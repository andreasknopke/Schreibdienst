import { NextRequest, NextResponse } from 'next/server';
import { 
  getRecoveryLogsWithRequest, 
  getRecoveryStatsWithRequest,
  clearOldLogsWithRequest,
  initWhisperRecoveryLogTableWithRequest,
  LogLevel,
  RecoveryAction
} from '@/lib/whisperRecoveryLogDb';

export const runtime = 'nodejs';

// GET: Fetch recovery logs and stats
export async function GET(req: NextRequest) {
  try {
    await initWhisperRecoveryLogTableWithRequest(req);
    
    const { searchParams } = new URL(req.url);
    const statsOnly = searchParams.get('stats') === 'true';
    const days = parseInt(searchParams.get('days') || '7');
    const limit = parseInt(searchParams.get('limit') || '100');
    const logLevel = searchParams.get('level') as LogLevel | null;
    const action = searchParams.get('action') as RecoveryAction | null;
    
    if (statsOnly) {
      const stats = await getRecoveryStatsWithRequest(req, days);
      return NextResponse.json(stats);
    }
    
    const logs = await getRecoveryLogsWithRequest(req, limit, {
      logLevel: logLevel || undefined,
      action: action || undefined
    });
    
    const stats = await getRecoveryStatsWithRequest(req, days);
    
    return NextResponse.json({
      logs,
      stats
    });
  } catch (error: any) {
    console.error('[WhisperX Recovery Logs] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE: Clear old logs
export async function DELETE(req: NextRequest) {
  try {
    await initWhisperRecoveryLogTableWithRequest(req);
    
    const { searchParams } = new URL(req.url);
    const daysToKeep = parseInt(searchParams.get('daysToKeep') || '30');
    
    const deletedCount = await clearOldLogsWithRequest(req, daysToKeep);
    
    return NextResponse.json({
      success: true,
      deletedCount,
      message: `${deletedCount} alte Log-Einträge gelöscht`
    });
  } catch (error: any) {
    console.error('[WhisperX Recovery Logs] DELETE error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
