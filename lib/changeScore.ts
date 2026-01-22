/**
 * Berechnet den Änderungsscore zwischen Original- und korrigiertem Text.
 * 
 * Score-Interpretation (Ampelsystem):
 * - 0-15%: Grün - Minimale Änderungen (Tippfehler, Satzzeichen)
 * - 16-35%: Gelb - Moderate Änderungen (grammatikalische Korrekturen)
 * - 36-100%: Rot - Signifikante Änderungen (größere Umformulierungen)
 */

// Levenshtein-Distanz berechnen (optimiert für längere Texte)
function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length;
  const len2 = str2.length;
  
  // Für sehr lange Texte: Sampling verwenden
  const maxLen = 5000;
  let s1 = str1;
  let s2 = str2;
  
  if (len1 > maxLen || len2 > maxLen) {
    // Sample: Anfang, Mitte, Ende
    const sampleSize = Math.floor(maxLen / 3);
    s1 = str1.substring(0, sampleSize) + 
         str1.substring(Math.floor(len1/2) - sampleSize/2, Math.floor(len1/2) + sampleSize/2) +
         str1.substring(len1 - sampleSize);
    s2 = str2.substring(0, sampleSize) + 
         str2.substring(Math.floor(len2/2) - sampleSize/2, Math.floor(len2/2) + sampleSize/2) +
         str2.substring(len2 - sampleSize);
  }
  
  const m = s1.length;
  const n = s2.length;
  
  // Optimierung: Nur 2 Zeilen statt volle Matrix
  let prev = new Array(n + 1);
  let curr = new Array(n + 1);
  
  for (let j = 0; j <= n; j++) {
    prev[j] = j;
  }
  
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        curr[j] = prev[j - 1];
      } else {
        curr[j] = 1 + Math.min(prev[j - 1], prev[j], curr[j - 1]);
      }
    }
    [prev, curr] = [curr, prev];
  }
  
  return prev[n];
}

/**
 * Berechnet den Änderungsprozentsatz zwischen Original und korrigiertem Text.
 * @returns Prozent der Änderung (0-100)
 */
export function calculateChangeScore(original: string, corrected: string): number {
  if (!original || !corrected) return 0;
  
  // Ensure both parameters are strings
  const originalStr = typeof original === 'string' ? original : String(original || '');
  const correctedStr = typeof corrected === 'string' ? corrected : String(corrected || '');
  
  // Normalisiere Texte (entferne überschüssige Whitespaces)
  const normalizedOriginal = originalStr.trim().replace(/\s+/g, ' ');
  const normalizedCorrected = correctedStr.trim().replace(/\s+/g, ' ');
  
  if (normalizedOriginal === normalizedCorrected) return 0;
  if (normalizedOriginal.length === 0) return 100;
  
  const distance = levenshteinDistance(normalizedOriginal, normalizedCorrected);
  const maxLen = Math.max(normalizedOriginal.length, normalizedCorrected.length);
  
  // Prozentsatz der geänderten Zeichen
  const changePercent = Math.round((distance / maxLen) * 100);
  
  return Math.min(100, changePercent);
}

/**
 * Gibt die Ampelfarbe basierend auf dem Änderungsscore zurück.
 */
export function getChangeLevel(score: number): 'green' | 'yellow' | 'red' {
  if (score <= 15) return 'green';
  if (score <= 35) return 'yellow';
  return 'red';
}

/**
 * Gibt eine beschreibende Bezeichnung für den Änderungsgrad zurück.
 */
export function getChangeDescription(score: number): string {
  if (score <= 5) return 'Kaum Änderungen';
  if (score <= 15) return 'Minimale Korrekturen';
  if (score <= 25) return 'Leichte Anpassungen';
  if (score <= 35) return 'Moderate Korrekturen';
  if (score <= 50) return 'Deutliche Änderungen';
  if (score <= 70) return 'Starke Überarbeitung';
  return 'Umfangreiche Änderungen';
}
