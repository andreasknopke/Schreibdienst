import { NextRequest, NextResponse } from 'next/server';
import { getRuntimeConfigWithRequest } from '@/lib/configDb';
import { loadDictionaryWithRequest, formatDictionaryForPrompt } from '@/lib/dictionaryDb';

export const runtime = 'nodejs';

// LLM Provider configuration - Template-Modus verwendet IMMER OpenAI für bessere Qualität
type LLMProvider = 'openai' | 'lmstudio';

async function getLLMConfig(req: NextRequest): Promise<{ provider: LLMProvider; baseUrl: string; apiKey: string; model: string }> {
  const runtimeConfig = await getRuntimeConfigWithRequest(req);
  
  // Template-Anpassung verwendet IMMER OpenAI, da LM Studio bei komplexen Kontextänderungen
  // oft Fehler macht (z.B. Text mitten im Satz einfügt)
  console.log('[Template] Forcing OpenAI for template adaptation (better quality)');
  
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

DEINE AUFGABE - INTELLIGENTE INTEGRATION:
1. Analysiere den Textbaustein und verstehe seine Struktur und den inhaltlichen Aufbau
2. Identifiziere, WO die diktierten Änderungen inhaltlich hingehören
3. Füge die Änderungen an der SEMANTISCH PASSENDEN Stelle ein
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
- Die Ausgabe muss ein vollständiger, medizinisch KONSISTENTER Befundtext sein

BEISPIELE:

Beispiel 1 - Einfache Ergänzung (kein Widerspruch):
Textbaustein: "Normalweite innere und äußere Liquorräume. Keine Mittellinienverlagerung. Keine Hirndruckzeichen."
Änderungen: "Zeichen einer diffusen Mikroangiopathie"
Ergebnis: "Zeichen einer diffusen Mikroangiopathie. Normalweite innere und äußere Liquorräume. Keine Mittellinienverlagerung. Keine Hirndruckzeichen."

Beispiel 2 - WIDERSPRUCH erkennen und beheben:
Textbaustein: "Normalweite innere und äußere Liquorräume. Keine Mittellinienverlagerung. Keine Hirndruckzeichen."
Änderungen: "Hydrocephalus e vacuo"
Ergebnis: "Hydrocephalus e vacuo. Keine Mittellinienverlagerung. Keine Hirndruckzeichen."
(Hier wurde "Normalweite Liquorräume" entfernt, da dies dem Hydrocephalus widerspricht!)

Beispiel 3 - Teilweise Änderung mit Widerspruch:
Textbaustein: "Gallenblase unauffällig, kein Steinnachweis. Gallenwege nicht erweitert."
Änderungen: "multiple Gallensteine"
Ergebnis: "Gallenblase mit multiplen Gallensteinen. Gallenwege nicht erweitert."
(Hier wurde "unauffällig, kein Steinnachweis" durch die pathologische Angabe ersetzt)

Beispiel 4 - Änderung ohne Widerspruch, passende Stelle:
Textbaustein: "Nieren beidseits orthotop und normal groß. Keine Harnstauung. Nebennieren unauffällig."
Änderungen: "rechts eine kleine 12mm Zyste"
Ergebnis: "Nieren beidseits orthotop und normal groß. Rechts eine kleine 12 mm große Zyste. Keine Harnstauung. Nebennieren unauffällig."

KRITISCH - NIEMALS:
- Änderungen MITTEN in einen Satz einfügen und den Satz grammatisch zerstören
- Widersprüchliche Aussagen im Text belassen (z.B. "normalweite Liquorräume" UND "Hydrocephalus")
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
    console.log('\n--- LLM OUTPUT ---');
    console.log(adaptedText);
    console.log('--- END OUTPUT ---\n');
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
