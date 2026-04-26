import { NextRequest, NextResponse } from 'next/server';
import {
  getDictationByIdWithRequest,
  initOfflineDictationTableWithRequest,
  resetDictationForRetranscribeWithRequest,
} from '@/lib/offlineDictationDb';
import { deleteCorrectionLogByDictationIdWithRequest, initCorrectionLogTableWithRequest } from '@/lib/correctionLogDb';
import { nudgeWorker } from '@/lib/backgroundWorker';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * POST: Re-transcribe a dictation from scratch.
 * - Deletes all correction logs for the dictation
 * - Resets the dictation to 'pending' status (clears all text fields, segments)
 * - Triggers the background worker to re-process it
 */
export async function POST(req: NextRequest) {
  try {
    await initOfflineDictationTableWithRequest(req);
    await initCorrectionLogTableWithRequest(req);

    const { dictationId } = await req.json();

    if (!dictationId) {
      return NextResponse.json({ error: 'dictationId required' }, { status: 400 });
    }

    // Verify dictation exists
    const dictation = await getDictationByIdWithRequest(req, dictationId);
    if (!dictation) {
      return NextResponse.json({ error: 'Dictation not found' }, { status: 404 });
    }

    console.log(`[ReTranscribe] Starting re-transcription for dictation #${dictationId}`);

    // Step 1: Delete all correction logs
    await deleteCorrectionLogByDictationIdWithRequest(req, dictationId);
    console.log(`[ReTranscribe] ✓ Correction logs deleted for dictation #${dictationId}`);

    // Step 2: Reset dictation to pending (clears all text, segments, scores)
    await resetDictationForRetranscribeWithRequest(req, dictationId);
    console.log(`[ReTranscribe] ✓ Dictation #${dictationId} reset to pending`);

    // Step 3: Trigger background worker to process it
    nudgeWorker();
    console.log(`[ReTranscribe] ✓ Worker triggered for dictation #${dictationId}`);

    return NextResponse.json({
      success: true,
      message: `Diktat #${dictationId} wird erneut transkribiert`,
      dictationId,
    });

  } catch (error: any) {
    console.error('[ReTranscribe] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
