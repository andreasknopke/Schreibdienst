/**
 * Double Precision Pipeline
 * 
 * Führt Transkriptionen mit zwei verschiedenen Services durch,
 * merged die Ergebnisse und lässt ein LLM die beste Version wählen.
 */

import { diffWordsWithSpace } from 'diff';
import { colognePhonetic, levenshtein } from './phoneticMatch';
import { DictionaryEntry } from './dictionaryDb';

export interface TranscriptionResult {
  text: string;
  segments?: any[];
  provider: string;
  originalText?: string;
}

export interface MergedResult {
  mergedTextWithMarkers: string;
  text1: string;
  text2: string;
  provider1: string;
  provider2: string;
  hasDifferences: boolean;
  autoResolvedDifferences: number;
}

export interface MergeNovelWordGuardResult {
  text: string;
  removedWords: string[];
}

function normalizeMergeWord(word: string): string {
  return word.toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z]/g, '');
}

function wordSimilarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length, 1);
  return 1 - (levenshtein(a, b) / maxLen);
}

function isWordToken(token: string): boolean {
  return /^[A-Za-zÄÖÜäöüß]+$/.test(token);
}

function tokenizeWordsAndSeparators(text: string): string[] {
  return text.match(/[A-Za-zÄÖÜäöüß]+|[^A-Za-zÄÖÜäöüß]+/g) ?? [];
}

function isPlausibleSourceDerivedWord(candidate: string, sourceWords: string[]): boolean {
  const candidateNorm = normalizeMergeWord(candidate);
  if (!candidateNorm) {
    return true;
  }

  const candidatePhonetic = colognePhonetic(candidate);

  for (const sourceWord of sourceWords) {
    const sourceNorm = normalizeMergeWord(sourceWord);
    if (!sourceNorm) {
      continue;
    }

    if (candidateNorm === sourceNorm) {
      return true;
    }

    const lexicalSimilarity = wordSimilarity(candidateNorm, sourceNorm);
    if (lexicalSimilarity >= 0.88) {
      return true;
    }

    const sourcePhonetic = colognePhonetic(sourceWord);
    if (!candidatePhonetic || !sourcePhonetic) {
      continue;
    }

    const phoneticSimilarity = wordSimilarity(candidatePhonetic, sourcePhonetic);
    const minWordLength = Math.min(candidateNorm.length, sourceNorm.length);

    if (minWordLength < 4) {
      if (phoneticSimilarity >= 0.8 && lexicalSimilarity >= 0.5) {
        return true;
      }
      continue;
    }

    if (phoneticSimilarity >= 0.67 && lexicalSimilarity >= 0.34) {
      return true;
    }
  }

  return false;
}

export function stripNovelWordsFromMergeOutput(text1: string, text2: string, finalText: string): MergeNovelWordGuardResult {
  if (!finalText) {
    return { text: finalText, removedWords: [] };
  }

  const sourceWords = Array.from(new Set(
    [...text1.match(/[A-Za-zÄÖÜäöüß]+/g) ?? [], ...text2.match(/[A-Za-zÄÖÜäöüß]+/g) ?? []]
  ));

  if (sourceWords.length === 0) {
    return { text: finalText, removedWords: [] };
  }

  const removedWords: string[] = [];
  const guardedTokens = tokenizeWordsAndSeparators(finalText).filter(token => {
    if (!isWordToken(token)) {
      return true;
    }

    if (isPlausibleSourceDerivedWord(token, sourceWords)) {
      return true;
    }

    removedWords.push(token);
    return false;
  });

  if (removedWords.length === 0) {
    return { text: finalText, removedWords };
  }

  const cleaned = guardedTokens.join('')
    .replace(/\s+([,.;:!?])/g, '$1')
    .replace(/([({\[] )/g, '$1')
    .replace(/\s{2,}/g, ' ')
    .trim();

  return {
    text: cleaned,
    removedWords,
  };
}

/**
 * Erstellt einen Text mit markierten Unterschieden zwischen zwei Transkriptionen.
 * Format: <<<VERSION_A: text1 | VERSION_B: text2>>>
 */
export function mergeTranscriptionsWithMarkers(
  result1: TranscriptionResult,
  result2: TranscriptionResult
): MergedResult {
  const text1 = result1.text.trim();
  const text2 = result2.text.trim();
  
  // Wenn beide identisch sind, keine Markierung nötig
  if (text1 === text2) {
    return {
      mergedTextWithMarkers: text1,
      text1,
      text2,
      provider1: result1.provider,
      provider2: result2.provider,
      hasDifferences: false,
      autoResolvedDifferences: 0,
    };
  }
  
  // Wort-basierter Diff
  const diffs = diffWordsWithSpace(text1, text2);
  
  let mergedParts: string[] = [];
  let i = 0;
  let unresolvedDifferences = 0;
  let autoResolvedDifferences = 0;
  
  while (i < diffs.length) {
    const current = diffs[i];
    
    if (!current.added && !current.removed) {
      // Unverändert - direkt übernehmen
      mergedParts.push(current.value);
      i++;
    } else if (current.removed) {
      // Suche nach dem nächsten 'added' Teil (falls vorhanden)
      const addedPart = diffs[i + 1]?.added ? diffs[i + 1] : null;
      
      if (addedPart) {
        // Es gibt eine Ersetzung - markiere beide Versionen
        const versionA = current.value.trim();
        const versionB = addedPart.value.trim();
        
        if (versionA && versionB) {
          // Wenn die Unterschiede NUR aus abweichender Interpunktion bestehen
          // (z. B. R004998-26, vs. R004998-26.), wird das LLM nicht belastet.
          // Solche reinen Satzzeichen-Varianten werden automatisch aufgelöst.
          const strippedA = versionA.replace(/[.,;:!?]+$/, '');
          const strippedB = versionB.replace(/[.,;:!?]+$/, '');
          if (strippedA === strippedB && strippedA.length > 0) {
            mergedParts.push(versionA.length >= versionB.length ? current.value : addedPart.value);
            autoResolvedDifferences++;
            i += 2;
            continue;
          }

          // Wenn eine Seite deutlich mehr Inhalt hat als die andere,
          // ist davon auszugehen, dass der zusätzliche Inhalt nicht verloren
          // gehen darf (z. B. eine Passage, die nur ein Modell verstanden hat).
          // In diesem Fall übernehmen wir automatisch die längere Variante,
          // statt dem LLM eine kurze Auswahl-Entscheidung zu geben.
          const wordsA = versionA.split(/\s+/).filter(Boolean);
          const wordsB = versionB.split(/\s+/).filter(Boolean);
          const lenA = wordsA.length;
          const lenB = wordsB.length;
          const diffWords = Math.abs(lenA - lenB);
          const longer = Math.max(lenA, lenB);
          const shorter = Math.max(Math.min(lenA, lenB), 1);
          const ratio = longer / shorter;
          const SIGNIFICANT_RATIO = 2;
          const SIGNIFICANT_WORD_DELTA = 5;

          if (diffWords >= SIGNIFICANT_WORD_DELTA && ratio >= SIGNIFICANT_RATIO) {
            // Inhaltliche Asymmetrie -> längere Version vollständig übernehmen
            mergedParts.push(lenB > lenA ? addedPart.value : current.value);
            autoResolvedDifferences++;
          } else {
            mergedParts.push(`<<<A: ${versionA} | B: ${versionB}>>>`);
            unresolvedDifferences++;
          }
        } else if (versionA) {
          mergedParts.push(current.value);
          autoResolvedDifferences++;
        } else if (versionB) {
          mergedParts.push(addedPart.value);
          autoResolvedDifferences++;
        }
        i += 2;
      } else {
        // Nur gelöscht in Version 2
        const versionA = current.value.trim();
        if (versionA) {
          mergedParts.push(current.value);
          autoResolvedDifferences++;
        }
        i++;
      }
    } else if (current.added) {
      // Nur hinzugefügt in Version 2 (ohne vorherige Löschung)
      const versionB = current.value.trim();
      if (versionB) {
        mergedParts.push(current.value);
        autoResolvedDifferences++;
      }
      i++;
    }
  }
  
  return {
    mergedTextWithMarkers: mergedParts.join(''),
    text1,
    text2,
    provider1: result1.provider,
    provider2: result2.provider,
    hasDifferences: unresolvedDifferences > 0,
    autoResolvedDifferences,
  };
}

/**
 * Zusätzliche Kontextinformationen für den Merge-Prompt
 */
export interface MergeContext {
  dictionaryEntries?: DictionaryEntry[];
  patientName?: string;
  patientDob?: string;
  doctorName?: string;
}

/**
 * Erstellt den System-Prompt für das LLM zur Auflösung der Unterschiede
 * Optimiert für MedGamma-27B (4K quantisiert)
 */
export function createMergePrompt(merged: MergedResult, context?: MergeContext): string {
  const dictionaryEntries = context?.dictionaryEntries;
  const patientName = context?.patientName;
  const patientDob = context?.patientDob;
  const doctorName = context?.doctorName;

  // Build dictionary section if entries exist with useInPrompt=true
  let dictionarySection = '';
  if (dictionaryEntries && dictionaryEntries.length > 0) {
    const promptEntries = dictionaryEntries.filter(e => e.useInPrompt);
    if (promptEntries.length > 0) {
      const dictLines = promptEntries.map(e => `"${e.wrong}" → "${e.correct}"`).join(', ');
      dictionarySection = `

WÖRTERBUCH (HÖCHSTE PRIORITÄT - immer anwenden):
${dictLines}`;
    }
  }

  // Build context section for patient and doctor
  let contextSection = '';
  const contextParts: string[] = [];
  if (patientName) contextParts.push(`Patient: ${patientName}`);
  if (patientDob) contextParts.push(`Geb.: ${patientDob}`);
  if (doctorName) contextParts.push(`Arzt: Dr. ${doctorName}`);
  if (contextParts.length > 0) {
    contextSection = `

DIKTAT-KONTEXT:
${contextParts.join(', ')}
Korrigiere phonetisch ähnliche Namen zu diesen korrekten Schreibweisen.`;
  }

  return `Du bist ein medizinischer Transkriptions-Experte. Zwei Whisper-Modelle haben dasselbe Diktat transkribiert. Wähle bei jedem Unterschied die KORREKTE Version.${dictionarySection}${contextSection}

DEINE AUFGABE - NUR DIESE KORREKTUREN:
• Korrigiere AUSSCHLIESSLICH Whisper-Fehler (phonetische Fehler, Verhörer)
• Korrigiere Rechtschreibung und Zeichensetzung
• Ändere NIEMALS den Satzbau oder die Satzstruktur
• Ersetze NIEMALS medizinische Fachbegriffe durch Synonyme
• Füge NIEMALS neue Wörter hinzu, die in keiner der beiden Transkriptionen vorkommen
• Wenn ein Wort in beiden Versionen unklar/unverständlich ist, markiere es mit [?]
• BEHALTE ALLE ALPHANUMERISCHEN CODES WIE R004998-26, P12345, ICD-10-Codes, Labor- und Histologie-Nummern UNVERÄNDERT BEI – auch dann, wenn sie für dich wie Tippfehler oder kryptische Zeichenketten aussehen. Diese Codes sind medizinisch relevant und dürfen NIEMALS gekürzt, getrennt oder gelöscht werden.

INHALTSERHALT (KRITISCH - kein gesprochener Inhalt darf verloren gehen):
• Text AUSSERHALB von <<<A: ... | B: ...>>> MUSS exakt und vollständig übernommen werden – auch dann, wenn er nur in einer der beiden Transkriptionen vorkam.
• Alphanumerische Codes (z. B. R004998, R004998-26, C34.9, J45.0, ICD-10-Codes, Histologie- und Labor-Nummern) sind MEDIZINISCHE DATEN, keine Tippfehler. DU DARFST SIE NIEMALS verändern, kürzen, trennen oder entfernen. Wenn ein Buchstaben-Ziffern-Code in einer oder beiden Transkriptionen steht, MUSS er unverändert im finalen Text erscheinen.
• Wenn innerhalb eines <<<A: ... | B: ...>>>-Markers eine Seite deutlich mehr medizinisch sinnvollen Inhalt enthält als die andere (z. B. ein ganzer Satz vs. ein einzelnes Wort), übernimm die längere Version VOLLSTÄNDIG. Es ist davon auszugehen, dass das andere Modell diese Passage einfach nicht verstanden hat.
• Lasse niemals ganze Sätze, Diagnosen, Befunde oder Anweisungen weg, die in einer der beiden Versionen klar enthalten sind.

TRANSKRIPTION A (${merged.provider1}):
${merged.text1}

TRANSKRIPTION B (${merged.provider2}):
${merged.text2}

MARKIERTE UNTERSCHIEDE:
${merged.mergedTextWithMarkers}

ENTSCHEIDUNGSREGELN für <<<A: ... | B: ...>>>:

1. WÖRTERBUCH/KONTEXT ZUERST: Nutze Wörterbuch und Diktat-Kontext (Patientenname, Arztname).

2. ECHTE WÖRTER BEVORZUGEN:
   ✓ "Gelenkbefall" statt "Gelenkbüffel"
   ✓ "Vaskulitis" statt "Voskulitis"
   ✓ "Daktylitis" statt "Dachlitiden"
   ✓ "Arthralgien" statt "Atragien"

3. MEDIZINISCHE FACHBEGRIFFE (alle Fachgebiete):
   RHEUMATOLOGIE: Psoriasis, Skyrizi, Celecoxib, MTX, IL-17, JAK-Inhibitoren, Biologika, HLA-B27
   KARDIOLOGIE: Myokardinfarkt, Koronarangiographie, Ejektionsfraktion, Vorhofflimmern, Stent
   CHIRURGIE: Laparoskopie, Cholezystektomie, Appendektomie, Anastomose, Drainage
   INNERE: Gastroskopie, Koloskopie, Sonographie, Aszites, Hepatomegalie, Splenomegalie
   GYNÄKOLOGIE: Hysterektomie, Adnexe, Zervix, Endometriose, Mammographie

VERBOTEN:
• KEINE Änderung des Satzbaus oder der Wortreihenfolge
• KEINE Ersetzung von Fachbegriffen durch Synonyme (z.B. NICHT "Arthralgien" → "Gelenkschmerzen")
• KEINE Markdown-Formatierung (**fett**, *kursiv*, # Überschriften)
• KEINE Erklärungen oder Kommentare
• KEINE Veränderung, Kürzung oder Löschung von alphanumerischen Codes (Buchstaben+Ziffern-Kombinationen wie R004998-26, C34.9, ICD-Codes, Histologie-/Labor-Nummern) – diese müssen BUCHSTABENGETREU und VOLLSTÄNDIG erhalten bleiben

AUSGABE: NUR den korrigierten Text. Reiner, unformatierter Fließtext.

FINALER TEXT:`;
}

/**
 * Erstellt einen einfachen User-Prompt für die Merge-Anfrage
 */
export function createMergeUserMessage(merged: MergedResult): string {
  return merged.mergedTextWithMarkers;
}

/**
 * Validiert nach dem LLM-Merge, ob medizinische Codes/IDs, die in BEIDEN
 * Quelltranskriptionen vorkommen, im LLM-Output erhalten geblieben sind.
 *
 * Typische Muster: Histologie-Nummern (R004998-26), Labornummern, ICD-Codes.
 *
 * Strategie in absteigender Präzision:
 * 1. Kontext aus Quelltexten extrahieren (Wort vor dem Code), dann im Output
 *    nach Kontextwort + Suffix suchen (z. B. "Histologie 26" → "Histologie R004998-26").
 * 2. [?] + Suffix ersetzen (z. B. "[?] 26" → "R004998-26").
 * 3. [?] alleinstehend durch den Code ersetzen.
 */
export function restoreMissingMedicalCodes(text1: string, text2: string, finalText: string): string {
  if (!finalText) return finalText;

  // Findet alphanumerische Codes: Buchstabe(n) + Ziffern, optional mit -Ziffernanhang
  // Beispiele: R004998, R004998-26, P12345, ABC9876-3
  const codePattern = /[A-Za-zÄÖÜäöüß]\d{3,}(?:[-–]\d+)?/g;

  const codes1 = new Set(text1.match(codePattern) ?? []);
  const codes2 = new Set(text2.match(codePattern) ?? []);

  // Debug-Log: welche Codes wurden in den Quelltexten gefunden?
  console.log(
    `[DoublePrecision] RestoreMissingCodes: Quelle 1 gefundene Codes: [${[...codes1].join(', ')}], ` +
    `Quelle 2 gefundene Codes: [${[...codes2].join(', ')}]`
  );

  // Nur Codes, die in BEIDEN Transkriptionen sicher erkannt wurden
  const consensusCodes: string[] = [];
  for (const code of codes1) {
    if (codes2.has(code)) {
      consensusCodes.push(code);
    }
  }

  if (consensusCodes.length === 0) return finalText;

  const missingCodes = consensusCodes.filter(code => !finalText.includes(code));
  if (missingCodes.length === 0) return finalText;

  console.log(
    `[DoublePrecision] RestoreMissingCodes: ${missingCodes.length} fehlende(r) Code(s) gefunden: ${missingCodes.join(', ')}`
  );

  let restored = finalText;

  for (const code of missingCodes) {
    // Code-Muster: R004998-26 → prefix=R004998, suffix=26
    const parts = code.match(/^([A-Za-zÄÖÜäöüß]\d{3,})(?:[-–](\d+))?$/);
    if (!parts) continue;

    const prefix = parts[1];    // z. B. R004998
    const suffix = parts[2];    // z. B. 26 (oder undefined)

    // Strategie 1: Kontextwort aus den Quelltexten extrahieren und im Output suchen.
    // Deckt den Fall ab: "Histologie 26" → "Histologie R004998-26"
    const contextWord = findCodeContextWord(text1, code) || findCodeContextWord(text2, code);
    console.log(
      `[DoublePrecision] RestoreMissingCodes: "${code}" → prefix="${prefix}" suffix="${suffix || 'n/a'}" ` +
      `contextWord="${contextWord || 'n/a'}"`
    );

    if (suffix && contextWord) {
      // Strategie 1a: Kontextwort + Leerzeichen + Suffix
      // "Histologie 26" → "Histologie R004998-26"
      const spaceRegex = new RegExp(
        `(${escapeRegex(contextWord)})\\s+${escapeRegex(suffix)}(?=[.,;:!?\\s]|$)`,
        'i'
      );
      const prev = restored;
      restored = restored.replace(spaceRegex, `$1 ${prefix}-${suffix}`);
      if (restored !== prev) {
        console.log(`[DoublePrecision] RestoreMissingCodes: "${code}" via Kontext+Whitespace "${contextWord} ${suffix}"`);
        continue;
      }

      // Strategie 1b: Kontextwort fusioniert mit Code-Fragment + Suffix
      // "Histologier-26" → "Histologie R004998-26"
      // Das LLM hat Kontextwort+Fragmente+Zahl zusammengeschrieben.
      const fusedRegex = new RegExp(
        `(${escapeRegex(contextWord)})\\D{0,8}${escapeRegex(suffix)}(?=[.,;:!?\\s]|$)`,
        'i'
      );
      const prev2 = restored;
      restored = restored.replace(fusedRegex, `$1 ${prefix}-${suffix}`);
      if (restored !== prev2) {
        console.log(`[DoublePrecision] RestoreMissingCodes: "${code}" via Kontext+fused "${contextWord}…${suffix}"`);
        continue;
      }
    }

    // Strategie 2: [?] + Suffix
    if (suffix) {
      const suffixRegex = new RegExp(
        `\\[\\?\\]\\s*${escapeRegex(suffix)}(?=[.,;:!?\\s]|$)`,
        'i'
      );
      const prev = restored;
      restored = restored.replace(suffixRegex, `${prefix}-${suffix}`);
      if (restored !== prev) {
        console.log(`[DoublePrecision] RestoreMissingCodes: "${code}" via [?] + Suffix wiederhergestellt`);
        continue;
      }
    }

    // Strategie 3: [?] alleinstehend durch den kompletten Code ersetzen
    if (restored.includes('[?]')) {
      restored = restored.replace('[?]', code);
      console.log(`[DoublePrecision] RestoreMissingCodes: "${code}" via [?]-Ersetzung wiederhergestellt`);
      continue;
    }

    // Strategie 4: Suffix ohne Kontextwort suchen (letzte Chance, unsicherer)
    if (suffix) {
      // Nur anwenden, wenn der Suffix eine einigermaßen eindeutige Länge hat (≥ 2 Ziffern)
      // und nicht bereits als Teil eines anderen Wortes/Codes vorkommt
      if (suffix.length >= 2) {
        const suffixOnlyRegex = new RegExp(
          `(?<![A-Za-zÄÖÜäöüß\\d-])${escapeRegex(suffix)}(?=[.,;:!?\\s]|$)`,
          'i'
        );
        const matches = restored.match(suffixOnlyRegex);
        if (matches && matches.length === 1) {
          // Nur ersetzen, wenn der Suffix genau einmal im Text vorkommt
          restored = restored.replace(suffixOnlyRegex, `${prefix}-${suffix}`);
          console.log(`[DoublePrecision] RestoreMissingCodes: "${code}" via eindeutigem Suffix wiederhergestellt`);
          continue;
        }
      }
    }

    console.warn(
      `[DoublePrecision] RestoreMissingCodes: "${code}" fehlt im LLM-Output, ` +
      `keine Wiederherstellung möglich. Text muss ggf. manuell geprüft werden.`
    );
  }

  return restored;
}

/**
 * Findet das Wort unmittelbar vor einem Code in einem Quelltext.
 * Z. B. für "Histologie R004998-26" → "Histologie"
 */
function findCodeContextWord(text: string, code: string): string | null {
  const idx = text.indexOf(code);
  if (idx <= 0) return null;

  const before = text.substring(0, idx).trim();
  const words = before.split(/\s+/);
  if (words.length === 0) return null;

  let contextWord = words[words.length - 1];
  // Strippen von angehängten Satzzeichen, damit auch "Histologie," → "Histologie"
  contextWord = contextWord.replace(/[.,;:!?]+$/, '');
  // Nur zurückgeben, wenn es ein echtes Wort ist (keine Satzzeichen-Kette, mind. 2 Buchstaben)
  return /^[A-Za-zÄÖÜäöüß]{2,}$/.test(contextWord) ? contextWord : null;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
