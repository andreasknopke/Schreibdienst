/**
 * Test script for the Anchor Matching Algorithm.
 * Run with: npx tsx scripts/test-anchor-matching.ts
 */
import {
  buildAnchorTimestampTable,
  computeMatchQuality,
  type AnchorOriginalWord,
  type AnchorCorrectedWord,
  type AnchorTimestampResult,
} from '../lib/anchorMatching';

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${msg}`);
  } else {
    failed++;
    console.error(`  ✗ ${msg}`);
  }
}

// Helper: create original words with timestamps
function makeOriginal(words: string[], startTime = 0, wordDuration = 0.5): AnchorOriginalWord[] {
  return words.map((w, i) => ({
    normalized: w.toLowerCase().replace(/[.,!?;:"""„''()\[\]<>«»–—\-\/\\@#$%^&*+=|~`*]/g, '').trim(),
    start: startTime + i * wordDuration,
    end: startTime + (i + 1) * wordDuration,
  }));
}

// Helper: create corrected words with char positions
function makeCorrected(words: string[]): AnchorCorrectedWord[] {
  let charPos = 0;
  return words.map(w => {
    const result = {
      word: w,
      normalized: w.toLowerCase().replace(/[.,!?;:"""„''()\[\]<>«»–—\-\/\\@#$%^&*+=|~`*]/g, '').trim(),
      charPos,
    };
    charPos += w.length + 1; // +1 for space
    return result;
  });
}

// ===================== Test Cases =====================

console.log('\n=== Test 1: Identical text (baseline) ===');
{
  const words = ['Der', 'Patient', 'hat', 'Fieber', 'und', 'Husten'];
  const orig = makeOriginal(words);
  const corr = makeCorrected(words);
  const result = buildAnchorTimestampTable(orig, corr, 3.0);
  
  assert(result.length === 6, `Result has 6 words (got ${result.length})`);
  assert(computeMatchQuality(result) === 100, `100% match quality (got ${computeMatchQuality(result)}%)`);
  assert(result[0].start === 0, `First word starts at 0`);
  assert(result[5].end === 3.0, `Last word ends at 3.0`);
}

console.log('\n=== Test 2: Simple word insertion by LLM ===');
{
  const orig = makeOriginal(['Patient', 'hat', 'Fieber']);
  const corr = makeCorrected(['Der', 'Patient', 'hat', 'hohes', 'Fieber']);
  const result = buildAnchorTimestampTable(orig, corr, 1.5);
  
  assert(result.length === 5, `Result has 5 words (got ${result.length})`);
  // "Patient", "hat", "Fieber" should be directly matched
  const matched = result.filter(r => !r.isInterpolated);
  assert(matched.length >= 3, `At least 3 direct matches (got ${matched.length})`);
  // "Der" and "hohes" should be interpolated
  assert(result[0].isInterpolated, `"Der" is interpolated`);
  assert(result[3].isInterpolated, `"hohes" is interpolated`);
}

console.log('\n=== Test 3: Word removal by LLM ===');
{
  const orig = makeOriginal(['Der', 'Patient', 'also', 'er', 'hat', 'Fieber']);
  const corr = makeCorrected(['Der', 'Patient', 'hat', 'Fieber']);
  const result = buildAnchorTimestampTable(orig, corr, 3.0);
  
  assert(result.length === 4, `Result has 4 words (got ${result.length})`);
  assert(computeMatchQuality(result) === 100, `100% match quality (got ${computeMatchQuality(result)}%)`);
}

console.log('\n=== Test 4: Medical formatting with structure ===');
{
  const orig = makeOriginal([
    'Befund', 'der', 'Patient', 'zeigt', 'erhöhten', 'Blutdruck',
    'Diagnose', 'arterielle', 'Hypertonie'
  ]);
  const corr = makeCorrected([
    '**Befund:**', 'Der', 'Patient', 'zeigt', 'erhöhten', 'Blutdruck.',
    '**Diagnose:**', 'Arterielle', 'Hypertonie.'
  ]);
  const result = buildAnchorTimestampTable(orig, corr, 4.5);
  
  assert(result.length === 9, `Result has 9 words (got ${result.length})`);
  const matched = result.filter(r => !r.isInterpolated);
  assert(matched.length >= 7, `At least 7 direct matches (got ${matched.length})`);
  assert(computeMatchQuality(result) >= 70, `Match quality >= 70% (got ${computeMatchQuality(result)}%)`);
}

console.log('\n=== Test 5: Heavy rewrite with preserved medical terms ===');
{
  const orig = makeOriginal([
    'also', 'der', 'Patient', 'kommt', 'rein', 'und', 'sagt',
    'er', 'hat', 'seit', 'drei', 'Tagen', 'Kopfschmerzen',
    'Temperatur', 'war', 'achtunddreißig', 'Komma', 'fünf'
  ]);
  const corr = makeCorrected([
    'Der', 'Patient', 'stellt', 'sich', 'vor', 'mit',
    'seit', 'drei', 'Tagen', 'bestehenden', 'Kopfschmerzen.',
    'Temperatur:', '38,5°C.'
  ]);
  const result = buildAnchorTimestampTable(orig, corr, 9.0);
  
  assert(result.length === 13, `Result has 13 words (got ${result.length})`);
  // Key medical content should be matched
  const matched = result.filter(r => !r.isInterpolated);
  assert(matched.length >= 5, `At least 5 direct matches (got ${matched.length})`);
  
  // "Patient" should be matched and have reasonable timestamp
  const patientWord = result.find(r => r.word === 'Patient');
  assert(patientWord !== undefined && !patientWord.isInterpolated, `"Patient" directly matched`);
  
  // "Kopfschmerzen." should match "Kopfschmerzen"
  const kopf = result.find(r => r.word.startsWith('Kopfschmerzen'));
  assert(kopf !== undefined && !kopf.isInterpolated, `"Kopfschmerzen" directly matched`);
}

console.log('\n=== Test 6: N-gram anchor detection ===');
{
  // "seit drei Tagen" should be a strong 3-gram anchor
  const orig = makeOriginal([
    'ähm', 'Patient', 'hat', 'seit', 'drei', 'Tagen', 'Fieber',
    'und', 'seit', 'zwei', 'Wochen', 'Husten'
  ]);
  const corr = makeCorrected([
    'Der', 'Patient', 'leidet', 'seit', 'drei', 'Tagen', 'an', 'Fieber',
    'sowie', 'seit', 'zwei', 'Wochen', 'an', 'Husten.'
  ]);
  const result = buildAnchorTimestampTable(orig, corr, 6.0);
  
  assert(result.length === 14, `Result has 14 words (got ${result.length})`);
  
  // "seit drei Tagen" should have consecutive, non-interpolated timestamps
  const seitIdx = result.findIndex(r => r.word === 'seit');
  if (seitIdx >= 0 && seitIdx + 2 < result.length) {
    const s1 = result[seitIdx];
    const s2 = result[seitIdx + 1];
    const s3 = result[seitIdx + 2];
    assert(!s1.isInterpolated && !s2.isInterpolated && !s3.isInterpolated,
      `"seit drei Tagen" all directly matched`);
    assert(s1.start < s2.start && s2.start < s3.start,
      `"seit drei Tagen" timestamps are ordered`);
  }
}

console.log('\n=== Test 7: Empty inputs ===');
{
  const result1 = buildAnchorTimestampTable([], makeCorrected(['test']), 1.0);
  assert(result1.length === 0, `Empty original returns empty result`);
  
  const result2 = buildAnchorTimestampTable(makeOriginal(['test']), [], 1.0);
  assert(result2.length === 0, `Empty corrected returns empty result`);
}

console.log('\n=== Test 8: Single word ===');
{
  const orig = makeOriginal(['Hallo']);
  const corr = makeCorrected(['Hallo']);
  const result = buildAnchorTimestampTable(orig, corr, 0.5);
  
  assert(result.length === 1, `Single word matched`);
  assert(!result[0].isInterpolated, `Single word is directly matched`);
}

console.log('\n=== Test 9: Completely different text (worst case) ===');
{
  const orig = makeOriginal(['eins', 'zwei', 'drei']);
  const corr = makeCorrected(['alpha', 'beta', 'gamma']);
  const result = buildAnchorTimestampTable(orig, corr, 1.5);
  
  assert(result.length === 3, `Result has 3 words (got ${result.length})`);
  assert(computeMatchQuality(result) === 0, `0% match quality (got ${computeMatchQuality(result)}%)`);
  // All should be interpolated but still have valid timestamps
  assert(result.every(r => r.isInterpolated), `All words interpolated`);
  assert(result.every(r => r.start >= 0 && r.end > r.start), `All timestamps valid`);
}

console.log('\n=== Test 10: Fuzzy matching (word stems) ===');
{
  const orig = makeOriginal(['Untersuchung', 'ergab', 'Auffälligkeit']);
  const corr = makeCorrected(['Untersuchungsergebnis', 'ergab', 'Auffälligkeiten']);
  const result = buildAnchorTimestampTable(orig, corr, 1.5);
  
  // "ergab" should be exact match, stem matches for the others
  const ergab = result.find(r => r.word === 'ergab');
  assert(ergab !== undefined && !ergab.isInterpolated, `"ergab" directly matched`);
  
  // Fuzzy: "Untersuchung" and "Untersuchungsergebnis" share prefix
  const unt = result.find(r => r.word === 'Untersuchungsergebnis');
  assert(unt !== undefined, `"Untersuchungsergebnis" has timestamp`);
}

console.log('\n=== Test 11: Timestamp ordering is monotonic ===');
{
  const orig = makeOriginal([
    'der', 'Patient', 'hat', 'Fieber', 'und', 'Husten',
    'seit', 'drei', 'Tagen', 'Kopfschmerzen', 'Übelkeit'
  ]);
  const corr = makeCorrected([
    'Der', 'Patient', 'präsentiert', 'sich', 'mit',
    'Fieber,', 'Husten,', 'Kopfschmerzen', 'und', 'Übelkeit',
    'seit', 'drei', 'Tagen.'
  ]);
  const result = buildAnchorTimestampTable(orig, corr, 5.5);
  
  assert(result.length === 13, `Result has 13 words (got ${result.length})`);
  
  // Check that timestamps are generally increasing (with small tolerance for interpolation)
  let monotonic = true;
  for (let i = 1; i < result.length; i++) {
    if (result[i].start < result[i - 1].start - 0.01) {
      monotonic = false;
      break;
    }
  }
  // Note: strict monotonicity isn't guaranteed when LLM reorders,
  // but timestamps should be approximately ordered
  console.log(`  ℹ Timestamps monotonic: ${monotonic}`);
}

// ===================== Summary =====================

console.log(`\n${'='.repeat(40)}`);
console.log(`Tests: ${passed} passed, ${failed} failed, ${passed + failed} total`);
console.log(`${'='.repeat(40)}\n`);

if (failed > 0) process.exit(1);
