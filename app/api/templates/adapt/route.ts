import { NextRequest, NextResponse } from 'next/server';
import { getRuntimeConfigWithRequest } from '@/lib/configDb';
import { loadDictionaryWithRequest, formatDictionaryForPrompt } from '@/lib/dictionaryDb';

export const runtime = 'nodejs';

// LLM Provider configuration
type LLMProvider = 'openai' | 'lmstudio';

async function getLLMConfig(req: NextRequest): Promise<{ provider: LLMProvider; baseUrl: string; apiKey: string; model: string }> {
  const runtimeConfig = await getRuntimeConfigWithRequest(req);
  const provider = runtimeConfig.llmProvider;
  
  if (provider === 'lmstudio') {
    return {
      provider: 'lmstudio',
      baseUrl: process.env.LLM_STUDIO_URL || 'http://localhost:1234',
      apiKey: 'lm-studio',
      model: process.env.LLM_STUDIO_MODEL || 'local-model'
    };
  }
  
  return {
    provider: 'openai',
    baseUrl: 'https://api.openai.com',
    apiKey: process.env.OPENAI_API_KEY || '',
    model: runtimeConfig.openaiModel || process.env.OPENAI_MODEL || 'gpt-4o-mini'
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
  options: LLMCallOptions = {}
): Promise<{ content: string; tokens?: { input: number; output: number } }> {
  const { temperature = 0.3, maxTokens = 2000 } = options;
  
  try {
    const endpoint = config.provider === 'lmstudio' 
      ? `${config.baseUrl}/v1/chat/completions`
      : 'https://api.openai.com/v1/chat/completions';
    
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`LLM API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    
    return {
      content: data.choices[0]?.message?.content || '',
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

const TEMPLATE_ADAPT_PROMPT = `Du bist ein medizinischer Befund-Assistent. Deine Aufgabe ist es, einen Textbaustein basierend auf diktierten Änderungen/Ergänzungen anzupassen.

EINGABE:
1. Ein VOLLSTÄNDIGER medizinischer Textbaustein (Vorlage) - dieser Text ist bereits strukturiert und formatiert
2. Diktierte Änderungen/Ergänzungen vom Arzt

DEINE AUFGABE - SEMANTISCH PASSENDE INTEGRATION:
1. Analysiere den Textbaustein und verstehe seine Struktur und den inhaltlichen Aufbau
2. Identifiziere, WO die diktierten Änderungen inhaltlich hingehören
3. Füge die Änderungen an der SEMANTISCH PASSENDEN Stelle ein, NICHT einfach am Anfang oder Ende
4. Wenn die Änderung sich auf einen bestimmten anatomischen Bereich oder Befund bezieht, füge sie dort ein
5. Behalte den Rest des Textbausteins UNVERÄNDERT bei

WICHTIGE REGELN:
- Wenn "sonst keine Änderungen" oder ähnliches gesagt wird, behalte den Rest EXAKT unverändert
- Wenn etwas als "nicht vorhanden" oder "unauffällig" beschrieben wird, entferne NICHTS
- Behalte die Formatierung (Absätze, Zeilenumbrüche) des Originals bei
- Behalte den professionellen medizinischen Schreibstil bei
- Die Ausgabe muss ein vollständiger, kohärenter Befundtext sein

BEISPIELE FÜR KORREKTES EINFÜGEN:

Beispiel 1 - Änderung am Anfang:
Textbaustein: "Normalweite innere und äußere Liquorräume. Keine Mittellinienverlagerung. Keine Hirndruckzeichen."
Änderungen: "Zeichen einer diffusen Mikroangiopathie"
Ergebnis: "Zeichen einer diffusen Mikroangiopathie. Normalweite innere und äußere Liquorräume. Keine Mittellinienverlagerung. Keine Hirndruckzeichen."

Beispiel 2 - Änderung an passender Stelle (NICHT mitten im Satz!):
Textbaustein: "Leber normal groß, glatt begrenzt, homogenes Parenchym. Gallenblase unauffällig, kein Steinnachweis. Pankreas gut beurteilbar, keine fokale Läsion."
Änderungen: "In der Gallenblase ein einzelner 8mm großer Konkrement"
Ergebnis: "Leber normal groß, glatt begrenzt, homogenes Parenchym. Gallenblase mit solitärem 8 mm großen Konkrement. Pankreas gut beurteilbar, keine fokale Läsion."

Beispiel 3 - Änderung ZWISCHEN Sätzen einfügen:
Textbaustein: "Nieren beidseits orthotop und normal groß. Keine Harnstauung. Nebennieren unauffällig."
Änderungen: "rechts eine kleine 12mm Zyste"
Ergebnis: "Nieren beidseits orthotop und normal groß. Rechts eine kleine 12 mm große Zyste. Keine Harnstauung. Nebennieren unauffällig."

KRITISCH - NIEMALS:
- Änderungen MITTEN in einen Satz einfügen und den Satz dadurch grammatisch zerstören
- Die Satzstruktur des Originaltextes beschädigen
- Einen Satz aufspalten und die Änderung dazwischen setzen

AUSGABEFORMAT:
- Gib NUR den angepassten Text zurück
- KEINE Einleitungen wie "Der angepasste Text lautet:"
- KEINE Erklärungen oder Kommentare
- KEINE Markierungen oder Tags`;

export async function POST(req: NextRequest) {
  console.log('\n=== Template Adapt Request ===');
  const startTime = Date.now();
  
  try {
    const body = await req.json();
    const { template, changes, field, username } = body;
    
    if (!template || !changes) {
      return NextResponse.json({ error: 'Template und Änderungen erforderlich' }, { status: 400 });
    }
    
    console.log(`[Template] Field: ${field || 'befund'}, Username: ${username || 'unknown'}`);
    console.log(`[Template] Template length: ${template.length} chars`);
    console.log(`[Template] Changes: "${changes}"`);
    
    // Get LLM config
    const llmConfig = await getLLMConfig(req);
    console.log(`[Template] Using provider: ${llmConfig.provider}, model: ${llmConfig.model}`);
    
    // Load dictionary for user if available
    let dictionarySuffix = '';
    if (username) {
      try {
        const { entries } = await loadDictionaryWithRequest(req, username);
        if (entries && entries.length > 0) {
          dictionarySuffix = formatDictionaryForPrompt(entries);
          console.log(`[Template] Loaded ${entries.length} dictionary entries`);
        }
      } catch (error) {
        console.error('[Template] Dictionary load error:', error);
      }
    }
    
    const systemPrompt = dictionarySuffix 
      ? `${TEMPLATE_ADAPT_PROMPT}\n${dictionarySuffix}`
      : TEMPLATE_ADAPT_PROMPT;
    
    const userMessage = `VOLLSTÄNDIGER TEXTBAUSTEIN (behalte die Struktur bei):
${template}

DIKTIERTE ÄNDERUNGEN (füge diese an der semantisch passenden Stelle ein, NICHT mitten in einen Satz):
${changes}

Gib den vollständigen angepassten Text zurück:`;

    const result = await callLLM(llmConfig, 
      [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage }
      ],
      { temperature: 0.2, maxTokens: 4000 }  // Lower temperature for more precise edits, higher token limit for complete templates
    );
    
    let adaptedText = result.content || template;
    
    // Clean up common LLM artifacts
    adaptedText = adaptedText
      .replace(/^["']|["']$/g, '')  // Remove surrounding quotes
      .replace(/^Der angepasste Text lautet:?\s*/i, '')
      .replace(/^Hier ist der angepasste Text:?\s*/i, '')
      .replace(/^Ergebnis:?\s*/i, '')
      .trim();
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const tokens = result.tokens ? `${result.tokens.input}/${result.tokens.output}` : 'unknown';
    console.log(`[Template] Success - Duration: ${duration}s, Tokens: ${tokens}`);
    console.log(`[Template] Output: ${adaptedText.substring(0, 100)}...`);
    console.log('=== Template Adapt Complete ===\n');
    
    return NextResponse.json({ 
      success: true, 
      adaptedText,
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
