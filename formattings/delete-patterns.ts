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
  commands: string[];
  pattern: RegExp;
  type: 'word' | 'sentence' | 'paragraph';
}

export const DELETE_PATTERNS: DeletePattern[] = [
  // --- Wort löschen ---
  { commands: ['Wort streichen'],               pattern: /\bwort\s*streichen\b/gi, type: 'word' as const },
  { commands: ['streiche Wort'],                pattern: /\bstreiche\s*wort\b/gi, type: 'word' as const },
  { commands: ['Wort löschen'],                 pattern: /\bwort\s*löschen\b/gi, type: 'word' as const },
  { commands: ['lösche das letzte Wort'],       pattern: /lösche\s*(?:das\s*)?letzte(?:s)?\s*wort\b/gi, type: 'word' as const },
  { commands: ['letztes Wort löschen'],         pattern: /letztes\s*wort\s*löschen\b/gi, type: 'word' as const },

  // --- Satz löschen ---
  { commands: ['lösche den letzten Satz'],      pattern: /lösche\s*(?:den\s*)?letzten\s*satz\b/gi, type: 'sentence' as const },
  { commands: ['Satz löschen'],                 pattern: /\bsatz\s*löschen\b/gi, type: 'sentence' as const },
  { commands: ['letzten Satz löschen'],         pattern: /letzten\s*satz\s*löschen\b/gi, type: 'sentence' as const },

  // --- Absatz löschen ---
  { commands: ['lösche den letzten Absatz'],    pattern: /lösche\s*(?:den\s*)?letzten\s*absatz\b/gi, type: 'paragraph' as const },
  { commands: ['letzten Absatz löschen'],       pattern: /letzten\s*absatz\s*löschen\b/gi, type: 'paragraph' as const },
];
