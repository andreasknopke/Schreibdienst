import { NextRequest, NextResponse } from 'next/server';
import { authenticateUserWithRequest } from '@/lib/usersDb';
import { getRuntimeConfigWithRequest } from '@/lib/configDb';

export const runtime = 'nodejs';

// LLM Provider configuration
type LLMProvider = 'openai' | 'lmstudio' | 'mistral';

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
  
  if (provider === 'mistral') {
    return {
      provider: 'mistral',
      baseUrl: 'https://api.mistral.ai',
      apiKey: process.env.MISTRAL_API_KEY || '',
      model: runtimeConfig.mistralModel || process.env.MISTRAL_MODEL || 'mistral-large-latest'
    };
  }
  
  return {
    provider: 'openai',
    baseUrl: 'https://api.openai.com',
    apiKey: process.env.OPENAI_API_KEY || '',
    model: runtimeConfig.openaiModel || process.env.OPENAI_MODEL || 'gpt-4o-mini'
  };
}

async function callLLM(
  config: { provider: LLMProvider; baseUrl: string; apiKey: string; model: string },
  messages: { role: string; content: string }[],
  options: { temperature?: number; maxTokens?: number } = {}
): Promise<{ content: string; tokens?: { input: number; output: number } }> {
  const { temperature = 0.5, maxTokens = 2000 } = options;
  
  if (config.provider === 'openai' && !config.apiKey) {
    throw new Error('OPENAI_API_KEY not configured');
  }
  
  if (config.provider === 'mistral' && !config.apiKey) {
    throw new Error('MISTRAL_API_KEY not configured');
  }
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  
  if (config.provider === 'openai' || config.provider === 'mistral') {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }
  
  const body: any = {
    model: config.model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };
  
  console.log(`[CustomAction LLM] Request: ${config.baseUrl}/v1/chat/completions`);
  
  const res = await fetch(`${config.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  
  if (!res.ok) {
    const errorText = await res.text();
    console.error(`[CustomAction LLM] API error:`, res.status, errorText);
    throw new Error(`LLM API error (${res.status}): ${errorText}`);
  }
  
  const data = await res.json();
  const content = data.choices?.[0]?.message?.content?.trim() || '';
  const tokens = data.usage ? { input: data.usage.prompt_tokens, output: data.usage.completion_tokens } : undefined;
  
  return { content, tokens };
}

interface AuthResult {
  username: string;
}

// Extract username from auth header
async function getAuthenticatedUser(request: NextRequest): Promise<AuthResult | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return null;
  }
  
  try {
    const credentials = Buffer.from(authHeader.slice(6), 'base64').toString();
    const [username, password] = credentials.split(':');
    const result = await authenticateUserWithRequest(request, username, password);
    
    if (result.success && result.user) {
      return { username: result.user.username };
    }
  } catch {
    // Invalid auth header
  }
  
  return null;
}

// POST: Execute a custom action on text
export async function POST(req: NextRequest) {
  const auth = await getAuthenticatedUser(req);
  if (!auth) {
    return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  }
  
  try {
    const body = await req.json();
    const { prompt, text, fieldName } = body as {
      prompt: string;
      text: string;
      fieldName?: string;
    };
    
    if (!prompt) {
      return NextResponse.json({ error: 'Prompt ist erforderlich' }, { status: 400 });
    }
    
    if (!text || !text.trim()) {
      return NextResponse.json({ error: 'Kein Text zum Verarbeiten vorhanden' }, { status: 400 });
    }
    
    console.log(`[CustomAction] Executing for user: ${auth.username}, field: ${fieldName || 'unknown'}, text length: ${text.length}`);
    
    const llmConfig = await getLLMConfig(req);
    
    const systemPrompt = `Du bist ein hilfreicher Assistent für medizinische Texte. 
Du erhältst einen Text und eine Anweisung vom Benutzer.
Führe die Anweisung auf den Text aus und gib das Ergebnis zurück.

REGELN:
- Gib NUR das Ergebnis zurück, keine Erklärungen oder Meta-Kommentare
- Wenn die Anweisung eine Analyse verlangt, gib die Analyse formatiert zurück
- Wenn die Anweisung eine Textänderung verlangt, gib den geänderten Text zurück
- Behalte medizinische Fachbegriffe korrekt bei
- Antworte auf Deutsch`;

    const userMessage = `ANWEISUNG: ${prompt}

TEXT:
${text}`;

    const startTime = Date.now();
    const result = await callLLM(llmConfig, [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userMessage }
    ], { temperature: 0.5, maxTokens: 2000 });
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[CustomAction] Completed in ${duration}s, output: ${result.content.length} chars`);
    
    return NextResponse.json({ 
      success: true, 
      result: result.content,
      tokens: result.tokens
    });
  } catch (error: any) {
    console.error('[API/CustomActions/Execute] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
