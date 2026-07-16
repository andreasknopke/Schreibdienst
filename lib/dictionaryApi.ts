/**
 * Gemeinsame API-Funktionen für Wörterbuch-Operationen.
 * Von allen Komponenten genutzt (DictionaryManager, ManualCorrectionSuggestion, WordActionPopup).
 */

export interface AddDictionaryEntryParams {
  wrong: string;
  correct: string;
  /** Zielbenutzer (für Sekretariat/Admin) */
  username?: string;
  /** Eintrag auch in allen Benutzergruppen speichern */
  addToGroup?: boolean;
  /** Im Prompt verwenden */
  useInPrompt?: boolean;
  /** Wortstamm-Matching aktivieren */
  matchStem?: boolean;
}

export interface AddDictionaryEntryResult {
  success: boolean;
  message?: string;
  warning?: string;
  error?: string;
}

/**
 * Eintrag zum Wörterbuch hinzufügen (POST /api/dictionary).
 * Einheitliche Funktion für alle Komponenten.
 */
export async function addDictionaryEntry(
  params: AddDictionaryEntryParams,
  authHeaders: Record<string, string>,
): Promise<AddDictionaryEntryResult> {
  const response = await fetch('/api/dictionary', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    body: JSON.stringify({
      wrong: params.wrong,
      correct: params.correct,
      username: params.username,
      addToGroup: params.addToGroup ?? false,
      useInPrompt: params.useInPrompt ?? false,
      matchStem: params.matchStem ?? false,
    }),
  });

  const data = await response.json();

  if (!response.ok || !data.success) {
    return { success: false, error: data.error || 'Fehler beim Speichern im Wörterbuch' };
  }

  return { success: true, message: data.message, warning: data.warning };
}
