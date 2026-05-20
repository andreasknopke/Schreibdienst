function startsWithUppercase(value: string): boolean {
  const firstChar = value.charAt(0);
  return firstChar.length > 0 && firstChar === firstChar.toUpperCase() && firstChar !== firstChar.toLowerCase();
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Wörterbuch-Schreibweise ist maßgeblich; nur ALLCAPS und Satzanfangs-
 * Großschreibung des Originals werden gespiegelt.
 */
export function applyDictionaryReplacementCase(original: string, replacement: string): string {
  if (!original || !replacement) return replacement;

  if (original === original.toUpperCase()) {
    return replacement.toUpperCase();
  }

  if (!startsWithUppercase(replacement) && startsWithUppercase(original)) {
    return capitalize(replacement);
  }

  return replacement;
}