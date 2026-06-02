import { NextRequest, NextResponse } from 'next/server';
import { getPoolForRequest } from '@/lib/db';
import { initOnlineUsageTableWithRequest } from '@/lib/onlineUsageDb';
import os from 'os';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type PeriodKey = 'today' | 'month' | 'year' | 'allTime';

type ChartPoint = {
    key: string;
    label: string;
    title: string;
    words: number;
    minutes: number;
    utterances: number;
    manualCorrections: number;
    vocabularyEntries: number;
};

const PERIODS: Array<{ key: PeriodKey; label: string; where: string; whereDateColumn: 'created_at' | 'added_at' }> = [
    { key: 'today', label: 'Heute', where: 'created_at >= CURDATE()', whereDateColumn: 'created_at' },
    { key: 'month', label: 'Dieser Monat', where: "created_at >= DATE_FORMAT(CURDATE(), '%Y-%m-01')", whereDateColumn: 'created_at' },
    { key: 'year', label: 'Dieses Jahr', where: 'created_at >= MAKEDATE(YEAR(CURDATE()), 1)', whereDateColumn: 'created_at' },
    { key: 'allTime', label: 'Gesamt', where: '1=1', whereDateColumn: 'created_at' },
];

const MONTH_LABEL = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });

function pad2(value: number): string {
    return String(value).padStart(2, '0');
}

function formatMonthKey(date: Date): string {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

function parseMonthKey(value: string): Date | null {
    const match = /^(\d{4})-(\d{2})$/.exec(value);
    if (!match) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) return null;
    return new Date(year, month - 1, 1);
}

function getCurrentMonthKey(): string {
    return formatMonthKey(new Date());
}

function buildMonthPeriodClause(start: Date, end: Date, dateColumn: 'created_at' | 'added_at') {
    const startStr = `${formatMonthKey(start)}-01`;
    const endStr = `${formatMonthKey(end)}-${pad2(new Date(end.getFullYear(), end.getMonth() + 1, 0).getDate())}`;
    return {
        where: `${dateColumn} BETWEEN ? AND ?`,
        params: [`${startStr} 00:00:00`, `${endStr} 23:59:59`],
    };
}

function buildPeriodForMonth(monthKey: string, dateColumn: 'created_at' | 'added_at') {
    const requested = parseMonthKey(monthKey);
    const start = requested ?? new Date();
    const monthDate = new Date(start.getFullYear(), start.getMonth(), 1);
    const end = new Date(start.getFullYear(), start.getMonth() + 1, 0);
    return {
        label: MONTH_LABEL.format(monthDate),
        monthDate,
        monthEnd: end,
        ...buildMonthPeriodClause(monthDate, monthDate, dateColumn),
    };
}

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

async function getOnlineUsageByPeriod(db: any, monthKey: string) {
    const summaries = {} as Record<PeriodKey, ReturnType<typeof emptyOnlineSummary>>;

    for (const period of PERIODS) {
        const isMonth = period.key === 'month';
        const monthClause = isMonth ? buildPeriodForMonth(monthKey, period.whereDateColumn) : null;
        const whereClause = isMonth ? monthClause!.where : period.where;
        const whereParams = isMonth ? monthClause!.params : [];
        const summary = emptyOnlineSummary(isMonth ? monthClause!.label : period.label);

        const [usageRows] = await db.query(
            `
            SELECT
                username,
                SUM(utterance_count) AS utterances,
                SUM(word_count) AS words,
                SUM(audio_duration_seconds) / 60 AS minutes,
                SUM(manual_corrections) AS manual_corrections
            FROM online_usage_events
            WHERE ${whereClause}
            GROUP BY username
        `,
            whereParams
        );

        const vocabWhereClause = isMonth
            ? buildPeriodForMonth(monthKey, 'added_at').where
            : period.where.replaceAll('created_at', 'added_at');
        const vocabWhereParams = isMonth
            ? buildPeriodForMonth(monthKey, 'added_at').params
            : [];

        const [vocabularyRows] = await db.query(
            `
            SELECT username, COUNT(*) AS vocabulary_entries
            FROM dictionary_entries
            WHERE ${vocabWhereClause}
            GROUP BY username
        `,
            vocabWhereParams
        );

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

function createChartPoint(key: string, label: string, title: string): ChartPoint {
    return {
        key,
        label,
        title,
        words: 0,
        minutes: 0,
        utterances: 0,
        manualCorrections: 0,
        vocabularyEntries: 0,
    };
}

function pad2(value: number): string {
    return String(value).padStart(2, '0');
}

function monthKey(date: Date): string {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}`;
}

function monthLabel(date: Date): string {
    return date.toLocaleDateString('de-DE', { month: 'long' });
}

function monthTitle(date: Date): string {
    return date.toLocaleDateString('de-DE', { month: 'long', year: 'numeric' });
}

function dayKey(date: Date): string {
    return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function dayLabel(date: Date): string {
    return String(date.getDate());
}

function dayTitle(date: Date): string {
    return date.toLocaleDateString('de-DE');
}

function parseDateKey(dateKey: string): Date {
    const [year, month, day] = dateKey.split('-').map((part) => Number(part));
    return new Date(year, month - 1, day);
}

async function getOnlineTrends(db: any, monthKey: string) {
    const trends = {} as Record<PeriodKey, ChartPoint[]>;
    const [currentDateRows] = await db.query(`SELECT DATE_FORMAT(CURDATE(), '%Y-%m-%d') AS current_day`);
    const currentDayKey = String((currentDateRows as any[])[0]?.current_day || new Date().toISOString().slice(0, 10));
    const currentDate = parseDateKey(currentDayKey);

    const [todayUsageRows] = await db.query(`
        SELECT
            username,
            SUM(word_count) AS words,
            SUM(audio_duration_seconds) / 60 AS minutes,
            SUM(utterance_count) AS utterances,
            SUM(manual_corrections) AS manual_corrections
        FROM online_usage_events
        WHERE created_at >= CURDATE()
        GROUP BY username
        ORDER BY words DESC, minutes DESC, utterances DESC
    `);

    const [todayVocabularyRows] = await db.query(`
        SELECT username, COUNT(*) AS vocabulary_entries
        FROM dictionary_entries
        WHERE added_at >= CURDATE()
        GROUP BY username
    `);

    const byUser = new Map<string, ChartPoint>();
    for (const row of todayUsageRows as any[]) {
        const username = String(row.username || 'unknown').toLowerCase();
        byUser.set(username, {
            ...createChartPoint(username, username, username),
            words: toNumber(row.words),
            minutes: toNumber(row.minutes),
            utterances: toNumber(row.utterances),
            manualCorrections: toNumber(row.manual_corrections),
        });
    }

    for (const row of todayVocabularyRows as any[]) {
        const username = String(row.username || 'unknown').toLowerCase();
        const existing = byUser.get(username) || createChartPoint(username, username, username);
        existing.vocabularyEntries = toNumber(row.vocabulary_entries);
        byUser.set(username, existing);
    }

    trends.today = Array.from(byUser.values()).sort((a, b) => b.words - a.words || b.minutes - a.minutes || b.utterances - a.utterances);

    const monthClause = buildPeriodForMonth(monthKey, 'created_at');
    const monthVocabClause = buildPeriodForMonth(monthKey, 'added_at');
    const [monthUsageRows] = await db.query(
        `
        SELECT
            DATE_FORMAT(created_at, '%Y-%m-%d') AS bucket,
            SUM(word_count) AS words,
            SUM(audio_duration_seconds) / 60 AS minutes,
            SUM(utterance_count) AS utterances,
            SUM(manual_corrections) AS manual_corrections
        FROM online_usage_events
        WHERE ${monthClause.where}
        GROUP BY DATE(created_at)
        ORDER BY bucket ASC
    `,
        monthClause.params
    );

    const [monthVocabularyRows] = await db.query(
        `
        SELECT DATE_FORMAT(added_at, '%Y-%m-%d') AS bucket, COUNT(*) AS vocabulary_entries
        FROM dictionary_entries
        WHERE ${monthVocabClause.where}
        GROUP BY DATE(added_at)
        ORDER BY bucket ASC
    `,
        monthVocabClause.params
    );

    const byMonthDay = new Map<string, ChartPoint>();
    const monthDate = monthClause.monthDate;
    const monthEnd = monthClause.monthEnd;
    const isCurrentMonth =
        monthDate.getFullYear() === currentDate.getFullYear() &&
        monthDate.getMonth() === currentDate.getMonth();
    const lastDay = isCurrentMonth ? currentDate.getDate() : monthEnd.getDate();
    const currentYear = currentDate.getFullYear();
    const currentMonth = currentDate.getMonth();

    for (let day = 1; day <= lastDay; day++) {
        const date = new Date(monthDate.getFullYear(), monthDate.getMonth(), day);
        const key = dayKey(date);
        byMonthDay.set(key, createChartPoint(key, dayLabel(date), dayTitle(date)));
    }

    for (const row of monthUsageRows as any[]) {
        const key = String(row.bucket);
        const existing = byMonthDay.get(key);
        if (existing) {
            existing.words = toNumber(row.words);
            existing.minutes = toNumber(row.minutes);
            existing.utterances = toNumber(row.utterances);
            existing.manualCorrections = toNumber(row.manual_corrections);
        }
    }

    for (const row of monthVocabularyRows as any[]) {
        const key = String(row.bucket);
        const existing = byMonthDay.get(key);
        if (existing) {
            existing.vocabularyEntries = toNumber(row.vocabulary_entries);
        }
    }

    trends.month = Array.from(byMonthDay.values());

    const [yearUsageRows] = await db.query(`
        SELECT
            DATE_FORMAT(created_at, '%Y-%m') AS bucket,
            SUM(word_count) AS words,
            SUM(audio_duration_seconds) / 60 AS minutes,
            SUM(utterance_count) AS utterances,
            SUM(manual_corrections) AS manual_corrections
        FROM online_usage_events
        WHERE created_at >= MAKEDATE(YEAR(CURDATE()), 1)
        GROUP BY DATE_FORMAT(created_at, '%Y-%m')
        ORDER BY bucket ASC
    `);

    const [yearVocabularyRows] = await db.query(`
        SELECT DATE_FORMAT(added_at, '%Y-%m') AS bucket, COUNT(*) AS vocabulary_entries
        FROM dictionary_entries
        WHERE added_at >= MAKEDATE(YEAR(CURDATE()), 1)
        GROUP BY DATE_FORMAT(added_at, '%Y-%m')
        ORDER BY bucket ASC
    `);

    const byYearMonth = new Map<string, ChartPoint>();
    for (let monthIndex = 0; monthIndex <= currentMonth; monthIndex++) {
        const date = new Date(currentYear, monthIndex, 1);
        const key = monthKey(date);
        byYearMonth.set(key, createChartPoint(key, monthLabel(date), monthTitle(date)));
    }

    for (const row of yearUsageRows as any[]) {
        const key = String(row.bucket);
        const existing = byYearMonth.get(key);
        if (existing) {
            existing.words = toNumber(row.words);
            existing.minutes = toNumber(row.minutes);
            existing.utterances = toNumber(row.utterances);
            existing.manualCorrections = toNumber(row.manual_corrections);
        }
    }

    for (const row of yearVocabularyRows as any[]) {
        const key = String(row.bucket);
        const existing = byYearMonth.get(key);
        if (existing) {
            existing.vocabularyEntries = toNumber(row.vocabulary_entries);
        }
    }

    trends.year = Array.from(byYearMonth.values());

    const [allTimeUsageRows] = await db.query(`
        SELECT
            DATE_FORMAT(created_at, '%Y-%m') AS bucket,
            SUM(word_count) AS words,
            SUM(audio_duration_seconds) / 60 AS minutes,
            SUM(utterance_count) AS utterances,
            SUM(manual_corrections) AS manual_corrections
        FROM online_usage_events
        GROUP BY DATE_FORMAT(created_at, '%Y-%m')
        ORDER BY bucket ASC
    `);

    const [allTimeVocabularyRows] = await db.query(`
        SELECT DATE_FORMAT(added_at, '%Y-%m') AS bucket, COUNT(*) AS vocabulary_entries
        FROM dictionary_entries
        GROUP BY DATE_FORMAT(added_at, '%Y-%m')
        ORDER BY bucket ASC
    `);

    const byAllTimeMonth = new Map<string, ChartPoint>();
    for (const row of allTimeUsageRows as any[]) {
        const key = String(row.bucket);
        const [year, month] = key.split('-').map((part) => Number(part));
        const date = new Date(year, month - 1, 1);
        byAllTimeMonth.set(
            key,
            createChartPoint(
                key,
                date.toLocaleDateString('de-DE', { month: 'long', year: '2-digit' }),
                monthTitle(date)
            )
        );
    }

    for (const row of allTimeVocabularyRows as any[]) {
        const key = String(row.bucket);
        if (!byAllTimeMonth.has(key)) {
            const [year, month] = key.split('-').map((part) => Number(part));
            const date = new Date(year, month - 1, 1);
            byAllTimeMonth.set(
                key,
                createChartPoint(
                    key,
                    date.toLocaleDateString('de-DE', { month: 'long', year: '2-digit' }),
                    monthTitle(date)
                )
            );
        }
    }

    for (const row of allTimeUsageRows as any[]) {
        const key = String(row.bucket);
        const existing = byAllTimeMonth.get(key);
        if (existing) {
            existing.words = toNumber(row.words);
            existing.minutes = toNumber(row.minutes);
            existing.utterances = toNumber(row.utterances);
            existing.manualCorrections = toNumber(row.manual_corrections);
        }
    }

    for (const row of allTimeVocabularyRows as any[]) {
        const key = String(row.bucket);
        const existing = byAllTimeMonth.get(key);
        if (existing) {
            existing.vocabularyEntries = toNumber(row.vocabulary_entries);
        }
    }

    trends.allTime = Array.from(byAllTimeMonth.entries())
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([, value]) => value);

    return trends;
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

        const url = new URL(req.url);
        const requestedMonth = url.searchParams.get('month');
        const monthKey = parseMonthKey(requestedMonth || '') ? (requestedMonth as string) : getCurrentMonthKey();

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

        const [onlineUsage, trends, providerBreakdown] = await Promise.all([
            getOnlineUsageByPeriod(db, monthKey),
            getOnlineTrends(db, monthKey),
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
                trends,
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
