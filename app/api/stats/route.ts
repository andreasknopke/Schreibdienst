import { NextRequest, NextResponse } from 'next/server';
import { getPoolForRequest } from '@/lib/db';
import os from 'os';

export const runtime = 'nodejs';

export async function GET(req: NextRequest) {
  try {
    const db = await getPoolForRequest(req);
    
    // 1. Performance / Latency Check
    const start = performance.now();
    await db.query('SELECT 1');
    const dbLatency = Math.round(performance.now() - start);

    // 2. Database Size
    // Note: This sums up all tables in the accessible database
    const [sizeRows] = await db.query(`
      SELECT 
        table_schema as name, 
        ROUND(SUM(data_length + index_length) / 1024 / 1024, 2) as size_mb 
      FROM information_schema.TABLES 
      WHERE table_schema = DATABASE()
      GROUP BY table_schema
    `);

    // 3. Job Statistics (Orders/Dictations)
    // Counts by status
    const [statusRows] = await db.query<any[]>(`
        SELECT 
            COALESCE(status, 'unknown') as status, 
            COUNT(*) as count 
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
        jobStats.total += row.count;
        jobStats.stats_by_status[row.status] = row.count;
        if (row.status === 'pending') jobStats.pending = row.count;
        if (row.status === 'processing') jobStats.processing = row.count;
        if (row.status === 'completed') jobStats.completed = row.count;
        if (row.status === 'error') jobStats.error = row.count;
    });

    // 4. Time Statistics for Audiotranscription & Processing
    // We look at the last 100 completed jobs to get relevant averages
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

    const performanceStats = perfRows[0] || {};

    // 5. LLM Correction Statistics
    // Count total corrections
    const [llmRows] = await db.query<any[]>(`
        SELECT count(*) as count FROM correction_log WHERE correction_type = 'llm'
    `);
    
    // 6. DB Response Times (simulated with latency above, but technically we could log slow queries if we had a log table)

    // 7. System Stats
    const systemStats = {
        uptime_seconds: os.uptime(),
        load_average: os.loadavg(), // [1min, 5min, 15min]
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
                avg_processing_factor: Number(performanceStats.avg_processing_factor || 0).toFixed(2), // 0.5 means processing takes half the audio time
                note: "Based on last 100 completed jobs"
            },
            llm_corrections: {
                total_count: llmRows[0]?.count || 0
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
