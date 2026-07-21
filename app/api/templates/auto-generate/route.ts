import { NextRequest, NextResponse } from 'next/server';
import { AUTO_GENERATE_PROMPT } from '@/prompts/templates/auto-generate';

export const runtime = 'nodejs';
export const maxDuration = 120; // 2 Minuten Timeout für LLM und Dokument-Parsing

type LLMProvider = 'openai' | 'lmstudio' | 'mistral';

interface LLMConfig {
  provider: LLMProvider;
  baseUrl: string;
  apiKey: string;
  model: string;
}

interface GeneratedTemplate {
  name: string;
  content: string;
  formatting?: { start: number; end: number; bold?: boolean; underline?: boolean }[];
}

function hasUsableApiKey(value: string | undefined): value is string {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized !== '' && normalized !== 'not set' && normalized !== '(not set)' && normalized !== 'undefined' && normalized !== 'null';
}

async function getLLMConfig(req: NextRequest): Promise<LLMConfig> {
  const { getRuntimeConfigWithRequest } = await import('@/lib/configDb');
  const runtimeConfig = await getRuntimeConfigWithRequest(req);

  const provider: LLMProvider = (runtimeConfig?.llmProvider || process.env.LLM_PROVIDER || 'openai') as LLMProvider;

  if (provider === 'lmstudio') {
    return {
      provider: 'lmstudio',
      baseUrl: process.env.LLM_STUDIO_URL || 'http://localhost:1234',
      apiKey: 'lm-studio',
      model: runtimeConfig?.lmStudioModelOverride || process.env.LLM_STUDIO_MODEL || 'meta-llama-3.1-8b-instruct',
    };
  }

  if (provider === 'mistral') {
    return {
      provider: 'mistral',
      baseUrl: 'https://api.mistral.ai',
      apiKey: process.env.MISTRAL_API_KEY || '',
      model: runtimeConfig?.mistralModel || process.env.MISTRAL_MODEL || 'mistral-large-latest',
    };
  }

  return {
    provider: 'openai',
    baseUrl: 'https://api.openai.com',
    apiKey: process.env.OPENAI_API_KEY || '',
    model: runtimeConfig?.openaiModel || process.env.TEMPLATE_OPENAI_MODEL || process.env.OPENAI_MODEL || 'gpt-4o',
  };
}

async function callLLM(
  config: LLMConfig,
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[],
  options: { temperature?: number; maxTokens?: number } = {},
): Promise<string> {
  const { temperature = 0.3, maxTokens = 4000 } = options;

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.provider === 'openai' || config.provider === 'mistral') {
    if (!hasUsableApiKey(config.apiKey)) {
      throw new Error(`${config.provider.toUpperCase()}_API_KEY not configured`);
    }
    headers.Authorization = `Bearer ${config.apiKey}`;
  }

  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    temperature,
    max_tokens: maxTokens,
  };

  const endpoint = `${config.baseUrl.replace(/\/+$/, '')}/v1/chat/completions`;
  const response = await fetch(endpoint, { method: 'POST', headers, body: JSON.stringify(body) });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`LLM API error: ${response.status} - ${error}`);
  }

  const data = await response.json();
  return data.choices[0]?.message?.content || '';
}

// Extrahiert Text aus PDF
async function extractPdfText(buffer: Buffer): Promise<string> {
  const pdfParse = (await import('pdf-parse')).default;
  const data = await pdfParse(buffer);
  return data.text || '';
}

// Extrahiert Text aus DOCX
async function extractDocxText(buffer: Buffer): Promise<string> {
  const mammoth = await import('mammoth');
  const result = await mammoth.extractRawText({ buffer });
  return result.value || '';
}

/**
 * POST /api/templates/auto-generate
 * 
 * Nimmt bis zu 3 Dokumente (PDF/DOCX) entgegen, extrahiert den Text,
 * schickt ihn an das LLM und gibt erkannte Bausteine als JSON zurück.
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const files = formData.getAll('files') as File[];

    if (!files || files.length === 0) {
      return NextResponse.json({ success: false, error: 'Keine Dateien hochgeladen' }, { status: 400 });
    }

    if (files.length > 3) {
      return NextResponse.json({ success: false, error: 'Maximal 3 Dateien erlaubt' }, { status: 400 });
    }

    // Texte aus allen Dokumenten extrahieren
    let combinedText = '';
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const name = file.name.toLowerCase();

      let text = '';
      if (name.endsWith('.pdf')) {
        text = await extractPdfText(buffer);
      } else if (name.endsWith('.docx') || name.endsWith('.doc')) {
        text = await extractDocxText(buffer);
      } else {
        return NextResponse.json({
          success: false,
          error: `Nicht unterstütztes Format: ${file.name}. Bitte PDF oder DOCX.`,
        }, { status: 400 });
      }

      if (text.trim()) {
        combinedText += `\n\n=== Dokument: ${file.name} ===\n\n${text}`;
      }
    }

    if (!combinedText.trim()) {
      return NextResponse.json({
        success: false,
        error: 'Konnte keinen Text aus den Dokumenten extrahieren.',
      }, { status: 400 });
    }

    // LLM-Konfiguration
    const llmConfig = await getLLMConfig(request);

    // LLM aufrufen
    const rawResult = await callLLM(
      llmConfig,
      [
        { role: 'system', content: AUTO_GENERATE_PROMPT },
        { role: 'user', content: `Analysiere die folgenden medizinischen Dokumente und extrahiere Textbausteine:\n\n${combinedText}` },
      ],
      { temperature: 0.2, maxTokens: 8000 },
    );

    // JSON aus Ergebnis parsen
    const cleaned = rawResult
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```$/, '')
      .trim();

    let parsed: { templates?: GeneratedTemplate[] };
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      // Fallback: JSON-Objekt aus dem Text extrahieren
      const jsonStart = cleaned.indexOf('{');
      const jsonEnd = cleaned.lastIndexOf('}');
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        try {
          parsed = JSON.parse(cleaned.slice(jsonStart, jsonEnd + 1));
        } catch {
          throw new Error('Konnte die LLM-Antwort nicht als JSON parsen');
        }
      } else {
        throw new Error('Konnte die LLM-Antwort nicht als JSON parsen');
      }
    }

    if (!parsed.templates || !Array.isArray(parsed.templates)) {
      return NextResponse.json({
        success: true,
        templates: [],
        message: 'Keine Bausteine erkannt.',
      });
    }

    return NextResponse.json({
      success: true,
      templates: parsed.templates,
    });
  } catch (error: any) {
    console.error('[AutoGenerate] Error:', error);
    return NextResponse.json({
      success: false,
      error: error.message || 'Fehler bei der Baustein-Generierung',
    }, { status: 500 });
  }
}
