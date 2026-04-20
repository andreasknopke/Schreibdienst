/**
 * Kölner Phonetik + Levenshtein für deutsches phonetisches Wörterbuch-Matching.
 * Rein deterministisch, keine Dependencies, <1ms pro Chunk.
 *
 * Anwendung: Nach der Transkription werden Wörter phonetisch mit dem
 * Wörterbuch verglichen. So werden z.B. "Rectum Koprostaze" → "Rektumkoprostase"
 * erkannt, auch wenn das STT-Modell die Schreibweise variiert.
 */

/**
 * Kölner Phonetik — Phonetischer Code für deutsche Wörter.
 * Basiert auf Hans Joachim Postel (1969), optimiert für medizinisches Deutsch.
 * https://de.wikipedia.org/wiki/Kölner_Phonetik
 */
export function colognePhonetic(word: string): string {
  if (!word) return '';

  // Normalisieren: Kleinbuchstaben, Umlaute auflösen
  let s = word.toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/ph/g, 'f')     // Pharynx → farynx
    .replace(/[^a-z]/g, ''); // Nur Buchstaben

  if (s.length === 0) return '';

  const codes: number[] = [];

  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    const prev = i > 0 ? s[i - 1] : '';
    const next = i < s.length - 1 ? s[i + 1] : '';

    let code = -1;

    switch (c) {
      case 'a': case 'e': case 'i': case 'o': case 'u':
        code = 0;
        break;
      case 'b':
        code = 1;
        break;
      case 'p':
        code = (next === 'h') ? 3 : 1;
        break;
      case 'f': case 'v': case 'w':
        code = 3;
        break;
      case 'd': case 't':
        code = ('csz'.includes(next)) ? 8 : 2;
        break;
      case 'g': case 'k': case 'q':
        code = 4;
        break;
      case 'c':
        if (i === 0) {
          code = ('ahkloqrux'.includes(next)) ? 4 : 8;
        } else {
          code = ('sz'.includes(prev)) ? 8 : 4;
          // Nach Vokalen: "ach"-Laut vs. "ich"-Laut
          if ('ahouq'.includes(prev)) code = 4;
        }
        break;
      case 'x':
        code = 48; // Spezialfall: wird zu "48"
        break;
      case 'l':
        code = 5;
        break;
      case 'm': case 'n':
        code = 6;
        break;
      case 'r':
        code = 7;
        break;
      case 's': case 'z':
        code = 8;
        break;
      case 'h':
      case 'j': // j klingt wie Vokal in vielen Kontexten
        code = -1; // Wird ignoriert
        break;
      default:
        code = -1;
    }

    if (code === -1) continue;

    // X-Spezialfall: zwei Ziffern
    if (code === 48) {
      codes.push(4);
      codes.push(8);
      continue;
    }

    codes.push(code);
  }

  if (codes.length === 0) return '0';

  // Doppelte aufeinanderfolgende Codes entfernen
  const deduped = [codes[0]];
  for (let i = 1; i < codes.length; i++) {
    if (codes[i] !== codes[i - 1]) {
      deduped.push(codes[i]);
    }
  }

  // Nullen entfernen (außer am Anfang)
  const result = [deduped[0]];
  for (let i = 1; i < deduped.length; i++) {
    if (deduped[i] !== 0) {
      result.push(deduped[i]);
    }
  }

  return result.join('');
}

/**
 * Levenshtein-Distanz zwischen zwei Strings.
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;

  // Schnelle Abkürzungen
  if (m === 0) return n;
  if (n === 0) return m;
  if (a === b) return 0;

  // Einzeilige DP (O(n) Speicher)
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;

  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,     // Deletion
        curr[j - 1] + 1, // Insertion
        prev[j - 1] + cost // Substitution
      );
    }
    [prev, curr] = [curr, prev];
  }

  return prev[n];
}

/**
 * Normalisiert ein Wort für den Vergleich: Lowercase, Umlaute auflösen.
 */
function normalizeForComparison(word: string): string {
  return word.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss');
}

export interface PhoneticDictEntry {
  wrong: string;          // Original "wrong"-Feld
  correct: string;        // Korrekte Schreibweise
  wrongPhonetic: string;  // Kölner Phonetik Code von "wrong"
  wrongNorm: string;      // Normalisiertes "wrong"
  correctPhonetic: string;// Kölner Phonetik Code von "correct"
}

/**
 * Baut einen phonetischen Index aus Wörterbuch-Einträgen.
 * Einmal beim Laden aufbauen, dann O(1)-Lookup pro phonetischem Code.
 */
export function buildPhoneticIndex(entries: { wrong: string; correct: string }[]): {
  byPhoneticCode: Map<string, PhoneticDictEntry[]>;
  allEntries: PhoneticDictEntry[];
} {
  const byPhoneticCode = new Map<string, PhoneticDictEntry[]>();
  const allEntries: PhoneticDictEntry[] = [];

  for (const entry of entries) {
    if (!entry.wrong || !entry.correct) continue;

    const pe: PhoneticDictEntry = {
      wrong: entry.wrong,
      correct: entry.correct,
      wrongPhonetic: colognePhonetic(entry.wrong),
      wrongNorm: normalizeForComparison(entry.wrong),
      correctPhonetic: colognePhonetic(entry.correct),
    };
    allEntries.push(pe);

    // Index unter dem phonetischen Code des "wrong"-Worts
    const existing = byPhoneticCode.get(pe.wrongPhonetic);
    if (existing) {
      existing.push(pe);
    } else {
      byPhoneticCode.set(pe.wrongPhonetic, [pe]);
    }

    // Auch unter dem phonetischen Code des "correct"-Worts indexieren,
    // falls das Modell eine ähnliche aber nicht identische Schreibweise liefert
    if (pe.correctPhonetic !== pe.wrongPhonetic) {
      const existingCorr = byPhoneticCode.get(pe.correctPhonetic);
      if (existingCorr) {
        existingCorr.push(pe);
      } else {
        byPhoneticCode.set(pe.correctPhonetic, [pe]);
      }
    }
  }

  return { byPhoneticCode, allEntries };
}

/**
 * Findet den besten phonetischen Match für ein Wort.
 * Gibt null zurück wenn kein ausreichend guter Match gefunden wird.
 *
 * Strategie:
 * 1. Exakter phonetischer Code-Match → Levenshtein als Tiebreaker
 * 2. Levenshtein auf normalisiertem Text ≤ 30% der Wortlänge
 *
 * @param minWordLength Mindestlänge des Wortes für phonetisches Matching (kurze Wörter haben zu viele false positives)
 */
export function findPhoneticMatch(
  word: string,
  index: { byPhoneticCode: Map<string, PhoneticDictEntry[]>; allEntries: PhoneticDictEntry[] },
  minWordLength: number = 5
): { correct: string; confidence: number } | null {
  if (!word || word.length < minWordLength) return null;

  const wordNorm = normalizeForComparison(word);
  const wordPhonetic = colognePhonetic(word);

  if (!wordPhonetic) return null;

  let bestMatch: { correct: string; confidence: number } | null = null;

  // Pass 1: Exakter phonetischer Code-Match
  const candidates = index.byPhoneticCode.get(wordPhonetic);
  if (candidates) {
    for (const cand of candidates) {
      // Levenshtein auf normalisiertem Text als Qualitätsprüfung
      const dist = levenshtein(wordNorm, cand.wrongNorm);
      const maxLen = Math.max(wordNorm.length, cand.wrongNorm.length);
      const similarity = 1 - (dist / maxLen);

      // Phonetischer Match + mindestens 50% Zeichenähnlichkeit
      if (similarity >= 0.5) {
        const confidence = 0.5 + (similarity * 0.5); // 0.75 - 1.0

        if (!bestMatch || confidence > bestMatch.confidence) {
          bestMatch = { correct: cand.correct, confidence };
        }
      }
    }
  }

  // Pass 2: Kein phonetischer Match → Levenshtein-Fallback (strenger)
  if (!bestMatch && wordNorm.length >= minWordLength) {
    for (const entry of index.allEntries) {
      // Längenfilter: Wörter müssen ähnlich lang sein (±40%)
      const lenRatio = Math.min(wordNorm.length, entry.wrongNorm.length) /
                       Math.max(wordNorm.length, entry.wrongNorm.length);
      if (lenRatio < 0.6) continue;

      const dist = levenshtein(wordNorm, entry.wrongNorm);
      const maxLen = Math.max(wordNorm.length, entry.wrongNorm.length);
      const similarity = 1 - (dist / maxLen);

      // Ohne phonetischen Match: mindestens 70% Zeichenähnlichkeit
      if (similarity >= 0.7) {
        const confidence = similarity * 0.8; // Etwas weniger Vertrauen ohne Phonetik

        if (!bestMatch || confidence > bestMatch.confidence) {
          bestMatch = { correct: entry.correct, confidence };
        }
      }
    }
  }

  return bestMatch;
}

/**
 * Wendet phonetisches Matching auf einen ganzen Text an.
 * Ersetzt Wörter die phonetisch mit Wörterbuch-Einträgen matchen.
 *
 * Wird NACH dem exakten Wörterbuch-Matching aufgerufen, fängt also
 * nur Wörter auf, die das exakte Matching verpasst hat.
 */
export function applyPhoneticCorrections(
  text: string,
  index: { byPhoneticCode: Map<string, PhoneticDictEntry[]>; allEntries: PhoneticDictEntry[] },
  minConfidence: number = 0.75
): string {
  if (!text || index.allEntries.length === 0) return text;

  // Text in Tokens aufteilen (Wörter + Nicht-Wörter)
  const tokens = text.split(/(\s+|[.,;:!?()"\-–—…]+)/);
  let changed = false;

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    // Nur Wort-Tokens prüfen (keine Leerzeichen/Satzzeichen)
    if (!token || /^[\s.,;:!?()"\-–—…]+$/.test(token)) continue;

    const match = findPhoneticMatch(token, index);
    if (match && match.confidence >= minConfidence) {
      // Groß/Kleinschreibung vom Original übernehmen
      let replacement = match.correct;
      if (token[0] === token[0].toUpperCase() && replacement[0] !== replacement[0].toUpperCase()) {
        replacement = replacement[0].toUpperCase() + replacement.slice(1);
      } else if (token[0] === token[0].toLowerCase() && replacement[0] !== replacement[0].toLowerCase()) {
        replacement = replacement[0].toLowerCase() + replacement.slice(1);
      }

      if (replacement !== token) {
        console.log(`[Phonetic] "${token}" → "${replacement}" (confidence: ${match.confidence.toFixed(2)})`);
        tokens[i] = replacement;
        changed = true;
      }
    }
  }

  return changed ? tokens.join('') : text;
}
