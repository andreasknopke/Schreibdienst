import { NextRequest, NextResponse } from 'next/server';
import { getRuntimeConfigWithRequest } from '@/lib/configDb';
import { addLlmPromptLog, updateLlmPromptLog } from '@/lib/llmPromptLog';

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

const TEMPLATE_ADAPT_BASE = `Du bist ein medizinischer Befund-Assistent. Deine Aufgabe ist es, einen Textbaustein basierend auf diktierten Änderungen/Ergänzungen anzupassen.

EINGABE:
1. Ein VOLLSTÄNDIGER medizinischer Textbaustein (Vorlage) - dieser Text ist bereits strukturiert und formatiert
2. Diktierte Änderungen/Ergänzungen vom Arzt

DEINE AUFGABE - INTELLIGENTE INTEGRATION:
1. Analysiere den Textbaustein und verstehe seine Struktur und den inhaltlichen Aufbau
2. Identifiziere, WO die diktierten Änderungen inhaltlich hingehören
3. Füge die Änderungen an der SEMANTISCH PASSENDEN Stelle ein`;

const CONTRADICTION_GENAU = `
4. PRÜFE AUF WIDERSPRÜCHE: Wenn die Änderung einer bestehenden Aussage WIDERSPRICHT, muss die widersprüchliche Aussage ENTFERNT oder ERSETZT werden
5. Behalte nur die Teile des Textbausteins bei, die mit den Änderungen VEREINBAR sind

WIDERSPRÜCHE ERKENNEN UND BEHEBEN:
- Wenn eine pathologische Änderung eine "unauffällig/normal"-Aussage widerspricht, ERSETZE diese
- Beispiel: "Hydrocephalus" widerspricht "normalweite Liquorräume" → Entferne "normalweite Liquorräume"
- Beispiel: "Hepatomegalie" widerspricht "Leber normal groß" → Ersetze durch die pathologische Angabe
- Beispiel: "Harnstau Grad II rechts" widerspricht "keine Harnstauung" → Passe an

WICHTIGE REGELN:
- Wenn "sonst keine Änderungen" gesagt wird, behalte alle NICHT-WIDERSPRÜCHLICHEN Teile bei
- Prüfe JEDEN Teil des Textbausteins auf Konsistenz mit den Änderungen
- Behalte die Formatierung (Absätze, Zeilenumbrüche) des Originals bei
- Behalte den professionellen medizinischen Schreibstil bei
- Die Ausgabe muss ein vollständiger, medizinisch KONSISTENTER Befundtext sein`;

const CONTRADICTION_EINFACH = `
4. PRÜFE AUF WIDERSPRÜCHE: Wenn eine Änderung einer bestehenden Aussage widerspricht, ENTFERNE oder ERSETZE die widersprüchliche Aussage
5. Behalte nur die mit den Änderungen VEREINBAREN Teile bei

WIDERSPRÜCHE:
- Pathologische Angabe widerspricht Normal-Aussage → Normal-Aussage ersetzen
- Beispiel: "Hydrocephalus" widerspricht "normalweite Liquorräume" → entferne "normalweite Liquorräume"`;

const CONTRADICTION_OPTIONEN = `
Der Textbaustein enthält Wahlmöglichkeiten in Klammern, z. B. "[Option A/Option B]".

DEINE AUFGABE:
- Wähle aus den Optionen in [Klammern] diejenige aus, die der diktierten Änderung am nächsten kommt
- Ersetze die gesamte Klammer inklusive Inhalt durch die gewählte Option
- Stimmt KEINE der Optionen mit der diktierten Änderung überein, lasse die Klammer unverändert
- Widerspruchsprüfung ist in diesem Modus NICKT nötig – die Optionen definieren die
  gültigen Alternativen bereits

UNUSED-TEXT (SEHR WICHTIG):
- Diktierte Änderungen, die in KEINE der vorhandenen Optionen passen, MÜSSEN im unusedText
  landen. Sie dürfen NICHT eigenmächtig als Freitext in den Baustein eingefügt werden.
- Nur wenn eine Änderung eindeutig einer Option zugeordnet werden kann, wird sie eingebaut.
- Bei Unsicherheit: lieber in unusedText als eine falsche Option zu wählen.`;

const TEMPLATE_NIEMALS = `
KRITISCH - NIEMALS:
- Änderungen MITTEN in einen Satz einfügen und den Satz grammatisch zerstören
- Widersprüchliche Aussagen im Text belassen (z.B. "normalweite Liquorräume" UND "Hydrocephalus")
- Einen Satz aufspalten und die Änderung dazwischen setzen

AUSGABEFORMAT:
- Gib AUSSCHLIESSLICH JSON im folgenden Format zurück:
  {"adaptedText":"...","unusedText":"..."}
- adaptedText enthält den vollständigen angepassten Textbaustein
- unusedText enthält nur die diktierten Textteile, die inhaltlich NICHT sinnvoll in den Baustein eingebaut werden konnten
- Wenn alles sinnvoll eingebaut wurde, setze unusedText auf einen leeren String
- KEINE Einleitungen wie "Der angepasste Text lautet:"
- KEINE Erklärungen oder Kommentare
- KEINE Markdown-Codeblöcke oder zusätzlichen Markierungen`;

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

export async function POST(req: NextRequest) {
  console.log('\n=== Template Adapt Request ===');
  const startTime = Date.now();
  
  try {
    const body = await req.json();
    const { template, changes, field, username, contradictionMode } = body;
    
    if (!template || !changes) {
      return NextResponse.json({ error: 'Template und Änderungen erforderlich' }, { status: 400 });
    }
    
    console.log(`[Template] Field: ${field || 'befund'}, Username: ${username || 'unknown'}`);
    console.log(`[Template] Template length: ${template.length} chars`);
    console.log(`[Template] Changes: "${changes}"`);
    console.log(`[Template] contradictionMode: ${contradictionMode || 'genau'}`);
    
    // Get LLM config
    const llmConfig = await getLLMConfig(req);
    console.log(`[Template] Using provider: ${llmConfig.provider}, model: ${llmConfig.model}`);
    
    // System-Prompt aus den konfigurierten Modulen zusammensetzen
    let contradictionSection: string;
    let systemPrompt: string;
    let isOptionenMode = false;
    if (contradictionMode === 'optionen') {
      isOptionenMode = true;
      contradictionSection = CONTRADICTION_OPTIONEN;
      systemPrompt = `${TEMPLATE_ADAPT_BASE}${contradictionSection}

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
      contradictionSection = contradictionMode === 'aus' ? '' : contradictionMode === 'einfach' ? CONTRADICTION_EINFACH : CONTRADICTION_GENAU;
      systemPrompt = `${TEMPLATE_ADAPT_BASE}${contradictionSection}${TEMPLATE_NIEMALS}`;
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

Gib den vollständigen angepassten Text zurück:`;
    } else {
      userMessage = `VOLLSTÄNDIGER TEXTBAUSTEIN (behalte die Struktur bei):
${cleanedTemplate}

DIKTIERTE ÄNDERUNGEN (füge diese an der semantisch passenden Stelle ein, NICHT mitten in einen Satz):
${changes}

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
    unusedText = unusedText.trim();
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const tokens = result.tokens ? `${result.tokens.input}/${result.tokens.output}` : 'unknown';
    console.log(`[Template] Success - Duration: ${duration}s, Tokens: ${tokens}`);
    console.log('\n--- LLM OUTPUT ---');
    console.log(adaptedText);
    console.log('--- END OUTPUT ---\n');
    console.log('=== Template Adapt Complete ===\n');
    
    return NextResponse.json({ 
      success: true, 
      adaptedText,
      unusedText,
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
