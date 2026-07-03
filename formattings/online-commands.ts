/**
 * Befehlsmuster für den Online/VAD-Diktatpfad.
 *
 * Anders als CONTROL_WORD_REPLACEMENTS (für den Batch-Pfad) werden diese
 * Muster verwendet, um Befehle direkt im Utterance-Stream zu erkennen
 * und zwischen Textanfügungen auszuführen.
 *
 * Typen: period, comma, dash, lineBreak, paragraphBreak, bulletPoint,
 *        deleteWord, deleteSentence, deleteParagraph
 *
 * Änderungen an dieser Datei beeinflussen, welche Befehle während
 * der Live-Diktat-Aufnahme (Online/VAD-Pfad) erkannt werden.
 */

export type OnlineCommandType =
  | 'deleteWord'
  | 'deleteSentence'
  | 'deleteParagraph'
  | 'lineBreak'
  | 'paragraphBreak'
  | 'bulletPoint'
  | 'comma'
  | 'period'
  | 'dash';

export interface OnlineCommandPattern {
  type: OnlineCommandType;
  pattern: RegExp;
}

export interface OnlineCommandMatch {
  type: OnlineCommandType;
  index: number;
  length: number;
}

export const ONLINE_COMMAND_PATTERNS: OnlineCommandPattern[] = [
  // --- Löschbefehle ---
  { type: 'deleteWord', pattern: /\blösche\s*(?:das\s*)?letzte(?:s)?\s*wort\b[.,;:!?]*/i },
  { type: 'deleteWord', pattern: /\bworte?\s*löschen\b[.,;:!?]*/i },
  { type: 'deleteSentence', pattern: /\blösche\s*(?:den\s*)?letzten\s*satz\b[.,;:!?]*/i },
  { type: 'deleteSentence', pattern: /\bsatz\s*löschen\b[.,;:!?]*/i },
  { type: 'deleteSentence', pattern: /\blez(?:te|en)\s*satz\s*löschen\b[.,;:!?]*/i },
  { type: 'deleteParagraph', pattern: /\blösche\s*(?:den\s*)?letzten\s*absatz\b[.,;:!?]*/i },
  { type: 'deleteParagraph', pattern: /\bletzten\s*absatz\s*löschen\b[.,;:!?]*/i },

  // --- Absätze & Zeilenumbrüche ---
  { type: 'paragraphBreak', pattern: /\b(?:neuer\s*|nächster\s*)?absatz\b[.,;:!?]*/i },
  { type: 'lineBreak', pattern: /\b(?:neue|nächste)\s*zeile\b[.,;:!?]*/i },
  { type: 'lineBreak', pattern: /\bzeilenumbruch\b[.,;:!?]*/i },

  // --- Aufzählungen ---
  { type: 'bulletPoint', pattern: /\bnächster\s*anstrich\b[.,;:!?]*/i },
  { type: 'bulletPoint', pattern: /\banstrich\b[.,;:!?]*/i },

  // --- Satzzeichen ---
  { type: 'comma', pattern: /\b(?:komma|beistrich)\b[.,;:!?]*/i },
  { type: 'period', pattern: /\bpunkt\b[.,;:!?]*/i },
  { type: 'dash', pattern: /\bbindestrich\b[.,;:!?]*/i },
];
