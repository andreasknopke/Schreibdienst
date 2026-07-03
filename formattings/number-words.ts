/**
 * Mapping gesprochener Zahlwörter zu Ziffern.
 *
 * Verwendet für:
 * - Aufzählungsbefehle: "Punkt drei" → "\n3. "
 * - Ordinalzahlen: "drittens" → "\n3. "
 *
 * Änderungen an dieser Datei beeinflussen, welche Zahlwörter in
 * der Diktatverarbeitung erkannt werden.
 */

export const NUMBER_WORDS: Record<string, number> = {
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
