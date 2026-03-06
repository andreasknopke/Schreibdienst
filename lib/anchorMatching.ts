/**
 * Anchor-Point Matching Algorithm for Mitlesen
 *
 * Aligns raw transcribed words (with timestamps) to LLM-corrected text words
 * using multi-pass anchor detection for robust timestamp mapping.
 *
 * Phases:
 * 1. N-gram anchors: unique multi-word sequences present in both texts
 * 2. Unique word anchors: single words appearing exactly once in both texts
 * 3. Order consistency: Longest Increasing Subsequence on original indices
 * 4. Gap filling: local greedy + fuzzy matching between anchors
 * 5. Timestamp interpolation for unmatched words
 */

// ---------- Types ----------

export interface AnchorOriginalWord {
  normalized: string;
  start: number;
  end: number;
}

export interface AnchorCorrectedWord {
  word: string;
  normalized: string;
  charPos: number;
}

export interface AnchorTimestampResult {
  word: string;
  start: number;
  end: number;
  isInterpolated: boolean;
  charPos: number;
}

interface Anchor {
  correctedIdx: number;
  originalIdx: number;
  ngramLength: number; // n-gram size that produced this match (0 = gap fill)
}

// ---------- Constants ----------

const GERMAN_STOP_WORDS = new Set([
  'der', 'die', 'das', 'den', 'dem', 'des',
  'ein', 'eine', 'einen', 'einem', 'einer', 'eines',
  'und', 'oder', 'aber', 'doch', 'sondern',
  'in', 'im', 'an', 'am', 'auf', 'um', 'bei', 'mit', 'nach', 'von', 'vom', 'zu', 'zum', 'zur',
  'für', 'über', 'unter', 'zwischen', 'vor', 'hinter', 'neben',
  'ist', 'sind', 'war', 'hat', 'haben', 'wird', 'werden', 'wurde', 'wurden',
  'nicht', 'kein', 'keine', 'keinen', 'keinem', 'keiner',
  'sich', 'es', 'er', 'sie', 'wir', 'ich',
  'als', 'auch', 'noch', 'schon', 'dann', 'so', 'da',
  'wie', 'was', 'wer', 'wo', 'wann',
  'sehr', 'nur', 'mehr', 'bereits',
  'dass', 'ob', 'wenn', 'weil', 'bis', 'seit',
  'kann', 'soll', 'muss', 'darf', 'will', 'möchte',
  'diese', 'dieser', 'dieses', 'diesem', 'diesen',
  'jede', 'jeder', 'jedes', 'jedem', 'jeden',
  'alle', 'aller', 'allem', 'allen',
  'hier', 'dort', 'nun', 'mal', 'denn',
]);

// ---------- Helpers ----------

/**
 * Build n-gram map: normalized key -> start indices.
 * Uses null-byte separator to avoid false matches across word boundaries.
 */
function buildNgramMap(
  words: { normalized: string }[],
  n: number,
  excludeIndices: Set<number>
): Map<string, number[]> {
  const map = new Map<string, number[]>();

  for (let i = 0; i <= words.length - n; i++) {
    let skip = false;
    const parts: string[] = [];
    for (let k = 0; k < n; k++) {
      if (excludeIndices.has(i + k) || !words[i + k].normalized) {
        skip = true;
        break;
      }
      parts.push(words[i + k].normalized);
    }
    if (skip) continue;

    const key = parts.join('\x00');
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(i);
  }

  return map;
}

/**
 * Fuzzy prefix match: two words match if they share a common prefix
 * of at least 4 characters that covers at least 60% of the shorter word.
 * Useful for matching "Blutdruck" ↔ "Blutdruckwert" or "untersucht" ↔ "Untersuchung".
 */
function fuzzyMatch(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const minLen = Math.min(a.length, b.length);
  if (minLen < 4) return false;
  let common = 0;
  for (let i = 0; i < minLen; i++) {
    if (a[i] === b[i]) common++;
    else break;
  }
  return common >= 4 && common >= minLen * 0.6;
}

// ---------- Phase 1: N-gram anchors ----------

/**
 * Find unique n-gram matches between original and corrected words.
 * Scans from longest n-gram down to bigrams, preferring longer matches.
 * Only n-grams that are unique in BOTH texts become anchors.
 */
function findNgramAnchors(
  original: AnchorOriginalWord[],
  corrected: AnchorCorrectedWord[],
  maxN: number = 5
): Anchor[] {
  const anchors: Anchor[] = [];
  const usedOrig = new Set<number>();
  const usedCorr = new Set<number>();

  for (let n = Math.min(maxN, Math.min(original.length, corrected.length)); n >= 2; n--) {
    const origMap = buildNgramMap(original, n, usedOrig);
    const corrMap = buildNgramMap(corrected, n, usedCorr);

    // Collect matches first, then apply (avoid modifying usedCorr while iterating)
    const newMatches: { ci: number; oi: number }[] = [];

    for (const [key, corrPositions] of corrMap) {
      if (corrPositions.length !== 1) continue;
      const origPositions = origMap.get(key);
      if (!origPositions || origPositions.length !== 1) continue;

      const ci = corrPositions[0];
      const oi = origPositions[0];

      // Verify no overlap with already-used words
      let overlap = false;
      for (let k = 0; k < n; k++) {
        if (usedOrig.has(oi + k) || usedCorr.has(ci + k)) {
          overlap = true;
          break;
        }
      }
      if (overlap) continue;

      newMatches.push({ ci, oi });
    }

    // Apply matches
    for (const { ci, oi } of newMatches) {
      for (let k = 0; k < n; k++) {
        anchors.push({
          correctedIdx: ci + k,
          originalIdx: oi + k,
          ngramLength: n,
        });
        usedOrig.add(oi + k);
        usedCorr.add(ci + k);
      }
    }
  }

  return anchors;
}

// ---------- Phase 2: Unique single-word anchors ----------

/**
 * Find words that appear exactly once in both texts (excluding stop words).
 * These are reliable anchors (e.g. medical terms, names, specific numbers).
 */
function findUniqueWordAnchors(
  original: AnchorOriginalWord[],
  corrected: AnchorCorrectedWord[],
  usedOrig: Set<number>,
  usedCorr: Set<number>
): Anchor[] {
  const origFreq = new Map<string, number[]>();
  for (let i = 0; i < original.length; i++) {
    if (usedOrig.has(i) || !original[i].normalized) continue;
    const norm = original[i].normalized;
    if (GERMAN_STOP_WORDS.has(norm) || norm.length < 2) continue;
    if (!origFreq.has(norm)) origFreq.set(norm, []);
    origFreq.get(norm)!.push(i);
  }

  const corrFreq = new Map<string, number[]>();
  for (let i = 0; i < corrected.length; i++) {
    if (usedCorr.has(i) || !corrected[i].normalized) continue;
    const norm = corrected[i].normalized;
    if (GERMAN_STOP_WORDS.has(norm) || norm.length < 2) continue;
    if (!corrFreq.has(norm)) corrFreq.set(norm, []);
    corrFreq.get(norm)!.push(i);
  }

  const anchors: Anchor[] = [];
  for (const [norm, corrIndices] of corrFreq) {
    if (corrIndices.length !== 1) continue;
    const origIndices = origFreq.get(norm);
    if (!origIndices || origIndices.length !== 1) continue;
    anchors.push({
      correctedIdx: corrIndices[0],
      originalIdx: origIndices[0],
      ngramLength: 1,
    });
  }

  return anchors;
}

// ---------- Phase 3: Order consistency (LIS) ----------

/**
 * Keep the longest order-consistent subset of anchors.
 * Anchors must maintain the same relative order in both texts
 * (since speech is temporal, reordering shouldn't happen).
 *
 * Uses O(n²) DP, which is fine for typical anchor counts (< 1000).
 */
function enforceOrderConsistency(anchors: Anchor[]): Anchor[] {
  if (anchors.length <= 1) return anchors;

  // Deduplicate by correctedIdx (keep higher ngramLength)
  const byCorr = new Map<number, Anchor>();
  for (const a of anchors) {
    const existing = byCorr.get(a.correctedIdx);
    if (!existing || a.ngramLength > existing.ngramLength) {
      byCorr.set(a.correctedIdx, a);
    }
  }

  // Deduplicate by originalIdx (keep higher ngramLength)
  const byOrig = new Map<number, Anchor>();
  for (const a of byCorr.values()) {
    const existing = byOrig.get(a.originalIdx);
    if (!existing || a.ngramLength > existing.ngramLength) {
      byOrig.set(a.originalIdx, a);
    }
  }

  // Keep only anchors that survived both dedup steps
  const deduped: Anchor[] = [];
  for (const a of byOrig.values()) {
    const byCorrEntry = byCorr.get(a.correctedIdx);
    if (byCorrEntry && byCorrEntry.originalIdx === a.originalIdx) {
      deduped.push(a);
    }
  }

  // Sort by correctedIdx
  deduped.sort((a, b) => a.correctedIdx - b.correctedIdx);
  if (deduped.length <= 1) return deduped;

  // LIS on originalIdx
  const n = deduped.length;
  const dp = new Array(n).fill(1);
  const parent = new Array(n).fill(-1);

  for (let i = 1; i < n; i++) {
    for (let j = 0; j < i; j++) {
      if (deduped[j].originalIdx < deduped[i].originalIdx && dp[j] + 1 > dp[i]) {
        dp[i] = dp[j] + 1;
        parent[i] = j;
      }
    }
  }

  // Reconstruct LIS
  let maxLen = 0;
  let maxIdx = 0;
  for (let i = 0; i < n; i++) {
    if (dp[i] > maxLen) {
      maxLen = dp[i];
      maxIdx = i;
    }
  }

  const lisIndices: number[] = [];
  let idx = maxIdx;
  while (idx !== -1) {
    lisIndices.push(idx);
    idx = parent[idx];
  }
  lisIndices.reverse();

  return lisIndices.map(i => deduped[i]);
}

// ---------- Phase 4: Gap filling ----------

interface Gap {
  corrStart: number;
  corrEnd: number;   // exclusive
  origStart: number;
  origEnd: number;   // exclusive
}

function buildGaps(
  orderedAnchors: Anchor[],
  correctedLen: number,
  originalLen: number
): Gap[] {
  const gaps: Gap[] = [];

  if (orderedAnchors.length === 0) {
    gaps.push({ corrStart: 0, corrEnd: correctedLen, origStart: 0, origEnd: originalLen });
    return gaps;
  }

  // Before first anchor
  const first = orderedAnchors[0];
  if (first.correctedIdx > 0 || first.originalIdx > 0) {
    gaps.push({
      corrStart: 0, corrEnd: first.correctedIdx,
      origStart: 0, origEnd: first.originalIdx,
    });
  }

  // Between consecutive anchors
  for (let i = 0; i < orderedAnchors.length - 1; i++) {
    const curr = orderedAnchors[i];
    const next = orderedAnchors[i + 1];
    if (curr.correctedIdx + 1 < next.correctedIdx || curr.originalIdx + 1 < next.originalIdx) {
      gaps.push({
        corrStart: curr.correctedIdx + 1, corrEnd: next.correctedIdx,
        origStart: curr.originalIdx + 1, origEnd: next.originalIdx,
      });
    }
  }

  // After last anchor
  const last = orderedAnchors[orderedAnchors.length - 1];
  if (last.correctedIdx + 1 < correctedLen || last.originalIdx + 1 < originalLen) {
    gaps.push({
      corrStart: last.correctedIdx + 1, corrEnd: correctedLen,
      origStart: last.originalIdx + 1, origEnd: originalLen,
    });
  }

  return gaps;
}

/**
 * Fill gaps between anchors with local matching.
 * Two sub-passes per gap:
 *   a) exact normalized match (greedy sequential)
 *   b) fuzzy prefix match for remaining words
 */
function fillGaps(
  original: AnchorOriginalWord[],
  corrected: AnchorCorrectedWord[],
  orderedAnchors: Anchor[],
  usedOrig: Set<number>,
  usedCorr: Set<number>
): Anchor[] {
  const gapAnchors: Anchor[] = [];
  const gaps = buildGaps(orderedAnchors, corrected.length, original.length);

  for (const gap of gaps) {
    // Collect available indices in this gap
    const corrRange: number[] = [];
    for (let i = gap.corrStart; i < gap.corrEnd; i++) {
      if (!usedCorr.has(i) && corrected[i].normalized) corrRange.push(i);
    }
    const origRange: number[] = [];
    for (let i = gap.origStart; i < gap.origEnd; i++) {
      if (!usedOrig.has(i) && original[i].normalized) origRange.push(i);
    }

    if (corrRange.length === 0 || origRange.length === 0) continue;

    // Pass A: exact greedy
    let oi = 0;
    for (const ci of corrRange) {
      if (usedCorr.has(ci)) continue;
      const savedOi = oi;
      while (oi < origRange.length) {
        if (usedOrig.has(origRange[oi])) { oi++; continue; }
        if (corrected[ci].normalized === original[origRange[oi]].normalized) {
          gapAnchors.push({ correctedIdx: ci, originalIdx: origRange[oi], ngramLength: 0 });
          usedOrig.add(origRange[oi]);
          usedCorr.add(ci);
          oi++;
          break;
        }
        oi++;
      }
      // If no exact match found in remaining original words, reset oi for next corrected word
      if (oi === origRange.length && savedOi === oi) oi = savedOi;
    }

    // Pass B: fuzzy matching for remaining unmatched words in this gap
    const remainingCorr = corrRange.filter(ci => !usedCorr.has(ci));
    const remainingOrig = origRange.filter(oi2 => !usedOrig.has(oi2));

    if (remainingCorr.length > 0 && remainingOrig.length > 0) {
      let oi2 = 0;
      for (const ci of remainingCorr) {
        while (oi2 < remainingOrig.length) {
          if (usedOrig.has(remainingOrig[oi2])) { oi2++; continue; }
          if (fuzzyMatch(corrected[ci].normalized, original[remainingOrig[oi2]].normalized)) {
            gapAnchors.push({ correctedIdx: ci, originalIdx: remainingOrig[oi2], ngramLength: 0 });
            usedOrig.add(remainingOrig[oi2]);
            usedCorr.add(ci);
            oi2++;
            break;
          }
          oi2++;
        }
      }
    }
  }

  return gapAnchors;
}

// ---------- Phase 5: Timestamp assignment ----------

function assignTimestamps(
  original: AnchorOriginalWord[],
  corrected: AnchorCorrectedWord[],
  anchors: Anchor[],
  audioDuration: number
): AnchorTimestampResult[] {
  // Build correctedIdx -> originalIdx map
  const anchorMap = new Map<number, number>();
  for (const a of anchors) {
    anchorMap.set(a.correctedIdx, a.originalIdx);
  }

  const result: AnchorTimestampResult[] = [];

  for (let i = 0; i < corrected.length; i++) {
    const cw = corrected[i];
    const origIdx = anchorMap.get(i);

    if (origIdx !== undefined) {
      const ow = original[origIdx];
      result.push({
        word: cw.word,
        start: ow.start,
        end: ow.end,
        isInterpolated: false,
        charPos: cw.charPos,
      });
    } else {
      // Interpolate from nearest anchors
      let prevAnchorCorr = -1;
      let prevAnchorOrig = -1;
      for (let j = i - 1; j >= 0; j--) {
        const oi = anchorMap.get(j);
        if (oi !== undefined) {
          prevAnchorCorr = j;
          prevAnchorOrig = oi;
          break;
        }
      }

      let nextAnchorCorr = -1;
      let nextAnchorOrig = -1;
      for (let j = i + 1; j < corrected.length; j++) {
        const oi = anchorMap.get(j);
        if (oi !== undefined) {
          nextAnchorCorr = j;
          nextAnchorOrig = oi;
          break;
        }
      }

      let start: number;
      let end: number;

      if (prevAnchorCorr >= 0 && nextAnchorCorr >= 0) {
        // Between two anchors → linear interpolation
        const prevEnd = original[prevAnchorOrig].end;
        const nextStart = original[nextAnchorOrig].start;
        const totalCorrWords = nextAnchorCorr - prevAnchorCorr;
        const offset = i - prevAnchorCorr;
        const fraction = offset / totalCorrWords;
        const timeSpan = nextStart - prevEnd;
        start = prevEnd + timeSpan * fraction;
        const wordDuration = totalCorrWords > 0 ? Math.min(0.3, Math.max(0.05, timeSpan / totalCorrWords)) : 0.2;
        end = start + wordDuration;
      } else if (prevAnchorCorr >= 0) {
        // Only previous anchor → extrapolate forward
        const prevEnd = original[prevAnchorOrig].end;
        const offset = i - prevAnchorCorr;
        start = prevEnd + offset * 0.15;
        end = start + 0.2;
      } else if (nextAnchorCorr >= 0) {
        // Only next anchor → extrapolate backward
        const nextStart = original[nextAnchorOrig].start;
        const offset = nextAnchorCorr - i;
        start = Math.max(0, nextStart - offset * 0.2);
        end = start + 0.2;
      } else {
        // No anchors at all → distribute evenly across audio
        const fraction = corrected.length > 1 ? i / (corrected.length - 1) : 0;
        start = fraction * audioDuration;
        end = start + 0.2;
      }

      result.push({
        word: cw.word,
        start,
        end: Math.max(start + 0.01, Math.min(end, audioDuration || end)),
        isInterpolated: true,
        charPos: cw.charPos,
      });
    }
  }

  return result;
}

// ---------- Main ----------

/**
 * Build timestamp mappings for corrected text using anchor-point matching.
 *
 * @param original  Words from WhisperX segments (with timestamps, pre-normalized)
 * @param corrected Words from LLM-corrected text (with charPos, pre-normalized)
 * @param audioDuration  Total audio duration in seconds
 * @returns One TimestampMapping per corrected word, in order
 */
export function buildAnchorTimestampTable(
  original: AnchorOriginalWord[],
  corrected: AnchorCorrectedWord[],
  audioDuration: number
): AnchorTimestampResult[] {
  if (original.length === 0 || corrected.length === 0) return [];

  // Phase 1: N-gram anchors (5-grams down to bigrams)
  const ngramAnchors = findNgramAnchors(original, corrected);

  // Phase 2: Unique single-word anchors (skip words already matched by n-grams)
  const usedOrigNgram = new Set(ngramAnchors.map(a => a.originalIdx));
  const usedCorrNgram = new Set(ngramAnchors.map(a => a.correctedIdx));
  const uniqueAnchors = findUniqueWordAnchors(original, corrected, usedOrigNgram, usedCorrNgram);

  // Phase 3: Combine & enforce temporal order
  const allCandidates = [...ngramAnchors, ...uniqueAnchors];
  const orderedAnchors = enforceOrderConsistency(allCandidates);

  // Phase 4: Fill gaps with local matching
  const usedOrig = new Set(orderedAnchors.map(a => a.originalIdx));
  const usedCorr = new Set(orderedAnchors.map(a => a.correctedIdx));
  const gapAnchors = fillGaps(original, corrected, orderedAnchors, usedOrig, usedCorr);

  // Combine all anchors
  const finalAnchors = [...orderedAnchors, ...gapAnchors];

  // Phase 5: Assign / interpolate timestamps
  return assignTimestamps(original, corrected, finalAnchors, audioDuration);
}

/**
 * Compute match quality as percentage of directly-matched (non-interpolated) words.
 */
export function computeMatchQuality(results: AnchorTimestampResult[]): number {
  if (results.length === 0) return 0;
  const matched = results.filter(r => !r.isInterpolated).length;
  return Math.round((matched / results.length) * 100);
}
