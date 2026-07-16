/**
 * Prompt-Override-System: Erlaubt Admin-Bearbeitung von Prompt-Vorlagen zur Laufzeit.
 *
 * Overrides werden in der `config`-Tabelle (runtime_config) gespeichert.
 * Der config_key folgt dem Muster `prompt_override:<pfad>`.
 * Beim LLM-Call wird geprüft, ob ein Override existiert — wenn ja, wird er verwendet.
 */

import { NextRequest } from 'next/server';
import { getPoolForRequest } from '@/lib/db';

/** Metadaten einer Prompt-Vorlage */
export interface PromptTemplateMeta {
  /** Eindeutige ID (z. B. "correct/system-prompt") */
  id: string;
  /** Anzeigename in der UI */
  label: string;
  /** Gruppe (z. B. "Korrektur", "Textbausteine", "Worker") */
  group: string;
  /** Dateipfad relativ zu prompts/ (für Info-Zwecke) */
  file: string;
  /** Standard-Inhalt (aus der Datei) */
  defaultContent: string;
}

/** Alle bekannten Prompt-Vorlagen mit Default-Content */
const PROMPT_TEMPLATES: PromptTemplateMeta[] = [
  {
    id: 'correct/system-prompt',
    label: 'System-Prompt (Korrektur)',
    group: 'Korrektur',
    file: 'prompts/correct/system-prompt.ts',
    defaultContent: '',
  },
  {
    id: 'correct/chunk-system-prompt',
    label: 'Chunk-System-Prompt (LM Studio)',
    group: 'Korrektur',
    file: 'prompts/correct/chunk-system-prompt.ts',
    defaultContent: '',
  },
  {
    id: 'correct/befund-system-prompt',
    label: 'Befund-System-Prompt',
    group: 'Korrektur',
    file: 'prompts/correct/befund-system-prompt.ts',
    defaultContent: '',
  },
  {
    id: 'correct/beurteilung-suggest-prompt',
    label: 'Beurteilung-Suggest-Prompt',
    group: 'Korrektur',
    file: 'prompts/correct/beurteilung-suggest-prompt.ts',
    defaultContent: '',
  },
  {
    id: 'offline/recorrect-system-prompt',
    label: 'Offline-Nachkorrektur-Prompt',
    group: 'Offline',
    file: 'prompts/offline/recorrect-system-prompt.ts',
    defaultContent: '',
  },
  {
    id: 'templates/adapt-base',
    label: 'Textbaustein-Anpassung (Basis)',
    group: 'Textbausteine',
    file: 'prompts/templates/adapt-base.ts',
    defaultContent: '',
  },
  {
    id: 'templates/contradiction-genau',
    label: 'Widerspruchsprüfung (genau) — nicht mehr verwendet',
    group: 'Textbausteine',
    file: 'prompts/templates/contradiction-genau.ts',
    defaultContent: '',
  },
  {
    id: 'templates/contradiction-einfach',
    label: 'Widerspruchsprüfung (einfach) — nicht mehr verwendet',
    group: 'Textbausteine',
    file: 'prompts/templates/contradiction-einfach.ts',
    defaultContent: '',
  },
  {
    id: 'templates/contradiction-check',
    label: 'Widerspruchsprüfung (separater Check)',
    group: 'Textbausteine',
    file: 'prompts/templates/contradiction-check.ts',
    defaultContent: '',
  },
  {
    id: 'templates/contradiction-optionen',
    label: 'Widerspruchsprüfung (Optionen)',
    group: 'Textbausteine',
    file: 'prompts/templates/contradiction-optionen.ts',
    defaultContent: '',
  },
  {
    id: 'templates/template-niemals',
    label: 'Textbaustein-Verbotsregeln',
    group: 'Textbausteine',
    file: 'prompts/templates/template-niemals.ts',
    defaultContent: '',
  },
  {
    id: 'worker/dictation-processor-prompt',
    label: 'Worker-Diktatverarbeitung (Batch)',
    group: 'Worker',
    file: 'prompts/worker/dictation-processor-prompt.ts',
    defaultContent: '',
  },
  {
    id: 'worker/dictation-processor-chunk-prompt',
    label: 'Worker-Diktatverarbeitung (Chunk)',
    group: 'Worker',
    file: 'prompts/worker/dictation-processor-chunk-prompt.ts',
    defaultContent: '',
  },
];

export function getPromptTemplateList(): Omit<PromptTemplateMeta, 'defaultContent'>[] {
  return PROMPT_TEMPLATES.map(({ id, label, group, file }) => ({ id, label, group, file }));
}

/** Config-Key für User-spezifische customFormattings */
function customFormattingsKey(username: string): string {
  return `user_custom_formattings:${username.toLowerCase()}`;
}

/**
 * Lädt customFormattings für einen User aus der config-Tabelle.
 */
export async function getCustomFormattingsForUser(
  request: NextRequest,
  username: string
): Promise<Record<string, { commands?: string; replacement?: string }> | undefined> {
  try {
    const db = await getPoolForRequest(request);
    const [rows] = await db.execute<any[]>(
      'SELECT config_value FROM config WHERE config_key = ?',
      [customFormattingsKey(username)]
    );
    const value = (rows as any[])?.[0]?.config_value;
    if (value) {
      const parsed = typeof value === 'string' ? JSON.parse(value) : value;
      console.log(`[CustomFormattings] GELADEN fuer ${username}:`, JSON.stringify(parsed).substring(0, 500));
      if (parsed && typeof parsed === 'object') return parsed;
    } else {
      console.log(`[CustomFormattings] KEINE Eintraege fuer ${username} (config_key=${customFormattingsKey(username)})`);
    }
  } catch (e: any) {
    console.warn(`[CustomFormattings] Fehler beim Laden fuer ${username}:`, e?.message);
  }
  return undefined;
}

/**
 * Speichert customFormattings für einen User in der config-Tabelle.
 * Wenn `formattings` leer ist, wird der Eintrag gelöscht.
 */
export async function saveCustomFormattingsForUser(
  request: NextRequest,
  username: string,
  formattings: Record<string, { commands?: string; replacement?: string }>
): Promise<void> {
  const db = await getPoolForRequest(request);
  const key = customFormattingsKey(username);
  const content = JSON.stringify(formattings);
  console.log(`[CustomFormattings] SPEICHERN fuer ${username}:`, content.substring(0, 500));
  await db.execute(
    `INSERT INTO config (config_key, config_value) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE config_value = ?`,
    [key, content, content]
  );
}

/**
 * Liefert den effektiven Prompt für eine ID zurück:
 * - Default-Inhalt aus der Datei (einmalig geladen)
 * - Überschrieben durch DB-Override falls vorhanden
 */
export async function getEffectivePrompt(
  request: NextRequest,
  promptId: string,
  defaultPrompt: string
): Promise<{ text: string; isOverridden: boolean }> {
  try {
    const db = await getPoolForRequest(request);
    const [rows] = await db.execute<any[]>(
      'SELECT config_value FROM config WHERE config_key = ?',
      [`prompt_override:${promptId}`]
    );
    const override = (rows as any[])?.[0]?.config_value;
    if (override && typeof override === 'string' && override.trim()) {
      return { text: override, isOverridden: true };
    }
  } catch {
    // DB nicht verfügbar → Fallback auf Default
  }
  return { text: defaultPrompt, isOverridden: false };
}

/**
 * Lädt ALLE Prompt-Overrides aus der DB.
 * Wird vom API-Endpoint verwendet, um die aktuellen Overrides anzuzeigen.
 */
export async function getPromptOverridesFromDb(request: NextRequest): Promise<Record<string, string>> {
  const overrides: Record<string, string> = {};
  try {
    const db = await getPoolForRequest(request);
    const [rows] = await db.execute<any[]>(
      "SELECT config_key, config_value FROM config WHERE config_key LIKE 'prompt_override:%'"
    );
    for (const row of rows as { config_key: string; config_value: string }[]) {
      const id = row.config_key.replace('prompt_override:', '');
      overrides[id] = row.config_value;
    }
  } catch {
    // ignore
  }
  return overrides;
}

/**
 * Speichert einen Prompt-Override in der DB.
 * Löscht den Eintrag, wenn `content` leer ist (→ zurücksetzen auf Default).
 */
export async function savePromptOverride(
  request: NextRequest,
  promptId: string,
  content: string
): Promise<void> {
  const db = await getPoolForRequest(request);
  const key = `prompt_override:${promptId}`;
  if (content.trim()) {
    await db.execute(
      `INSERT INTO config (config_key, config_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE config_value = ?`,
      [key, content, content]
    );
  } else {
    await db.execute('DELETE FROM config WHERE config_key = ?', [key]);
  }
}
