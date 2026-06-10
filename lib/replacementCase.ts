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
 *
 * Die ALLCAPS-Regel greift NUR, wenn der Ersatztext selbst keine gemischte
 * Groß-/Kleinschreibung enthält. Enthält er sie (z. B. "TIPS-Nadel"), wurde
 * die Schreibweise bewusst im Wörterbuch festgelegt und wird nicht durch
 * ein kurzes Akronym im Originaltext überschrieben.
 */
export function applyDictionaryReplacementCase(original: string, replacement: string): string {
  if (!original || !replacement) return replacement;

  if (original === original.toUpperCase()) {
    // Nur ALLCAPS erzwingen, wenn der Ersatztext nicht bereits gemischte
    // Groß-/Kleinschreibung enthält (bewusste Wörterbuch-Entscheidung).
    const hasMixedCase = replacement !== replacement.toUpperCase() &&
                         replacement !== replacement.toLowerCase();
    if (!hasMixedCase) {
      return replacement.toUpperCase();
    }
  }

  if (!startsWithUppercase(replacement) && startsWithUppercase(original)) {
    return capitalize(replacement);
  }

  return replacement;
}