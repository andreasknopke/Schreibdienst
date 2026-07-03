/**
 * Deterministische Ersetzungen für gesprochene Formatierungsbefehle.
 *
 * Änderungen an dieser Datei beeinflussen direkt die Diktatverarbeitung.
 * Die Regeln werden in applyFormattingControlWordsWithStats() angewandt.
 *
 * Reihenfolge: Längere/phrasenhafte Muster müssen VOR kürzeren kommen,
 * damit z. B. "nächster Absatz" vor "Absatz" matched.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ReplacementFn = (...args: any[]) => string;

export interface ControlWordEntry {
  commands: string[];
  pattern: RegExp;
  replacement: string | ReplacementFn;
}

export const CONTROL_WORD_REPLACEMENTS: ControlWordEntry[] = [
  // --- Absätze & Zeilenumbrüche ---
  { commands: ['neuer Absatz'],            pattern: /[.,;\s]*\bneuer\s*absatz\b[.,;\s]*/gi, replacement: '\n\n' },
  { commands: ['nächster Absatz'],         pattern: /[.,;\s]*\bnächster\s*absatz\b[.,;\s]*/gi, replacement: '\n\n' },
  { commands: ['Absatz'],                  pattern: /[.,;\s]*\babsatz\b[.,;\s]*/gi, replacement: '\n\n' },
  { commands: ['neue Zeile'],              pattern: /[.,;\s]*\bneue\s*zeile\b[.,;\s]*/gi, replacement: '\n' },
  { commands: ['nächste Zeile'],           pattern: /[.,;\s]*\bnächste\s*zeile\b[.,;\s]*/gi, replacement: '\n' },

  // --- Einrückungen ---
  { commands: ['nächster Punkt eingerückt'], pattern: /[.,;\s]*\bnächster\s*punkt\s*eingerückt\b[.,;\s]*/gi, replacement: '\n  - ' },
  { commands: ['eingerückt', 'rücke ein', 'einrücken'], pattern: /[.,;\s]*\beingerückt\b[.,;\s]*/gi, replacement: '\n  ' },
  { commands: ['eingerückt', 'rücke ein', 'einrücken'], pattern: /[.,;\s]*\brücke\s*ein\b[.,;\s]*/gi, replacement: '\n  ' },
  { commands: ['eingerückt', 'rücke ein', 'einrücken'], pattern: /[.,;\s]*\beinrücken\b[.,;\s]*/gi, replacement: '\n  ' },

  // --- Aufzählungen (Bullet Points) ---
  { commands: ['nächster Anstrich'],       pattern: /[.,;\s]*\bnächster\s*anstrich\b[.,;\s]*/gi, replacement: '\n- ' },
  { commands: ['Anstrich'],                pattern: /[.,;\s]*\banstrich\b[.,;\s]*/gi, replacement: '\n- ' },

  // --- Klammern ---
  { commands: ['Klammer auf'],             pattern: /[,\s]*\bklammer\s*auf\b[,\s]*/gi, replacement: ' (' },
  { commands: ['Klammer zu'],              pattern: /[,\s]*\bklammer\s*zu\b[,\s]*/gi, replacement: ') ' },
  { commands: ['Klammer auf'],             pattern: /[,\s]*\bklammern\s*auf\b[,\s]*/gi, replacement: ' (' },
  { commands: ['Klammer zu'],              pattern: /[,\s]*\bklammern\s*zu\b[,\s]*/gi, replacement: ') ' },
  { commands: ['Klammer auf'],             pattern: /[,\s]*\bklammern\b(?!\s*(auf|zu))[,\s]*/gi, replacement: ' (' },
  { commands: ['Xklammer zu → X)'],        pattern: /(\w+)klammer\s*zu\b[,\s]*/gi, replacement: '$1) ' },
  { commands: ['Xklammern zu → X)'],       pattern: /(\w+)klammern\s*zu\b[,\s]*/gi, replacement: '$1) ' },
  { commands: ['in Klammern'],             pattern: /\bin\s*klammern\s+/gi, replacement: '(' },

  // --- Satzzeichen (mit Komma davor) ---
  { commands: ['Doppelpunkt'],             pattern: /,\s*doppelpunkt\b/gi, replacement: ':' },
  { commands: ['Semikolon', 'Strichpunkt'], pattern: /,\s*semikolon\b/gi, replacement: ';' },
  { commands: ['Fragezeichen'],            pattern: /,\s*fragezeichen\b/gi, replacement: '?' },
  { commands: ['Ausrufezeichen'],          pattern: /,\s*ausrufezeichen\b/gi, replacement: '!' },
  { commands: ['Punkt'],                   pattern: /,\s*punkt\s*\./gi, replacement: '.' },
  { commands: ['Punkt'],                   pattern: /,\s*punkt\b(?!\s*(eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|\d))/gi, replacement: '.' },

  // --- "Punkt" / "Komma" nach bestehendem Satzzeichen ---
  { commands: ['Punkt'],                   pattern: /([.!?])\s*punkt\s*\./gi, replacement: '$1' },
  { commands: ['Punkt'],                   pattern: /([.!?])\s*punkt\s+/gi, replacement: '$1 ' },
  { commands: ['Komma', 'Beistrich'],      pattern: /([.!?])\s*komma\s*[.,]/gi, replacement: '$1' },
  { commands: ['Punkt'],                   pattern: /\.\s+punkt\s*\./gi, replacement: '.' },

  // --- Zusammengesetzte Satzzeichen (Wort + Befehl) ---
  { commands: ['Wortdoppelpunkt → Wort:'], pattern: /\b(\w+?)doppelpunkt\b/gi, replacement: (_: string, word: string) => `${word}:` },
  { commands: ['Wortsemikolon → Wort;'],   pattern: /\b(\w+?)semikolon\b/gi, replacement: (_: string, word: string) => `${word};` },
  { commands: ['Wortfragezeichen → Wort?'], pattern: /\b(\w+?)fragezeichen\b/gi, replacement: (_: string, word: string) => `${word}?` },
  { commands: ['Wortausrufezeichen → Wort!'], pattern: /\b(\w+?)ausrufezeichen\b/gi, replacement: (_: string, word: string) => `${word}!` },

  // --- Satzzeichen (eigenständige Wörter) ---
  { commands: ['Doppelpunkt'],             pattern: /\bdoppelpunkt\b/gi, replacement: ':' },
  { commands: ['Semikolon', 'Strichpunkt'], pattern: /\bsemikolon\b/gi, replacement: ';' },
  { commands: ['Fragezeichen'],            pattern: /\bfragezeichen\b/gi, replacement: '?' },
  { commands: ['Ausrufezeichen'],          pattern: /\bausrufezeichen\b/gi, replacement: '!' },

  // --- Anführungszeichen ---
  { commands: ['Anführungszeichen auf'],   pattern: /\banführungszeichen\s*auf\b/gi, replacement: '„' },
  { commands: ['Anführungszeichen zu'],    pattern: /\banführungszeichen\s*zu\b/gi, replacement: '"' },
  { commands: ['Anführungszeichen oben'],  pattern: /\banführungszeichen\s*oben\b/gi, replacement: '"' },
  { commands: ['Anführungszeichen unten'], pattern: /\banführungszeichen\s*unten\b/gi, replacement: '„' },

  // --- Zahlenverhältnisse: "80 zu 100" → "80/100" ---
  { commands: ['80 zu 100 → 80/100'],      pattern: /\b(\d+)\s*zu\s*(\d+)\b/gi, replacement: (_match: string, num1: string, num2: string) => `${num1}/${num2}` },

  // --- Uhrzeit: "10 Uhr 15" → "10:15" ---
  { commands: ['10 Uhr 15 → 10:15'],       pattern: /\b(\d{1,2})\s*uhr\s*(\d{2})\b/gi, replacement: (_match: string, hours: string, minutes: string) => `${hours}:${minutes}` },
  { commands: ['10.15 Uhr → 10:15'],       pattern: /\b(\d{1,2})[\s.]+(\d{2})\s*uhr\b/gi, replacement: (_match: string, hours: string, minutes: string) => `${hours}:${minutes}` },
  { commands: ['10 :15 → 10:15'],          pattern: /(\d{1,2}):\s+(\d{2})\b/gi, replacement: (_match: string, h: string, m: string) => `${h}:${m}` },
];
