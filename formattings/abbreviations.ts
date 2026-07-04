/**
 * Deterministische Abkürzungen für gesprochene medizinische Maßeinheiten und Begriffe.
 *
 * Diese Regeln werden in der Textverarbeitung VOR dem LLM-Aufruf angewandt.
 * Änderungen hier sind sofort wirksam und können pro Benutzer ein-/ausgeschaltet werden.
 *
 * ACHTUNG: Nur Wort-Grenzen-basierte Ersetzungen (word boundary \b).
 * Keine Teilstring-Ersetzungen, die zufällig in anderen Wörtern vorkommen könnten.
 */

export interface AbbreviationEntry {
  id: string;
  commands: string[];   // die gesprochenen Begriffe (für UI-Anzeige)
  pattern: RegExp;      // was gematcht wird
  replacement: string;  // die Abkürzung
  category: 'Einheiten' | 'Medikation' | 'Laborwerte' | 'Allgemein';
}

function id(...parts: string[]): string {
  return parts[0].toLowerCase().replace(/\s+/g, '-').replace(/[^a-zäöüß0-9-]/g, '');
}

// Hilfsfunktion: Plural-Formen eines Worts erzeugen
function pluralOf(singular: string): string {
  return singular + 'n'; // einfache deutsche Pluralbildung
}

export const ABBREVIATIONS: AbbreviationEntry[] = [
  // ========================
  // Dosis-Einheiten
  // ========================
  { id: id('mg'), commands: ['Milligramm', 'milligramm'], pattern: /\bmilligramm\b/gi, replacement: 'mg', category: 'Einheiten' },
  { id: id('g'), commands: ['Gramm', 'gramm'], pattern: /\bgramm\b/gi, replacement: 'g', category: 'Einheiten' },
  { id: id('kg'), commands: ['Kilogramm', 'kilogramm'], pattern: /\bkilogramm\b/gi, replacement: 'kg', category: 'Einheiten' },
  { id: id('µg'), commands: ['Mikrogramm', 'mikrogramm'], pattern: /\bmikrogramm\b/gi, replacement: 'µg', category: 'Einheiten' },
  { id: id('ng'), commands: ['Nanogramm', 'nanogramm'], pattern: /\bnanogramm\b/gi, replacement: 'ng', category: 'Einheiten' },
  { id: id('IE'), commands: ['Internationale Einheit', 'internationale Einheiten'], pattern: /\binternationale\s*einheiten?\b/gi, replacement: 'IE', category: 'Einheiten' },
  { id: id('I.E.'), commands: ['I.E.', 'IE'], pattern: /\bi\.?\s*e\.?\b/gi, replacement: 'IE', category: 'Einheiten' },

  // ========================
  // Volumen-Einheiten
  // ========================
  { id: id('ml'), commands: ['Milliliter', 'milliliter'], pattern: /\bmilliliter\b/gi, replacement: 'ml', category: 'Einheiten' },
  { id: id('l'), commands: ['Liter', 'liter'], pattern: /\bliter\b/gi, replacement: 'l', category: 'Einheiten' },
  { id: id('µl'), commands: ['Mikroliter', 'mikroliter'], pattern: /\bmikroliter\b/gi, replacement: 'µl', category: 'Einheiten' },
  { id: id('dl'), commands: ['Deziliter', 'deziliter'], pattern: /\bdeziliter\b/gi, replacement: 'dl', category: 'Einheiten' },

  // ========================
  // Längen- & Größen-Einheiten
  // ========================
  { id: id('mm'), commands: ['Millimeter', 'millimeter'], pattern: /\bmillimeter\b/gi, replacement: 'mm', category: 'Einheiten' },
  { id: id('cm'), commands: ['Zentimeter', 'centimeter'], pattern: /\bzentimeter\b/gi, replacement: 'cm', category: 'Einheiten' },
  { id: id('m'), commands: ['Meter', 'meter'], pattern: /\bmeter\b/gi, replacement: 'm', category: 'Einheiten' },
  { id: id('km'), commands: ['Kilometer', 'kilometer'], pattern: /\bkilometer\b/gi, replacement: 'km', category: 'Einheiten' },
  { id: id('µm'), commands: ['Mikrometer', 'mikrometer'], pattern: /\bmikrometer\b/gi, replacement: 'µm', category: 'Einheiten' },

  // ========================
  // Zeit-Einheiten
  // ========================
  { id: id('min'), commands: ['Minute', 'Minuten', 'minute', 'minuten'], pattern: /\bminuten?\b/gi, replacement: 'min', category: 'Einheiten' },
  { id: id('h'), commands: ['Stunde', 'Stunden', 'stunde', 'stunden'], pattern: /\bstunden?\b/gi, replacement: 'h', category: 'Einheiten' },
  { id: id('s'), commands: ['Sekunde', 'Sekunden', 'sekunde', 'sekunden'], pattern: /\bsekunden?\b/gi, replacement: 's', category: 'Einheiten' },
  { id: id('d'), commands: ['Tag', 'Tage', 'tag', 'tage'], pattern: /\btagen?\b/gi, replacement: 'd', category: 'Einheiten' },
  { id: id('Wo'), commands: ['Woche', 'Wochen', 'woche', 'wochen'], pattern: /\bwochen?\b/gi, replacement: 'Wo', category: 'Einheiten' },
  { id: id('Std'), commands: ['stunden'], pattern: /\bstunden\b/gi, replacement: 'h', category: 'Einheiten' }, // redundant mit 'h', für Großschreibung

  // ========================
  // Pro-Angaben
  // ========================
  { id: id('pro'), commands: ['pro'], pattern: /\bpro\s+liter\b/gi, replacement: '/l', category: 'Laborwerte' },
  { id: id('pro'), commands: ['pro'], pattern: /\bpro\s+milliliter\b/gi, replacement: '/ml', category: 'Laborwerte' },
  { id: id('pro'), commands: ['pro'], pattern: /\bpro\s+mikroliter\b/gi, replacement: '/µl', category: 'Laborwerte' },

  // ========================
  // Prozent & Promille
  // ========================
  { id: id('%'), commands: ['Prozent', 'prozent'], pattern: /\bprozent\b/gi, replacement: '%', category: 'Allgemein' },
  { id: id('‰'), commands: ['Promille', 'promille'], pattern: /\bpromille\b/gi, replacement: '‰', category: 'Allgemein' },

  // ========================
  // Temperatur
  // ========================
  { id: id('°C'), commands: ['Grad Celsius', 'Grad celcius'], pattern: /\bgrad\s*celsius\b/gi, replacement: '°C', category: 'Einheiten' },
  { id: id('°C'), commands: ['Grad'], pattern: /\bgrad\b(?=\s*(?:celsius|Celsius))/gi, replacement: '°', category: 'Einheiten' },

  // ========================
  // Blutdruck & Druck
  // ========================
  { id: id('mmHg'), commands: ['Millimeter Quecksilbersäule', 'mmHg'], pattern: /\bmillimeter\s*quecksilbersäule\b/gi, replacement: 'mmHg', category: 'Einheiten' },
  { id: id('mmHG'), commands: ['mmHG'], pattern: /\bmm\s*hg\b/gi, replacement: 'mmHg', category: 'Einheiten' }, // Normalisierung

  // ========================
  // Konzentrationen
  // ========================
  { id: id('mmol'), commands: ['Millimol', 'millimol'], pattern: /\bmillimol\b/gi, replacement: 'mmol', category: 'Laborwerte' },
  { id: id('µmol'), commands: ['Mikromol', 'mikromol'], pattern: /\bmikromol\b/gi, replacement: 'µmol', category: 'Laborwerte' },
  { id: id('nmol'), commands: ['Nanomol', 'nanomol'], pattern: /\bnanomol\b/gi, replacement: 'nmol', category: 'Laborwerte' },
  { id: id('mmol/l'), commands: ['Millimol pro Liter'], pattern: /\bmillimol\s+pro\s+liter\b/gi, replacement: 'mmol/l', category: 'Laborwerte' },
  { id: id('µmol/l'), commands: ['Mikromol pro Liter'], pattern: /\bmikromol\s+pro\s+liter\b/gi, replacement: 'µmol/l', category: 'Laborwerte' },

  // ========================
  // Standard-Präfixe
  // ========================
  { id: id('mg/d'), commands: ['Milligramm pro Tag'], pattern: /\bmilligramm\s+pro\s+tag\b/gi, replacement: 'mg/d', category: 'Medikation' },
  { id: id('mg/kg'), commands: ['Milligramm pro Kilogramm'], pattern: /\bmilligramm\s+pro\s+kilogramm\b/gi, replacement: 'mg/kg', category: 'Medikation' },
  { id: id('mg/kgKG'), commands: ['Milligramm pro Kilogramm Körpergewicht'], pattern: /\bmilligramm\s+pro\s+kilogramm\s+körpergewicht\b/gi, replacement: 'mg/kgKG', category: 'Medikation' },
  { id: id('1-0-0'), commands: ['1-0-0'], pattern: /\b1\s*[-–]\s*0\s*[-–]\s*0\b/g, replacement: '1-0-0', category: 'Medikation' },
  { id: id('1-1-1'), commands: ['1-1-1'], pattern: /\b1\s*[-–]\s*1\s*[-–]\s*1\b/g, replacement: '1-1-1', category: 'Medikation' },
  { id: id('1x'), commands: ['1x täglich', 'einmal täglich'], pattern: /\b(?:1\s*mal|einmal)\s*täglich\b/gi, replacement: '1x/d', category: 'Medikation' },
  { id: id('2x'), commands: ['2x täglich', 'zweimal täglich'], pattern: /\b(?:2\s*mal|zweimal)\s*täglich\b/gi, replacement: '2x/d', category: 'Medikation' },
  { id: id('3x'), commands: ['3x täglich', 'dreimal täglich'], pattern: /\b(?:3\s*mal|dreimal)\s*täglich\b/gi, replacement: '3x/d', category: 'Medikation' },
  { id: id('4x'), commands: ['4x täglich', 'viermal täglich'], pattern: /\b(?:4\s*mal|viermal)\s*täglich\b/gi, replacement: '4x/d', category: 'Medikation' },

  // ========================
  // Körpermaße
  // ========================
  { id: id('kgKG'), commands: ['Kilogramm Körpergewicht'], pattern: /\bkilogramm\s*körpergewicht\b/gi, replacement: 'kgKG', category: 'Allgemein' },
  { id: id('cmGr'), commands: ['Zentimeter Größe'], pattern: /\bzentimeter\s*größe\b/gi, replacement: 'cm', category: 'Allgemein' },

  // ========================
  // Häufige medizinische Abkürzungen
  // ========================
  { id: id('p.o.'), commands: ['peroral', 'per os'], pattern: /\bper\s*os\b/gi, replacement: 'p.o.', category: 'Medikation' },
  { id: id('i.v.'), commands: ['intravenös', 'intravenoes'], pattern: /\bintravenös\b/gi, replacement: 'i.v.', category: 'Medikation' },
  { id: id('s.c.'), commands: ['subkutan', 'subcutan'], pattern: /\bsubkutan\b/gi, replacement: 's.c.', category: 'Medikation' },
  { id: id('i.m.'), commands: ['intramuskulär', 'intramuskulaer'], pattern: /\bintramuskulär\b/gi, replacement: 'i.m.', category: 'Medikation' },
  { id: id('b.B.'), commands: ['bei Bedarf'], pattern: /\bbei\s*bedarf\b/gi, replacement: 'b.B.', category: 'Medikation' },
  { id: id('nüchtern'), commands: ['nüchtern'], pattern: /\bnüchtern\b/gi, replacement: 'nü.', category: 'Allgemein' },
];
