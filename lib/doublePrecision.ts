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

AUSGABE: NUR den korrigierten Text. KEINE Erklärungen.

FINALER TEXT:`;
}

/**
 * Erstellt einen einfachen User-Prompt für die Merge-Anfrage
 */
export function createMergeUserMessage(merged: MergedResult): string {
  return merged.mergedTextWithMarkers;
}
