import { NextRequest, NextResponse } from 'next/server';
import { getWorkerState } from '@/lib/dictationProcessor';
import { nudgeWorker } from '@/lib/backgroundWorker';

export const runtime = 'nodejs';
export const maxDuration = 60; // Only needs a short timeout now – no heavy processing here

/**
 * POST: Signal the background worker to check for and process pending dictations.
 * Returns immediately – processing happens asynchronously in the background.
 */
export async function POST(req: NextRequest) {
  try {
    const { isProcessing, lastProcessTime } = getWorkerState();

    // Signal the background worker to run a cycle immediately
    nudgeWorker();

    return NextResponse.json({
      message: isProcessing ? 'Worker already processing – nudged' : 'Worker triggered',
      isProcessing,
      lastProcessTime,
      lastProcessTimeAgo: lastProcessTime
        ? `${Math.round((Date.now() - lastProcessTime) / 1000)}s ago`
        : 'never',
    });
  } catch (error: any) {
    console.error('[Worker Route] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * GET: Return current worker status.
 */
export async function GET() {
  const { isProcessing, lastProcessTime } = getWorkerState();
  return NextResponse.json({
    isProcessing,
    lastProcessTime,
    lastProcessTimeAgo: lastProcessTime
      ? `${Math.round((Date.now() - lastProcessTime) / 1000)}s ago`
      : 'never',
  });
}
