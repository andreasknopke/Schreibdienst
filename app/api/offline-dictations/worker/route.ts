import { NextRequest, NextResponse } from 'next/server';
import {
  getPendingDictations,
  markDictationProcessing,
  completeDictation,
  markDictationError,
  getDictationById,
  initOfflineDictationTable,
} from '@/lib/offlineDictationDb';
import { getRuntimeConfig } from '@/lib/configDb';
import { formatDictionaryForPrompt, applyDictionary, loadDictionary } from '@/lib/dictionaryDb';

export const runtime = 'nodejs';
export const maxDuration = 300; // 5 minutes max for processing

// Worker state - avoid concurrent processing
let isProcessing = false;
let lastProcessTime = 0;

// Process a single dictation
async function processDictation(dictationId: number): Promise<void> {
  console.log(`[Worker] Processing dictation #${dictationId}`);
  
  const dictation = await getDictationById(dictationId, true);
  if (!dictation) {
    throw new Error(`Dictation #${dictationId} not found`);
  }
  
  if (!dictation.audio_data) {
    throw new Error(`Dictation #${dictationId} has no audio data`);
  }
  
  // Mark as processing
  await markDictationProcessing(dictationId);
  
  try {
    // Step 1: Transcribe audio
    console.log(`[Worker] Transcribing dictation #${dictationId}...`);
    // Convert Buffer to Uint8Array for Blob compatibility
    const audioData = new Uint8Array(dictation.audio_data);
    const audioBlob = new Blob([audioData], { type: dictation.audio_mime_type });
    const transcriptionResult = await transcribeAudio(audioBlob);
    
    if (!transcriptionResult.text) {
      throw new Error('Transcription returned empty text');
    }
    
    console.log(`[Worker] Transcription complete for #${dictationId}: ${transcriptionResult.text.length} chars`);
    
    // Step 2: Correct with LLM
    console.log(`[Worker] Correcting dictation #${dictationId}...`);
    
    if (dictation.mode === 'befund') {
      // Parse field commands for befund mode
      const parsed = parseFieldCommands(transcriptionResult.text);
      
      const befundFields = {
        methodik: parsed.methodik || '',
        befund: parsed.befund || transcriptionResult.text,
        beurteilung: parsed.beurteilung || '',
      };
      
      const correctedFields = await correctBefundFields(befundFields, dictation.username);
      
      await completeDictation(dictationId, {
        transcript: transcriptionResult.text,
        methodik: correctedFields.methodik,
        befund: correctedFields.befund,
        beurteilung: correctedFields.beurteilung,
      });
    } else {
      // Arztbrief mode
      const correctedText = await correctText(transcriptionResult.text, dictation.username);
      
      await completeDictation(dictationId, {
        transcript: transcriptionResult.text,
        correctedText: correctedText,
      });
    }
    
    console.log(`[Worker] ✓ Dictation #${dictationId} completed successfully`);
    
  } catch (error: any) {
    console.error(`[Worker] ✗ Error processing dictation #${dictationId}:`, error.message);
    await markDictationError(dictationId, error.message);
    throw error;
  }
}

// Transcribe audio using the same logic as the transcribe API
async function transcribeAudio(audioBlob: Blob): Promise<{ text: string }> {
  const runtimeConfig = await getRuntimeConfig();
  const provider = runtimeConfig.transcriptionProvider;
  
  if (provider === 'elevenlabs') {
    return transcribeWithElevenLabs(audioBlob);
  }
  
  try {
    return await transcribeWithWhisperX(audioBlob);
  } catch (error: any) {
    console.warn('[Worker] WhisperX failed, trying ElevenLabs fallback:', error.message);
    if (process.env.ELEVENLABS_API_KEY) {
      return transcribeWithElevenLabs(audioBlob);
    }
    throw error;
  }
}

async function transcribeWithWhisperX(file: Blob): Promise<{ text: string }> {
  const whisperUrl = process.env.WHISPER_SERVICE_URL || 'http://localhost:5000';
  const isGradio = whisperUrl.includes(':7860');
  
  if (isGradio) {
    // Get auth credentials
    const authUser = process.env.WHISPER_AUTH_USERNAME;
    let authPass = process.env.WHISPER_AUTH_PASSWORD;
    
    if (!authPass) {
      const whisperEnvVars = Object.keys(process.env).filter(k => k.includes('WHISPER'));
      for (const key of whisperEnvVars) {
        if (key.includes('PASSWORD')) {
          authPass = process.env[key] || '';
        }
      }
    }
    
    // Login
    const loginRes = await fetch(`${whisperUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `username=${encodeURIComponent(authUser || '')}&password=${encodeURIComponent(authPass || '')}`,
    });
    
    if (!loginRes.ok) throw new Error(`Gradio login failed (${loginRes.status})`);
    const sessionCookie = loginRes.headers.get('set-cookie')?.split(';')[0] || '';
    
    // Upload file
    const uploadFormData = new FormData();
    uploadFormData.append('files', file, 'audio.webm');
    
    const uploadRes = await fetch(`${whisperUrl}/gradio_api/upload?upload_id=${Date.now()}`, {
      method: 'POST',
      headers: { 'Cookie': sessionCookie },
      body: uploadFormData,
    });
    
    if (!uploadRes.ok) throw new Error(`Gradio upload failed (${uploadRes.status})`);
    const uploadData = await uploadRes.json();
    const filePath = uploadData[0].path || uploadData[0];
    
    // Process
    let whisperModel = process.env.WHISPER_MODEL || 'large-v3';
    if (whisperModel === 'large-v3') {
      whisperModel = 'cstr/whisper-large-v3-turbo-german-int8_float32';
    }
    
    const processRes = await fetch(`${whisperUrl}/gradio_api/call/start_process`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Cookie': sessionCookie },
      body: JSON.stringify({
        data: [
          { path: filePath, orig_name: 'audio.webm', size: file.size, mime_type: file.type || 'audio/webm', meta: { _type: 'gradio.FileData' } },
          "German",
          whisperModel,
          "cuda"
        ]
      }),
    });
    
    if (!processRes.ok) throw new Error(`Gradio process failed (${processRes.status})`);
    const processData = await processRes.json();
    
    // Get result
    const resultRes = await fetch(`${whisperUrl}/gradio_api/call/start_process/${processData.event_id}`, {
      headers: { 'Cookie': sessionCookie },
    });
    
    if (!resultRes.ok) throw new Error(`Gradio result failed (${resultRes.status})`);
    const resultText = await resultRes.text();
    const dataMatch = resultText.match(/data:\s*(\[.*\])/s);
    if (!dataMatch) throw new Error('Could not parse Gradio response');
    
    const resultData = JSON.parse(dataMatch[1]);
    let text = typeof resultData[0] === 'string' ? resultData[0] : resultData[0]?.value || '';
    
    return { text };
  }
  
  // FastAPI implementation
  const formData = new FormData();
  formData.append('file', file, 'audio.webm');
  formData.append('language', 'de');
  formData.append('align', 'true');
  
  const res = await fetch(`${whisperUrl}/transcribe`, { method: 'POST', body: formData });
  if (!res.ok) throw new Error(`WhisperX API error (${res.status})`);
  
  const data = await res.json();
  return { text: data.text ?? '' };
}

async function transcribeWithElevenLabs(file: Blob): Promise<{ text: string }> {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) throw new Error('ELEVENLABS_API_KEY not configured');
  
  const formData = new FormData();
  formData.append('file', file, 'audio.webm');
  formData.append('model_id', 'scribe_v1');
  formData.append('language_code', 'de');
  formData.append('tag_audio_events', 'false');
  
  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: formData,
  });
  
  if (!res.ok) throw new Error(`ElevenLabs API error (${res.status})`);
  const data = await res.json();
  return { text: data.text ?? '' };
}

// Parse field commands for Befund mode
function parseFieldCommands(text: string): { methodik: string | null; befund: string | null; beurteilung: string | null } {
  const fieldPattern = /\b(methodik|befund|beurteilung|zusammenfassung)\s*(?:[:：]|doppelpunkt)/gi;
  const matches: { field: 'methodik' | 'befund' | 'beurteilung'; index: number; length: number }[] = [];
  let match;
  
  while ((match = fieldPattern.exec(text)) !== null) {
    const fieldName = match[1].toLowerCase();
    let field: 'methodik' | 'befund' | 'beurteilung';
    if (fieldName === 'methodik') field = 'methodik';
    else if (fieldName === 'beurteilung' || fieldName === 'zusammenfassung') field = 'beurteilung';
    else field = 'befund';
    matches.push({ field, index: match.index, length: match[0].length });
  }
  
  if (matches.length === 0) {
    return { methodik: null, befund: text, beurteilung: null };
  }
  
  const result: { methodik: string | null; befund: string | null; beurteilung: string | null } = {
    methodik: null, befund: null, beurteilung: null
  };
  
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const next = matches[i + 1];
    const startPos = current.index + current.length;
    const endPos = next ? next.index : text.length;
    const fieldText = text.substring(startPos, endPos).trim();
    
    if (fieldText) {
      result[current.field] = result[current.field] ? result[current.field] + ' ' + fieldText : fieldText;
    }
  }
  
  // Text before first command goes to befund
  const textBefore = text.substring(0, matches[0].index).trim();
  if (textBefore) {
    result.befund = result.befund ? textBefore + ' ' + result.befund : textBefore;
  }
  
  return result;
}

// Correct text using LLM
async function correctText(text: string, username: string): Promise<string> {
  const dictionary = await loadDictionary(username);
  const dictText = formatDictionaryForPrompt(dictionary.entries);
  
  const llmConfig = await getLLMConfig();
  const systemPrompt = `Du bist ein medizinischer Diktat-Assistent. Korrigiere den Text.
${dictText ? `\nWÖRTERBUCH (verwende diese Korrekturen):\n${dictText}` : ''}

REGELN:
1. Korrigiere Grammatik und Rechtschreibung
2. Behalte medizinische Fachbegriffe exakt bei
3. Führe Sprachbefehle aus (Punkt, Komma, neuer Absatz, etc.)
4. Gib NUR den korrigierten Text zurück`;

  const result = await callLLM(llmConfig, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: text }
  ]);
  
  return applyDictionary(result, dictionary.entries);
}

// Correct befund fields using LLM
async function correctBefundFields(fields: { methodik: string; befund: string; beurteilung: string }, username: string): Promise<{ methodik: string; befund: string; beurteilung: string }> {
  const dictionary = await loadDictionary(username);
  const dictText = formatDictionaryForPrompt(dictionary.entries);
  
  const llmConfig = await getLLMConfig();
  const systemPrompt = `Du bist ein medizinischer Befund-Assistent. Korrigiere die drei Felder.
${dictText ? `\nWÖRTERBUCH:\n${dictText}` : ''}

Antworte NUR mit JSON: {"methodik": "...", "befund": "...", "beurteilung": "..."}`;

  const result = await callLLM(llmConfig, [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: JSON.stringify(fields) }
  ], { jsonMode: true });
  
  try {
    const parsed = JSON.parse(result);
    return {
      methodik: applyDictionary(parsed.methodik || fields.methodik, dictionary.entries),
      befund: applyDictionary(parsed.befund || fields.befund, dictionary.entries),
      beurteilung: applyDictionary(parsed.beurteilung || fields.beurteilung, dictionary.entries),
    };
  } catch {
    return fields;
  }
}

// LLM helper
async function getLLMConfig() {
  const runtimeConfig = await getRuntimeConfig();
  const provider = runtimeConfig.llmProvider;
  
  if (provider === 'lmstudio') {
    return {
      provider: 'lmstudio' as const,
      baseUrl: process.env.LLM_STUDIO_URL || 'http://localhost:1234',
      apiKey: 'lm-studio',
      model: process.env.LLM_STUDIO_MODEL || 'local-model'
    };
  }
  
  return {
    provider: 'openai' as const,
    baseUrl: 'https://api.openai.com',
    apiKey: process.env.OPENAI_API_KEY || '',
    model: runtimeConfig.openaiModel || process.env.OPENAI_MODEL || 'gpt-4o-mini'
  };
}

async function callLLM(
  config: { provider: string; baseUrl: string; apiKey: string; model: string },
  messages: { role: string; content: string }[],
  options: { jsonMode?: boolean } = {}
): Promise<string> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (config.provider === 'openai') {
    headers['Authorization'] = `Bearer ${config.apiKey}`;
  }
  
  const body: any = {
    model: config.model,
    messages,
    temperature: 0.3,
    max_tokens: 2000,
  };
  
  if (options.jsonMode && config.provider === 'openai') {
    body.response_format = { type: 'json_object' };
  }
  
  const res = await fetch(`${config.baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });
  
  if (!res.ok) throw new Error(`LLM API error (${res.status})`);
  const data = await res.json();
  return data.choices?.[0]?.message?.content?.trim() || '';
}

// POST: Trigger worker to process pending dictations
export async function POST(req: NextRequest) {
  try {
    await initOfflineDictationTable();
    
    // Check if already processing
    if (isProcessing) {
      return NextResponse.json({ 
        message: 'Worker already processing',
        lastProcessTime 
      });
    }
    
    isProcessing = true;
    lastProcessTime = Date.now();
    
    try {
      const pending = await getPendingDictations(5);
      
      if (pending.length === 0) {
        return NextResponse.json({ message: 'No pending dictations', processed: 0 });
      }
      
      console.log(`[Worker] Found ${pending.length} pending dictations`);
      
      let processed = 0;
      let errors = 0;
      
      for (const dictation of pending) {
        try {
          await processDictation(dictation.id);
          processed++;
        } catch (error: any) {
          console.error(`[Worker] Failed to process #${dictation.id}:`, error.message);
          errors++;
        }
      }
      
      console.log(`[Worker] Batch complete: ${processed} processed, ${errors} errors`);
      
      return NextResponse.json({ 
        message: 'Worker completed',
        processed,
        errors,
        remaining: pending.length - processed - errors
      });
      
    } finally {
      isProcessing = false;
    }
    
  } catch (error: any) {
    isProcessing = false;
    console.error('[Worker] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// GET: Check worker status
export async function GET() {
  return NextResponse.json({
    isProcessing,
    lastProcessTime,
    lastProcessTimeAgo: lastProcessTime ? `${Math.round((Date.now() - lastProcessTime) / 1000)}s ago` : 'never'
  });
}
