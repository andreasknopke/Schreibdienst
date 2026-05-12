import { NextRequest, NextResponse } from 'next/server';
import { getPoolForRequest } from '@/lib/db';
import { initOnlineUsageTableWithRequest } from '@/lib/onlineUsageDb';
import os from 'os';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PeriodKey = 'today' | 'month' | 'year' | 'allTime';

const PERIODS: Array<{ key: PeriodKey; label: string; where: string }> = [
    { key: 'today', label: 'Heute', where: 'created_at >= CURDATE()' },
    { key: 'month', label: 'Dieser Monat', where: "created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')" },
    { key: 'year', label: 'Dieses Jahr', where: 'created_at >= MAKEDATE(YEAR(CURDATE()), 1)' },
    { key: 'allTime', label: 'Gesamt', where: '1=1' },
];

function toNumber(value: unknown): number {
    const parsed = Number(value ?? 0);
    return Number.isFinite(parsed) ? parsed : 0;
}

function emptyOnlineSummary(label: string) {
    return {
        label,
        totals: {
            users: 0,
            utterances: 0,
            words: 0,
            minutes: 0,
            manualCorrections: 0,
            vocabularyEntries: 0,
        },
        users: [] as Array<{
            username: string;
            utterances: number;
            words: number;
            minutes: number;
            manualCorrections: number;
            vocabularyEntries: number;
        }>,
    };
}

async function getOnlineUsageByPeriod(db: any) {
    const summaries = {} as Record<PeriodKey, ReturnType<typeof emptyOnlineSummary>>;

    for (const period of PERIODS) {
        const summary = emptyOnlineSummary(period.label);

            const [usageRows] = await db.query(`
            SELECT
                username,
                SUM(utterance_count) AS utterances,
                SUM(word_count) AS words,
                SUM(audio_duration_seconds) / 60 AS minutes,
                SUM(manual_corrections) AS manual_corrections
            FROM online_usage_events
            WHERE ${period.where}
            GROUP BY username
        `);

            const [vocabularyRows] = await db.query(`
            SELECT username, COUNT(*) AS vocabulary_entries
            FROM dictionary_entries
            WHERE ${period.where.replaceAll('created_at', 'added_at')}
            GROUP BY username
        `);

        const rowsByUser = new Map<string, any>();
        for (const row of usageRows as any[]) {
            const username = String(row.username || 'unknown').toLowerCase();
            rowsByUser.set(username, {
                username,
                utterances: toNumber(row.utterances),
                words: toNumber(row.words),
                minutes: toNumber(row.minutes),
                manualCorrections: toNumber(row.manual_corrections),
                vocabularyEntries: 0,
            });
        }

        for (const row of vocabularyRows as any[]) {
            const username = String(row.username || 'unknown').toLowerCase();
            const existing = rowsByUser.get(username) || {
                username,
                utterances: 0,
                words: 0,
                minutes: 0,
                manualCorrections: 0,
                vocabularyEntries: 0,
            };
            existing.vocabularyEntries = toNumber(row.vocabulary_entries);
            rowsByUser.set(username, existing);
        }

        summary.users = Array.from(rowsByUser.values()).sort((a, b) => b.words - a.words || b.minutes - a.minutes);
        summary.totals = summary.users.reduce((totals, user) => ({
            users: totals.users + (user.words || user.utterances || user.minutes || user.manualCorrections || user.vocabularyEntries ? 1 : 0),
            utterances: totals.utterances + user.utterances,
            words: totals.words + user.words,
            minutes: totals.minutes + user.minutes,
            manualCorrections: totals.manualCorrections + user.manualCorrections,
            vocabularyEntries: totals.vocabularyEntries + user.vocabularyEntries,
        }), summary.totals);

        summaries[period.key] = summary;
    }

    return summaries;
}

async function getOnlineTrend(db: any) {
    const [usageRows] = await db.query(`
        SELECT
            DATE(created_at) AS day,
            SUM(word_count) AS words,
            SUM(audio_duration_seconds) / 60 AS minutes,
            SUM(utterance_count) AS utterances,
            SUM(manual_corrections) AS manual_corrections
        FROM online_usage_events
        WHERE created_at >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)
        GROUP BY DATE(created_at)
        ORDER BY day ASC
    `);

    const [vocabularyRows] = await db.query(`
        SELECT DATE(added_at) AS day, COUNT(*) AS vocabulary_entries
        FROM dictionary_entries
        WHERE added_at >= DATE_SUB(CURDATE(), INTERVAL 29 DAY)
        GROUP BY DATE(added_at)
    `);

    const byDay = new Map<string, any>();
    for (let offset = 29; offset >= 0; offset--) {
        const date = new Date();
        date.setDate(date.getDate() - offset);
        const key = date.toISOString().slice(0, 10);
        byDay.set(key, { day: key, words: 0, minutes: 0, utterances: 0, manualCorrections: 0, vocabularyEntries: 0 });
    }

    for (const row of usageRows as any[]) {
        const key = new Date(row.day).toISOString().slice(0, 10);
        const existing = byDay.get(key);
        if (existing) {
            existing.words = toNumber(row.words);
            existing.minutes = toNumber(row.minutes);
            existing.utterances = toNumber(row.utterances);
            existing.manualCorrections = toNumber(row.manual_corrections);
        }
    }

    for (const row of vocabularyRows as any[]) {
        const key = new Date(row.day).toISOString().slice(0, 10);
        const existing = byDay.get(key);
        if (existing) {
            existing.vocabularyEntries = toNumber(row.vocabulary_entries);
        }
    }

    return Array.from(byDay.values());
}

async function getProviderBreakdown(db: any) {
    const [rows] = await db.query(`
        SELECT COALESCE(provider, 'unknown') AS provider, COUNT(*) AS requests, SUM(word_count) AS words
        FROM online_usage_events
        WHERE event_type = 'utterance'
        GROUP BY COALESCE(provider, 'unknown')
        ORDER BY requests DESC
    `);

    return (rows as any[]).map((row) => ({
        provider: row.provider,
        requests: toNumber(row.requests),
        words: toNumber(row.words),
    }));
}

export async function GET(req: NextRequest) {
    try {
        const db = await getPoolForRequest(req);
        await initOnlineUsageTableWithRequest(req);

        const start = performance.now();
        await db.query('SELECT 1');
        const dbLatency = Math.round(performance.now() - start);

        const [sizeRows] = await db.query(`
            SELECT 
                table_schema as name, 
                ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) as size_mb 
            FROM information_schema.TABLES 
            WHERE table_schema = DATABASE()
            GROUP BY table_schema
        `);

        const [statusRows] = await db.query<any[]>(`
            SELECT COALESCE(status, 'unknown') as status, COUNT(*) as count 
            FROM offline_dictations 
            GROUP BY status
        `);

        const jobStats = {
            total: 0,
            pending: 0,
            processing: 0,
            completed: 0,
            error: 0,
            stats_by_status: {} as Record<string, number>
        };

        statusRows.forEach((row: any) => {
            const count = toNumber(row.count);
            jobStats.total += count;
            jobStats.stats_by_status[row.status] = count;
            if (row.status === 'pending') jobStats.pending = count;
            if (row.status === 'processing') jobStats.processing = count;
            if (row.status === 'completed') jobStats.completed = count;
            if (row.status === 'error') jobStats.error = count;
        });

        const [perfRows] = await db.query<any[]>(`
            SELECT 
                AVG(audio_duration_seconds) as avg_audio_duration,
                AVG(TIMESTAMPDIFF(SECOND, processing_started_at, completed_at)) as avg_processing_time,
                AVG(CASE WHEN audio_duration_seconds > 0 THEN TIMESTAMPDIFF(SECOND, processing_started_at, completed_at) / audio_duration_seconds ELSE NULL END) as avg_processing_factor
            FROM offline_dictations 
            WHERE status = 'completed' 
            AND processing_started_at IS NOT NULL 
            AND completed_at IS NOT NULL
            AND audio_duration_seconds > 0
            ORDER BY created_at DESC 
            LIMIT 100
        `);

        const [llmRows] = await db.query<any[]>(`SELECT count(*) as count FROM correction_log WHERE correction_type = 'llm'`);
        const performanceStats = perfRows[0] || {};

        const [onlineUsage, trend, providerBreakdown] = await Promise.all([
            getOnlineUsageByPeriod(db),
            getOnlineTrend(db),
            getProviderBreakdown(db),
        ]);

        const systemStats = {
            uptime_seconds: os.uptime(),
            load_average: os.loadavg(),
            memory: {
                total_mb: Math.round(os.totalmem() / 1024 / 1024),
                free_mb: Math.round(os.freemem() / 1024 / 1024),
                process_usage_mb: Math.round(process.memoryUsage().rss / 1024 / 1024)
            },
            cpus: os.cpus().length,
            platform: os.platform(),
            arch: os.arch()
        };

        return NextResponse.json({
            timestamp: new Date().toISOString(),
            online: {
                periods: onlineUsage,
                trend,
                providerBreakdown,
            },
            system: systemStats,
            database: {
                latency_ms: dbLatency,
                size_mb: (sizeRows as any[])[0]?.size_mb || 0,
                db_name: (sizeRows as any[])[0]?.name || 'unknown'
            },
            jobs: {
                counts: jobStats,
                performance: {
                    avg_audio_duration_sec: Number(performanceStats.avg_audio_duration || 0).toFixed(2),
                    avg_processing_time_sec: Number(performanceStats.avg_processing_time || 0).toFixed(2),
                    avg_processing_factor: Number(performanceStats.avg_processing_factor || 0).toFixed(2),
                    note: 'Based on last 100 completed jobs'
                },
                llm_corrections: {
                    total_count: toNumber(llmRows[0]?.count)
                }
            }
        });
    } catch (error: any) {
        console.error('[API] Stats Error:', error);
        return NextResponse.json(
            { error: 'Failed to fetch stats', details: error.message },
            { status: 500 }
        );
    }
}
