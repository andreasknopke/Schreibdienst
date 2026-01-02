import { NextRequest, NextResponse } from 'next/server';
import {
  getCorrectionLogByDictationIdWithRequest,
  getCorrectionLogStatsWithRequest,
  initCorrectionLogTableWithRequest,
} from '@/lib/correctionLogDb';

export const runtime = 'nodejs';

// GET: Get correction logs for a dictation
export async function GET(req: NextRequest) {
  try {
    await initCorrectionLogTableWithRequest(req);
    
    const { searchParams } = new URL(req.url);
    const dictationId = searchParams.get('dictationId');
    const stats = searchParams.get('stats') === 'true';
    
    if (!dictationId) {
      return NextResponse.json({ error: 'dictationId required' }, { status: 400 });
    }
    
    const id = parseInt(dictationId);
    if (isNaN(id)) {
      return NextResponse.json({ error: 'Invalid dictationId' }, { status: 400 });
    }
    
    if (stats) {
      // Get statistics
      const statistics = await getCorrectionLogStatsWithRequest(req, id);
      return NextResponse.json(statistics);
    } else {
      // Get full log entries
      const logs = await getCorrectionLogByDictationIdWithRequest(req, id);
      return NextResponse.json(logs);
    }
  } catch (error: any) {
    console.error('[Correction Log] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
