import { NextRequest, NextResponse } from 'next/server';
import { getPoolForRequest } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toNumber(value: unknown): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(req: NextRequest) {
    try {
        const db = await getPoolForRequest(req);

        // Nutzer pro Abteilung zählen
        const [userRows] = await db.execute<any[]>(`
            SELECT
                COALESCE(NULLIF(TRIM(u.department), ''), '(ohne Abteilung)') AS department,
                COUNT(DISTINCT u.username) AS user_count
            FROM users u
            GROUP BY department
            ORDER BY department ASC
        `);

        // Diktierzeit (online_usage_events) und Wörterbuch-Einträge pro Abteilung
        const [usageRows] = await db.execute<any[]>(`
            SELECT
                COALESCE(NULLIF(TRIM(u.department), ''), '(ohne Abteilung)') AS department,
                COALESCE(SUM(o.audio_duration_seconds), 0) AS total_audio_duration_seconds,
                COALESCE(SUM(o.word_count), 0) AS total_word_count,
                COALESCE(SUM(o.utterance_count), 0) AS total_utterances
            FROM users u
            LEFT JOIN online_usage_events o ON LOWER(o.username) = LOWER(u.username)
            GROUP BY department
            ORDER BY department ASC
        `);

        // Wörterbuch-Einträge pro Abteilung
        const [dictRows] = await db.execute<any[]>(`
            SELECT
                COALESCE(NULLIF(TRIM(u.department), ''), '(ohne Abteilung)') AS department,
                COUNT(d.id) AS dictionary_entry_count
            FROM users u
            LEFT JOIN dictionary_entries d ON LOWER(d.username) = LOWER(u.username)
            GROUP BY department
            ORDER BY department ASC
        `);

        // Private Templates pro Abteilung
        const [templateRows] = await db.execute<any[]>(`
            SELECT
                COALESCE(NULLIF(TRIM(u.department), ''), '(ohne Abteilung)') AS department,
                COUNT(t.id) AS template_count
            FROM users u
            LEFT JOIN templates t ON LOWER(t.username) = LOWER(u.username)
            GROUP BY department
            ORDER BY department ASC
        `);

        // Gruppen-Bausteine pro Abteilung
        // Zähle template_group_entries für Gruppen, deren Mitglieder in der Abteilung sind
        const [groupTemplateRows] = await db.execute<any[]>(`
            SELECT
                COALESCE(NULLIF(TRIM(u.department), ''), '(ohne Abteilung)') AS department,
                COUNT(DISTINCT e.id) AS group_template_count
            FROM users u
            LEFT JOIN dictionary_group_members gm ON LOWER(gm.username) = LOWER(u.username)
            LEFT JOIN template_group_entries e ON e.group_id = gm.group_id
            GROUP BY department
            ORDER BY department ASC
        `);

        // Ergebnisse zusammenführen
        const usageMap = new Map<string, any>();
        for (const row of usageRows) {
            usageMap.set(row.department, row);
        }

        const dictMap = new Map<string, number>();
        for (const row of dictRows) {
            dictMap.set(row.department, toNumber(row.dictionary_entry_count));
        }

        const templateMap = new Map<string, number>();
        for (const row of templateRows) {
            templateMap.set(row.department, toNumber(row.template_count));
        }

        const groupTemplateMap = new Map<string, number>();
        for (const row of groupTemplateRows) {
            groupTemplateMap.set(row.department, toNumber(row.group_template_count));
        }

        const departments = userRows.map((userRow: any) => {
            const dept = userRow.department;
            const usage = usageMap.get(dept) || {};
            return {
                department: dept,
                user_count: toNumber(userRow.user_count),
                total_audio_duration_seconds: toNumber(usage.total_audio_duration_seconds),
                total_word_count: toNumber(usage.total_word_count),
                total_utterances: toNumber(usage.total_utterances),
                dictionary_entry_count: dictMap.get(dept) || 0,
                template_count: templateMap.get(dept) || 0,
                group_template_count: groupTemplateMap.get(dept) || 0,
            };
        });

        return NextResponse.json({
            timestamp: new Date().toISOString(),
            departments,
        });
    } catch (error: any) {
        console.error('[API] Department Stats Error:', error);
        return NextResponse.json(
            { error: 'Fehler beim Laden der Abteilungsstatistik', details: error.message },
            { status: 500 }
        );
    }
}
