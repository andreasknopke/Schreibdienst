/**
 * Deterministische Abkürzungen für gesprochene medizinische Maßeinheiten und Begriffe.
 *
 * Ersetzungen werden VOR dem LLM-Aufruf angewandt (word-boundary-basiert).
 * Änderungen hier sind sofort wirksam und können pro Benutzer ein-/ausgeschaltet werden.
 */

export interface AbbreviationEntry {
  id: string;
  commands: string[];   // die gesprochenen Begriffe (für UI-Anzeige)
  pattern: RegExp;      // was gematcht wird
  replacement: string;  // die Abkürzung
  category: 'Einheiten' | 'Medikation' | 'Laborwerte' | 'Allgemein' | 'Diagnostik';
}

// ---- Dosis & Masse ----
const doseinheiten: AbbreviationEntry[] = [
  { id: 'mg', commands: ['Milligramm'], pattern: /\bmilligramm\b/gi, replacement: 'mg', category: 'Einheiten' },
  { id: 'g', commands: ['Gramm'], pattern: /\bgramm\b/gi, replacement: 'g', category: 'Einheiten' },
  { id: 'kg', commands: ['Kilogramm'], pattern: /\bkilogramm\b/gi, replacement: 'kg', category: 'Einheiten' },
  { id: 'µg', commands: ['Mikrogramm'], pattern: /\bmikrogramm\b/gi, replacement: 'µg', category: 'Einheiten' },
  { id: 'ng', commands: ['Nanogramm'], pattern: /\bnanogramm\b/gi, replacement: 'ng', category: 'Einheiten' },
  { id: 'IE', commands: ['IE', 'Internationale Einheit(en)'], pattern: /\binternationale\s*einheiten?\b/gi, replacement: 'IE', category: 'Einheiten' },
];

// ---- Volumen ----
const volumen: AbbreviationEntry[] = [
  { id: 'ml', commands: ['Milliliter'], pattern: /\bmilliliter\b/gi, replacement: 'ml', category: 'Einheiten' },
  { id: 'l', commands: ['Liter'], pattern: /\bliter\b/gi, replacement: 'l', category: 'Einheiten' },
  { id: 'µl', commands: ['Mikroliter'], pattern: /\bmikroliter\b/gi, replacement: 'µl', category: 'Einheiten' },
  { id: 'dl', commands: ['Deziliter'], pattern: /\bdeziliter\b/gi, replacement: 'dl', category: 'Einheiten' },
  { id: 'ccm', commands: ['Kubikzentimeter'], pattern: /\bkubikzentimeter\b/gi, replacement: 'ccm', category: 'Einheiten' },
];

// ---- Längen ----
const laengen: AbbreviationEntry[] = [
  { id: 'mm', commands: ['Millimeter'], pattern: /\bmillimeter\b/gi, replacement: 'mm', category: 'Einheiten' },
  { id: 'cm', commands: ['Zentimeter'], pattern: /\bzentimeter\b/gi, replacement: 'cm', category: 'Einheiten' },
  { id: 'm', commands: ['Meter'], pattern: /\bmeter\b/gi, replacement: 'm', category: 'Einheiten' },
  { id: 'km', commands: ['Kilometer'], pattern: /\bkilometer\b/gi, replacement: 'km', category: 'Einheiten' },
  { id: 'µm', commands: ['Mikrometer'], pattern: /\bmikrometer\b/gi, replacement: 'µm', category: 'Einheiten' },
];

// ---- Zeit ----
const zeiten: AbbreviationEntry[] = [
  { id: 'min', commands: ['Minute(n)'], pattern: /\bminuten?\b/gi, replacement: 'min', category: 'Einheiten' },
  { id: 'h', commands: ['Stunde(n)'], pattern: /\bstunden?\b/gi, replacement: 'h', category: 'Einheiten' },
  { id: 's', commands: ['Sekunde(n)'], pattern: /\bsekunden?\b/gi, replacement: 's', category: 'Einheiten' },
  { id: 'd', commands: ['Tag(e)'], pattern: /\btagen?\b/gi, replacement: 'd', category: 'Einheiten' },
  { id: 'Wo', commands: ['Woche(n)'], pattern: /\bwochen?\b/gi, replacement: 'Wo', category: 'Einheiten' },
];

// ---- Konzentrationen & Pro-Angaben ----
const konzentrationen: AbbreviationEntry[] = [
  { id: 'mg/d', commands: ['Milligramm pro Tag'], pattern: /\bmilligramm\s+pro\s+tag\b/gi, replacement: 'mg/d', category: 'Medikation' },
  { id: 'mg/dl', commands: ['Milligramm pro Deziliter'], pattern: /\bmilligramm\s+pro\s+deziliter\b/gi, replacement: 'mg/dl', category: 'Laborwerte' },
  { id: 'mmol/l', commands: ['Millimol pro Liter'], pattern: /\bmillimol\s+pro\s+liter\b/gi, replacement: 'mmol/l', category: 'Laborwerte' },
  { id: 'µmol/l', commands: ['Mikromol pro Liter'], pattern: /\bmikromol\s+pro\s+liter\b/gi, replacement: 'µmol/l', category: 'Laborwerte' },
  { id: 'g/l', commands: ['Gramm pro Liter'], pattern: /\bgramm\s+pro\s+liter\b/gi, replacement: 'g/l', category: 'Laborwerte' },
  { id: 'g/dl', commands: ['Gramm pro Deziliter'], pattern: /\bgramm\s+pro\s+deziliter\b/gi, replacement: 'g/dl', category: 'Laborwerte' },
  { id: 'mg/kg', commands: ['Milligramm pro kg'], pattern: /\bmilligramm\s+pro\s+kilogramm\b/gi, replacement: 'mg/kg', category: 'Laborwerte' },
  { id: 'mmol/kg', commands: ['Millimol pro kg'], pattern: /\bmillimol\s+pro\s+kilogramm\b/gi, replacement: 'mmol/kg', category: 'Laborwerte' },
  { id: 'µg/kg', commands: ['Mikrogramm pro kg'], pattern: /\bmikrogramm\s+pro\s+kilogramm\b/gi, replacement: 'µg/kg', category: 'Laborwerte' },
  { id: 'IE/kg', commands: ['IE pro kg'], pattern: /\binternationale\s*einheiten?\s+pro\s+kilogramm\b/gi, replacement: 'IE/kg', category: 'Laborwerte' },
  { id: 'ml/kg', commands: ['Milliliter pro kg'], pattern: /\bmilliliter\s+pro\s+kilogramm\b/gi, replacement: 'ml/kg', category: 'Laborwerte' },
  { id: 'µg/kg/min', commands: ['µg pro kg pro Minute'], pattern: /\bmikrogramm\s+pro\s+kilogramm\s+pro\s+minute\b/gi, replacement: 'µg/kg/min', category: 'Laborwerte' },
  { id: 'ml/h', commands: ['Milliliter pro Stunde'], pattern: /\bmilliliter\s+pro\s+stunde\b/gi, replacement: 'ml/h', category: 'Einheiten' },
  { id: 'ml/min', commands: ['Milliliter pro Minute'], pattern: /\bmilliliter\s+pro\s+minute\b/gi, replacement: 'ml/min', category: 'Einheiten' },
  { id: 'g/h', commands: ['Gramm pro Stunde'], pattern: /\bgramm\s+pro\s+stunde\b/gi, replacement: 'g/h', category: 'Einheiten' },
  { id: 'mg/h', commands: ['Milligramm pro Stunde'], pattern: /\bmilligramm\s+pro\s+stunde\b/gi, replacement: 'mg/h', category: 'Einheiten' },
];

// ---- Vitalwerte ----
const vitalwerte: AbbreviationEntry[] = [
  { id: 'bpm', commands: ['Schläge pro Minute'], pattern: /\bschl(?:ä|ae)ge\s+pro\s+minute\b/gi, replacement: 'bpm', category: 'Allgemein' },
  { id: 'mmHg', commands: ['mmHg'], pattern: /\bmillimeter\s*quecksilbers(?:ä|ae)ule\b/gi, replacement: 'mmHg', category: 'Einheiten' },
  { id: '°C', commands: ['Grad Celsius'], pattern: /\bgrad\s*celsius\b/gi, replacement: '°C', category: 'Einheiten' },
  { id: '%', commands: ['Prozent'], pattern: /\bprozent\b/gi, replacement: '%', category: 'Allgemein' },
  { id: '‰', commands: ['Promille'], pattern: /\bpromille\b/gi, replacement: '‰', category: 'Allgemein' },
  { id: 'mg/kgKG', commands: ['mg pro kg Körpergewicht'], pattern: /\bmilligramm\s+pro\s+kilogramm\s+k(?:ö|oe)rpergewicht\b/gi, replacement: 'mg/kgKG', category: 'Medikation' },
];

// ---- Dosierung ----
const dosierung: AbbreviationEntry[] = [
  { id: '1x/d', commands: ['1x täglich', 'einmal täglich'], pattern: /\b(?:1\s*mal|einmal)\s*t(?:ä|ae)glich\b/gi, replacement: '1x/d', category: 'Medikation' },
  { id: '2x/d', commands: ['2x täglich', 'zweimal täglich'], pattern: /\b(?:2\s*mal|zweimal)\s*t(?:ä|ae)glich\b/gi, replacement: '2x/d', category: 'Medikation' },
  { id: '3x/d', commands: ['3x täglich', 'dreimal täglich'], pattern: /\b(?:3\s*mal|dreimal)\s*t(?:ä|ae)glich\b/gi, replacement: '3x/d', category: 'Medikation' },
  { id: '4x/d', commands: ['4x täglich', 'viermal täglich'], pattern: /\b(?:4\s*mal|viermal)\s*t(?:ä|ae)glich\b/gi, replacement: '4x/d', category: 'Medikation' },
  { id: 'b.B.', commands: ['bei Bedarf'], pattern: /\bbei\s*bedarf\b/gi, replacement: 'b.B.', category: 'Medikation' },
  { id: 'stat', commands: ['sofort'], pattern: /\bsofort\b/gi, replacement: 'stat', category: 'Medikation' },
  { id: 'Tbl.', commands: ['Tablette(n)'], pattern: /\btabletten?\b/gi, replacement: 'Tbl.', category: 'Medikation' },
  { id: 'Kps', commands: ['Kapsel(n)'], pattern: /\bkapseln?\b/gi, replacement: 'Kps', category: 'Medikation' },
  { id: 'Amp.', commands: ['Ampulle(n)'], pattern: /\bampullen?\b/gi, replacement: 'Amp.', category: 'Medikation' },
];

// ---- Applikation ----
const applikation: AbbreviationEntry[] = [
  { id: 'i.v.', commands: ['intravenös'], pattern: /\bintraven(?:ö|oe)s\b/gi, replacement: 'i.v.', category: 'Medikation' },
  { id: 'i.m.', commands: ['intramuskulär'], pattern: /\bintramuskul(?:ä|ae)r\b/gi, replacement: 'i.m.', category: 'Medikation' },
  { id: 's.c.', commands: ['subkutan'], pattern: /\bsubkutan\b/gi, replacement: 's.c.', category: 'Medikation' },
  { id: 'i.c.', commands: ['intrakutan'], pattern: /\bintrakutan\b/gi, replacement: 'i.c.', category: 'Medikation' },
  { id: 'i.a.', commands: ['intraarteriell'], pattern: /\bintraarteriell\b/gi, replacement: 'i.a.', category: 'Medikation' },
  { id: 'i.o.', commands: ['intraossär'], pattern: /\bintraoss(?:ä|ae)r\b/gi, replacement: 'i.o.', category: 'Medikation' },
  { id: 'p.o.', commands: ['peroral', 'per os'], pattern: /\bper\s*os\b/gi, replacement: 'p.o.', category: 'Medikation' },
  { id: 's.l.', commands: ['sublingual'], pattern: /\bsublingual\b/gi, replacement: 's.l.', category: 'Medikation' },
  { id: 'inhal.', commands: ['inhalativ'], pattern: /\binhalativ\b/gi, replacement: 'inhal.', category: 'Medikation' },
  { id: 't.d.', commands: ['transdermal'], pattern: /\btransdermal\b/gi, replacement: 't.d.', category: 'Medikation' },
];

// ---- Anordnungen ----
const anordnungen: AbbreviationEntry[] = [
  { id: 'v.d.E.', commands: ['vor dem Essen'], pattern: /\bvor\s+dem\s+essen\b/gi, replacement: 'v.d.E.', category: 'Allgemein' },
  { id: 'n.d.E.', commands: ['nach dem Essen'], pattern: /\bnach\s+dem\s+essen\b/gi, replacement: 'n.d.E.', category: 'Allgemein' },
  { id: 'z.N.', commands: ['zur Nacht'], pattern: /\bzur\s+nacht\b/gi, replacement: 'z.N.', category: 'Allgemein' },
  { id: 'nü.', commands: ['nüchtern'], pattern: /\bn(?:ü|ue)chtern\b/gi, replacement: 'nü.', category: 'Allgemein' },
  { id: 'NPO', commands: ['nicht per os'], pattern: /\bnicht\s+per\s+os\b/gi, replacement: 'NPO', category: 'Medikation' },
  { id: 'LA', commands: ['linkes Auge'], pattern: /\blinkes\s+auge\b/gi, replacement: 'LA', category: 'Allgemein' },
  { id: 'RA', commands: ['rechtes Auge'], pattern: /\brechtes\s+auge\b/gi, replacement: 'RA', category: 'Allgemein' },
  { id: 'BA', commands: ['beide Augen'], pattern: /\bbeide\s+augen\b/gi, replacement: 'BA', category: 'Allgemein' },
];

// ---- Labor-Kurzzeichen ----
const labor: AbbreviationEntry[] = [
  { id: 'CRP', commands: ['CRP'], pattern: /\bCRP\b/g, replacement: 'CRP', category: 'Laborwerte' },
  { id: 'Hb', commands: ['Hb', 'Hämoglobin'], pattern: /\bHb\b/g, replacement: 'Hb', category: 'Laborwerte' },
  { id: 'Hkt', commands: ['Hkt', 'Hämatokrit'], pattern: /\bHkt\b/gi, replacement: 'Hkt', category: 'Laborwerte' },
  { id: 'Krea', commands: ['Kreatinin'], pattern: /\bKreatinin\b/gi, replacement: 'Krea', category: 'Laborwerte' },
  { id: 'GFR', commands: ['GFR'], pattern: /\bGFR\b/gi, replacement: 'GFR', category: 'Laborwerte' },
  { id: 'Leuko', commands: ['Leukozyten'], pattern: /\bLeukozyten\b/gi, replacement: 'Leuko', category: 'Laborwerte' },
  { id: 'Thrombo', commands: ['Thrombozyten'], pattern: /\bThrombozyten\b/gi, replacement: 'Thrombo', category: 'Laborwerte' },
  { id: 'EKG', commands: ['EKG'], pattern: /\bEKG\b/g, replacement: 'EKG', category: 'Laborwerte' },
  { id: 'BGA', commands: ['BGA'], pattern: /\bBGA\b/gi, replacement: 'BGA', category: 'Laborwerte' },
  { id: 'HbA1c', commands: ['HbA1c'], pattern: /\bHbA1c\b/gi, replacement: 'HbA1c', category: 'Laborwerte' },
  { id: 'SpO2', commands: ['SpO2', 'Sauerstoffsättigung'], pattern: /\bSpO2\b/gi, replacement: 'SpO2', category: 'Laborwerte' },
  { id: 'RR', commands: ['RR', 'Blutdruck'], pattern: /\bRR\b/g, replacement: 'RR', category: 'Laborwerte' },
  { id: 'HF', commands: ['HF', 'Herzfrequenz'], pattern: /\bHF\b/g, replacement: 'HF', category: 'Laborwerte' },
  { id: 'BZ', commands: ['Blutzucker'], pattern: /\bBlutzucker\b/gi, replacement: 'BZ', category: 'Laborwerte' },
];

// ---- Diagnostik & Befund ----
const diagnostik: AbbreviationEntry[] = [
  { id: 'Z.n.', commands: ['Z.n.', 'Zustand nach'], pattern: /\bZustand\s+nach\b/gi, replacement: 'Z.n.', category: 'Diagnostik' },
  { id: 'V.a.', commands: ['V.a.', 'Verdacht auf'], pattern: /\bVerdacht\s+auf\b/gi, replacement: 'V.a.', category: 'Diagnostik' },
  { id: 'o.B.', commands: ['o.B.', 'ohne Befund', 'unauffällig'], pattern: /\bohne\s+Befund\b/gi, replacement: 'o.B.', category: 'Diagnostik' },
  { id: 'path.', commands: ['path.', 'pathologisch'], pattern: /\bpathologisch\b/gi, replacement: 'path.', category: 'Diagnostik' },
  { id: 're.', commands: ['re.', 'rechts (Seitenangabe)'], pattern: /\brechts\b(?!\s+auge)/gi, replacement: 're.', category: 'Diagnostik' },
  { id: 'li.', commands: ['li.', 'links (Seitenangabe)'], pattern: /\blinks\b(?!\s+auge)/gi, replacement: 'li.', category: 'Diagnostik' },
  { id: 'bds.', commands: ['bds.', 'bilateral', 'beidseits'], pattern: /\bbilateral\b/gi, replacement: 'bds.', category: 'Diagnostik' },
  { id: 'Prämed.', commands: ['Prämed.', 'Prämedikation'], pattern: /\bPr(?:ä|ae)medikation\b/gi, replacement: 'Prämed.', category: 'Diagnostik' },
  { id: 'kompl.-los', commands: ['kompl.-los', 'komplikationslos'], pattern: /\bkomplikationslos\b/gi, replacement: 'kompl.-los', category: 'Diagnostik' },
  { id: 'i.L.A.', commands: ['i.L.A.', 'in Lokalanästhesie'], pattern: /\bin\s+Lokalan(?:ä|ae)sthesie\b/gi, replacement: 'i.L.A.', category: 'Diagnostik' },
  { id: 'i.V.N.', commands: ['i.V.N.', 'in Vollnarkose'], pattern: /\bin\s+Vollnarkose\b/gi, replacement: 'i.V.N.', category: 'Diagnostik' },
  { id: 'ABP', commands: ['ABP', 'Antibiotikaprophylaxe'], pattern: /\bAntibiotikaprophylaxe\b/gi, replacement: 'ABP', category: 'Diagnostik' },
  { id: 'TPX', commands: ['TPX', 'Thromboseprophylaxe'], pattern: /\bThromboseprophylaxe\b/gi, replacement: 'TPX', category: 'Diagnostik' },
  { id: 'AK', commands: ['AK', 'Antikoagulation'], pattern: /\bAntikoagulation\b/gi, replacement: 'AK', category: 'Diagnostik' },
];

export const ABBREVIATIONS: AbbreviationEntry[] = [
  ...doseinheiten,
  ...volumen,
  ...laengen,
  ...zeiten,
  ...konzentrationen,
  ...vitalwerte,
  ...dosierung,
  ...applikation,
  ...anordnungen,
  ...labor,
  ...diagnostik,
];
