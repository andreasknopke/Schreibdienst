/**
 * Reusable Voxtral local transcription + WER utilities.
 *
 * `transcribeBufferWithVoxtral` is the factored core of
 * `transcribeWithVoxtralLocal` from app/api/transcribe/route.ts. It is used by:
 *   - app/api/training-samples/verify/route.ts    (training success check)
 *   - future re-uses (model ablation, batch tests)
 *
 * The function does NOT apply any dictionary / formatting corrections –
 * this is intentional: the goal is to measure raw model quality.
 */

import { normalizeAudioForWhisper } from './audioCompression';

export interface VoxtralTranscriptionResult {
  text: string;
  language: string;
  model: string;
  durationMs: number;
}

/**
 * Transcribe an arbitrary audio buffer with the local Voxtral (vLLM) server.
 * The audio is normalised to 16kHz mono PCM WAV first.
 *
 * Throws Error on HTTP failure, missing URL, or empty response.
 */
export async function transcribeBufferWithVoxtral(
  audioBuffer: Buffer,
  mimeType: string,
  options: { temperature?: number; signal?: AbortSignal } = {}
): Promise<VoxtralTranscriptionResult> {
  const baseUrl = (process.env.VOXTRAL_LOCAL_URL || 'http://localhost:8000').replace(/\/+$/, '');
  if (!process.env.VOXTRAL_LOCAL_URL) {
    throw new Error('VOXTRAL_LOCAL_URL ist nicht konfiguriert');
  }
  const modelName = process.env.VOXTRAL_LOCAL_MODEL || 'mistralai/Voxtral-Mini-3B-2507';

  const startTime = Date.now();

  // Normalize to canonical 16kHz mono PCM WAV
  const { data: normData, mimeType: normMime, normalized } =
    await normalizeAudioForWhisper(audioBuffer, mimeType);
  const finalBuffer = normalized ? normData : audioBuffer;
  const finalMime = normalized ? normMime : mimeType;

  const formData = new FormData();
  const audioFile = new File([finalBuffer], 'audio.wav', { type: finalMime });
  formData.append('file', audioFile);
  formData.append('model', modelName);
  formData.append('language', 'de');
  formData.append('response_format', 'json');
  formData.append('temperature', String(options.temperature ?? 0));

  const res = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
    method: 'POST',
    body: formData,
    signal: options.signal,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Voxtral-Local API error (${res.status}): ${text.slice(0, 300)}`);
  }

  const data = await res.json();
  const transcriptionText = (data.text || '').trim();
  if (!transcriptionText) {
    throw new Error('Voxtral-Local lieferte leere Transkription');
  }

  return {
    text: transcriptionText,
    language: data.language || 'de',
    model: modelName,
    durationMs: Date.now() - startTime,
  };
}

// ============================================================
// WER / Levenshtein helper
// ============================================================

/**
 * Tokenise a German sentence into lowercase words (Umlaute preserved).
 * Strips punctuation but keeps word characters (incl. äöüß).
 */
function tokenize(text: string): string[] {
  if (!text) return [];
  const lower = text.toLowerCase();
  const matches = lower.match(/[a-zäöüß0-9]+/gi);
  return matches || [];
}

/**
 * Standard Levenshtein over two token arrays (Levenshtein-word-level).
 * Returns substitutions / deletions / insertions.
 */
function tokenLevenshtein(a: string[], b: string[]) {
  const m = a.length;
  const n = b.length;
  if (m === 0) return { distance: n, subs: 0, del: n, ins: 0 };
  if (n === 0) return { distance: m, subs: 0, del: 0, ins: m };

  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,     // deletion
        dp[i][j - 1] + 1,     // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }
  return { distance: dp[m][n], subs: 0, del: 0, ins: 0 };
}

export interface WerResult {
  wer: number;          // 0..1 (1.0 = 100% wrong)
  errorCount: number;   // absolute token-level edit distance
  refTokens: number;    // tokens in reference (corrected) text
  hypTokens: number;    // tokens in hypothesis (model output)
}

/**
 * Compute word-error-rate between hypothesis (model output) and reference
 * (curated corrected text). Reference token count = denominator.
 * If reference is empty, WER is undefined and returned as null fields.
 */
export function computeWer(hypothesis: string, reference: string): WerResult {
  const hyp = tokenize(hypothesis);
  const ref = tokenize(reference);
  if (ref.length === 0) {
    return { wer: 0, errorCount: hyp.length, refTokens: 0, hypTokens: hyp.length };
  }
  const { distance } = tokenLevenshtein(hyp, ref);
  return {
    wer: distance / ref.length,
    errorCount: distance,
    refTokens: ref.length,
    hypTokens: hyp.length,
  };
}

// ============================================================
// Diff for visualisation (word level)
// ============================================================

export interface DiffSegment {
  type: 'equal' | 'insert' | 'delete';
  value: string;
}

/**
 * Word-level diff between voxtral_raw_text (original wrong transcription) and
 * last_verify_text (current transcription). Used for visualising remaining
 * errors after retraining.
 *
 * Uses the diffWordsWithSpace algorithm via the 'diff' package to stay
 * consistent with the rest of the codebase.
 */
export function computeWordDiff(hypothesis: string, reference: string): DiffSegment[] {
  // Lazy import so unused paths don't fail on server-only contexts
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { diffWordsWithSpace } = require('diff') as typeof import('diff');
  // diffWords returns parts relative to reference; we view reference as truth,
  // hypothesis as system output. We swap so "removed" = missing from hypothesis
  // (= error in transcription), "added" = extra in hypothesis.
  const parts = diffWordsWithSpace(reference, hypothesis);
  return parts.map((p) => ({
    type: p.added ? 'insert' : (p.removed ? 'delete' : 'equal'),
    value: p.value,
  }));
}
