/**
 * Löschbefehle für die Diktatverarbeitung.
 *
 * Jeder Eintrag definiert ein gesprochenes Muster und was gelöscht wird.
 * Typ: 'word' | 'sentence' | 'paragraph'
 *
 * Änderungen an dieser Datei beeinflussen direkt, welche Löschbefehle
 * während des Diktats erkannt und ausgeführt werden.
 */

export interface DeletePattern {
  pattern: RegExp;
  type: 'word' | 'sentence' | 'paragraph';
}

export const DELETE_PATTERNS: DeletePattern[] = [
  // --- Wort löschen ---
  { pattern: /\bwort\s*streichen\b/gi, type: 'word' as const },
  { pattern: /\bstreiche\s*wort\b/gi, type: 'word' as const },
  { pattern: /\bwort\s*löschen\b/gi, type: 'word' as const },
  { pattern: /lösche\s*(?:das\s*)?letzte(?:s)?\s*wort\b/gi, type: 'word' as const },
  { pattern: /letztes\s*wort\s*löschen\b/gi, type: 'word' as const },

  // --- Satz löschen ---
  { pattern: /lösche\s*(?:den\s*)?letzten\s*satz\b/gi, type: 'sentence' as const },
  { pattern: /\bsatz\s*löschen\b/gi, type: 'sentence' as const },
  { pattern: /letzten\s*satz\s*löschen\b/gi, type: 'sentence' as const },

  // --- Absatz löschen ---
  { pattern: /lösche\s*(?:den\s*)?letzten\s*absatz\b/gi, type: 'paragraph' as const },
  { pattern: /letzten\s*absatz\s*löschen\b/gi, type: 'paragraph' as const },
];
