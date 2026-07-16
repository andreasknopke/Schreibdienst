import { NextRequest, NextResponse } from 'next/server';
import { getRuntimeConfigWithRequest } from '@/lib/configDb';
import { addLlmPromptLog, updateLlmPromptLog } from '@/lib/llmPromptLog';
import { CONTRADICTION_CHECK } from '@/prompts/templates/contradiction-check';
import { getEffectivePrompt } from '@/lib/promptOverrides';

export const runtime = 'nodejs';

type LLMProvider = 'openai' | 'lmstudio' | 'mistral';

function hasUsableApiKey(value: string | undefined): value is string {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized !== '' && normalized !== 'not set' && normalized !== '(not set)' && normalized !== 'undefined' && normalized !== 'null';
}

async function getLLMConfig(req: NextRequest): Promise<{ provider: LLMProvider; baseUrl: string; apiKey: string; model: string }> {
  const runtimeConfig = await getRuntimeConfigWithRequest(req);

  if (runtimeConfig.llmProvider === 'lmstudio') {
    return {
      provider: 'lmstudio',
      baseUrl: process.env.LLM_STUDIO_URL || 'http://localhost:1234',
      apiKey: 'lm-studio',
      model: runtimeConfig.lmStudioModelOverride || process.env.LLM_STUDIO_MODEL || 'meta-llama-3.1-8b-instruct',
    };
  }

  if (runtimeConfig.llmProvider === 'mistral') {
    return {
      provider: 'mistral',
      baseUrl: 'https://api.mistral.ai',
      apiKey: process.env.MISTRAL_API_KEY || '',
      model: runtimeConfig.mistralModel || process.env.MISTRAL_MODEL || 'mistral-large-latest',
    };
  }

  return {
    provider: 'openai',
    baseUrl: 'https://api.openai.com',
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.TEMPLATE_OPENAI_MODEL || runtimeConfig.openaiModel || process.env.OPENAI_MODEL || 'gpt-4o',
  };
}

async function callLLM(config: { provider: LLMProvider; baseUrl: string; apiKey: string; model: string }, systemPrompt: string, userMessage: string, meta?: { username?: string }) {
  const logId = addLlmPromptLog('check-contradictions', meta?.username || 'unknown', config.provider, config.model, systemPrompt, userMessage);

  try {
    if ((config.provider === 'openai' || config.provider === 'mistral') && !hasUsableApiKey(config.apiKey)) {
      throw new Error('API-Key nicht konfiguriert');
    }

    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (config.provider === 'openai' || config.provider === 'mistral') {
      headers.Authorization = `Bearer ${config.apiKey}`;
    }

    const body: Record<string, unknown> = {
      model: config.model,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userMessage },
      ],
      temperature: 0.1,
      max_tokens: 1000,
    };

    const startTime = Date.now();
    const endpoint = `${config.baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
    const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });
    const elapsed = Date.now() - startTime;

    if (!response.ok) {
      const error = await response.text();
      updateLlmPromptLog(logId, '', elapsed, 'error', `LLM API error: ${response.status} - ${error}`);
      throw new Error(`LLM API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const content = data.choices[0]?.message?.content || '';
    updateLlmPromptLog(logId, content, elapsed, 'success');
    return content;
  } catch (error) {
    console.error('[CheckContradictions] LLM call error:', error);
    throw error;
  }
}

interface ContradictionEntry {
  passage: string;
  description: string;
}

function parseContradictions(raw: string): ContradictionEntry[] {
  const trimmed = raw.trim();
  const withoutFence = trimmed.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');

  const tryParse = (text: string): ContradictionEntry[] | null => {
    try {
      const parsed = JSON.parse(text);
      if (parsed && Array.isArray(parsed.contradictions)) {
        return parsed.contradictions.map((c: any) => ({
          passage: typeof c.passage === 'string' ? c.passage : '',
          description: typeof c.description === 'string' ? c.description : '',
        })).filter((c: ContradictionEntry) => c.passage);
      }
    } catch { /* continue */ }
    return null;
  };

  const result = tryParse(trimmed) ?? tryParse(withoutFence);
  if (result) return result;

  const jsonStart = withoutFence.indexOf('{');
  const jsonEnd = withoutFence.lastIndexOf('}');
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    const extracted = withoutFence.slice(jsonStart, jsonEnd + 1);
    const fallback = tryParse(extracted);
    if (fallback) return fallback;
  }

  return [];
}

export async function POST(req: NextRequest) {
  console.log('\n=== Check Contradictions ===');
  const startTime = Date.now();

  try {
    const body = await req.json();
    const { text, username } = body;

    if (!text || !text.trim()) {
      return NextResponse.json({ success: true, contradictions: [] });
    }

    console.log(`[CheckContradictions] Text length: ${text.length} chars, Username: ${username || 'unknown'}`);

    const llmConfig = await getLLMConfig(req);
    const effectivePrompt = (await getEffectivePrompt(req, 'templates/contradiction-check', CONTRADICTION_CHECK)).text;

    const result = await callLLM(llmConfig, effectivePrompt, text, { username });

    const contradictions = parseContradictions(result || '');
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[CheckContradictions] Done - ${contradictions.length} contradictions found, Duration: ${duration}s`);

    return NextResponse.json({ success: true, contradictions });
  } catch (error: any) {
    console.error('[CheckContradictions] Error:', error.message);
    return NextResponse.json({ success: false, error: error.message, contradictions: [] }, { status: 500 });
  }
}
