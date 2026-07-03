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
  commands: string[];
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
  { commands: ['lösche das letzte Wort'],           type: 'deleteWord', pattern: /\blösche\s*(?:das\s*)?letzte(?:s)?\s*wort\b[.,;:!?]*/i },
  { commands: ['Wort löschen'],                     type: 'deleteWord', pattern: /\bworte?\s*löschen\b[.,;:!?]*/i },
  { commands: ['lösche den letzten Satz'],           type: 'deleteSentence', pattern: /\blösche\s*(?:den\s*)?letzten\s*satz\b[.,;:!?]*/i },
  { commands: ['Satz löschen'],                     type: 'deleteSentence', pattern: /\bsatz\s*löschen\b[.,;:!?]*/i },
  { commands: ['letzten Satz löschen'],              type: 'deleteSentence', pattern: /\blez(?:te|en)\s*satz\s*löschen\b[.,;:!?]*/i },
  { commands: ['lösche den letzten Absatz'],         type: 'deleteParagraph', pattern: /\blösche\s*(?:den\s*)?letzten\s*absatz\b[.,;:!?]*/i },
  { commands: ['letzten Absatz löschen'],            type: 'deleteParagraph', pattern: /\bletzten\s*absatz\s*löschen\b[.,;:!?]*/i },

  // --- Absätze & Zeilenumbrüche ---
  { commands: ['neuer Absatz', 'nächster Absatz', 'Absatz'], type: 'paragraphBreak', pattern: /\b(?:neuer\s*|nächster\s*)?absatz\b[.,;:!?]*/i },
  { commands: ['neue Zeile', 'nächste Zeile'],      type: 'lineBreak', pattern: /\b(?:neue|nächste)\s*zeile\b[.,;:!?]*/i },
  { commands: ['Zeilenumbruch'],                    type: 'lineBreak', pattern: /\bzeilenumbruch\b[.,;:!?]*/i },

  // --- Aufzählungen ---
  { commands: ['nächster Anstrich'],                type: 'bulletPoint', pattern: /\bnächster\s*anstrich\b[.,;:!?]*/i },
  { commands: ['Anstrich'],                         type: 'bulletPoint', pattern: /\banstrich\b[.,;:!?]*/i },

  // --- Satzzeichen ---
  { commands: ['Komma', 'Beistrich'],               type: 'comma', pattern: /\b(?:komma|beistrich)\b[.,;:!?]*/i },
  { commands: ['Punkt'],                            type: 'period', pattern: /\bpunkt\b[.,;:!?]*/i },
  { commands: ['Bindestrich', 'Minus'],             type: 'dash', pattern: /\bbindestrich\b[.,;:!?]*/i },
];
