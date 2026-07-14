import { NextRequest, NextResponse } from 'next/server';
import { getPoolForRequest } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function toNumber(value: unknown): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function pad2(value: number): string {
    return String(value).padStart(2, '0');
}

/**
 * Baut eine WHERE-Klausel für den Zeitfilter.
 * Unterstützte Modi:
 *   - Kein Param / 'all' / 'gesamt' → kein Filter (alle Zeiten)
 *   - 'year-YYYY' → filtert auf das Jahr
 *   - 'YYYY-MM' → filtert auf den Monat
 */
function buildTimeFilter(monthParam: string | null): { clause: string; params: string[] } {
    if (!monthParam || monthParam === 'all' || monthParam === 'gesamt') {
        return { clause: '1=1', params: [] };
    }

    // year-2026 → Jahresfilter
    const yearMatch = /^year-(\d{4})$/.exec(monthParam);
    if (yearMatch) {
        const year = yearMatch[1];
        return {
            clause: 'o.created_at >= ? AND o.created_at < ?',
            params: [`${year}-01-01 00:00:00`, `${Number(year) + 1}-01-01 00:00:00`],
        };
    }

    // YYYY-MM → Monatsfilter
    const monthMatch = /^(\d{4})-(\d{2})$/.exec(monthParam);
    if (monthMatch) {
        const [_, year, month] = monthMatch;
        const nextMonth = Number(month) === 12 ? `01` : pad2(Number(month) + 1);
        const nextYear = Number(month) === 12 ? String(Number(year) + 1) : year;
        return {
            clause: 'o.created_at >= ? AND o.created_at < ?',
            params: [`${year}-${month}-01 00:00:00`, `${nextYear}-${nextMonth}-01 00:00:00`],
        };
    }

    return { clause: '1=1', params: [] };
}

export async function GET(req: NextRequest) {
    try {
        const db = await getPoolForRequest(req);
        const { searchParams } = new URL(req.url);
        const monthParam = searchParams.get('month');
        const timeFilter = buildTimeFilter(monthParam);

        // Nutzer pro Abteilung zählen (immer alle Nutzer, unabhängig vom Zeitfilter)
        const [userRows] = await db.execute<any[]>(`
            SELECT
                COALESCE(NULLIF(TRIM(u.department), ''), '(ohne Abteilung)') AS department,
                COUNT(DISTINCT u.username) AS user_count
            FROM users u
            GROUP BY department
            ORDER BY department ASC
        `);

        // Diktierzeit (online_usage_events) mit optionalem Zeitfilter
        const [usageRows] = await db.execute<any[]>(
            `
            SELECT
                COALESCE(NULLIF(TRIM(u.department), ''), '(ohne Abteilung)') AS department,
                COALESCE(SUM(o.audio_duration_seconds), 0) AS total_audio_duration_seconds,
                COALESCE(SUM(o.word_count), 0) AS total_word_count,
                COALESCE(SUM(o.utterance_count), 0) AS total_utterances
            FROM users u
            LEFT JOIN online_usage_events o ON LOWER(o.username) = LOWER(u.username)
                AND ${timeFilter.clause}
            GROUP BY department
            ORDER BY department ASC
        `,
            timeFilter.params
        );

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
            period: monthParam || 'all',
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
