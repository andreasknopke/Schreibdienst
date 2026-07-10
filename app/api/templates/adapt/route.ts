import { NextRequest, NextResponse } from 'next/server';
import { getRuntimeConfigWithRequest } from '@/lib/configDb';
import { addLlmPromptLog, updateLlmPromptLog } from '@/lib/llmPromptLog';
import { TEMPLATE_ADAPT_BASE } from '@/prompts/templates/adapt-base';
import { CONTRADICTION_GENAU } from '@/prompts/templates/contradiction-genau';
import { CONTRADICTION_EINFACH } from '@/prompts/templates/contradiction-einfach';
import { CONTRADICTION_OPTIONEN } from '@/prompts/templates/contradiction-optionen';
import { TEMPLATE_NIEMALS } from '@/prompts/templates/template-niemals';
import { getEffectivePrompt } from '@/lib/promptOverrides';
import { remapRichTextRangesByContent, normalizeRichTextRanges, type RichTextFormatRange } from '@/lib/richTextFormatting';

export const runtime = 'nodejs';

type LLMProvider = 'openai' | 'lmstudio' | 'mistral';

function hasUsableApiKey(value: string | undefined): value is string {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized !== '' && normalized !== 'not set' && normalized !== '(not set)' && normalized !== 'undefined' && normalized !== 'null';
}

async function getLLMConfig(req: NextRequest): Promise<{ provider: LLMProvider; baseUrl: string; apiKey: string; model: string }> {
  const runtimeConfig = await getRuntimeConfigWithRequest(req);

  if (runtimeConfig.llmProvider === 'lmstudio') {
    const model = runtimeConfig.lmStudioModelOverride || process.env.LLM_STUDIO_MODEL || 'meta-llama-3.1-8b-instruct';
    console.log(`[Template] Using LM Studio for template adaptation, model: ${model}`);
    return {
      provider: 'lmstudio',
      baseUrl: process.env.LLM_STUDIO_URL || 'http://localhost:1234',
      apiKey: 'lm-studio',
      model,
    };
  }

  if (runtimeConfig.llmProvider === 'mistral') {
    const model = runtimeConfig.mistralModel || process.env.MISTRAL_MODEL || 'mistral-large-latest';
    console.log(`[Template] Using Mistral for template adaptation, model: ${model}`);
    return {
      provider: 'mistral',
      baseUrl: 'https://api.mistral.ai',
      apiKey: process.env.MISTRAL_API_KEY || '',
      model,
    };
  }

  const model = process.env.TEMPLATE_OPENAI_MODEL || runtimeConfig.openaiModel || process.env.OPENAI_MODEL || 'gpt-4o';
  console.log(`[Template] Using OpenAI for template adaptation, model: ${model}`);

  return {
    provider: 'openai',
    baseUrl: 'https://api.openai.com',
    apiKey: process.env.OPENAI_API_KEY || '',
    model,
  };
}

interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface LLMCallOptions {
  temperature?: number;
  maxTokens?: number;
}

interface LLMConfig {
  provider: LLMProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
}

async function callLLM(
  config: LLMConfig,
  messages: LLMMessage[],
  options: LLMCallOptions = {},
  meta?: { endpoint: string; username?: string },
): Promise<{ content: string; tokens?: { input: number; output: number } }> {
  const { temperature = 0.3, maxTokens = 2000 } = options;

  // Prompt-Log erfassen (für Admin-Konsole)
  const systemPrompt = messages.find((m) => m.role === 'system')?.content || '';
  const userMessage = messages.find((m) => m.role === 'user')?.content || '';
  const logId = addLlmPromptLog(
    meta?.endpoint || 'templates-adapt',
    meta?.username || 'unknown',
    config.provider,
    config.model,
    systemPrompt,
    userMessage,
  );
  
  try {
    if (config.provider === 'openai' && !hasUsableApiKey(config.apiKey)) {
      throw new Error('OPENAI_API_KEY not configured');
    }

    if (config.provider === 'mistral' && !hasUsableApiKey(config.apiKey)) {
      throw new Error('MISTRAL_API_KEY not configured');
    }

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (config.provider === 'openai' || config.provider === 'mistral') {
      headers.Authorization = `Bearer ${config.apiKey}`;
    }

    const body: Record<string, unknown> = {
      model: config.model,
      messages,
      temperature,
    };

    if (config.provider === 'lmstudio') {
      body.max_tokens = maxTokens;
    }

    const startTime = Date.now();
    const endpoint = `${config.baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });

    const elapsed = Date.now() - startTime;

    if (!response.ok) {
      const error = await response.text();
      updateLlmPromptLog(logId, '', elapsed, 'error', `LLM API error: ${response.status} - ${error}`);
      throw new Error(`LLM API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content || '';
    
    updateLlmPromptLog(logId, content, elapsed, 'success');
    
    return {
      content,
      tokens: data.usage ? {
        input: data.usage.prompt_tokens,
        output: data.usage.completion_tokens
      } : undefined
    };
  } catch (error) {
    console.error('[Template Adapt] LLM call error:', error);
    throw error;
  }
}

// Prompt definitions moved to prompts/templates/

function tryParseTemplateAdaptJson(raw: string): { adaptedText: string; unusedText: string } | null {
  const trimmed = raw.trim();
  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

  const candidates = [trimmed, withoutFence];
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed.adaptedText === 'string') {
        return {
          adaptedText: parsed.adaptedText,
          unusedText: typeof parsed.unusedText === 'string' ? parsed.unusedText : '',
        };
      }
    } catch {
      // continue
    }
  }

  const jsonStart = withoutFence.indexOf('{');
  const jsonEnd = withoutFence.lastIndexOf('}');
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    try {
      const parsed = JSON.parse(withoutFence.slice(jsonStart, jsonEnd + 1));
      if (parsed && typeof parsed.adaptedText === 'string') {
        return {
          adaptedText: parsed.adaptedText,
          unusedText: typeof parsed.unusedText === 'string' ? parsed.unusedText : '',
        };
      }
    } catch {
      // continue
    }
  }

  return null;
}

// Entfernt Markdown-Auszeichnungen aus dem LLM-Ergebnis, die im Original-Baustein
// nicht vorkamen. So bleibt das Layout des Bausteins erhalten, falls das Modell
// eigenmächtig **fett**, *kursiv* oder #-Überschriften hinzufügt.
function stripIntroducedMarkdown(original: string, adapted: string): string {
  let result = adapted;

  // Fett (**text**) immer entfernen – die Formatierung wird über formatRanges
  // + Lexical-Rendering gesteuert. Das LLM verschiebt ** oft an falsche Stellen
  // (z.B. **text****text**:), sodass die konditionale Prüfung nicht ausreicht.
  result = result.replace(/\*\*(.*?)\*\*/g, '$1');
  result = result.replace(/__(.*?)__/g, '$1');

  // Kursiv (*text* / _text_) immer entfernen
  result = result.replace(/\*([^*\n]+)\*/g, '$1');
  result = result.replace(/_([^_\n]+)_/g, '$1');

  // Markdown-Überschriften (# ...) am Zeilenanfang entfernen
  result = result.replace(/^#{1,6}\s+/gm, '');

  return result;
}

// Entfernt geschweifte Klammern {…} aus dem LLM-Ergebnis.
// Die {…} sind reine Steuer-Marker fuer die Wiederholungslogik und gehoeren
// nicht in den Endtext.
function stripCurlyBraces(text: string): string {
  return text.replace(/\{([^}]*)\}/g, '$1');
}

/**
 * Nach dem Standard-Remap: Findet Format-Ranges fuer duplizierte Absaetze.
 *
 * Das Standard-remapRichTextRanges bildet Format-Ranges 1:1 von Original auf
 * Zieltext ab – wenn das LLM aber einen Absatz dupliziert hat (z. B. weil
 * ein {-Marker wiederholt wurde), bekommt die Kopie keine Format-Ranges.
 *
 * Diese Funktion sucht nach unformatierten Textabschnitten und kopiert
 * Format-Ranges aus inhaltlich passenden Quellen.
 */
function applyFormatRangesToDuplications(
  originalText: string,
  adaptedText: string,
  inputRanges: RichTextFormatRange[],
  remappedRanges: RichTextFormatRange[],
): RichTextFormatRange[] {
  const result = [...remappedRanges];
  if (inputRanges.length === 0) return result;

  const maxEnd = Math.max(0, ...result.map(r => r.end));
  if (maxEnd >= adaptedText.length) return result; // keine Duplikation erkannt

  // Fuer jede originale Range: suche den Segmenttext im Bereich NACH maxEnd
  const seen = new Set<string>();
  for (const input of inputRanges) {
    const segment = originalText.slice(input.start, input.end);
    if (!segment || segment.length < 3) continue;
    const key = `${segment}|${input.bold}|${input.italic}|${input.underline}`;
    if (seen.has(key)) continue;
    seen.add(key);

    // Alle Vorkommen in adaptedText nach maxEnd finden
    let searchPos = maxEnd;
    while (searchPos < adaptedText.length) {
      const foundAt = adaptedText.indexOf(segment, searchPos);
      if (foundAt === -1 || foundAt > adaptedText.length) break;
      result.push({
        start: foundAt,
        end: foundAt + segment.length,
        bold: input.bold,
        italic: input.italic,
        underline: input.underline,
      });
      searchPos = foundAt + segment.length;
    }
  }

  return normalizeRichTextRanges(result, adaptedText.length);
}

export async function POST(req: NextRequest) {
  console.log('\n=== Template Adapt Request ===');
  const startTime = Date.now();
  
  try {
    const body = await req.json();
    const { template, changes, field, username, contradictionMode, formatRanges } = body;
    
    if (!template || !changes) {
      return NextResponse.json({ error: 'Template und Änderungen erforderlich' }, { status: 400 });
    }
    
    console.log(`[Template] Field: ${field || 'befund'}, Username: ${username || 'unknown'}`);
    console.log(`[Template] Template length: ${template.length} chars`);
    console.log(`[Template] FormatRanges: ${(formatRanges ?? []).length} ranges`);
    console.log(`[Template] Changes: "${changes}"`);
    console.log(`[Template] contradictionMode: ${contradictionMode || 'genau'}`);
    
    // Get LLM config
    const llmConfig = await getLLMConfig(req);
    console.log(`[Template] Using provider: ${llmConfig.provider}, model: ${llmConfig.model}`);
    
    // System-Prompt aus den konfigurierten Modulen zusammensetzen
    let contradictionSection: string;
    let systemPrompt: string;
    let isOptionenMode = false;

    const effectiveAdaptBase = (await getEffectivePrompt(req, 'templates/adapt-base', TEMPLATE_ADAPT_BASE)).text;
    const effectiveNiemals = (await getEffectivePrompt(req, 'templates/template-niemals', TEMPLATE_NIEMALS)).text;
    const effectiveOptionen = (await getEffectivePrompt(req, 'templates/contradiction-optionen', CONTRADICTION_OPTIONEN)).text;
    const effectiveEinfach = (await getEffectivePrompt(req, 'templates/contradiction-einfach', CONTRADICTION_EINFACH)).text;
    const effectiveGenau = (await getEffectivePrompt(req, 'templates/contradiction-genau', CONTRADICTION_GENAU)).text;

    if (contradictionMode === 'optionen') {
      isOptionenMode = true;
      contradictionSection = effectiveOptionen;
      systemPrompt = `${effectiveAdaptBase}${contradictionSection}

AUSGABEFORMAT:
- Gib AUSSCHLIESSLICH JSON im folgenden Format zurück:
  {"adaptedText":"...","unusedText":"..."}
- adaptedText enthält den vollständigen angepassten Textbaustein
- unusedText enthält nur die diktierten Textteile, die inhaltlich NICHT sinnvoll in den Baustein eingebaut werden konnten
- Wenn alles sinnvoll eingebaut wurde, setze unusedText auf einen leeren String
- KEINE Einleitungen wie "Der angepasste Text lautet:"
- KEINE Erklärungen oder Kommentare
- KEINE Markdown-Codeblöcke oder zusätzlichen Markierungen`;
    } else {
      contradictionSection = contradictionMode === 'aus' ? '' : contradictionMode === 'einfach' ? effectiveEinfach : effectiveGenau;
      systemPrompt = `${effectiveAdaptBase}${contradictionSection}${effectiveNiemals}`;
    }
    
    // Markdown-Marker aus dem Template entfernen, damit das LLM sie nicht
    // versehentlich verschiebt oder dupliziert. Die Formatierung wird über
    // formatRanges + Lexical gesteuert, nicht über ** im Text.
    const cleanedTemplate = template.replace(/\*\*/g, '');

    let userMessage: string;
    if (isOptionenMode) {
      userMessage = `TEXTBAUSTEIN MIT OPTIONEN (wähle aus den [Optionen] basierend auf den Änderungen):
${cleanedTemplate}

DIKTIERTE ÄNDERUNGEN (ordne diese den [Optionen] im Textbaustein zu):
${changes}

WICHTIG: {…} am Absatzanfang sind Wiederholungs-Marker, KEINE Optionen.
Absätze mit {…} können mehrfach vorkommen, Absätze ohne {…} nicht.

Gib den vollständigen angepassten Text zurück:`;
    } else {
      userMessage = `VOLLSTÄNDIGER TEXTBAUSTEIN (behalte die Struktur bei):
${cleanedTemplate}

DIKTIERTE ÄNDERUNGEN (füge diese an der semantisch passenden Stelle ein, NICHT mitten in einen Satz):
${changes}

WICHTIG: {…} am Absatzanfang sind Wiederholungs-Marker, KEINE Optionen.
Absätze mit {…} können mehrfach vorkommen, Absätze ohne {…} nicht.

Gib den vollständigen angepassten Text zurück:`;
    }

    // Detailliertes Logging des gesamten Prompts
    console.log('\n--- SYSTEM PROMPT ---');
    console.log(systemPrompt);
    console.log('\n--- USER MESSAGE ---');
    console.log(userMessage);
    console.log('\n--- END PROMPT ---\n');

    const result = await callLLM(llmConfig, 
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      { temperature: 0.2, maxTokens: 4000 },
      { endpoint: 'templates-adapt', username }
    );
    
    const parsedResult = tryParseTemplateAdaptJson(result.content || '');
    let adaptedText = parsedResult?.adaptedText || result.content || template;
    let unusedText = parsedResult?.unusedText || '';
    
    // Clean up common LLM artifacts
    adaptedText = adaptedText
      .replace(/^["']|["']$/g, '')  // Remove surrounding quotes
      .replace(/^Der angepasste Text lautet:?\s*/i, '')
      .replace(/^Hier ist der angepasste Text:?\s*/i, '')
      .replace(/^Ergebnis:?\s*/i, '')
      .trim();

    // Layout-Schutz: Markdown-Auszeichnungen, die das Original NICHT enthielt,
    // wieder entfernen, damit das ursprüngliche Layout des Bausteins erhalten bleibt
    // (z. B. "**Teil 1**" -> "Teil 1").
    adaptedText = stripIntroducedMarkdown(template, adaptedText);
    adaptedText = stripCurlyBraces(adaptedText);
    unusedText = unusedText.trim();
    
    // Format-Ranges fuer den adaptierten Text berechnen
    const inputFormats = (formatRanges as RichTextFormatRange[] | undefined) ?? [];
    let adaptedFormats: RichTextFormatRange[] = [];
    if (inputFormats.length > 0) {
      // Schritt 1: Inhalts-basiertes Remap – sucht formatierte Segmente im
      // LLM-Output anhand ihres Textinhalts. Erhält Formatierung auch bei
      // Umstellungen, Einschüben oder Duplikationen durch das LLM.
      let remapped = remapRichTextRangesByContent(template, adaptedText, inputFormats);
      // Schritt 2: Duplikations-Erkennung – kopiert Ranges auf wiederholte Absätze
      remapped = applyFormatRangesToDuplications(template, adaptedText, inputFormats, remapped);
      adaptedFormats = remapped;
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const tokens = result.tokens ? `${result.tokens.input}/${result.tokens.output}` : 'unknown';
    console.log(`[Template] Success - Duration: ${duration}s, Tokens: ${tokens}`);
    console.log(`[Template] Adapted formats: ${adaptedFormats.length} ranges`);
    console.log('\n--- LLM OUTPUT ---');
    console.log(adaptedText);
    console.log('--- END OUTPUT ---\n');
    console.log('=== Template Adapt Complete ===\n');
    
    return NextResponse.json({ 
      success: true, 
      adaptedText,
      unusedText,
      formatRanges: adaptedFormats,
      field: field || 'befund'
    });
    
  } catch (error: any) {
    console.error('[Template] Error:', error.message);
    console.log('=== Template Adapt Failed ===\n');
    return NextResponse.json({ 
      error: 'Template-Anpassung fehlgeschlagen', 
      details: error.message 
    }, { status: 500 });
  }
}
