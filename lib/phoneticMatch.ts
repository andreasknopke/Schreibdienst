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
 * Normalisiert ein Wort für den Vergleich: Lowercase, Umlaute auflösen,
 * Trenner entfernen. Bindestriche und Leerzeichen sollen beim
 * Ähnlichkeitsvergleich nicht als echter Buchstabenfehler zählen.
 */
function normalizeForComparison(word: string): string {
  return word.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z]/g, '');
}

export interface PhoneticDictEntry {
  wrong: string;          // Original "wrong"-Feld
  correct: string;        // Korrekte Schreibweise
  wrongPhonetic: string;  // Kölner Phonetik Code von "wrong"
  wrongNorm: string;      // Normalisiertes "wrong"
  correctPhonetic: string;// Kölner Phonetik Code von "correct"
  isSelfMapping: boolean; // Reiner Fachbegriff ohne explizite Fehlvariante
}

const EXPLICIT_MATCH_SIMILARITY = 0.5;
const EXPLICIT_VARIATION_SIMILARITY = 0.45;
const SELF_MAPPING_MATCH_SIMILARITY = 0.82;
const SELF_MAPPING_VARIATION_SIMILARITY = 0.85;

function getSimilarityThreshold(candidate: PhoneticDictEntry, viaVariation: boolean): number {
  if (candidate.isSelfMapping) {
    return viaVariation ? SELF_MAPPING_VARIATION_SIMILARITY : SELF_MAPPING_MATCH_SIMILARITY;
  }

  return viaVariation ? EXPLICIT_VARIATION_SIMILARITY : EXPLICIT_MATCH_SIMILARITY;
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
      isSelfMapping: normalizeForComparison(entry.wrong) === normalizeForComparison(entry.correct),
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
 * Generiert alle phonetischen Code-Variationen mit Levenshtein-Distanz 1.
 * Erlaubt: Ersetzung einer Ziffer, Löschung einer Ziffer, Einfügung einer Ziffer.
 * Nur für Codes ≥ 4 Zeichen (kürzere haben zu viele false positives).
 */
function generateCodeVariations(code: string): string[] {
  if (code.length < 4) return [];
  const digits = '012345678';
  const variations: Set<string> = new Set();
  
  // Ersetzungen: jede Position durch jede andere Ziffer
  for (let i = 0; i < code.length; i++) {
    for (const d of digits) {
      if (d !== code[i]) {
        variations.add(code.slice(0, i) + d + code.slice(i + 1));
      }
    }
  }
  
  // Löschungen: jede Position entfernen
  for (let i = 0; i < code.length; i++) {
    const v = code.slice(0, i) + code.slice(i + 1);
    if (v.length >= 3) variations.add(v);
  }
  
  // Einfügungen: an jeder Position eine Ziffer einfügen
  for (let i = 0; i <= code.length; i++) {
    for (const d of digits) {
      variations.add(code.slice(0, i) + d + code.slice(i));
    }
  }
  
  return [...variations];
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
  if (!word) return null;
  const wordNorm = normalizeForComparison(word);
  if (wordNorm.length < minWordLength) return null;

  const wordPhonetic = colognePhonetic(word);

  if (!wordPhonetic) return null;

  let bestMatch: { correct: string; confidence: number } | null = null;

  // Pass 1: Exakter phonetischer Code-Match
  const candidates = index.byPhoneticCode.get(wordPhonetic);
  if (candidates) {
    for (const cand of candidates) {
      const dist = levenshtein(wordNorm, cand.wrongNorm);
      const maxLen = Math.max(wordNorm.length, cand.wrongNorm.length);
      const similarity = 1 - (dist / maxLen);
      const minSimilarity = getSimilarityThreshold(cand, false);

      if (similarity >= minSimilarity) {
        const confidence = 0.5 + (similarity * 0.5);
        if (!bestMatch || confidence > bestMatch.confidence) {
          bestMatch = { correct: cand.correct, confidence };
        }
      }
    }
  }

  // Pass 1b: Unscharfer phonetischer Code-Match via Code-Variationen (O(1) pro Variation)
  // Fängt Ch/Sch-Verwechslungen und ähnliche Abweichungen ab
  if (!bestMatch) {
    const variations = generateCodeVariations(wordPhonetic);
    for (const varCode of variations) {
      const varCandidates = index.byPhoneticCode.get(varCode);
      if (!varCandidates) continue;
      
      for (const cand of varCandidates) {
        const dist = levenshtein(wordNorm, cand.wrongNorm);
        const maxLen = Math.max(wordNorm.length, cand.wrongNorm.length);
        const similarity = 1 - (dist / maxLen);
        const minSimilarity = getSimilarityThreshold(cand, true);

        if (similarity >= minSimilarity) {
          const confidence = 0.4 + (similarity * 0.5);
          if (!bestMatch || confidence > bestMatch.confidence) {
            bestMatch = { correct: cand.correct, confidence };
          }
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
 *
 * Multi-Wort-Fenster: Prüft auch ob 2-4 aufeinanderfolgende Wörter
 * zusammengefügt einem Wörterbuch-Eintrag entsprechen.
 * Z.B. "Schule Zystole Thiasis" → "Cholezystolithiasis"
 */
export function applyPhoneticCorrections(
  text: string,
  index: { byPhoneticCode: Map<string, PhoneticDictEntry[]>; allEntries: PhoneticDictEntry[] },
  minConfidence: number = 0.75
): string {
  if (!text || index.allEntries.length === 0) return text;

  // Text in Wörter und Trennzeichen aufteilen
  // Wir brauchen die Struktur: [word, sep, word, sep, word, ...]
  const parts = text.split(/(\s+|[.,;:!?()"\-–—…]+)/);
  
  // Extrahiere Wort-Positionen (Indizes in parts[])
  const wordIndices: number[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (parts[i] && !/^[\s.,;:!?()"\-–—…]+$/.test(parts[i])) {
      wordIndices.push(i);
    }
  }

  // Set um bereits ersetzte Positionen zu tracken
  const replaced = new Set<number>();
  let changed = false;

  // Pass 1: Multi-Wort-Fenster (längste zuerst: 4, 3, 2 Wörter)
  // Deutsche Stoppwörter die nicht Teil von Komposita sein können
  const stopWords = new Set([
    'der', 'die', 'das', 'den', 'dem', 'des', 'ein', 'eine', 'einer', 'eines', 'einem', 'einen',
    'und', 'oder', 'aber', 'wenn', 'als', 'wie', 'dass', 'mit', 'von', 'zu', 'für', 'auf',
    'an', 'in', 'im', 'am', 'um', 'bei', 'nach', 'vor', 'aus', 'bis', 'über', 'unter',
    'ist', 'sind', 'war', 'hat', 'wird', 'kann', 'soll', 'muss', 'darf',
    'ich', 'er', 'sie', 'es', 'wir', 'ihr', 'du', 'nicht', 'kein', 'keine', 'keiner',
    'auch', 'noch', 'schon', 'nur', 'sehr', 'hier', 'dort', 'dann', 'da',
    'neue', 'neuer', 'neues', 'neuem', 'neuen', 'neu',
    'alte', 'alter', 'altes', 'altem', 'alten', 'alt',
    'kleine', 'kleiner', 'kleines', 'kleinem', 'kleinen', 'klein',
    'große', 'großer', 'großes', 'großem', 'großen', 'groß',
    'gute', 'guter', 'gutes', 'gutem', 'guten', 'gut',
    'ohne', 'seit', 'zum', 'zur', 'vom', 'beim', 'ins', 'aufs',
    'links', 'rechts', 'oben', 'unten', 'vorne', 'hinten',
    'leichte', 'leichter', 'schwere', 'schwerer',
    'erste', 'erster', 'zweite', 'zweiter', 'dritte', 'dritter',
  ]);

  for (let windowSize = 4; windowSize >= 2; windowSize--) {
    for (let wi = 0; wi <= wordIndices.length - windowSize; wi++) {
      // Prüfe ob eine der Positionen schon ersetzt wurde
      const positions = wordIndices.slice(wi, wi + windowSize);
      if (positions.some(p => replaced.has(p))) continue;

      // Wörter zusammenfügen (ohne Leerzeichen)
      const words = positions.map(p => parts[p]);
      
      // Stoppwörter dürfen nicht am Rand des Fensters stehen
      // (sie könnten versehentlich mitgezogen werden)
      if (stopWords.has(words[0].toLowerCase()) || stopWords.has(words[words.length - 1].toLowerCase())) continue;
      
      const combined = words.join('');
      
      // Mindestlänge für zusammengefügte Wörter
      if (combined.length < 6) continue;

      const match = findPhoneticMatch(combined, index, 4);
      if (match && match.confidence >= minConfidence) {
        // Groß/Kleinschreibung vom ersten Wort übernehmen
        let replacement = match.correct;
        const firstWord = parts[positions[0]];
        if (firstWord[0] === firstWord[0].toUpperCase() && replacement[0] !== replacement[0].toUpperCase()) {
          replacement = replacement[0].toUpperCase() + replacement.slice(1);
        }

        if (replacement !== combined) {
          const originalPhrase = positions.map(p => parts[p]).join(' ');
          console.log(`[Phonetic] "${originalPhrase}" → "${replacement}" (${windowSize} words combined, confidence: ${match.confidence.toFixed(2)})`);
          
          // Erstes Wort ersetzen, restliche Wörter + Trennzeichen dazwischen leeren
          parts[positions[0]] = replacement;
          for (let k = 1; k < positions.length; k++) {
            // Trennzeichen zwischen den Wörtern leeren
            for (let t = positions[k - 1] + 1; t < positions[k]; t++) {
              parts[t] = '';
            }
            parts[positions[k]] = '';
          }
          
          positions.forEach(p => replaced.add(p));
          changed = true;
        }
      }
    }
  }

  // Pass 2: Einzelwort-Matching (für noch nicht ersetzte Wörter)
  for (const wi of wordIndices) {
    if (replaced.has(wi)) continue;
    
    const token = parts[wi];
    const match = findPhoneticMatch(token, index);
    if (match && match.confidence >= minConfidence) {
      let replacement = match.correct;
      if (token[0] === token[0].toUpperCase() && replacement[0] !== replacement[0].toUpperCase()) {
        replacement = replacement[0].toUpperCase() + replacement.slice(1);
      } else if (token[0] === token[0].toLowerCase() && replacement[0] !== replacement[0].toLowerCase()) {
        replacement = replacement[0].toLowerCase() + replacement.slice(1);
      }

      if (replacement !== token) {
        console.log(`[Phonetic] "${token}" → "${replacement}" (confidence: ${match.confidence.toFixed(2)})`);
        parts[wi] = replacement;
        replaced.add(wi);
        changed = true;
      }
    }
  }

  return changed ? parts.join('') : text;
}
