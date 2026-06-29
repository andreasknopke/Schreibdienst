/**
 * Programmatic text formatting for dictation control words.
 * Applied BEFORE LLM correction for consistent, deterministic results.
 */

import { buildPhoneticIndex, applyPhoneticCorrectionsDetailed } from './phoneticMatch';
import { applyDictionaryReplacementCase } from './replacementCase';

// Dictionary entry interface (compatible with dictionaryDb.ts)
export interface DictionaryEntry {
  wrong: string;
  correct: string;
  addedAt?: string;
  useInPrompt?: boolean;  // Wort wird im Whisper initial_prompt verwendet
  matchStem?: boolean;    // Wortstamm-Matching aktivieren
  phoneticMinSimilarity?: number;
  scope?: 'private' | 'group';
  groupId?: number;
  groupName?: string;
}

export interface DictionaryCorrectionOperation {
  originalText: string;
  replacementText: string;
  dictionaryWrong: string;
  dictionaryCorrect: string;
  source: 'standard' | 'private' | 'group';
  matchType: 'exact' | 'stem' | 'phonetic';
  confidence?: number;
  similarity?: number;
  minSimilarity?: number;
  targetUsername?: string;
  groupId?: number;
  groupName?: string;
}

export interface PreprocessTranscriptionResult {
  text: string;
  operations: DictionaryCorrectionOperation[];
}

export interface MedicalAbbreviationOperation extends DictionaryCorrectionOperation {
  originalText: string;
  replacementText: string;
  dictionaryWrong: string;
  dictionaryCorrect: string;
  source: 'standard';
  matchType: 'exact';
  ruleKey: string;
  category: keyof typeof MEDICAL_ABBREVIATION_RULES;
}

export interface PreprocessTranscriptionOptions {
  targetUsername?: string;
  dictionarySet?: 'alltag' | 'medical';
}

type DictionarySource = 'standard' | 'private' | 'group';

type AnnotatedDictionaryEntry = DictionaryEntry & {
  source: DictionarySource;
  targetUsername?: string;
};

const MEDICAL_ABBREVIATION_RULES = {
  volumen: {
    milliliter: 'ml',
    mikroliter: 'µl',
    liter: 'l',
    deziliter: 'dl',
    kubikzentimeter: 'ccm',
    tropfen: 'gtt',
  },
  masse: {
    gramm: 'g',
    milligramm: 'mg',
    mikrogramm: 'µg',
    nanogramm: 'ng',
    kilogramm: 'kg',
    internationale_einheit: 'IE',
    einheiten: 'E',
  },
  konzentration: {
    milligramm_pro_deziliter: 'mg/dl',
    millimol_pro_liter: 'mmol/l',
    mikromol_pro_liter: 'µmol/l',
    gramm_pro_liter: 'g/l',
    gramm_pro_deziliter: 'g/dl',
    milligramm_pro_kilogramm: 'mg/kg',
    millimol_pro_kilogramm: 'mmol/kg',
    mikrogramm_pro_kilogramm: 'µg/kg',
    internationale_einheit_pro_kilogramm: 'IE/kg',
    einheiten_pro_kilogramm: 'E/kg',
    milliliter_pro_kilogramm: 'ml/kg',
    tropfen_pro_minute: 'gtt/min',
    promille: '‰',
    prozent: '%',
  },
  vitalwerte_zeit: {
    schlaege_pro_minute: 'bpm',
    atemzuege_pro_minute: '/min',
    millimeter_quecksilbersaeule: 'mmHg',
    grad_celsius: '°C',
    sekunden: 's',
    minuten: 'min',
    stunden: 'h',
    tage: 'd',
    milliliter_pro_stunde: 'ml/h',
    milliliter_pro_minute: 'ml/min',
    gramm_pro_stunde: 'g/h',
    milligramm_pro_stunde: 'mg/h',
    mikrogramm_pro_kilogramm_pro_minute: 'µg/kg/min',
  },
  dosierung: {
    mal_taeglich: 'x/d',
    zweimal_taeglich: '2x/d',
    dreimal_taeglich: '3x/d',
    viermal_taeglich: '4x/d',
    bei_bedarf: 'b.B.',
    sofort: 'stat',
    tablette: 'Tbl.',
    kapsel: 'Kps',
    ampulle: 'Amp.',
    einheiten: 'E',
  },
  applikation: {
    intravenoes: 'i.v.',
    intramuskulaer: 'i.m.',
    subkutan: 's.c.',
    intrakutan: 'i.c.',
    intraarteriell: 'i.a.',
    intraossaer: 'i.o.',
    intrathekal: 'i.th.',
    per_os: 'p.o.',
    sublingual: 's.l.',
    rektal: 'rektal',
    inhalativ: 'inhal.',
    nasal: 'nasal',
    ophthalmisch: 'ophth.',
    transdermal: 't.d.',
  },
  anordnung: {
    vor_dem_essen: 'v.d.E.',
    nach_dem_essen: 'n.d.E.',
    zur_nacht: 'z.N.',
    nuechtern: 'nuechtern',
    nicht_per_os: 'NPO',
    linkes_auge: 'LA',
    rechtes_auge: 'RA',
    beide_augen: 'BA',
  },
  labor_kurzzeichen: {
    ekg: 'EKG',
    rr: 'RR',
    hf: 'HF',
    af: 'AF',
    spo2: 'SpO2',
    crp: 'CRP',
    hba1c: 'HbA1c',
    bga: 'BGA',
    blutzucker: 'BZ',
    blutdruck: 'RR',
    herzfrequenz: 'HF',
    sauerstoffsaettigung: 'SpO2',
    leukozyten: 'Leuko',
    thrombozyten: 'Thrombo',
    haemoglobin: 'Hb',
    haematokrit: 'Hkt',
    kreatinin: 'Krea',
    glomerulaere_filtrationsrate: 'GFR',
    c_reaktives_protein: 'CRP',
  },
  diagnostik_und_befund: {
    z_n: 'Z.n.',
    v_a: 'V.a.',
    o_b: 'o.B.',
    ohne_befund: 'o.B.',
    unauffaellig: 'o.B.',
    pathologisch: 'path.',
    rechts: 're.',
    links: 'li.',
    bilateral: 'bds.',
    praemedikation: 'Prämed.',
    komplikationslos: 'kompl.-los',
    in_lokalanesthesia: 'i.L.A.',
    in_vollnarkose: 'i.V.N.',
    in_narkose: 'i.N.',
    antibiotikaprophylaxe: 'ABP',
    thromboseprophylaxe: 'TPX',
    antikoagulation: 'AK',
  },
} as const;

type MedicalAbbreviationRules = typeof MEDICAL_ABBREVIATION_RULES;

type MedicalAbbreviationRuleEntry = {
  category: keyof MedicalAbbreviationRules;
  ruleKey: string;
  replacement: string;
  aliases: string[];
};

const MEDICAL_ABBREVIATION_ALIASES: Record<string, Record<string, string[]>> = {
  volumen: {
    milliliter: ['milliliter', 'milli liter', 'milli-liter'],
    mikroliter: ['mikroliter', 'micro liter', 'micro-liter', 'mikro liter', 'mikro-liter'],
    liter: ['liter'],
    deziliter: ['deziliter', 'dezi liter', 'dezi-liter'],
    kubikzentimeter: ['kubikzentimeter', 'kubik zentimeter', 'kubik-zentimeter'],
    tropfen: ['tropfen', 'tropfen pro minute'],
  },
  masse: {
    gramm: ['gramm', 'gram'],
    milligramm: ['milligramm', 'milli gramm', 'milli-gramm'],
    mikrogramm: ['mikrogramm', 'micro gramm', 'micro-gramm', 'mikro gramm', 'mikro-gramm'],
    nanogramm: ['nanogramm', 'nano gramm', 'nano-gramm'],
    kilogramm: ['kilogramm', 'kilo gramm', 'kilo-gramm'],
    internationale_einheit: ['internationale einheit', 'internationale einheiten', 'internationaler einheit'],
    einheiten: ['einheiten', 'einheit'],
  },
  konzentration: {
    milligramm_pro_deziliter: ['milligramm pro deziliter', 'milligramm pro dezi liter'],
    millimol_pro_liter: ['millimol pro liter', 'milli mol pro liter'],
    mikromol_pro_liter: ['mikromol pro liter', 'micro mol pro liter', 'mikro mol pro liter'],
    gramm_pro_liter: ['gramm pro liter'],
    gramm_pro_deziliter: ['gramm pro deziliter', 'gramm pro dezi liter'],
    milligramm_pro_kilogramm: ['milligramm pro kilogramm', 'milligramm pro kilo gramm'],
    millimol_pro_kilogramm: ['millimol pro kilogramm', 'milli mol pro kilogramm'],
    mikrogramm_pro_kilogramm: ['mikrogramm pro kilogramm', 'micro gramm pro kilogramm', 'mikro gramm pro kilogramm'],
    internationale_einheit_pro_kilogramm: ['internationale einheit pro kilogramm', 'internationaler einheit pro kilogramm'],
    einheiten_pro_kilogramm: ['einheiten pro kilogramm', 'einheit pro kilogramm'],
    milliliter_pro_kilogramm: ['milliliter pro kilogramm', 'milli liter pro kilogramm'],
    tropfen_pro_minute: ['tropfen pro minute', 'tropfen pro minute'],
    promille: ['promille'],
    prozent: ['prozent', 'pro zent'],
  },
  vitalwerte_zeit: {
    schlaege_pro_minute: ['schlaege pro minute', 'schläge pro minute', 'herzschlaege pro minute', 'herzschläge pro minute'],
    atemzuege_pro_minute: ['atemzuege pro minute', 'atemzüge pro minute'],
    millimeter_quecksilbersaeule: ['millimeter quecksilbersaeule', 'millimeter quecksilbersäule'],
    grad_celsius: ['grad celsius'],
    sekunden: ['sekunden', 'sekunde', 'seconds'],
    minuten: ['minuten', 'minute', 'mins'],
    stunden: ['stunden', 'stunde', 'std', 'stds'],
    tage: ['tage', 'tag'],
    milliliter_pro_stunde: ['milliliter pro stunde', 'milli liter pro stunde'],
    milliliter_pro_minute: ['milliliter pro minute', 'milli liter pro minute'],
    gramm_pro_stunde: ['gramm pro stunde'],
    milligramm_pro_stunde: ['milligramm pro stunde', 'milli gramm pro stunde'],
    mikrogramm_pro_kilogramm_pro_minute: ['mikrogramm pro kilogramm pro minute', 'micro gramm pro kilogramm pro minute', 'mikro gramm pro kilogramm pro minute'],
  },
  dosierung: {
    mal_taeglich: ['mal taeglich', 'mal täglich', 'mal pro tag'],
    zweimal_taeglich: ['zweimal taeglich', 'zweimal täglich', 'zwei mal taeglich', 'zwei mal täglich'],
    dreimal_taeglich: ['dreimal taeglich', 'dreimal täglich', 'drei mal taeglich', 'drei mal täglich'],
    viermal_taeglich: ['viermal taeglich', 'viermal täglich', 'vier mal taeglich', 'vier mal täglich'],
    bei_bedarf: ['bei bedarf'],
    sofort: ['sofort', 'sofortig'],
    tablette: ['tablette', 'tabletten', 'tab', 'tabs'],
    kapsel: ['kapsel', 'kapseln'],
    ampulle: ['ampulle', 'ampullen'],
    einheiten: ['einheiten', 'einheit'],
  },
  applikation: {
    intravenoes: ['intravenoes', 'intravenös', 'intravenoese', 'intravenöse'],
    intramuskulaer: ['intramuskulaer', 'intramuskulär', 'intramuskulaere', 'intramuskuläre'],
    subkutan: ['subkutan', 'subcutan'],
    intrakutan: ['intrakutan', 'intracutan'],
    intraarteriell: ['intraarteriell', 'intra arterial'],
    intraossaer: ['intraossaer', 'intraossär', 'intraossaeer', 'intraossäre'],
    intrathekal: ['intrathekal', 'intra thekal'],
    per_os: ['per os', 'per oral'],
    sublingual: ['sublingual'],
    rektal: ['rektal', 'rectal'],
    inhalativ: ['inhalativ', 'inhalation'],
    nasal: ['nasal'],
    ophthalmisch: ['ophthalmisch', 'ophthalmologisch', 'augen'],
    transdermal: ['transdermal', 'transderm'],
  },
  anordnung: {
    vor_dem_essen: ['vor dem essen', 'vor den essen', 'vor essensbeginn'],
    nach_dem_essen: ['nach dem essen', 'nach den essen', 'nach essensbeginn'],
    zur_nacht: ['zur nacht', 'nacht'],
    nuechtern: ['nuechtern', 'nüchtern', 'nuechter', 'nüchter'],
    nicht_per_os: ['nicht per os', 'nicht per oral', 'npo'],
    linkes_auge: ['linkes auge'],
    rechtes_auge: ['rechtes auge'],
    beide_augen: ['beide augen'],
  },
  labor_kurzzeichen: {
    ekg: ['ekg', 'e kg'],
    rr: ['rr', 'r r'],
    hf: ['hf', 'h f'],
    af: ['af', 'a f'],
    spo2: ['spo2', 'sp o 2', 'sauerstoff saettigung', 'sauerstoffsättigung'],
    crp: ['crp', 'c r p'],
    hba1c: ['hba1c', 'hba 1 c', 'hba eins c'],
    bga: ['bga', 'b g a'],
    blutzucker: ['blutzucker', 'blut zucker', 'b z'],
    blutdruck: ['blutdruck', 'blut druck', 'r r'],
    herzfrequenz: ['herzfrequenz', 'herz frequenz', 'h f'],
    sauerstoffsaettigung: ['sauerstoffsättigung', 'sauerstoff saettigung', 'spo2'],
    leukozyten: ['leukozyten', 'leukos', 'leuko'],
    thrombozyten: ['thrombozyten', 'thrombos', 'thrombo'],
    haemoglobin: ['haemoglobin', 'hämoglobin', 'h b'],
    haematokrit: ['haematokrit', 'hämatokrit', 'hkt'],
    kreatinin: ['kreatinin', 'krea'],
    glomerulaere_filtrationsrate: ['glomerulaere filtrationsrate', 'glomeruläre filtrationsrate', 'gfr'],
    c_reaktives_protein: ['c reaktives protein', 'c-reaktives protein', 'crp'],
  },
  diagnostik_und_befund: {
    z_n: ['z n', 'zustand nach'],
    v_a: ['v a', 'verdacht auf', 'v d a'],
    o_b: ['o b', 'ohne befund', 'unauffällig'],
    ohne_befund: ['ohne befund'],
    unauffaellig: ['unauffällig', 'unauffaellig', 'o b'],
    pathologisch: ['pathologisch', 'path', 'pathologisch'],
    rechts: ['rechts', 'recht', 're'],
    links: ['links', 'link', 'li'],
    bilateral: ['bilateral', 'beidseitig', 'bds'],
    praemedikation: ['praemedikation', 'prämedikation', 'prämed'],
    komplikationslos: ['komplikationslos', 'komplikations frei', 'kompllos'],
    in_lokalanesthesia: ['in lokalanesthesia', 'in lokalanästhesie', 'in lokaler betaubung', 'in lokaler betäubung'],
    in_vollnarkose: ['in vollnarkose', 'in voll narkose'],
    in_narkose: ['in narkose'],
    antibiotikaprophylaxe: ['antibiotikaprophylaxe', 'antibiotika prophylaxe', 'abp'],
    thromboseprophylaxe: ['thromboseprophylaxe', 'thrombose prophylaxe', 'tpx'],
    antikoagulation: ['antikoagulation', 'anti koagulation', 'ak'],
  },
};

function getMedicalAbbreviationRuleEntries(): Array<{
  category: keyof MedicalAbbreviationRules;
  ruleKey: string;
  replacement: string;
  aliases: string[];
}> {
  const entries: Array<{
    category: keyof MedicalAbbreviationRules;
    ruleKey: string;
    replacement: string;
    aliases: string[];
  }> = [];

  for (const category of Object.keys(MEDICAL_ABBREVIATION_RULES) as Array<keyof MedicalAbbreviationRules>) {
    const categoryRules = MEDICAL_ABBREVIATION_RULES[category];
    for (const ruleKey of Object.keys(categoryRules) as Array<keyof typeof categoryRules>) {
      const replacement = categoryRules[ruleKey];
      const aliases = (MEDICAL_ABBREVIATION_ALIASES[category] && MEDICAL_ABBREVIATION_ALIASES[category][ruleKey])
        ? MEDICAL_ABBREVIATION_ALIASES[category][ruleKey]
        : [String(ruleKey).replace(/_/g, ' ')];
      entries.push({ category, ruleKey: String(ruleKey), replacement, aliases });
    }
  }

  return entries.sort((a, b) => b.aliases.reduce((sum, alias) => sum + alias.length, 0) - a.aliases.reduce((sum, alias) => sum + alias.length, 0));
}

function normalizeMedicalAbbreviationInput(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\u0301/g, '')
    .replace(/\u0308/g, '')
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function applyMedicalAbbreviationsIfEnabled(
  text: string,
  dictionarySet: 'alltag' | 'medical' = 'medical'
): { text: string; operations: MedicalAbbreviationOperation[] } {
  if (dictionarySet !== 'medical') return { text, operations: [] };
  if (!text) return { text, operations: [] };

  const rules = getMedicalAbbreviationRuleEntries();
  let result = text;
  const operations: MedicalAbbreviationOperation[] = [];

  for (const rule of rules) {
    const normalizedAliases = [...new Set(rule.aliases.map(normalizeMedicalAbbreviationInput))]
      .filter(Boolean)
      .sort((a, b) => b.length - a.length);

    if (normalizedAliases.length === 0) continue;

    const aliasPattern = normalizedAliases
      .map(alias => alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');

    const regex = new RegExp(`(?<![A-Za-zÄÖÜäöüß0-9])(${aliasPattern})(?![A-Za-zÄÖÜäöüß0-9])`, 'gi');
    result = result.replace(regex, (match) => {
      const normalizedMatch = normalizeMedicalAbbreviationInput(match);
      const matchedAlias = normalizedAliases.find(alias => alias === normalizedMatch);
      if (!matchedAlias) return match;
      if (rule.replacement === match) return match;

      operations.push({
        originalText: match,
        replacementText: rule.replacement,
        dictionaryWrong: matchedAlias,
        dictionaryCorrect: rule.replacement,
        source: 'standard',
        matchType: 'exact',
        ruleKey: rule.ruleKey,
        category: rule.category,
      });

      return rule.replacement;
    });
  }

  return { text: result, operations };
}

export function applyMedicalAbbreviations(text: string, dictionarySet: 'alltag' | 'medical' = 'medical'): string {
  return applyMedicalAbbreviationsIfEnabled(text, dictionarySet).text;
}

/**
 * Apply dictionary corrections to text.
 * Replaces all occurrences of wrong words with their correct versions.
 * Uses word boundaries for more precise matching.
 * 
 * If matchStem is enabled for an entry, it also replaces the wrong word
 * when it appears as a prefix in compound words (e.g., "Schole" -> "Chole"
 * will also correct "Scholezystitis" -> "Cholezystitis").
 */
export function applyDictionaryCorrections(text: string, entries: DictionaryEntry[], standardEntries?: { wrong: string; correct: string; phoneticMinSimilarity?: number }[]): string {
  return applyDictionaryCorrectionsDetailed(text, entries, standardEntries).text;
}

export function applyDictionaryCorrectionsDetailed(
  text: string,
  entries: DictionaryEntry[],
  standardEntries?: { wrong: string; correct: string; phoneticMinSimilarity?: number }[],
  options?: PreprocessTranscriptionOptions
): PreprocessTranscriptionResult {
  if (!text) {
    return { text, operations: [] };
  }

  const annotatedUserEntries: AnnotatedDictionaryEntry[] = (entries ?? []).map((entry) => ({
    ...entry,
    source: entry.scope === 'group' ? 'group' : 'private',
    targetUsername: entry.scope === 'group' ? undefined : options?.targetUsername,
  }));
  const annotatedStandardEntries: AnnotatedDictionaryEntry[] = (standardEntries ?? []).map((entry) => ({
    ...entry,
    source: 'standard',
  }));

  // Merge mit Standard-Wörterbuch (aus DB wenn vorhanden, sonst hardcodiert)
  // Typisiert lokal, damit source/targetUsername der annotierten Einträge erhalten bleiben.
  const userWrongWords = new Set(annotatedUserEntries.map((entry) => entry.wrong.toLowerCase()));
  const mergedEntries: AnnotatedDictionaryEntry[] = [
    ...annotatedUserEntries,
    ...annotatedStandardEntries.filter((entry) => !userWrongWords.has(entry.wrong.toLowerCase())),
  ];
  let result = text;
  let replacementCount = 0;
  let stemReplacementCount = 0;
  const operations: DictionaryCorrectionOperation[] = [];

  // Sort entries by length of wrong word (longest first) to avoid partial replacements
  const sortedEntries = [...mergedEntries].sort((a, b) => b.wrong.length - a.wrong.length);

  for (const entry of sortedEntries) {
    if (!entry.wrong || !entry.correct) continue;
    
    // Escape special regex characters in the wrong word
    const escapedWrong = entry.wrong.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const escapedCorrect = entry.correct;
    
    if ('matchStem' in entry && entry.matchStem) {
      // STEM MATCHING: Also match when wrong word appears as prefix in compound words
      // Match: "Schole" in "Scholezystitis", "Scholedochus", "Scholestase"
      // Pattern: word boundary at start, then the wrong word, followed by more letters
      
      // First: Match standalone words (exact match)
      const standaloneRegex = new RegExp(`(?<![A-ZÄÖÜa-zäöüß])${escapedWrong}(?![A-ZÄÖÜa-zäöüß])`, 'gi');
      result = result.replace(standaloneRegex, (match) => {
        const replacement = applyDictionaryReplacementCase(match, escapedCorrect);
        if (replacement === match) return match;
        replacementCount++;
        operations.push({
          originalText: match,
          replacementText: replacement,
          dictionaryWrong: entry.wrong,
          dictionaryCorrect: entry.correct,
          source: entry.source,
          matchType: 'exact',
          targetUsername: entry.targetUsername,
          groupId: entry.groupId,
          groupName: entry.groupName,
        });
        return replacement;
      });
      
      // Second: Match as prefix in compound words (wrong word followed by more letters)
      // This matches "Scholezystitis" and replaces "Schole" with "Chole" -> "Cholezystitis"
      const stemRegex = new RegExp(`(?<![A-ZÄÖÜa-zäöüß])${escapedWrong}([A-ZÄÖÜa-zäöüß]+)`, 'gi');
      result = result.replace(stemRegex, (match, suffix) => {
        // Preserve case of the original stem
        const correctedStem = applyDictionaryReplacementCase(match.slice(0, entry.wrong.length), escapedCorrect);
        const replacement = correctedStem + suffix;
        if (replacement === match) return match;
        stemReplacementCount++;
        operations.push({
          originalText: match,
          replacementText: replacement,
          dictionaryWrong: entry.wrong,
          dictionaryCorrect: entry.correct,
          source: entry.source,
          matchType: 'stem',
          targetUsername: entry.targetUsername,
          groupId: entry.groupId,
          groupName: entry.groupName,
        });
        return replacement;
      });
    } else {
      // Standard word boundary matching (no stem matching)
      const regex = new RegExp(`(?<![A-ZÄÖÜa-zäöüß])${escapedWrong}(?![A-ZÄÖÜa-zäöüß])`, 'gi');
      
      result = result.replace(regex, (match) => {
        const replacement = applyDictionaryReplacementCase(match, escapedCorrect);
        if (replacement === match) return match;
        replacementCount++;
        operations.push({
          originalText: match,
          replacementText: replacement,
          dictionaryWrong: entry.wrong,
          dictionaryCorrect: entry.correct,
          source: entry.source,
          matchType: 'exact',
          targetUsername: entry.targetUsername,
          groupId: entry.groupId,
          groupName: entry.groupName,
        });
        return replacement;
      });
    }
  }

  if (replacementCount > 0 || stemReplacementCount > 0) {
    console.log(`[Dictionary] Applied ${replacementCount} direct + ${stemReplacementCount} stem corrections`);
  }

  // Pass 2: Phonetisches Matching für Wörter die das exakte Matching verpasst hat
  const phoneticIndex = buildPhoneticIndex(mergedEntries);
  if (phoneticIndex.allEntries.length > 0) {
    const phoneticResult = applyPhoneticCorrectionsDetailed(result, phoneticIndex);
    result = phoneticResult.text;
    operations.push(...phoneticResult.operations);
  }

  return { text: result, operations };
}

// Replacement function type for control words
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ReplacementFn = (...args: any[]) => string;

// Control word replacements - order matters for multi-word phrases first
const CONTROL_WORD_REPLACEMENTS: Array<{ pattern: RegExp; replacement: string | ReplacementFn }> = [
  // Paragraph/line breaks (must come before simpler patterns)
  // Capture surrounding punctuation (. , ;) and whitespace that Whisper often adds
  { pattern: /[.,;\s]*\bneuer\s*absatz\b[.,;\s]*/gi, replacement: '\n\n' },
  { pattern: /[.,;\s]*\bnächster\s*absatz\b[.,;\s]*/gi, replacement: '\n\n' },
  { pattern: /[.,;\s]*\babsatz\b[.,;\s]*/gi, replacement: '\n\n' },
  { pattern: /[.,;\s]*\bneue\s*zeile\b[.,;\s]*/gi, replacement: '\n' },
  { pattern: /[.,;\s]*\bnächste\s*zeile\b[.,;\s]*/gi, replacement: '\n' },
  
  // Indent control:
  //   "eingerückt" → new line + indent (e.g. 2 spaces)
  //   "rücke ein" → same (common dictation variant)
  //   "nächster Punkt eingerückt" → new line with bullet + indent
  { pattern: /[.,;\s]*\bnächster\s*punkt\s*eingerückt\b[.,;\s]*/gi, replacement: '\n  - ' },
  { pattern: /[.,;\s]*\beingerückt\b[.,;\s]*/gi, replacement: '\n  ' },
  { pattern: /[.,;\s]*\brücke\s*ein\b[.,;\s]*/gi, replacement: '\n  ' },
  { pattern: /[.,;\s]*\beinrücken\b[.,;\s]*/gi, replacement: '\n  ' },
  
  // Bullet points (Aufzählungsanstriche)
  // "nächster Anstrich" must come before "Anstrich" (multi-word first)
  { pattern: /[.,;\s]*\bnächster\s*anstrich\b[.,;\s]*/gi, replacement: '\n- ' },
  { pattern: /[.,;\s]*\banstrich\b[.,;\s]*/gi, replacement: '\n- ' },
  
  // NOTE: "Punkt eins", "Punkt zwei", etc. are handled in handleEnumerationCommands()
  // which is called BEFORE these replacements
  
  // Brackets/parentheses - capture surrounding commas/spaces that Whisper often adds
  // ", Klammer auf, " → " ("  and  ", Klammer zu, " → ") "
  { pattern: /[,\s]*\bklammer\s*auf\b[,\s]*/gi, replacement: ' (' },
  { pattern: /[,\s]*\bklammer\s*zu\b[,\s]*/gi, replacement: ') ' },
  // "klammern auf" / "klammern zu" (Plural-Varianten, müssen vor dem reinen "klammern" kommen)
  { pattern: /[,\s]*\bklammern\s*auf\b[,\s]*/gi, replacement: ' (' },
  { pattern: /[,\s]*\bklammern\s*zu\b[,\s]*/gi, replacement: ') ' },
  // "klammern" alleine (ohne "auf"/"zu") = Klammer auf (umgangssprachlich)
  { pattern: /[,\s]*\bklammern\b(?!\s*(auf|zu))[,\s]*/gi, replacement: ' (' },
  // "Xklammer zu" - Whisper schreibt manchmal zusammen, z.B. "Histoklammer zu" → "Histo)"
  { pattern: /(\w+)klammer\s*zu\b[,\s]*/gi, replacement: '$1) ' },
  // "Xklammern zu" - auch Plural, z.B. "Diagnosenklammern zu" → "Diagnosen)"
  { pattern: /(\w+)klammern\s*zu\b[,\s]*/gi, replacement: '$1) ' },
  { pattern: /\bin\s*klammern\s+/gi, replacement: '(' }, // "in Klammern XYZ" - opening only, closing handled separately
  
  // Punctuation with preceding comma removal - ",[ ]Doppelpunkt" → ":"
  // Handle cases like "Hauptdiagnose, Doppelpunkt" → "Hauptdiagnose:"
  { pattern: /,\s*doppelpunkt\b/gi, replacement: ':' },
  { pattern: /,\s*semikolon\b/gi, replacement: ';' },
  { pattern: /,\s*fragezeichen\b/gi, replacement: '?' },
  { pattern: /,\s*ausrufezeichen\b/gi, replacement: '!' },
  // ", Punkt." → "." (mit nachfolgendem Punkt) - muss vor dem allgemeinen Pattern kommen
  { pattern: /,\s*punkt\s*\./gi, replacement: '.' },
  { pattern: /,\s*punkt\b(?!\s*(eins|zwei|drei|vier|fünf|sechs|sieben|acht|neun|zehn|\d))/gi, replacement: '.' },
  
  // "Punkt" and "Komma" as control words when surrounded by punctuation
  // ". Punkt." → "." (redundant spoken punctuation)
  // ". Punkt " → ". " (Punkt as control word after sentence end)
  // "? Punkt." → "?" etc.
  { pattern: /([.!?])\s*punkt\s*\./gi, replacement: '$1' },  // ". Punkt." → "."
  { pattern: /([.!?])\s*punkt\s+/gi, replacement: '$1 ' },   // ". Punkt " → ". "
  { pattern: /([.!?])\s*komma\s*[.,]/gi, replacement: '$1' }, // ". Komma," → "."
  
  // Standalone "Punkt." at sentence boundary (after space or at start)
  // This catches "... Text. Punkt." → "... Text."
  { pattern: /\.\s+punkt\s*\./gi, replacement: '.' },
  
  // Punctuation - FIRST handle compound words ending with punctuation command
  // e.g., "Diagnosedoppelpunkt" → "Diagnose:"
  // NOTE: "Punkt" and "Komma" are handled by LLM because they're too ambiguous
  //       (e.g., "der entscheidende Punkt ist..." should NOT become "der entscheidende . ist...")
  { pattern: /\b(\w+?)doppelpunkt\b/gi, replacement: (_: string, word: string) => `${word}:` },
  { pattern: /\b(\w+?)semikolon\b/gi, replacement: (_: string, word: string) => `${word};` },
  { pattern: /\b(\w+?)fragezeichen\b/gi, replacement: (_: string, word: string) => `${word}?` },
  { pattern: /\b(\w+?)ausrufezeichen\b/gi, replacement: (_: string, word: string) => `${word}!` },
  
  // Punctuation (standalone words only) - unambiguous ones only
  // "Punkt" and "Komma" are left to LLM for context-aware handling
  { pattern: /\bdoppelpunkt\b/gi, replacement: ':' },
  { pattern: /\bsemikolon\b/gi, replacement: ';' },
  { pattern: /\bfragezeichen\b/gi, replacement: '?' },
  { pattern: /\bausrufezeichen\b/gi, replacement: '!' },
  
  // Quotes
  { pattern: /\banführungszeichen\s*auf\b/gi, replacement: '„' },
  { pattern: /\banführungszeichen\s*zu\b/gi, replacement: '"' },
  { pattern: /\banführungszeichen\s*oben\b/gi, replacement: '"' },
  { pattern: /\banführungszeichen\s*unten\b/gi, replacement: '„' },
  
  // Zahl-zu-Zahl: "80 zu 100" → "80/100" (Blutdruck, Maße, etc.)
  // Muss vor Delete-Befehlen kommen, da "zu" auch in anderen Kontexten vorkommt
  { pattern: /\b(\d+)\s*zu\s*(\d+)\b/gi, replacement: (_match: string, num1: string, num2: string) => `${num1}/${num2}` },
  
  // Uhrzeit: "10 Uhr 15" → "10:15" (Stunde:Minuten)
  { pattern: /\b(\d{1,2})\s*uhr\s*(\d{2})\b/gi, replacement: (_match: string, hours: string, minutes: string) => `${hours}:${minutes}` },
  // ASR-Variante: "10. 15 Uhr" oder "10.15 Uhr" → "10:15" (Punkt/Leerzeichen zwischen Zahlen, "Uhr" am Ende)
  { pattern: /\b(\d{1,2})[\s.]+(\d{2})\s*uhr\b/gi, replacement: (_match: string, hours: string, minutes: string) => `${hours}:${minutes}` },
  
  // Delete commands - these need special handling after replacement
  // Mark them for post-processing
  
  // Uhrzeit-Nachbereitung: "10: 15" → "10:15" (falls ASR oder LLM Leerzeichen nach : eingefügt haben)
  { pattern: /(\d{1,2}):\s+(\d{2})\b/gi, replacement: (_match: string, h: string, m: string) => `${h}:${m}` },
];

// Delete command patterns
const DELETE_PATTERNS = [
  { pattern: /\bwort\s*streichen\b/gi, type: 'word' as const },  // "Wort streichen" or "Wortstreichen"
  { pattern: /\bstreiche\s*wort\b/gi, type: 'word' as const },   // "streiche Wort" or "streichewort"
  { pattern: /\bwort\s*löschen\b/gi, type: 'word' as const },
  { pattern: /lösche\s*(?:das\s*)?letzte(?:s)?\s*wort\b/gi, type: 'word' as const },
  { pattern: /letztes\s*wort\s*löschen\b/gi, type: 'word' as const },
  { pattern: /lösche\s*(?:den\s*)?letzten\s*satz\b/gi, type: 'sentence' as const },
  { pattern: /\bsatz\s*löschen\b/gi, type: 'sentence' as const },
  { pattern: /letzten\s*satz\s*löschen\b/gi, type: 'sentence' as const },
  { pattern: /lösche\s*(?:den\s*)?letzten\s*absatz\b/gi, type: 'paragraph' as const },
  { pattern: /letzten\s*absatz\s*löschen\b/gi, type: 'paragraph' as const },
];

// Number word to digit mapping for enumeration
const NUMBER_WORDS: Record<string, number> = {
  'eins': 1, 'ein': 1, 'erste': 1, 'erster': 1, 'erstes': 1,
  'zwei': 2, 'zweite': 2, 'zweiter': 2, 'zweites': 2,
  'drei': 3, 'dritte': 3, 'dritter': 3, 'drittes': 3,
  'vier': 4, 'vierte': 4, 'vierter': 4, 'viertes': 4,
  'fünf': 5, 'fünfte': 5, 'fünfter': 5, 'fünftes': 5,
  'sechs': 6, 'sechste': 6, 'sechster': 6, 'sechstes': 6,
  'sieben': 7, 'siebte': 7, 'siebter': 7, 'siebtes': 7,
  'acht': 8, 'achte': 8, 'achter': 8, 'achtes': 8,
  'neun': 9, 'neunte': 9, 'neunter': 9, 'neuntes': 9,
  'zehn': 10, 'zehnte': 10, 'zehnter': 10, 'zehntes': 10,
  'elf': 11, 'elfte': 11, 'elfter': 11, 'elftes': 11,
  'zwölf': 12, 'zwölfte': 12, 'zwölfter': 12, 'zwölftes': 12,
};

/**
 * Apply formatting control words programmatically.
 * This should be called BEFORE sending text to LLM for correction.
 * 
 * @param text - Raw transcription text with spoken control words
 * @returns Text with control words replaced by actual formatting
 */
/**
 * Result of control word application with statistics
 */
export interface ControlWordResult {
  text: string;
  stats: {
    paragraphs: number;  // "neuer Absatz", "Absatz"
    lineBreaks: number;  // "neue Zeile"
    bulletPoints: number; // "Anstrich", "nächster Anstrich"
    punctuation: number; // "Punkt", "Komma", "Doppelpunkt" etc.
    brackets: number;    // "Klammer auf/zu"
    deletions: number;   // "lösche das letzte Wort" etc.
    enumerations: number; // "Punkt eins", "Nächster Punkt" etc.
    total: number;
  };
}

/**
 * Apply formatting control words programmatically.
 * This should be called BEFORE sending text to LLM for correction.
 * 
 * @param text - Raw transcription text with spoken control words
 * @returns Text with control words replaced by actual formatting
 */
export function applyFormattingControlWords(text: string): string {
  const result = applyFormattingControlWordsWithStats(text);
  return result.text;
}

/**
 * Online-Modus: aggressivere Steuerwort-Ersetzung für bereits segmentierte Utterances.
 * In VAD-/Realtime-Pfaden sind einzelne Utterances deutlich eher echte Befehle als Fließtext,
 * deshalb werden hier auch Punkt/Komma/Bindestrich programmgesteuert umgesetzt.
 */
export function applyOnlineDictationControlWords(text: string): string {
  if (!text) return text;

  let result = applyFormattingControlWords(text);

  const liveOnlyReplacements: Array<{ pattern: RegExp; replacement: string }> = [
    { pattern: /\b(komma|beistrich)\b/gi, replacement: ',' },
    { pattern: /\bbindestrich\b/gi, replacement: '-' },
    { pattern: /\bpunkt\b/gi, replacement: '.' },
  ];

  for (const { pattern, replacement } of liveOnlyReplacements) {
    result = result.replace(pattern, replacement);
  }

  // Cleanup: Entferne überflüssige Kommas, die nach Doppelpunkt, Semikolon, Frage- oder
  // Ausrufezeichen stehen (z.B. "Doppelpunkt Komma" → ":,", bereinigt zu ":").
  result = result.replace(/([:;?!])\s*,/g, '$1');

  return cleanupFormattingPreserveEdgeBreaks(result);
}

/**
 * Wendet Löschbefehle auf einen bereits kombinierten Text an.
 * Dadurch funktionieren Befehle wie "lösche den letzten Satz" auch dann,
 * wenn der zu löschende Inhalt in einer vorherigen Utterance liegt.
 */
export function applyDeleteCommands(text: string): string {
  if (!text) return text;
  return cleanupFormatting(handleDeleteCommands(text));
}

function isStandaloneDeleteCommand(text: string): boolean {
  if (!text) return false;

  const normalized = text
    .toLowerCase()
    .replace(/[.,;:!?-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const standaloneDeletePatterns = [
    /^lösche\s*(?:das\s*)?letzte(?:s)?\s*wort$/,
    /^letztes\s*wort\s*löschen$/,
    /^wort\s*löschen$/,
    /^wort\s*streichen$/,
    /^streiche\s*wort$/,
    /^lösche\s*(?:den\s*)?letzten\s*satz$/,
    /^letzten\s*satz\s*löschen$/,
    /^satz\s*löschen$/,
    /^lösche\s*(?:den\s*)?letzten\s*absatz$/,
    /^letzten\s*absatz\s*löschen$/,
  ];

  return standaloneDeletePatterns.some((pattern) => pattern.test(normalized));
}

type OnlineCommandType =
  | 'deleteWord'
  | 'deleteSentence'
  | 'deleteParagraph'
  | 'lineBreak'
  | 'paragraphBreak'
  | 'bulletPoint'
  | 'comma'
  | 'period'
  | 'dash';

interface OnlineCommandMatch {
  type: OnlineCommandType;
  index: number;
  length: number;
}

const ONLINE_COMMAND_PATTERNS: Array<{ type: OnlineCommandType; pattern: RegExp }> = [
  { type: 'deleteWord', pattern: /\blösche\s*(?:das\s*)?letzte(?:s)?\s*wort\b[.,;:!?]*/i },
  { type: 'deleteWord', pattern: /\bletztes\s*wort\s*löschen\b[.,;:!?]*/i },
  { type: 'deleteWord', pattern: /\bwort\s*löschen\b[.,;:!?]*/i },
  { type: 'deleteWord', pattern: /\bwort\s*streichen\b[.,;:!?]*/i },
  { type: 'deleteWord', pattern: /\bstreiche\s*wort\b[.,;:!?]*/i },
  { type: 'deleteSentence', pattern: /\blösche\s*(?:den\s*)?letzten\s*satz\b[.,;:!?]*/i },
  { type: 'deleteSentence', pattern: /\bsatz\s*löschen\b[.,;:!?]*/i },
  { type: 'deleteSentence', pattern: /\bletzen\s*satz\s*löschen\b[.,;:!?]*/i },
  { type: 'deleteSentence', pattern: /\bletzten\s*satz\s*löschen\b[.,;:!?]*/i },
  { type: 'deleteParagraph', pattern: /\blösche\s*(?:den\s*)?letzten\s*absatz\b[.,;:!?]*/i },
  { type: 'deleteParagraph', pattern: /\bletzten\s*absatz\s*löschen\b[.,;:!?]*/i },
  { type: 'paragraphBreak', pattern: /\b(?:neuer\s*|nächster\s*)?absatz\b[.,;:!?]*/i },
  { type: 'lineBreak', pattern: /\b(?:neue|nächste)\s*zeile\b[.,;:!?]*/i },
  { type: 'lineBreak', pattern: /\bzeilenumbruch\b[.,;:!?]*/i },
  { type: 'bulletPoint', pattern: /\bnächster\s*anstrich\b[.,;:!?]*/i },
  { type: 'bulletPoint', pattern: /\banstrich\b[.,;:!?]*/i },
  { type: 'comma', pattern: /\b(?:komma|beistrich)\b[.,;:!?]*/i },
  { type: 'period', pattern: /\bpunkt\b[.,;:!?]*/i },
  { type: 'dash', pattern: /\bbindestrich\b[.,;:!?]*/i },
];

function findNextOnlineCommand(text: string, startIndex: number): OnlineCommandMatch | null {
  let bestMatch: OnlineCommandMatch | null = null;

  for (const { type, pattern } of ONLINE_COMMAND_PATTERNS) {
    const slice = text.slice(startIndex);
    const match = slice.match(pattern);
    if (!match || match.index === undefined) continue;

    const absoluteIndex = startIndex + match.index;
    const candidate: OnlineCommandMatch = {
      type,
      index: absoluteIndex,
      length: match[0].length,
    };

    if (!bestMatch || absoluteIndex < bestMatch.index) {
      bestMatch = candidate;
      continue;
    }

    if (bestMatch && absoluteIndex === bestMatch.index && candidate.length > bestMatch.length) {
      bestMatch = candidate;
    }
  }

  return bestMatch;
}

function appendOnlineText(currentText: string, textSegment: string): string {
  if (!textSegment.trim()) return currentText;
  const normalizedSegment = /\n$/.test(currentText) ? textSegment.replace(/^\s+/, '') : textSegment;
  const formattedSegment = applyOnlineDictationControlWords(normalizedSegment);
  if (!formattedSegment.trim()) return currentText;
  return combineFormattedText(currentText, formattedSegment);
}

function applyOnlineCommand(currentText: string, type: OnlineCommandType): string {
  switch (type) {
    case 'deleteWord':
      return deleteLastWordFromText(currentText);
    case 'deleteSentence':
      return deleteLastSentenceFromText(currentText);
    case 'deleteParagraph':
      return deleteLastParagraphFromText(currentText);
    case 'lineBreak':
      return `${currentText.replace(/[^\S\n]*$/, '')}\n`;
    case 'paragraphBreak':
      return `${currentText.replace(/[^\S\n]*$/, '')}\n\n`;
    case 'bulletPoint':
      return `${currentText.replace(/[^\S\n]*$/, '')}\n- `;
    case 'comma':
      return cleanupFormatting(`${currentText.replace(/[^\S\n]*$/, '')},`);
    case 'period':
      return cleanupFormatting(`${currentText.replace(/[^\S\n]*$/, '')}.`);
    case 'dash':
      return cleanupFormattingPreserveTrailingBreaks(`${currentText}${currentText ? ' ' : ''}-`);
    default:
      return currentText;
  }
}

function cleanupFormattingPreserveTrailingBreaks(text: string): string {
  if (!text) return text;

  const trailingBreaks = text.match(/\n+$/)?.[0] ?? '';
  const cleaned = cleanupFormatting(text);
  if (!trailingBreaks) return cleaned;
  return `${cleaned}${trailingBreaks}`;
}

function cleanupFormattingPreserveEdgeBreaks(text: string): string {
  if (!text) return text;

  const leadingBreaks = text.match(/^\n+/)?.[0] ?? '';
  const trailingBreaks = text.match(/\n+$/)?.[0] ?? '';
  const cleaned = cleanupFormatting(text);
  const normalizedLeadingBreaks = leadingBreaks.replace(/\n{3,}/g, '\n\n');
  const normalizedTrailingBreaks = trailingBreaks.replace(/\n{3,}/g, '\n\n');

  if (!cleaned) {
    const edgeBreaks = `${normalizedLeadingBreaks}${normalizedTrailingBreaks}`.replace(/\n{3,}/g, '\n\n');
    return edgeBreaks;
  }

  return `${normalizedLeadingBreaks}${cleaned}${normalizedTrailingBreaks}`;
}

function deleteLastWordFromText(text: string): string {
  return cleanupFormatting(text.replace(/\s*\S+\s*$/, ''));
}

function deleteLastSentenceFromText(text: string): string {
  const withoutLastSentence = text.replace(/\s*[^.!?]*[.!?]\s*$/, '');
  if (withoutLastSentence !== text) {
    return cleanupFormatting(withoutLastSentence);
  }
  return cleanupFormatting(text.replace(/[^\n]*$/, ''));
}

function deleteLastParagraphFromText(text: string): string {
  const lastParagraphBreak = text.lastIndexOf('\n\n');
  if (lastParagraphBreak > 0) {
    return cleanupFormatting(text.substring(0, lastParagraphBreak));
  }
  return '';
}

function applyStandaloneDeleteCommand(currentText: string, commandText: string): string {
  const normalized = commandText
    .toLowerCase()
    .replace(/[.,;:!?]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (/wort\s*streichen|streiche\s*wort|wort\s*löschen|lösche\s*(?:das\s*)?letzte(?:s)?\s*wort|letztes\s*wort\s*löschen/.test(normalized)) {
    return deleteLastWordFromText(currentText);
  }
  if (/lösche\s*(?:den\s*)?letzten\s*satz|letzten\s*satz\s*löschen|satz\s*löschen/.test(normalized)) {
    return deleteLastSentenceFromText(currentText);
  }
  if (/lösche\s*(?:den\s*)?letzten\s*absatz|letzten\s*absatz\s*löschen/.test(normalized)) {
    return deleteLastParagraphFromText(currentText);
  }

  return cleanupFormatting(currentText);
}

/**
 * Wendet eine einzelne Online-Utterance auf den bereits aufgebauten Text an.
 * Reine Löschbefehle werden NICHT angehängt, sondern direkt auf den vorhandenen
 * Text angewendet. Dadurch löscht "lösche den letzten Satz" zuverlässig den
 * vorherigen Satz statt den aktuellen Befehls-Chunk.
 */
export interface OnlineUtteranceApplicationDebugStep {
  kind: 'append' | 'command';
  input: string;
  changed: boolean;
  commandType?: OnlineCommandType;
}

export function applyOnlineUtteranceToText(
  currentText: string,
  utteranceText: string,
  onDebugStep?: (step: OnlineUtteranceApplicationDebugStep) => void
): string {
  if (!utteranceText.trim()) {
    if (/\n/.test(utteranceText)) {
      const trailingBreaks = (utteranceText.match(/\n+/g) || []).join('').replace(/\n{3,}/g, '\n\n');
      if (trailingBreaks) {
        return cleanupFormattingPreserveEdgeBreaks(`${currentText.replace(/[^\S\n]*$/, '')}${trailingBreaks}`);
      }
    }

    return cleanupFormatting(currentText);
  }

  let result = currentText;
  let cursor = 0;

  while (cursor < utteranceText.length) {
    const nextCommand = findNextOnlineCommand(utteranceText, cursor);
    if (!nextCommand) {
      const input = utteranceText.slice(cursor);
      const before = result;
      result = appendOnlineText(result, input);
      onDebugStep?.({
        kind: 'append',
        input,
        changed: result !== before,
      });
      break;
    }

    if (nextCommand.index > cursor) {
      const input = utteranceText.slice(cursor, nextCommand.index);
      const before = result;
      result = appendOnlineText(result, input);
      onDebugStep?.({
        kind: 'append',
        input,
        changed: result !== before,
      });
    }

    const commandText = utteranceText.slice(nextCommand.index, nextCommand.index + nextCommand.length);
    const before = result;
    result = applyOnlineCommand(result, nextCommand.type);
    onDebugStep?.({
      kind: 'command',
      input: commandText,
      commandType: nextCommand.type,
      changed: result !== before,
    });
    cursor = nextCommand.index + nextCommand.length;
  }

  return cleanupFormattingPreserveEdgeBreaks(result);
}

/**
 * Kombiniert zwei bereits formatierte Textstücke und bereinigt Leerzeichen/
 * Satzzeichen an der Fuge. Das verhindert Artefakte wie "Text ," oder "Text \n\n".
 */
export function combineFormattedText(existingText: string, incomingText: string): string {
  if (!existingText) return cleanupFormattingPreserveEdgeBreaks(incomingText);
  if (!incomingText) return cleanupFormattingPreserveEdgeBreaks(existingText);
  const separator = existingText.endsWith(' ') || existingText.endsWith('\n') ? '' : ' ';
  return cleanupFormattingPreserveEdgeBreaks(`${existingText}${separator}${incomingText}`);
}

/**
 * Apply formatting control words and return statistics about what was applied.
 * Use this version when you need to log/display the results.
 */
export function applyFormattingControlWordsWithStats(text: string): ControlWordResult {
  if (!text) return { text, stats: { paragraphs: 0, lineBreaks: 0, bulletPoints: 0, punctuation: 0, brackets: 0, deletions: 0, enumerations: 0, total: 0 } };
  
  let result = text;
  const stats = { paragraphs: 0, lineBreaks: 0, bulletPoints: 0, punctuation: 0, brackets: 0, deletions: 0, enumerations: 0, total: 0 };
  
  // Step 0: Handle enumeration commands first (before other replacements)
  const enumResult = handleEnumerationCommands(result);
  result = enumResult.text;
  stats.enumerations = enumResult.count;
  stats.total += enumResult.count;
  
  // Step 1: Apply simple replacements and count
  for (const { pattern, replacement } of CONTROL_WORD_REPLACEMENTS) {
    const matches = result.match(pattern);
    if (matches) {
      const count = matches.length;
      stats.total += count;
      
      // Categorize the match
      const patternStr = pattern.source.toLowerCase();
      if (patternStr.includes('anstrich')) {
        stats.bulletPoints += count;
      } else if (patternStr.includes('absatz') || patternStr.includes('zeile') || patternStr.includes('eingerückt') || patternStr.includes('einrücken') || patternStr.includes('rücke')) {
        if (patternStr.includes('zeile')) {
          stats.lineBreaks += count;
        } else if (patternStr.includes('absatz')) {
          stats.paragraphs += count;
        } else {
          stats.lineBreaks += count; // eingerückt/rücke ein/einrücken zählen als Zeilenumbruch
        }
      } else if (patternStr.includes('klammer')) {
        stats.brackets += count;
      } else {
        stats.punctuation += count;
      }
    }
    // Handle both string and function replacements
    if (typeof replacement === 'function') {
      result = result.replace(pattern, replacement as (...args: string[]) => string);
    } else {
      result = result.replace(pattern, replacement);
    }
  }
  
  // Step 2: Handle delete commands
  const beforeDelete = result;
  result = handleDeleteCommands(result);
  if (beforeDelete !== result) {
    stats.deletions++;
    stats.total++;
  }
  
  // Step 3: Clean up formatting
  result = cleanupFormattingPreserveEdgeBreaks(result);
  
  // Log if any control words were applied
  if (stats.total > 0) {
    const details: string[] = [];
    if (stats.paragraphs > 0) details.push(`${stats.paragraphs}x Absatz`);
    if (stats.lineBreaks > 0) details.push(`${stats.lineBreaks}x Zeile`);
    if (stats.bulletPoints > 0) details.push(`${stats.bulletPoints}x Anstrich`);
    if (stats.punctuation > 0) details.push(`${stats.punctuation}x Satzzeichen`);
    if (stats.brackets > 0) details.push(`${stats.brackets}x Klammer`);
    if (stats.deletions > 0) details.push(`${stats.deletions}x Löschung`);
    if (stats.enumerations > 0) details.push(`${stats.enumerations}x Aufzählung`);
    console.log(`[ControlWords] ${stats.total} Steuerbefehle erkannt: ${details.join(', ')}`);
  }
  
  return { text: result, stats };
}

/**
 * Handle enumeration/list commands
 * Patterns:
 * - "Aufzählung beginnen/starten" (optional start marker, removed)
 * - "Punkt eins/zwei/drei..." → "1./2./3. ..."
 * - "Nächster Punkt" → next number in sequence
 * - "Aufzählung beenden" (end marker, removed)
 */
function handleEnumerationCommands(text: string): { text: string; count: number } {
  if (!text) return { text, count: 0 };
  
  let result = text;
  let count = 0;
  
  // Step 1: Remove optional start markers
  const startPatterns = [
    /\baufzählung\s*beginnen\b[.,;:\s]*/gi,
    /\baufzählung\s*starten\b[.,;:\s]*/gi,
    /\bliste\s*beginnen\b[.,;:\s]*/gi,
    /\bliste\s*starten\b[.,;:\s]*/gi,
  ];
  
  for (const pattern of startPatterns) {
    if (pattern.test(result)) {
      result = result.replace(pattern, '\n');
      count++;
    }
  }
  
  // Step 2: Remove end markers
  const endPatterns = [
    /\baufzählung\s*beenden\b[.,;:\s]*/gi,
    /\baufzählung\s*ende\b[.,;:\s]*/gi,
    /\bliste\s*beenden\b[.,;:\s]*/gi,
    /\bliste\s*ende\b[.,;:\s]*/gi,
  ];
  
  for (const pattern of endPatterns) {
    if (pattern.test(result)) {
      result = result.replace(pattern, '\n');
      count++;
    }
  }
  
  // Step 3: Process all enumeration commands sequentially from left to right
  // This ensures "Nächster Punkt" correctly follows previous numbered items
  
  // Build combined pattern to find all enumeration commands
  const numberWordPattern = Object.keys(NUMBER_WORDS).join('|');
  
  // Pattern for "Punkt [number word]" or "Punkt [digit]" or "Nächster Punkt" etc.
  // Using 'gi' flags for global case-insensitive matching
  const allEnumPatterns = new RegExp(
    `\\bpunkt\\s*(${numberWordPattern}|\\d+)\\b[.,;:\\s]*` +
    `|\\bnächster\\s*punkt\\b[.,;:\\s]*` +
    `|\\bnächster\\s*listenpunkt\\b[.,;:\\s]*` +
    `|\\bweiterer\\s*punkt\\b[.,;:\\s]*` +
    `|\\berstens\\b[.,;:\\s]*` +
    `|\\bzweitens\\b[.,;:\\s]*` +
    `|\\bdrittens\\b[.,;:\\s]*` +
    `|\\bviertens\\b[.,;:\\s]*` +
    `|\\bfünftens\\b[.,;:\\s]*` +
    `|\\bsechstens\\b[.,;:\\s]*` +
    `|\\bsiebentens\\b[.,;:\\s]*` +
    `|\\bsiebtens\\b[.,;:\\s]*` +
    `|\\bachtens\\b[.,;:\\s]*` +
    `|\\bneuntens\\b[.,;:\\s]*` +
    `|\\bzehntens\\b[.,;:\\s]*`,
    'gi'
  );
  
  // Ordinal word to number mapping
  const ordinalToNumber: Record<string, number> = {
    'erstens': 1, 'zweitens': 2, 'drittens': 3, 'viertens': 4, 'fünftens': 5,
    'sechstens': 6, 'siebentens': 7, 'siebtens': 7, 'achtens': 8, 'neuntens': 9, 'zehntens': 10,
  };
  
  let currentNumber = 0;
  
  result = result.replace(allEnumPatterns, (match) => {
    const matchLower = match.toLowerCase().trim();
    count++;
    
    // Check if it's "Punkt [number]"
    // Use \w+ instead of \S+ to avoid capturing trailing punctuation like commas
    const punktMatch = match.match(/\bpunkt\s*(\w+)/i);
    if (punktMatch) {
      const numPart = punktMatch[1].toLowerCase();
      // Try as number word
      if (NUMBER_WORDS[numPart]) {
        currentNumber = NUMBER_WORDS[numPart];
        return `\n${currentNumber}. `;
      }
      // Try as digit
      const digit = parseInt(numPart, 10);
      if (!isNaN(digit)) {
        currentNumber = digit;
        return `\n${currentNumber}. `;
      }
    }
    
    // Check if it's an ordinal (erstens, zweitens, etc.)
    for (const [ordinal, num] of Object.entries(ordinalToNumber)) {
      if (matchLower.startsWith(ordinal)) {
        currentNumber = num;
        return `\n${currentNumber}. `;
      }
    }
    
    // Check if it's "Nächster Punkt" or similar
    if (/nächster\s+punkt|nächster\s+listenpunkt|weiterer\s+punkt/i.test(match)) {
      currentNumber++;
      return `\n${currentNumber}. `;
    }
    
    // Fallback - shouldn't happen
    return match;
  });
  
  return { text: result, count };
}

/**
 * Handle "delete last word/sentence/paragraph" commands
 */
function handleDeleteCommands(text: string): string {
  let result = text;
  
  for (const { pattern, type } of DELETE_PATTERNS) {
    let match;
    // Reset the regex for each iteration
    const regex = new RegExp(pattern.source, pattern.flags);
    
    while ((match = regex.exec(result)) !== null) {
      const deletePosition = match.index;
      const deleteCommand = match[0];
      const textBefore = result.substring(0, deletePosition);
      const textAfter = result.substring(deletePosition + deleteCommand.length);
      
      let newTextBefore: string;
      
      switch (type) {
        case 'word':
          // Delete the last word before the command
          newTextBefore = textBefore.replace(/\s*\S+\s*$/, '');
          break;
        case 'sentence':
          // Delete the last sentence (ending with . ! ?)
          newTextBefore = textBefore.replace(/[^.!?]*[.!?]\s*$/, '');
          // If no sentence found, try to find any text after last paragraph break
          if (newTextBefore === textBefore) {
            newTextBefore = textBefore.replace(/[^\n]*$/, '');
          }
          break;
        case 'paragraph':
          // Delete the last paragraph (text after last double newline or from start)
          const lastParagraphBreak = textBefore.lastIndexOf('\n\n');
          if (lastParagraphBreak > 0) {
            newTextBefore = textBefore.substring(0, lastParagraphBreak);
          } else {
            // No paragraph break found, delete everything
            newTextBefore = '';
          }
          break;
        default:
          newTextBefore = textBefore;
      }
      
      result = newTextBefore + textAfter;
      // Reset regex to search from beginning after modification
      regex.lastIndex = 0;
    }
  }
  
  return result;
}

/**
 * Clean up formatting artifacts
 */
function cleanupFormatting(text: string): string {
  return text
    // Remove multiple spaces (but keep newlines)
    .replace(/[^\S\n]+/g, ' ')
    // Remove space before punctuation
    .replace(/[^\S\n]+([.,;:!?)])/g, '$1')
    // Remove space after colon before digits (Uhrzeit-Korrektur: "10: 15" → "10:15")
    .replace(/: +(?=\d)/g, ':')
    // Add space after punctuation if missing (but not before newline or opening bracket)
    .replace(/([.,;:!?])(?=[A-ZÄÖÜa-zäöüß])/g, '$1 ')
    // Remove space after opening parenthesis
    .replace(/\(\s+/g, '(')
    // Remove space before closing parenthesis
    .replace(/\s+\)/g, ')')
    // Add space after closing parenthesis if followed by letter
    .replace(/\)(?=[A-ZÄÖÜa-zäöüß])/g, ') ')
    // Remove comma before opening parenthesis: ", (" → " ("
    .replace(/,\s*\(/g, ' (')
    // Remove comma after closing parenthesis if followed by comma: "), " → ") " - no double comma
    .replace(/\),\s*,/g, '),')
    // Max 2 newlines (one empty line)
    .replace(/\n{3,}/g, '\n\n')
    // Remove trailing whitespace from lines
    .replace(/[^\S\n]+$/gm, '')
    // Trim overall
    .trim();
}

/**
 * Remove filler words like "ähm", "äh", "hm" from text
 */
export function removeFillerWords(text: string): string {
  if (!text) return text;
  
  return text
    // Common German filler words (standalone)
    .replace(/\b(ähm|äh|hm+|mhm+|öhm|eh|ehm)\b\s*/gi, '')
    // Clean up any double spaces created
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Erkennt und repariert Wörter bei denen der gesprochene Befehl "Punkt"
 * versehentlich mit dem vorherigen Wort zusammengezogen wurde.
 *
 * Beispiele:
 *   "stehenpunkt."  → "stehen. "
 *   "Unazitpunkt."  → "Unazit. "  (später korrigiert phonetisches Matching "Unazit"→"Unazid")
 *   "Diespunkt ist" → "Dies. ist" (wenn "Dies" im Wörterbuch)
 *
 * Zwei Erkennungsregeln:
 *   1. Das Wort wird von einem automatischen Punkt gefolgt → hohe Sicherheit, immer trennen.
 *   2. Der Wortstamm (ohne "punkt") ist ein bekannter Wörterbuch-Eintrag → trennen.
 *
 * @param text - Rohtext aus der Transkription
 * @param knownCorrectWords - Set von bekannten korrekten Schreibweisen aus dem Wörterbuch
 * @returns Bereinigter Text und ausgeführte Operationen
 */
export function fixConcatenatedPunkt(
  text: string,
  knownCorrectWords?: Set<string>
): { text: string; operations: DictionaryCorrectionOperation[] } {
  if (!text) return { text, operations: [] };

  const operations: DictionaryCorrectionOperation[] = [];

  // Bekannte Wörter die legitimerweise auf "punkt" enden (keine Zusammenziehung)
  const legitimatePunktWords = new Set([
    'zeit', 'stand', 'gesichts', 'schwer', 'dreh', 'angel', 'angriffs',
    'ansatz', 'ausgangs', 'blick', 'brenn', 'eck', 'end', 'fix', 'flucht',
    'flieh', 'gegen', 'haupt', 'hinter', 'höhe', 'kern', 'knack', 'kristallisations',
    'markierungs', 'mittel', 'null', 'setz', 'siede',
    'stütz', 'tief', 'treff', 'umkehr', 'verknüpfungs', 'wahl', 'wende',
    'wolken',
  ]);

  // Regex: Wort das mit "punkt" endet (case-insensitive), aber mind. 3 Zeichen Stamm.
  // Gruppe 1: Wortstamm vor "punkt", Gruppe 2: nachfolgender Whitespace+Punkt oder Satzende.
  const concatenatedPunktRegex = /\b([A-ZÄÖÜa-zäöüß]{2,})punkt(\s*\.\s*|\s*\.$|$)/gi;

  const result = text.replace(concatenatedPunktRegex, (match, stem: string, trailing: string, offset: number) => {
    const stemLower = stem.toLowerCase();

    // Überspringe legitime Zusammensetzungen mit "punkt"
    if (legitimatePunktWords.has(stemLower)) return match;

    const hasTrailingPeriod = trailing.includes('.');

    // Regel 1: Automatischer Punkt folgt → hohe Sicherheit, immer trennen
    if (hasTrailingPeriod) {
      const replacement = stem + '. ';
      operations.push({
        originalText: match.trim(),
        replacementText: replacement.trim(),
        dictionaryWrong: stem + 'punkt',
        dictionaryCorrect: stem + '.',
        source: 'standard',
        matchType: 'exact',
      });
      return replacement;
    }

    // Regel 2: Wortstamm ist im Wörterbuch bekannt → trennen
    if (knownCorrectWords && knownCorrectWords.has(stemLower)) {
      const replacement = stem + '. ';
      operations.push({
        originalText: match.trim(),
        replacementText: replacement.trim(),
        dictionaryWrong: stem + 'punkt',
        dictionaryCorrect: stem + '.',
        source: 'standard',
        matchType: 'exact',
      });
      return replacement;
    }

    // Kein Match → unverändert lassen
    return match;
  });

  if (operations.length > 0) {
    console.log(`[PunktConcat] Fixed ${operations.length} concatenated "punkt" word(s):`,
      operations.map(o => `"${o.dictionaryWrong}"→"${o.dictionaryCorrect}"`).join(', '));
  }

  return { text: result, operations };
}

/**
 * Combined preprocessing: apply formatting + remove fillers + dictionary corrections
 * Use this before sending to LLM
 * 
 * @param text - Raw transcription text
 * @param dictionaryEntries - Optional dictionary entries for user-specific corrections
 */
export function preprocessTranscription(text: string, dictionaryEntries?: DictionaryEntry[], standardEntries?: { wrong: string; correct: string; phoneticMinSimilarity?: number }[]): string {
  return preprocessTranscriptionDetailed(text, dictionaryEntries, standardEntries).text;
}

export function preprocessTranscriptionDetailed(
  text: string,
  dictionaryEntries?: DictionaryEntry[],
  standardEntries?: { wrong: string; correct: string; phoneticMinSimilarity?: number }[],
  options?: PreprocessTranscriptionOptions
): PreprocessTranscriptionResult {
  if (!text) return { text, operations: [] };
  
  let result = text;
  const operations: DictionaryCorrectionOperation[] = [];
  
  // Step 1: Remove filler words
  result = removeFillerWords(result);
  
  // Step 2: Apply formatting control words (logs automatically if any found)
  result = applyFormattingControlWords(result);
  
  // Step 2b: Fix concatenated "punkt" words (z.B. "stehenpunkt." → "stehen. ")
  // Läuft NACH den control words (die standalone "Punkt" behandeln) und VOR
  // den dictionary corrections (die den abgetrennten Stamm phonetisch korrigieren).
  const hasDictionaryEntries = (dictionaryEntries?.length ?? 0) > 0;
  const hasStandardEntries = (standardEntries?.length ?? 0) > 0;
  if (hasDictionaryEntries || hasStandardEntries) {
    const allCorrectWords = new Set<string>();
    for (const e of (dictionaryEntries ?? [])) {
      allCorrectWords.add(e.correct.toLowerCase());
    }
    for (const e of (standardEntries ?? [])) {
      allCorrectWords.add(e.correct.toLowerCase());
    }
    const punktResult = fixConcatenatedPunkt(result, allCorrectWords);
    result = punktResult.text;
    operations.push(...punktResult.operations);
  } else {
    // Auch ohne Wörterbuch: Regel 1 (automatischer Punkt danach) greift trotzdem
    const punktResult = fixConcatenatedPunkt(result);
    result = punktResult.text;
    operations.push(...punktResult.operations);
  }
  
  // Step 3: Apply dictionary corrections (if entries provided, logs automatically if any applied)
  if (hasDictionaryEntries || hasStandardEntries) {
    const dictionaryResult = applyDictionaryCorrectionsDetailed(result, dictionaryEntries ?? [], standardEntries, options);
    result = dictionaryResult.text;
    operations.push(...dictionaryResult.operations);
  }
  
  // Step 4: Deterministic medical abbreviation conversion, only in Medical mode.
  const abbreviationResult = applyMedicalAbbreviationsIfEnabled(result, options?.dictionarySet ?? 'medical');
  result = abbreviationResult.text;
  operations.push(...abbreviationResult.operations);
  
  return { text: result, operations };
}

/**
 * Remove Markdown formatting from text.
 * Used to clean up LLM output that may contain unwanted formatting.
 * 
 * Removes:
 * - Bold: **text** or __text__
 * - Italic: *text* or _text_
 * - Headers: # ## ### etc.
 * - Code: `code` or ```code```
 * - Strikethrough: ~~text~~
 * - Links: [text](url)
 * 
 * @param text - Text potentially containing Markdown formatting
 * @returns Clean text without Markdown formatting
 */
export function removeMarkdownFormatting(text: string): string {
  if (!text) return '';
  
  // Ensure text is a string
  let result = typeof text === 'string' ? text : String(text);
  
  // Remove bold: **text** or __text__
  result = result.replace(/\*\*([^*]+)\*\*/g, '$1');
  result = result.replace(/__([^_]+)__/g, '$1');
  
  // Remove italic: *text* or _text_ (be careful not to affect underscores in words)
  // Only match single asterisks not preceded/followed by another asterisk
  result = result.replace(/(?<!\*)\*(?!\*)([^*]+)(?<!\*)\*(?!\*)/g, '$1');
  // Only match underscores at word boundaries
  result = result.replace(/(?<=\s|^)_([^_]+)_(?=\s|$|[.,;:!?])/g, '$1');
  
  // Remove strikethrough: ~~text~~
  result = result.replace(/~~([^~]+)~~/g, '$1');
  
  // Remove inline code: `code`
  result = result.replace(/`([^`]+)`/g, '$1');
  
  // Remove code blocks: ```code```
  result = result.replace(/```[\s\S]*?```/g, (match) => {
    // Extract the code content without the backticks
    return match.replace(/^```\w*\n?/, '').replace(/\n?```$/, '');
  });
  
  // Remove headers: # ## ### #### ##### ###### at start of lines
  result = result.replace(/^#{1,6}\s+/gm, '');
  
  // Remove links but keep text: [text](url) → text
  result = result.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
  
  // Remove reference links: [text][ref] → text
  result = result.replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1');
  
  // Remove images: ![alt](url) → (remove completely or keep alt)
  result = result.replace(/!\[([^\]]*)\]\([^)]+\)/g, '');
  
  // Clean up multiple spaces that may have been created
  result = result.replace(/  +/g, ' ');
  
  // Clean up multiple newlines
  result = result.replace(/\n{3,}/g, '\n\n');
  
  return result.trim();
}
