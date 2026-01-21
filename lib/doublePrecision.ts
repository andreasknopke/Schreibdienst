/**
 * Double Precision Pipeline
 * 
 * Führt Transkriptionen mit zwei verschiedenen Services durch,
 * merged die Ergebnisse und lässt ein LLM die beste Version wählen.
 */

import { diffWordsWithSpace } from 'diff';
import { DictionaryEntry } from './dictionaryDb';

export interface TranscriptionResult {
  text: string;
  segments?: any[];
  provider: string;
}

export interface MergedResult {
  mergedTextWithMarkers: string;
  text1: string;
  text2: string;
  provider1: string;
  provider2: string;
  hasDifferences: boolean;
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
    };
  }
  
  // Wort-basierter Diff
  const diffs = diffWordsWithSpace(text1, text2);
  
  let mergedParts: string[] = [];
  let i = 0;
  
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
          mergedParts.push(`<<<A: ${versionA} | B: ${versionB}>>>`);
        } else if (versionA) {
          mergedParts.push(`<<<A: ${versionA} | B: [FEHLT]>>>`);
        } else if (versionB) {
          mergedParts.push(`<<<A: [FEHLT] | B: ${versionB}>>>`);
        }
        i += 2;
      } else {
        // Nur gelöscht in Version 2
        const versionA = current.value.trim();
        if (versionA) {
          mergedParts.push(`<<<A: ${versionA} | B: [FEHLT]>>>`);
        }
        i++;
      }
    } else if (current.added) {
      // Nur hinzugefügt in Version 2 (ohne vorherige Löschung)
      const versionB = current.value.trim();
      if (versionB) {
        mergedParts.push(`<<<A: [FEHLT] | B: ${versionB}>>>`);
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
    hasDifferences: true,
  };
}

/**
 * Erstellt den System-Prompt für das LLM zur Auflösung der Unterschiede
 * Optimiert für MedGamma-27B (4K quantisiert)
 */
export function createMergePrompt(merged: MergedResult, dictionaryEntries?: DictionaryEntry[]): string {
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

  return `Du bist ein medizinischer Transkriptions-Experte. Zwei Whisper-Modelle haben dasselbe Diktat transkribiert. Wähle bei jedem Unterschied die KORREKTE Version.${dictionarySection}

TRANSKRIPTION A (${merged.provider1}):
${merged.text1}

TRANSKRIPTION B (${merged.provider2}):
${merged.text2}

MARKIERTE UNTERSCHIEDE:
${merged.mergedTextWithMarkers}

ENTSCHEIDUNGSREGELN für <<<A: ... | B: ...>>>:

1. WÖRTERBUCH ZUERST: Falls ein Wort im Wörterbuch steht, verwende die korrekte Form.

2. ECHTE WÖRTER BEVORZUGEN:
   ✓ "Gelenkbefall" (echtes Wort) statt "Gelenkbüffel" (Unsinn)
   ✓ "Vaskulitis" statt "Voskulitis"/"Vaskelytis"
   ✓ "Daktylitis" statt "Dachlitiden"/"Daphnitiden"
   ✓ "Arthralgien" statt "Atragien"/"Arthrogäne"

3. MEDIZINISCHE FACHBEGRIFFE:
   - Psoriasis (nicht Diasis)
   - Skyrizi = Risankizumab (nicht Sky Ritzy, Eschkei)
   - Celecoxib (nicht Silikoxid, Xelokoksin)
   - MTX = Methotrexat (nicht M-Ticks)
   - IL-17-Blockade (nicht ER-17, ihr 17)
   - JAK-Inhibitoren (nicht Yakubitor)
   - Uveitis (nicht Ovitiden)

4. RHEUMATOLOGIE-KONTEXT:
   Gelenkbefall, axialer Befall, Biologika, Basistherapie, HLA-B27, ISG, OSG

AUSGABE: NUR den korrigierten Text. KEINE Erklärungen.

FINALER TEXT:`;
}

/**
 * Erstellt einen einfachen User-Prompt für die Merge-Anfrage
 */
export function createMergeUserMessage(merged: MergedResult): string {
  return merged.mergedTextWithMarkers;
}
