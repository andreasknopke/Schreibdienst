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

export const CONTROL_WORD_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string | ReplacementFn }> = [
  // --- Absätze & Zeilenumbrüche ---
  { pattern: /[.,;\s]*\bneuer\s*absatz\b[.,;\s]*/gi, replacement: '\n\n' },
  { pattern: /[.,;\s]*\bnächster\s*absatz\b[.,;\s]*/gi, replacement: '\n\n' },
  { pattern: /[.,;\s]*\babsatz\b[.,;\s]*/gi, replacement: '\n\n' },
  { pattern: /[.,;\s]*\bneue\s*zeile\b[.,;\s]*/gi, replacement: '\n' },
  { pattern: /[.,;\s]*\bnächste\s*zeile\b[.,;\s]*/gi, replacement: '\n' },

  // --- Einrückungen ---
  { pattern: /[.,;\s]*\bnächster\s*punkt\s*eingerückt\b[.,;\s]*/gi, replacement: '\n  - ' },
  { pattern: /[.,;\s]*\beingerückt\b[.,;\s]*/gi, replacement: '\n  ' },
  { pattern: /[.,;\s]*\brücke\s*ein\b[.,;\s]*/gi, replacement: '\n  ' },
  { pattern: /[.,;\s]*\beinrücken\b[.,;\s]*/gi, replacement: '\n  ' },

  // --- Aufzählungen (Bullet Points) ---
  { pattern: /[.,;\s]*\bnächster\s*anstrich\b[.,;\s]*/gi, replacement: '\n- ' },
  { pattern: /[.,;\s]*\banstrich\b[.,;\s]*/gi, replacement: '\n- ' },

  // --- Klammern ---
  { pattern: /[,\s]*\bklammer\s*auf\b[,\s]*/gi, replacement: ' (' },
  { pattern: /[,\s]*\bklammer\s*zu\b[,\s]*/gi, replacement: ') ' },
  { pattern: /[,\s]*\bklammern\s*auf\b[,\s]*/gi, replacement: ' (' },
  { pattern: /[,\s]*\bklammern\s*zu\b[,\s]*/gi, replacement: ') ' },
  { pattern: /[,\s]*\bklammern\b(?!\s*(auf|zu))[,\s]*/gi, replacement: ' (' },
  { pattern: /(\w+)klammer\s*zu\b[,\s]*/gi, replacement: '$1) ' },
  { pattern: /(\w+)klammern\s*zu\b[,\s]*/gi, replacement: '$1) ' },
  { pattern: /\bin\s*klammern\s+/gi, replacement: '(' },

  // --- Satzzeichen (mit Komma davor) ---
  { pattern: /,\s*doppelpunkt\b/gi, replacement: ':' },
  { pattern: /,\s*semikolon\b/gi, replacement: ';' },
  { pattern: /,\s*fragezeichen\b/gi, replacement: '?' },
  { pattern: /,\s*ausrufezeichen\b/gi, replacement: '!' },
  { pattern: /,\s*punkt\s*\./gi, replacement: '.' },
  { pattern: /,\s*punkt\b(?!\s*(eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|\d))/gi, replacement: '.' },

  // --- "Punkt" / "Komma" nach bestehendem Satzzeichen ---
  { pattern: /([.!?])\s*punkt\s*\./gi, replacement: '$1' },
  { pattern: /([.!?])\s*punkt\s+/gi, replacement: '$1 ' },
  { pattern: /([.!?])\s*komma\s*[.,]/gi, replacement: '$1' },
  { pattern: /\.\s+punkt\s*\./gi, replacement: '.' },

  // --- Zusammengesetzte Satzzeichen (Wort + Befehl) ---
  { pattern: /\b(\w+?)doppelpunkt\b/gi, replacement: (_: string, word: string) => `${word}:` },
  { pattern: /\b(\w+?)semikolon\b/gi, replacement: (_: string, word: string) => `${word};` },
  { pattern: /\b(\w+?)fragezeichen\b/gi, replacement: (_: string, word: string) => `${word}?` },
  { pattern: /\b(\w+?)ausrufezeichen\b/gi, replacement: (_: string, word: string) => `${word}!` },

  // --- Satzzeichen (eigenständige Wörter) ---
  { pattern: /\bdoppelpunkt\b/gi, replacement: ':' },
  { pattern: /\bsemikolon\b/gi, replacement: ';' },
  { pattern: /\bfragezeichen\b/gi, replacement: '?' },
  { pattern: /\bausrufezeichen\b/gi, replacement: '!' },

  // --- Anführungszeichen ---
  { pattern: /\banführungszeichen\s*auf\b/gi, replacement: '„' },
  { pattern: /\banführungszeichen\s*zu\b/gi, replacement: '"' },
  { pattern: /\banführungszeichen\s*oben\b/gi, replacement: '"' },
  { pattern: /\banführungszeichen\s*unten\b/gi, replacement: '„' },

  // --- Zahlenverhältnisse: "80 zu 100" → "80/100" ---
  { pattern: /\b(\d+)\s*zu\s*(\d+)\b/gi, replacement: (_match: string, num1: string, num2: string) => `${num1}/${num2}` },

  // --- Uhrzeit: "10 Uhr 15" → "10:15" ---
  { pattern: /\b(\d{1,2})\s*uhr\s*(\d{2})\b/gi, replacement: (_match: string, hours: string, minutes: string) => `${hours}:${minutes}` },
  { pattern: /\b(\d{1,2})[\s.]+(\d{2})\s*uhr\b/gi, replacement: (_match: string, hours: string, minutes: string) => `${hours}:${minutes}` },
  { pattern: /(\d{1,2}):\s+(\d{2})\b/gi, replacement: (_match: string, h: string, m: string) => `${h}:${m}` },
];
