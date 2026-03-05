import { NextRequest } from 'next/server';
import { processAllPending, getWorkerState } from '@/lib/dictationProcessor';

// ============================================================
// Background Worker – runs an auto-polling loop inside the
// Node.js process, completely independent of HTTP requests.
// ============================================================

const POLL_INTERVAL_MS = 8_000;   // Check for new work every 8 seconds
const BATCH_SIZE = 5;              // Process up to 5 dictations per cycle

let intervalId: ReturnType<typeof setInterval> | null = null;
let consecutiveErrors = 0;

/**
 * Build a synthetic NextRequest so the existing WithRequest DB helpers
 * route to the default pool (no x-db-token → falls back to env vars).
 */
function makeSyntheticRequest(): NextRequest {
  return new NextRequest('http://localhost/background-worker', {
    method: 'GET',
    headers: {},
  });
}

async function tick() {
  const { isProcessing } = getWorkerState();
  if (isProcessing) return; // another cycle is still running

  try {
    const req = makeSyntheticRequest();
    const { processed, errors } = await processAllPending(req, BATCH_SIZE);

    if (processed > 0 || errors > 0) {
      console.log(`[BackgroundWorker] Cycle done: ${processed} processed, ${errors} errors`);
    }
    consecutiveErrors = 0;
  } catch (err: any) {
    consecutiveErrors++;
    console.error(`[BackgroundWorker] Tick error (${consecutiveErrors}):`, err.message);
  }
}

/** Start the background polling loop. Idempotent – calling twice is safe. */
export function startBackgroundWorker() {
  if (intervalId) return;
  console.log(`[BackgroundWorker] Starting auto-polling every ${POLL_INTERVAL_MS / 1000}s`);
  intervalId = setInterval(tick, POLL_INTERVAL_MS);
  // Run an initial tick after a short delay to let the server finish booting
  setTimeout(tick, 3_000);
}

/** Stop the background polling loop. */
export function stopBackgroundWorker() {
  if (!intervalId) return;
  clearInterval(intervalId);
  intervalId = null;
  console.log('[BackgroundWorker] Stopped');
}

/** Signal the worker to process immediately (non-blocking). */
export function nudgeWorker() {
  // Fire off a tick without awaiting – caller gets instant response
  tick().catch(() => {});
}
