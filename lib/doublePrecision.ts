/**
 * Double Precision Pipeline
 * 
 * Führt Transkriptionen mit zwei verschiedenen Services durch,
 * merged die Ergebnisse und lässt ein LLM die beste Version wählen.
 */

import { diffWordsWithSpace } from 'diff';

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
 */
export function createMergePrompt(merged: MergedResult): string {
  return `Du bist ein medizinischer Transkriptions-Experte. Dir werden zwei Transkriptionen desselben Audiodiktats präsentiert, mit markierten Unterschieden.

TRANSKRIPTION A (${merged.provider1}):
${merged.text1}

TRANSKRIPTION B (${merged.provider2}):
${merged.text2}

MERGED TEXT MIT MARKIERTEN UNTERSCHIEDEN:
${merged.mergedTextWithMarkers}

DEINE AUFGABE:
- Analysiere jeden markierten Unterschied (<<<A: ... | B: ...>>>)
- Wähle für jeden Unterschied die Version, die im medizinischen Kontext am sinnvollsten ist
- Berücksichtige Grammatik, medizinische Terminologie und logischen Zusammenhang
- Erstelle den finalen, zusammenhängenden Text

WICHTIGE REGELN:
1. Gib NUR den finalen Text zurück - KEINE Erklärungen, Kommentare oder Einleitungen
2. Der Text muss vollständig und grammatisch korrekt sein
3. Behalte alle korrekten Teile bei, die nicht markiert sind
4. Bei [FEHLT] entscheide, ob das Wort/die Phrase notwendig ist oder weggelassen werden sollte

FINALER TEXT:`;
}

/**
 * Erstellt einen einfachen User-Prompt für die Merge-Anfrage
 */
export function createMergeUserMessage(merged: MergedResult): string {
  return merged.mergedTextWithMarkers;
}
