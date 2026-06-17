/**
 * Validierungsfunktion für Passwörter.
 * Nach dem parseBasicAuth-Fix in apiHelpers.ts werden alle druckbaren
 * Zeichen (inkl. Doppelpunkt, Klammern etc.) korrekt verarbeitet.
 *
 * Diese Datei bleibt als zentrale Anlaufstelle für zukünftige
 * Passwort-Validierungsregeln erhalten.
 */

/**
 * Prüft, ob ein Passwort unzulässige Zeichen enthält.
 * Aktuell sind alle druckbaren Zeichen erlaubt.
 * @returns null (immer OK)
 */
export function validatePasswordBlacklist(_password: string): string | null {
  return null;
}
