/**
 * LLM-Prompt-Logging (In-Memory Ring Buffer)
 *
 * Speichert die exakten Prompts, die an LLMs gesendet werden,
 * zur Ansicht in der Admin-Konsole. Läuft server-seitig im
 * Next.js-Prozess und hält maximal MAX_ENTRIES Einträge.
 */

export interface LlmPromptLogEntry {
  id: number;
  timestamp: string;
  endpoint: string;
  username: string;
  provider: string;
  model: string;
  systemPrompt: string;
  userMessage: string;
  responsePreview: string;
  durationMs: number;
  status: 'pending' | 'success' | 'error';
  errorMessage?: string;
}

const MAX_ENTRIES = 100;
const entries: LlmPromptLogEntry[] = [];
let idCounter = 0;

/**
 * Einen neuen Prompt-Log-Eintrag erfassen (vor dem LLM-Call).
 * Gibt die `id` zurück, mit der später `updateLlmPromptLog` aufgerufen werden kann.
 */
export function addLlmPromptLog(
  endpoint: string,
  username: string,
  provider: string,
  model: string,
  systemPrompt: string,
  userMessage: string,
): number {
  const id = ++idCounter;
  entries.unshift({
    id,
    timestamp: new Date().toISOString(),
    endpoint,
    username: username || 'unknown',
    provider,
    model,
    systemPrompt,
    userMessage,
    responsePreview: '',
    durationMs: 0,
    status: 'pending',
  });
  if (entries.length > MAX_ENTRIES) entries.pop();
  return id;
}

/**
 * Einen vorhandenen Eintrag nach dem LLM-Call aktualisieren.
 */
export function updateLlmPromptLog(
  id: number,
  response: string,
  durationMs: number,
  status: 'success' | 'error',
  errorMessage?: string,
): void {
  const entry = entries.find((e) => e.id === id);
  if (!entry) return;
  entry.responsePreview = response ? response.substring(0, 2000) : '';
  entry.durationMs = durationMs;
  entry.status = status;
  if (errorMessage) entry.errorMessage = errorMessage;
}

/**
 * Alle aktuellen Einträge abrufen (neueste zuerst).
 */
export function getLlmPromptLogs(): LlmPromptLogEntry[] {
  return entries;
}

/**
 * Alle Einträge löschen.
 */
export function clearLlmPromptLogs(): void {
  entries.length = 0;
}
