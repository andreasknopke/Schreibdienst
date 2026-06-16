/**
 * Kölner Phonetik + Levenshtein für deutsches phonetisches Wörterbuch-Matching.
 * Rein deterministisch, keine Dependencies, <1ms pro Chunk.
 *
 * Anwendung: Nach der Transkription werden Wörter phonetisch mit dem
 * Wörterbuch verglichen. So werden z.B. "Rectum Koprostaze" → "Rektumkoprostase"
 * erkannt, auch wenn das STT-Modell die Schreibweise variiert.
 */

import { diffWordsWithSpace } from 'diff';
import { applyDictionaryReplacementCase } from './replacementCase';

/**
 * Debug-Switch für ausführliches Logging in der LLM- und Phonetic-Pipeline.
 *
 * Wenn aktiviert (`true`), werden verdächtige Medikamenten-ähnliche Wörter
 * (großgeschrieben, >5 Zeichen) auf ihrem Weg durch die Pipeline verfolgt
 * und in den Log geschrieben.
 *
 * Standard: `false` (aus).
 * Zum Debuggen lokal auf `true` setzen.
 */
export const PHONETIC_DEBUG_LOGGING = false;

function debugLog(...args: unknown[]): void {
  if (PHONETIC_DEBUG_LOGGING) {
    console.log(...args);
  }
}

/**
 * Extrahiert geschützte Wörter aus Preprocessing-Operationen (DictionaryCorrectionOperation).
 * 
 * Diese Wörter wurden durch TextFormatting/Wörterbuch/Abkürzungsregeln bewusst
 * erzeugt (z.B. "Antikoagulation" → "AK", "milligramm" → "mg") und dürfen vom
 * LLM NIEMALS gelöscht werden.
 *
 * @param operations - Liste der Preprocessing-Operationen
 * @returns Set von normalisierten (lowercase, Umlaute aufgelöst) geschützten Wörtern
 */
export function buildProtectedWordsFromOperations(
  operations: Array<{
    replacementText: string;
    dictionaryCorrect?: string;
  }>
): Set<string> {
  const words = new Set<string>();
  
  for (const op of operations) {
    if (!op.replacementText) continue;
    
    // Extrahiere alle Wort-Tokens aus dem replacementText
    for (const token of op.replacementText.match(/[A-Za-zÄÖÜäöüß0-9]+/g) ?? []) {
      // Nur Wörter mit ≥2 Zeichen (filtert einzelne Punktuations-Zeichen)
      if (token.length >= 2) {
        words.add(normalizeForComparison(token));
      }
    }
    
    // Auch das dictionaryCorrect-Wort schützen (falls unterschiedlich)
    if (op.dictionaryCorrect && op.dictionaryCorrect !== op.replacementText) {
      for (const token of op.dictionaryCorrect.match(/[A-Za-zÄÖÜäöüß0-9]+/g) ?? []) {
        if (token.length >= 2) {
          words.add(normalizeForComparison(token));
        }
      }
    }
  }
  
  return words;
}

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

function normalizedSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length, 1);
  return 1 - (levenshtein(a, b) / maxLen);
}

/**
 * Extrahiert den reinen Buchstabenkern (a-z) eines Wortes.
 * Für Akronym-Vergleiche (Patch 1/3).
 */
export function extractLetterCore(s: string): string {
  return s.toLowerCase().replace(/[^a-z]/g, '');
}

/**
 * Extrahiert den alphanumerischen Kern (a-z0-9) eines Wortes.
 * Behält Ziffern bei – anders als normalizeForComparison / extractLetterCore.
 * "DAS28-CRP" → "das28crp", "CRP" → "crp"
 */
function extractAlphanumericCore(s: string): string {
  return s.toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');
}

/**
 * Teilt ein Wort in alpha-Teile an Zahlen und Nicht-Buchstaben.
 * "DAS28-CRP" → ["DAS", "CRP"], "CRP" → ["CRP"], "ASDAS-CRP" → ["ASDAS", "CRP"]
 * (Patch 3: Zahlen als Trennzeichen)
 */
export function splitIntoAlphaParts(s: string): string[] {
  return s.split(/[^a-zA-Z]+/).filter(part => part.length > 0);
}

function isAcronymLikeTerm(term: string): boolean {
  const asciiLetters = term.replace(/[^A-Za-z]/g, '');
  if (asciiLetters.length < 2 || asciiLetters.length > 6) {
    return false;
  }

  // Title-case (Satzanfang) wie "Das", "Der", "Ist" sind keine Akronyme
  if (/^[A-Z][a-z]+$/.test(asciiLetters)) return false;

  const uppercaseCount = (term.match(/[A-Z]/g) ?? []).length;
  const lowercaseCount = (term.match(/[a-z]/g) ?? []).length;

  return uppercaseCount >= 2 || (uppercaseCount >= 1 && lowercaseCount >= 1 && asciiLetters.length <= 4);
}

function tokenizeWordsAndSeparators(text: string): string[] {
  return text.match(/[A-Za-zÄÖÜäöüß]+|[^A-Za-zÄÖÜäöüß]+/g) ?? [];
}

function isWordToken(token: string): boolean {
  return /^[A-Za-zÄÖÜäöüß]+$/.test(token);
}

function hasLLMUncertaintySuffix(tokens: string[], tokenIndex: number): boolean {
  const nextToken = tokens[tokenIndex + 1];
  return typeof nextToken === 'string' && nextToken.trimStart().startsWith('[???]');
}

function markWordAsUncertain(word: string): string {
  return word;
}

function markTextAsUncertain(text: string): string {
  const tokens = tokenizeWordsAndSeparators(text);
  return tokens.map((token, tokenIndex) => {
    if (!isWordToken(token)) {
      return token;
    }

    if (hasLLMUncertaintySuffix(tokens, tokenIndex)) {
      return token;
    }

    return markWordAsUncertain(token);
  }).join('');
}

function shouldKeepLLMReplacement(originalWord: string, replacementWord: string): boolean {
  const originalNorm = normalizeForComparison(originalWord);
  const replacementNorm = normalizeForComparison(replacementWord);

  if (!originalNorm || !replacementNorm || originalNorm === replacementNorm) {
    return true;
  }

  const lexicalSimilarity = normalizedSimilarity(originalNorm, replacementNorm);
  if (lexicalSimilarity >= 0.88) {
    return true;
  }

  const originalPhonetic = colognePhonetic(originalWord);
  const replacementPhonetic = colognePhonetic(replacementWord);
  if (!originalPhonetic || !replacementPhonetic) {
    return false;
  }

  const phoneticSimilarity = normalizedSimilarity(originalPhonetic, replacementPhonetic);
  const minWordLength = Math.min(originalNorm.length, replacementNorm.length);

  if (minWordLength < 4) {
    return phoneticSimilarity >= 0.8 && lexicalSimilarity >= 0.5;
  }

  return phoneticSimilarity >= 0.67 && lexicalSimilarity >= 0.34;
}

export interface LLMPhoneticGuardResult {
  text: string;
  checkedWordReplacements: number;
  rejectedWordReplacements: number;
  revertedChunks: number;
}

function keepOnlyNonWordTokens(text: string): string {
  return tokenizeWordsAndSeparators(text)
    .filter(token => !isWordToken(token))
    .join('');
}

/**
 * Verhindert, dass das LLM einzelne Wörter oder ganze Wortgruppen durch
 * phonetisch unplausible Alternativen ersetzt.
 *
 * @param protectedWords - Optionales Set von Wörtern (normalisiert, lowercase),
 *   die explizit vor dem LLM geschützt werden. Diese Wörter wurden durch
 *   TextFormatting / Wörterbuch gezielt erzeugt (z.B. "Antikoagulation" → "AK")
 *   und dürfen vom LLM NIEMALS gelöscht oder ersetzt werden.
 */
export function applyLLMPhoneticGuard(
  originalText: string,
  correctedText: string,
  protectedWords?: Set<string>
): LLMPhoneticGuardResult {
  if (!originalText || !correctedText || originalText === correctedText) {
    return {
      text: correctedText,
      checkedWordReplacements: 0,
      rejectedWordReplacements: 0,
      revertedChunks: 0,
    };
  }

  // DEBUG: Sammle Medikamenten-ähnliche Wörter (großgeschrieben, >5 Zeichen),
  // damit wir nachvollziehen können, wo sie ggf. verloren gehen.
  // Beispiele: "Falithrom", "Zirpin", "Marcumar", "Saliver"
  const MEDICATION_PATTERN = /\b[A-Z][a-zäöüß]{4,}\b/g;
  const suspiciousWords = new Set<string>();
  for (const match of originalText.match(MEDICATION_PATTERN) ?? []) {
    suspiciousWords.add(match);
  }

  const diffs = diffWordsWithSpace(originalText, correctedText);
  const guardedParts: string[] = [];
  let checkedWordReplacements = 0;
  let rejectedWordReplacements = 0;
  let revertedChunks = 0;

  // DEBUG: Logge für jedes verdächtige Wort, was im Diff damit passiert
  if (suspiciousWords.size > 0) {
    for (const w of suspiciousWords) {
      const inOriginal = originalText.includes(w);
      const inCorrected = correctedText.includes(w);
      const status = inOriginal && inCorrected ? 'KEPT' : inOriginal && !inCorrected ? 'DROPPED_BY_LLM' : !inOriginal && inCorrected ? 'ADDED_BY_LLM' : 'NOT_PRESENT';
      debugLog(`[PhonGuard DEBUG] suspicious-word "${w}": ${status} (original contains=${inOriginal}, corrected contains=${inCorrected})`);
    }
  }

  for (let index = 0; index < diffs.length; ) {
    const part = diffs[index];

    if (!part.added && !part.removed) {
      guardedParts.push(part.value);
      index++;
      continue;
    }

    let removedText = '';
    while (index < diffs.length && diffs[index].removed) {
      removedText += diffs[index].value;
      index++;
    }

    let addedText = '';
    while (index < diffs.length && diffs[index].added) {
      addedText += diffs[index].value;
      index++;
    }

    if (!removedText) {
      const addedWords = tokenizeWordsAndSeparators(addedText).filter(isWordToken);
      if (addedWords.length === 0) {
        guardedParts.push(addedText);
        continue;
      }

      rejectedWordReplacements += addedWords.length;
      revertedChunks++;
      guardedParts.push(keepOnlyNonWordTokens(addedText));
      continue;
    }

    if (!addedText) {
      // LLM hat Text komplett gelöscht ohne Ersatz → Original wiederherstellen
      guardedParts.push(markTextAsUncertain(removedText));
      revertedChunks++;
      continue;
    }

    // PRÜFEN: Enthält der entfernte Text geschützte Wörter (aus TextFormatting)?
    // Wenn ja, den gesamten Chunk blocken und Original behalten.
    const removedWordsForProtection = tokenizeWordsAndSeparators(removedText).filter(isWordToken);
    const hasProtectedWord = removedWordsForProtection.some(
      w => protectedWords?.has(normalizeForComparison(w))
    );
    if (hasProtectedWord) {
      const protectedList = removedWordsForProtection.filter(w => protectedWords!.has(normalizeForComparison(w)));
      debugLog(`[PhonGuard PROTECTED] Protected word(s) found in removed text: ${protectedList.join(', ')} — restoring original`);
      guardedParts.push(markTextAsUncertain(removedText));
      revertedChunks++;
      continue;
    }

    const removedTokens = tokenizeWordsAndSeparators(removedText);
    const addedTokens = tokenizeWordsAndSeparators(addedText);
    const removedWords = removedTokens.filter(isWordToken);
    const addedWords = addedTokens.filter(isWordToken);

    if (removedWords.length === 0 || addedWords.length === 0) {
      guardedParts.push(addedText);
      continue;
    }

    if (removedWords.length !== addedWords.length) {
      guardedParts.push(markTextAsUncertain(removedText));
      rejectedWordReplacements += Math.max(removedWords.length, addedWords.length);
      revertedChunks++;
      continue;
    }

    let wordIndex = 0;
    let chunkRejected = false;
    const guardedChunk = addedTokens.map((token, tokenIndex) => {
      if (!isWordToken(token)) {
        return token;
      }

      const originalWord = removedWords[wordIndex];
      const replacementWord = addedWords[wordIndex];
      wordIndex++;

      if (hasLLMUncertaintySuffix(addedTokens, tokenIndex)) {
        return token;
      }

      if (normalizeForComparison(originalWord) === normalizeForComparison(replacementWord)) {
        return token;
      }

      checkedWordReplacements++;
      if (shouldKeepLLMReplacement(originalWord, replacementWord)) {
        return token;
      }

      rejectedWordReplacements++;
      chunkRejected = true;
      return markWordAsUncertain(originalWord);
    }).join('');

    if (chunkRejected) {
      revertedChunks++;
    }

    guardedParts.push(guardedChunk);
  }

  // Post-pass: LLM fügt oft defensive [???]-Marker an Wörter an, die es im
  // Output gar nicht verändert hat (z. B. unbekannte Medikamentennamen wie
  // "Falithrom" oder "Zirpin"). Diese Marker würden den Lesefluss zerstören,
  // obwohl das LLM das Wort selbst als unverändert beibehalten hat.
  // Wenn das Originalwort identisch im korrigierten Text vorkommt und das LLM
  // nur einen [???]-Marker angehängt hat, wird der Marker entfernt.
  const preStrippedText = guardedParts.join('');
  const strippedText = stripDefensiveUncertaintyMarkers(originalText, preStrippedText);

  // Post-pass: Geschützte Wörter (aus TextFormatting/Wörterbuch) verifizieren.
  // Diese Wörter wurden durch Vorverarbeitung bewusst erzeugt und dürfen nicht
  // vom LLM gelöscht werden. Falls sie im finalen Text fehlen, werden sie
  // aus dem Original wiederhergestellt.
  if (protectedWords && protectedWords.size > 0) {
    const verified = verifyProtectedWords(originalText, strippedText, protectedWords);
    return {
      text: verified,
      checkedWordReplacements,
      rejectedWordReplacements,
      revertedChunks,
    };
  }

  return {
    text: strippedText,
    checkedWordReplacements,
    rejectedWordReplacements,
    revertedChunks,
  };
}

/**
 * Stellt sicher, dass geschützte Wörter (aus TextFormatting/Wörterbuch)
 * im finalen Guard-Output vorhanden sind. Falls das LLM sie gelöscht hat,
 * werden sie aus dem Originaltext wiederhergestellt.
 *
 * Strategie: Für jedes fehlende geschützte Wort wird sein umgebender
 * Kontext (einige Wörter vorher/nachher) im Original extrahiert.
 * Dieser Kontext wird dann im Guard-Output gesucht und das fehlende Wort
 * an der passenden Stelle eingefügt.
 */
function verifyProtectedWords(
  originalText: string,
  guardedText: string,
  protectedWords: Set<string>
): string {
  const missingWords: Array<{ word: string; originalPos: number }> = [];
  const wordRegex = /[A-Za-zÄÖÜäöüß0-9]+/g;
  
  for (const match of originalText.matchAll(wordRegex)) {
    const word = match[0];
    const normalized = normalizeForComparison(word);
    if (!protectedWords.has(normalized)) continue;
    if (guardedText.includes(word)) continue;
    missingWords.push({ word, originalPos: match.index! });
  }
  
  if (missingWords.length === 0) return guardedText;
  
  console.log(
    `[PhonGuard] Protected-word verification: ${missingWords.length} word(s) ` +
    `missing from LLM output — restoring from original`
  );
  
  let result = guardedText;
  for (const mw of missingWords) {
    // Suche 2 Wörter vor und nach dem fehlenden Wort als Kontext-Anker
    const before = originalText.slice(Math.max(0, mw.originalPos - 50), mw.originalPos);
    const after = originalText.slice(mw.originalPos + mw.word.length, mw.originalPos + mw.word.length + 50);
    const anchorBefore = (before.match(/(\S+)\s*(\S+)\s*$/) || []).slice(1).filter(Boolean).join(' ');
    const anchorAfter = (after.match(/^\s*(\S+)\s*(\S+)/) || []).slice(1).filter(Boolean).join(' ');
    
    // Anker im guardedText suchen
    let insertPos = -1;
    if (anchorBefore) {
      const idx = result.toLowerCase().indexOf(anchorBefore.toLowerCase());
      if (idx !== -1) insertPos = idx + anchorBefore.length;
    }
    if (insertPos === -1 && anchorAfter) {
      const idx = result.toLowerCase().indexOf(anchorAfter.toLowerCase());
      if (idx !== -1) insertPos = idx;
    }
    
    if (insertPos !== -1) {
      const beforePart = result.slice(0, insertPos);
      const afterPart = result.slice(insertPos);
      const spaceB = beforePart && !beforePart.endsWith(' ') && !beforePart.endsWith('\n');
      const spaceA = afterPart && !afterPart.startsWith(' ') && !afterPart.startsWith('\n');
      result = beforePart + (spaceB ? ' ' : '') + mw.word + (spaceA ? ' ' : '') + afterPart;
      console.log(`[PhonGuard] ✓ Restored protected word "${mw.word}" (anchor: "${anchorBefore || anchorAfter}")`);
    } else {
      // Fallback: ans Ende
      const t = result.trimEnd();
      result = t + (t ? '. ' : '') + mw.word + '.';
      console.log(`[PhonGuard] ⚠️ No context for "${mw.word}" — appended at end`);
    }
  }
  
  return result;
}

/**
 * Erkennt und entfernt defensive Unsicherheits-Marker wie " [???]" oder
 * " [?]", die das LLM an Wörter angehängt hat, die es nicht angerührt hat
 * (z. B. unbekannte Medikamentennamen).
 *
 * Vorgehen:
 * 1. Tokenisiere das LLM-Output in Wort- und Separator-Tokens
 * 2. Wenn ein Wort-Token identisch zu einem Wort im Original vorkommt und
 *    das folgende Separator-Token mit "[???]" / "[?]" beginnt, wird der
 *    Marker entfernt (das Wort bleibt stehen)
 *
 * @returns Bereinigter Text
 */
export function stripDefensiveUncertaintyMarkers(originalText: string, correctedText: string): string {
  if (!originalText || !correctedText || originalText === correctedText) {
    return correctedText;
  }

  // Erzeuge ein Set aller normalisierten Original-Wörter
  const originalWords = new Set<string>();
  for (const match of originalText.match(/[A-Za-zÄÖÜäöüß0-9]+/g) ?? []) {
    originalWords.add(normalizeForComparison(match));
  }
  if (originalWords.size === 0) {
    return correctedText;
  }

  // Suche Unsicherheits-Marker im korrigierten Text. Diese können sein:
  //   " [???]", " [?]", " [??]", " ??? ", " ?? " usw.
  // Wir entfernen den Marker NUR, wenn das davorstehende Wort bereits im
  // Original vorkommt (d.h. LLM hat das Wort nicht verändert).
  //
  // Strategie: Regex-Suche nach Markern, dann für jeden Fund prüfen, ob
  // das vorhergehende Wort im Original enthalten ist. Wenn ja, Marker
  // entfernen (inkl. umgebende Leerzeichen normalisieren).
  const MARKER_REGEX = /\s*(\[\?{2,}\]|\?{2,})/g;

  return correctedText.replace(MARKER_REGEX, (match, marker, offset) => {
    // Suche rückwärts nach dem letzten Wort-Token vor diesem Marker.
    // Wir erlauben beliebige Nicht-Wort-Zeichen (z. B. ".", ",", ";")
    // zwischen dem Wort und dem Marker, da "Falithrom. [???]" üblich ist.
    const beforeText = correctedText.slice(0, offset);

    const wordMatch = beforeText.match(/([A-Za-zÄÖÜäöüß0-9]+)[^A-Za-zÄÖÜäöüß0-9]*$/);
    if (!wordMatch) {
      // Kein Wort davor → Marker behalten (sicherheitshalber)
      return match;
    }

    const precedingWord = wordMatch[1];
    const normalized = normalizeForComparison(precedingWord);

    // Wenn das vorhergehende Wort im Original vorkommt, ist der Marker
    // defensiv → entfernen. Das Leerzeichen vor dem Marker wird mit entfernt,
    // damit kein doppeltes Leerzeichen entsteht.
    if (originalWords.has(normalized)) {
      return '';
    }

    return match;
  });
}

// Deutsche Beuge-/Pluralendungen, längste zuerst (wichtig für korrektes Strippen).
const INFLECTION_SUFFIXES = ['innen', 'nen', 'en', 'em', 'er', 'es', 'ne', 'in', 'e', 'n', 's'];

/**
 * Liefert die längste passende Endung aus INFLECTION_SUFFIXES, sofern der
 * verbleibende Stamm noch lang genug ist.
 */
function detectInflectionSuffix(normWord: string, minStemLen = 3): string {
  for (const suf of INFLECTION_SUFFIXES) {
    if (normWord.endsWith(suf) && normWord.length - suf.length >= minStemLen) {
      return suf;
    }
  }
  return '';
}

/**
 * Wählt für das Replacement diejenige Endung, deren abgetrennter Stamm dem
 * Zielstamm am nächsten kommt. So werden lexikalische Wortenden wie
 * "Immunglobulin" oder "Ödem" nicht fälschlich als Flexionsendung behandelt.
 */
function detectBestReplacementSuffix(normWord: string, targetStem: string, minStemLen = 3): string {
  let bestSuffix = '';
  let bestDistance = levenshtein(normWord, targetStem);

  for (const suf of INFLECTION_SUFFIXES) {
    if (!normWord.endsWith(suf) || normWord.length - suf.length < minStemLen) {
      continue;
    }

    const candidateStem = normWord.slice(0, -suf.length);
    const candidateDistance = levenshtein(candidateStem, targetStem);
    if (candidateDistance < bestDistance) {
      bestDistance = candidateDistance;
      bestSuffix = suf;
    }
  }

  return bestSuffix;
}

/**
 * Hängt eine Endung an den Original-Replacement an und respektiert dabei
 * Original-Schreibweise (Umlaute, Bindestriche). Da die Endungen rein aus
 * ASCII-Buchstaben bestehen, ist das ein einfaches Konkatenieren.
 */
function applySuffix(replacement: string, suffix: string): string {
  if (!suffix) return replacement;
  return replacement + suffix;
}

/**
 * Tauscht eine vorhandene Endung am Replacement durch eine neue Endung aus.
 * Behält Groß-/Kleinschreibung des Wortanfangs bei (wird vom Aufrufer separat
 * gehandhabt).
 */
function swapSuffix(replacement: string, oldSuf: string, newSuf: string): string {
  if (!oldSuf) return applySuffix(replacement, newSuf);
  // Replacement kann Umlaute enthalten; Endungen sind aber ASCII.
  // Wir entfernen oldSuf nur, wenn das Replacement (case-insensitive) darauf endet.
  const lower = replacement.toLowerCase();
  if (lower.endsWith(oldSuf)) {
    return replacement.slice(0, -oldSuf.length) + newSuf;
  }
  return replacement + newSuf;
}

/**
 * Bewahrt deutsche Beuge- und Pluralendungen beim Wörterbuch-Ersatz.
 *
 * Beispiele:
 *   "arterielle"        → matched "arteriell"        → "arterielle"        (Endung 'e' bewahrt)
 *   "Arterien"          → matched "Arterie"          → "Arterien"          (Endung 'n' bewahrt)
 *   "arterialle"        → matched "arteriell"        → "arterielle"        (Tippfehler korrigiert + 'e' bewahrt)
 *   "rheumatologischen" → matched "rheumatologische" → "rheumatologischen" (Endung 'e' → 'en' getauscht)
 *   "rheumtologische"   → matched "rheumatologische" → "rheumatologische"  (Tippfehler korrigiert, Endung gleich)
 *   "Diabetes"          → matched "Diabetes"        → "Diabetes"          (keine Änderung)
 *
 * Strategie:
 *   1. Erkenne Endung am Original und am Replacement.
 *   2. Wenn die Stämme (Levenshtein auf normalisierter Form) deutlich näher
 *      beieinander liegen als die ursprünglichen Wörter, ersetze die Endung
 *      des Replacements durch die Endung des Originals.
 *   3. Sonst: Replacement unverändert lassen.
 */
function preserveInflection(original: string, replacement: string): string {
  const origNorm = normalizeForComparison(original);
  const replNorm = normalizeForComparison(replacement);
  if (!origNorm || !replNorm) return replacement;
  if (origNorm === replNorm) return replacement;

  const baseDist = levenshtein(origNorm, replNorm);
  const origSuf = detectInflectionSuffix(origNorm);
  if (!origSuf) return replacement;

  const origStem = origNorm.slice(0, -origSuf.length);
  const replSuf = detectBestReplacementSuffix(replNorm, origStem);

  // Wenn schon identische Endung: nichts zu tun.
  if (origSuf && origSuf === replSuf) return replacement;

  const replStem = replSuf ? replNorm.slice(0, -replSuf.length) : replNorm;

  // Mindestlänge der Stämme, damit kein "is/im/es" als Stamm zählt.
  if (origStem.length < 3 || replStem.length < 3) return replacement;

  const stemDist = levenshtein(origStem, replStem);

  // Stämme müssen näher liegen als die vollen Wörter (sonst war es kein Endungs-Effekt).
  if (stemDist >= baseDist) return replacement;

  // Zusätzliche Sicherung gegen False-Positives: Stämme sollen recht ähnlich sein.
  const stemMaxLen = Math.max(origStem.length, replStem.length);
  const stemSimilarity = 1 - stemDist / stemMaxLen;
  if (stemSimilarity < 0.7) return replacement;

  return swapSuffix(replacement, replSuf, origSuf);
}

export interface PhoneticDictEntry {
  wrong: string;          // Original "wrong"-Feld
  correct: string;        // Korrekte Schreibweise
  wrongPhonetic: string;  // Kölner Phonetik Code von "wrong"
  wrongNorm: string;      // Normalisiertes "wrong"
  correctNorm: string;    // Normalisierte korrekte Schreibweise
  correctPhonetic: string;// Kölner Phonetik Code von "correct"
  isSelfMapping: boolean; // Reiner Fachbegriff ohne explizite Fehlvariante
  isAcronymLike: boolean;
  source?: 'standard' | 'private' | 'group';
  phoneticMinSimilarity?: number;
  targetUsername?: string;
  groupId?: number;
  groupName?: string;
}

export interface PhoneticMatchResult {
  correct: string;
  confidence: number;
  similarity: number;
  minSimilarity: number;
  matchedEntry: PhoneticDictEntry;
}

export interface PhoneticReplacementOperation {
  originalText: string;
  replacementText: string;
  dictionaryWrong: string;
  dictionaryCorrect: string;
  source: 'standard' | 'private' | 'group';
  matchType: 'phonetic';
  confidence: number;
  similarity: number;
  minSimilarity: number;
  targetUsername?: string;
  groupId?: number;
  groupName?: string;
}

const EXPLICIT_MATCH_SIMILARITY = 0.5;
const EXPLICIT_VARIATION_SIMILARITY = 0.45;
const SELF_MAPPING_MATCH_SIMILARITY = 0.82;
const SELF_MAPPING_VARIATION_SIMILARITY = 0.85;
const SHORT_EXPLICIT_MATCH_SIMILARITY = 0.75;
const SHORT_EXPLICIT_VARIATION_SIMILARITY = 0.78;
const SHORT_PHONETIC_WORD_LENGTH = 8;

function getSimilarityThreshold(candidate: PhoneticDictEntry, viaVariation: boolean, wordLength?: number): number {
  const override = typeof candidate.phoneticMinSimilarity === 'number'
    ? Math.min(0.99, Math.max(0, candidate.phoneticMinSimilarity))
    : undefined;

  if (candidate.isSelfMapping) {
    const base = viaVariation ? SELF_MAPPING_VARIATION_SIMILARITY : SELF_MAPPING_MATCH_SIMILARITY;
    return override !== undefined ? Math.max(base, override) : base;
  }

  const shortestLength = Math.min(wordLength ?? Number.POSITIVE_INFINITY, candidate.wrongNorm.length || Number.POSITIVE_INFINITY);
  const base = shortestLength <= SHORT_PHONETIC_WORD_LENGTH
    ? (viaVariation ? SHORT_EXPLICIT_VARIATION_SIMILARITY : SHORT_EXPLICIT_MATCH_SIMILARITY)
    : (viaVariation ? EXPLICIT_VARIATION_SIMILARITY : EXPLICIT_MATCH_SIMILARITY);
  return override !== undefined ? Math.max(base, override) : base;
}

/**
 * Baut einen phonetischen Index aus Wörterbuch-Einträgen.
 * Einmal beim Laden aufbauen, dann O(1)-Lookup pro phonetischem Code.
 */
export function buildPhoneticIndex(entries: { wrong: string; correct: string; source?: 'standard' | 'private' | 'group'; phoneticMinSimilarity?: number; targetUsername?: string; groupId?: number; groupName?: string }[]): {
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
      correctNorm: normalizeForComparison(entry.correct),
      correctPhonetic: colognePhonetic(entry.correct),
      isSelfMapping: normalizeForComparison(entry.wrong) === normalizeForComparison(entry.correct),
      isAcronymLike: isAcronymLikeTerm(entry.wrong) || isAcronymLikeTerm(entry.correct),
      source: entry.source,
      phoneticMinSimilarity: entry.phoneticMinSimilarity,
      targetUsername: entry.targetUsername,
      groupId: entry.groupId,
      groupName: entry.groupName,
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

// Schwellwert: Unterschreitet die phonetische Ähnlichkeit zwischen
// wrong und correct diesen Wert, wird vor dem Eintrag gewarnt.
const PHONETIC_ENTRY_WARNING_THRESHOLD = 0.35;

/**
 * Berechnet die phonetische Ähnlichkeit zwischen zwei Wörtern.
 * Nutzt den normalisierten Text (nicht nur die Codes), da kurze Codes
 * (z.B. „den“ → „26“ vs. „pAVK IIb“ → „13421“) bei reinem Code-Vergleich
 * zu trügerisch hohen/niedrigen Werten führen.
 *
 * Verwendet wird die Levenshtein-Distanz auf den normalisierten Formen,
 * kombiniert mit der phonetischen Code-Distanz als Plausibilitätsprüfung.
 *
 * @returns Wert zwischen 0 (völlig verschieden) und 1 (identisch).
 */
export function computeEntryPhoneticSimilarity(wrong: string, correct: string): number {
  const wNorm = normalizeForComparison(wrong);
  const cNorm = normalizeForComparison(correct);
  const textSimilarity = normalizedSimilarity(wNorm, cNorm);

  // Phonetische Code-Distanz als zweite Meinung
  const wCode = colognePhonetic(wrong);
  const cCode = colognePhonetic(correct);
  const maxCodeLen = Math.max(wCode.length, cCode.length, 1);
  const codeSimilarity = 1 - (levenshtein(wCode, cCode) / maxCodeLen);

  // Kombination: der schlechtere der beiden Werte dominiert (konservativ)
  return Math.min(textSimilarity, codeSimilarity);
}

/**
 * Prüft, ob ein Wörterbuch-Eintrag phonetisch zu weit auseinander liegt
 * und gibt ggf. eine erklärende Warnung zurück.
 *
 * @returns Warn-String oder null, wenn keine Warnung nötig ist.
 */
export function getEntryPhoneticWarning(wrong: string, correct: string): string | null {
  const similarity = computeEntryPhoneticSimilarity(wrong, correct);

  if (similarity >= PHONETIC_ENTRY_WARNING_THRESHOLD) {
    return null;
  }

  const wCode = colognePhonetic(wrong);
  const cCode = colognePhonetic(correct);

  return (
    `Achtung: „${wrong}“ und „${correct}“ sind phonetisch sehr verschieden ` +
    `(Ähnlichkeit: ${Math.round(similarity * 100)}%, Codes: ${wCode} ↔ ${cCode}). ` +
    `Das phonetische Matching könnte dadurch falsche Ersetzungen auslösen. ` +
    `Bitte prüfe, ob dieser Eintrag sinnvoll ist, oder schwäche das Matching über „Phonetisch abschwächen“ ab.`
  );
}

/**
 * Prüft, ob zwei Wörter phonetisch ähnlich genug sind, um einen
 * Wörterbuch-Vorschlag zu rechtfertigen.
 *
 * Verhindert sinnfreie Vorschläge wie das Matching eines gelöschten
 * Wortes mit dem unveränderten Vorwort, die phonetisch nichts
 * miteinander zu tun haben.
 *
 * Verwendet computeEntryPhoneticSimilarity und vergleicht gegen
 * den unteren Warn-Schwellwert.
 *
 * @returns true, wenn die Wörter phonetisch ähnlich genug sind.
 */
export function areWordsPhoneticallySimilar(a: string, b: string): boolean {
  if (!a || !b) return false;
  const similarity = computeEntryPhoneticSimilarity(a, b);
  return similarity >= PHONETIC_ENTRY_WARNING_THRESHOLD;
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
 * Dediziertes Akronym-Matching als Ergänzung zur phonetischen Suche.
 *
 * Adressiert drei Probleme:
 * 1. Kölner Phonetik ist für Initialwörter ungeeignet (CRP → 471 vs DASCRP → 2871)
 *    → Buchstabenkern-Levenshtein statt Phonetik (Patch 1)
 * 2. Kurze Akronyme (CRP, STIR) werden durch minWordLength=5 blockiert
 *    → Separate Matching-Logik mit niedrigerer Schwelle (Patch 2)
 * 3. Zahlen in Akronymen (DAS28-CRP) maskieren Teilakronyme
 *    → Aufsplitten an Zahlen/Nicht-Buchstaben (Patch 3)
 */
function findAcronymPhoneticMatch(
  word: string,
  index: { allEntries: PhoneticDictEntry[] }
): PhoneticMatchResult | null {
  if (!word) return null;

  // Alphanumerischer Kern (mit Ziffern), damit "DAS28" ≠ "DAS" ≠ "das"
  const wordCore = extractAlphanumericCore(word);
  if (wordCore.length < 3) return null;

  // Kurze Akronyme (2–3 Buchstaben) werden als Einzelbuchstaben gesprochen
  // (D-A-S, C-R-P). Liefert die STT ein kurzes Wort ohne Akronym-Charakter
  // ("das", "der", "ist" …), darf kein Treffer erfolgen.
  // Längere Akronyme (FLAIR, STIR, DAS28-CRP) werden phonetisch gesprochen
  // und bleiben ungefiltert.
  if (wordCore.length <= 3 && !isAcronymLikeTerm(word)) return null;

  const alphaParts = splitIntoAlphaParts(word);
  const isShortInput = wordCore.length <= 3;

  let bestMatch: PhoneticMatchResult | null = null;

  for (const entry of index.allEntries) {
    if (!entry.isAcronymLike) continue;

    // Ziffern-erhaltender Kern aus dem Original-Eintrag (nicht wrongNorm,
    // das Ziffern entfernt – "DAS28" würde sonst zu "das" verstümmelt)
    const entryCore = extractAlphanumericCore(entry.wrong);
    const isShortEntry = entryCore.length <= 3;

    // 1. Buchstabenkern-Levenshtein (Patch 1): direkter Vergleich ohne Phonetik
    const coreDist = levenshtein(wordCore, entryCore);
    const maxCoreLen = Math.max(wordCore.length, entryCore.length, 1);
    const coreSimilarity = 1 - coreDist / maxCoreLen;

    const minSim = getSimilarityThreshold(entry, false, wordCore.length);

    // Kurze Einträge (≤3 Buchstaben) nur per exaktem Kern-Vergleich matchen
    if (isShortEntry && wordCore !== entryCore) continue;

    if (coreSimilarity >= minSim) {
      const confidence = 0.5 + coreSimilarity * 0.5;
      if (!bestMatch || confidence > bestMatch.confidence) {
        bestMatch = {
          correct: entry.correct,
          confidence,
          similarity: coreSimilarity,
          minSimilarity: minSim,
          matchedEntry: entry,
        };
      }
    }

    // Substring/Part-Matching nur für längere Eingaben UND Einträge
    // (sonst Kollision mit deutschen Stoppwörtern wie "das" in "dascrp")
    if (isShortInput || isShortEntry || coreSimilarity < 0.4) continue;

    // 2. Substring-Prüfung (Patch 1): kürzerer Kern (≥4 Buchst.) im längeren enthalten?
    // z.B. "stir" in "stirn" → Hinweis auf verwandte Terme
    const shorter = wordCore.length <= entryCore.length ? wordCore : entryCore;
    const longer = wordCore.length > entryCore.length ? wordCore : entryCore;
    if (shorter.length >= 4 && longer.includes(shorter)) {
      const substringRatio = shorter.length / longer.length;
      const confidence = 0.55 + substringRatio * 0.25;
      if (!bestMatch || confidence > bestMatch.confidence) {
        bestMatch = {
          correct: entry.correct,
          confidence,
          similarity: coreSimilarity,
          minSimilarity: 0.4,
          matchedEntry: entry,
        };
      }
    }

    // 3. Teilakronyme matchen (Patch 3): alpha-parts gegen entryCore
    for (const part of alphaParts) {
      if (part.length < 2) continue;
      const partLower = part.toLowerCase();
      if (partLower === entryCore) {
        const confidence = 0.65;
        if (!bestMatch || confidence > bestMatch.confidence) {
          bestMatch = {
            correct: entry.correct,
            confidence,
            similarity: 1.0,
            minSimilarity: 0.5,
            matchedEntry: entry,
          };
        }
        break;
      }
      const partDist = levenshtein(partLower, entryCore);
      const maxPartLen = Math.max(partLower.length, entryCore.length, 1);
      const partSimilarity = 1 - partDist / maxPartLen;
      if (partSimilarity >= 0.75) {
        const confidence = 0.55 + partSimilarity * 0.1;
        if (!bestMatch || confidence > bestMatch.confidence) {
          bestMatch = {
            correct: entry.correct,
            confidence,
            similarity: partSimilarity,
            minSimilarity: 0.5,
            matchedEntry: entry,
          };
        }
      }
    }
  }

  return bestMatch;
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
): PhoneticMatchResult | null {
  if (!word) return null;
  const wordNorm = normalizeForComparison(word);
  // Patch 2: Kurze Akronyme (≥3 Buchstaben) durchlassen, wenn Einträge existieren
  if (wordNorm.length < minWordLength) {
    if (wordNorm.length >= 3 && index.allEntries.some(e => e.isAcronymLike)) {
      return findAcronymPhoneticMatch(word, index);
    }
    return null;
  }

  const wordPhonetic = colognePhonetic(word);

  if (!wordPhonetic) return null;

  let bestMatch: PhoneticMatchResult | null = null;

  const isCompatibleAcronymCandidate = (candidate: PhoneticDictEntry): boolean => {
    if (!candidate.isAcronymLike) {
      return true;
    }

    const acronymBaseLength = Math.max(candidate.wrongNorm.length, candidate.correctNorm.length);
    if (acronymBaseLength === 0) {
      return false;
    }

    return wordNorm.length <= acronymBaseLength + 1;
  };

  // Pass 1: Exakter phonetischer Code-Match
  const candidates = index.byPhoneticCode.get(wordPhonetic);
  if (candidates) {
    for (const cand of candidates) {
      if (!isCompatibleAcronymCandidate(cand)) {
        continue;
      }

      const dist = levenshtein(wordNorm, cand.wrongNorm);
      const maxLen = Math.max(wordNorm.length, cand.wrongNorm.length);
      const similarity = 1 - (dist / maxLen);
      const minSimilarity = getSimilarityThreshold(cand, false, wordNorm.length);

      if (similarity >= minSimilarity) {
        const confidence = 0.5 + (similarity * 0.5);
        if (!bestMatch || confidence > bestMatch.confidence) {
            bestMatch = { correct: cand.correct, confidence, similarity, minSimilarity, matchedEntry: cand };
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
        if (!isCompatibleAcronymCandidate(cand)) {
          continue;
        }

        const dist = levenshtein(wordNorm, cand.wrongNorm);
        const maxLen = Math.max(wordNorm.length, cand.wrongNorm.length);
        const similarity = 1 - (dist / maxLen);
        const minSimilarity = getSimilarityThreshold(cand, true, wordNorm.length);

        if (similarity >= minSimilarity) {
          const confidence = 0.4 + (similarity * 0.5);
          if (!bestMatch || confidence > bestMatch.confidence) {
            bestMatch = { correct: cand.correct, confidence, similarity, minSimilarity, matchedEntry: cand };
          }
        }
      }
    }
  }

  // Patch 1+3: Akronym-Matching als Fallback für Wörter, die phonetisch nicht matchen
  if (!bestMatch) {
    bestMatch = findAcronymPhoneticMatch(word, index);
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
  return applyPhoneticCorrectionsDetailed(text, index, minConfidence).text;
}

export function applyPhoneticCorrectionsDetailed(
  text: string,
  index: { byPhoneticCode: Map<string, PhoneticDictEntry[]>; allEntries: PhoneticDictEntry[] },
  minConfidence: number = 0.75
): { text: string; operations: PhoneticReplacementOperation[] } {
  if (!text || index.allEntries.length === 0) {
    return { text, operations: [] };
  }

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
  const operations: PhoneticReplacementOperation[] = [];

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

      // Tokens mit Ziffern (z. B. Histologie-Codes wie "R004998") sind keine
      // phonetisch korrigierbaren Wörter und dürfen nicht in ein Wort-Fenster
      // gezogen werden – sonst entstehen Fusionen wie "Histologie R004998" → "Histologier".
      if (positions.some(p => /\d/.test(parts[p]))) continue;

      // Wörter zusammenfügen (ohne Leerzeichen)
      const words = positions.map(p => parts[p]);
      const normalizedWords = words.map(word => normalizeForComparison(word));
      
      // Stoppwörter dürfen nicht am Rand des Fensters stehen
      // (sie könnten versehentlich mitgezogen werden)
      if (stopWords.has(words[0].toLowerCase()) || stopWords.has(words[words.length - 1].toLowerCase())) continue;
      if (normalizedWords.some(word => word.length === 0)) continue;
      
      const combined = words.join('');
      
      // Mindestlänge für zusammengefügte Wörter
      if (combined.length < 6) continue;

      const match = findPhoneticMatch(combined, index, 4);
      if (match && match.confidence >= minConfidence) {
        // Beuge-/Pluralendung des Gesamtphrasenendes bewahren
        let replacement = preserveInflection(combined, match.correct);
        const firstWord = parts[positions[0]];
        replacement = applyDictionaryReplacementCase(firstWord, replacement);

        if (replacement !== combined) {
          const originalPhrase = positions.map(p => parts[p]).join(' ');
          console.log(`[Phonetic] "${originalPhrase}" → "${replacement}" (${windowSize} words combined, confidence: ${match.confidence.toFixed(2)})`);
          operations.push({
            originalText: originalPhrase,
            replacementText: replacement,
            dictionaryWrong: match.matchedEntry.wrong,
            dictionaryCorrect: match.matchedEntry.correct,
            source: match.matchedEntry.source ?? 'standard',
            matchType: 'phonetic',
            confidence: match.confidence,
            similarity: match.similarity,
            minSimilarity: match.minSimilarity,
            targetUsername: match.matchedEntry.targetUsername,
            groupId: match.matchedEntry.groupId,
            groupName: match.matchedEntry.groupName,
          });
          
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
    // Tokens mit Ziffern (z. B. Codes/IDs wie "R004998") nicht phonetisch korrigieren.
    if (/\d/.test(token)) continue;
    const match = findPhoneticMatch(token, index);
    if (match && match.confidence >= minConfidence) {
      // Beuge-/Pluralendung bewahren (z.B. "arterielle" bleibt "arterielle", nicht "arteriell")
      let replacement = preserveInflection(token, match.correct);
      replacement = applyDictionaryReplacementCase(token, replacement);

      if (replacement !== token) {
        console.log(`[Phonetic] "${token}" → "${replacement}" (confidence: ${match.confidence.toFixed(2)})`);
        parts[wi] = replacement;
        replaced.add(wi);
        changed = true;
        operations.push({
          originalText: token,
          replacementText: replacement,
          dictionaryWrong: match.matchedEntry.wrong,
          dictionaryCorrect: match.matchedEntry.correct,
          source: match.matchedEntry.source ?? 'standard',
          matchType: 'phonetic',
          confidence: match.confidence,
          similarity: match.similarity,
          minSimilarity: match.minSimilarity,
          targetUsername: match.matchedEntry.targetUsername,
          groupId: match.matchedEntry.groupId,
          groupName: match.matchedEntry.groupName,
        });
      }
    }
  }

  return { text: changed ? parts.join('') : text, operations };
}
