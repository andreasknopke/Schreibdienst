/**
 * Hilfsfunktionen zur Erkennung von {…}-Markern in Textbausteinen.
 *
 * Ein Absatz, der mit {…} beginnt (z. B. "{Linke Hand} Beweglichkeit frei…"),
 * wird vom LLM beim Einarbeiten von Diktaten als wiederholbar erkannt.
 * Die Wiederholung selbst steuert der Prompt in prompts/templates/adapt-base.ts.
 *
 * Diese Datei stellt nur clientseitige Utility-Funktionen für die Erkennung
 * bereit (z. B. für UI-Hinweise).
 */

// ---------------------------------------------------------------------------
// Typen
// ---------------------------------------------------------------------------

export interface MarkerParagraph {
  /** Index des Absatzes im Plaintext (0‑basiert) */
  pIndex: number;
  /** Vollständiger Plaintext des Absatzes */
  pTag: string;
  /** Inhalt der geschweiften Klammer (z. B. "Linke Hand") */
  marker: string;
  /** Plaintext des gesamten Absatzes */
  plainText: string;
}

// ---------------------------------------------------------------------------
// Plaintext-Parsing: Absätze via \n\n
// ---------------------------------------------------------------------------

/**
 * Teilt einen Plaintext in Absätze auf (getrennt durch \n\n).
 */
function splitParagraphs(text: string): string[] {
  if (!text) return [];
  return text.split(/\n\n+/).filter(p => p.trim().length > 0);
}

// ---------------------------------------------------------------------------
// Öffentliche API
// ---------------------------------------------------------------------------

/**
 * Durchsucht einen Plaintext nach Absätzen, die mit {…} beginnen.
 */
export function findMarkerParagraphs(text: string): MarkerParagraph[] {
  if (!text) return [];
  const paragraphs = splitParagraphs(text);
  const results: MarkerParagraph[] = [];
  for (let i = 0; i < paragraphs.length; i++) {
    const pText = paragraphs[i].trim();
    const match = pText.match(/^\s*\{([^}]+)\}/);
    if (match) {
      results.push({ pIndex: i, pTag: pText, marker: match[1].trim(), plainText: pText });
    }
  }
  return results;
}

/**
 * Prüft, ob ein Plaintext überhaupt {…}-Marker enthält.
 */
export function hasMarkerParagraphs(text: string): boolean {
  return findMarkerParagraphs(text).length > 0;
}
