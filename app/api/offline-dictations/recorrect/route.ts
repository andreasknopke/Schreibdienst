import { NextRequest, NextResponse } from 'next/server';
import {
  getDictationByIdWithRequest,
  initOfflineDictationTableWithRequest,
  updateCorrectedTextWithRequest,
} from '@/lib/offlineDictationDb';
import {
  getCorrectionLogByDictationIdWithRequest,
  logDoublePrecisionCorrectionWithRequest,
  logLLMCorrectionWithRequest,
  logTextFormattingCorrectionWithRequest,
  initCorrectionLogTableWithRequest,
} from '@/lib/correctionLogDb';
import { getRuntimeConfigWithRequest } from '@/lib/configDb';
import { loadDictionaryWithRequest, DictionaryEntry } from '@/lib/dictionaryDb';
import { calculateChangeScore } from '@/lib/changeScore';
import { preprocessTranscription, removeMarkdownFormatting } from '@/lib/textFormatting';
import { mergeTranscriptionsWithMarkers, createMergePrompt, TranscriptionResult, MergeContext } from '@/lib/doublePrecision';

export const runtime = 'nodejs';
export const maxDuration = 120; // 2 minutes max

// LM-Studio Max Token Limit (aus Umgebungsvariable oder Standard 10000)
const LM_STUDIO_MAX_TOKENS = parseInt(process.env.LLM_STUDIO_TOKEN || '10000', 10);

// Max characters per chunk for cloud LLMs (Mistral, OpenAI) to avoid timeouts
const CLOUD_LLM_MAX_CHARS = 40000;

// Split text into chunks by character limit, breaking at sentence boundaries
function splitTextIntoChunksByCharLimit(text: string, maxChars: number = CLOUD_LLM_MAX_CHARS): string[] {
  if (!text || text.trim().length === 0) return [''];
  if (text.length <= maxChars) return [text];

  const sentences: string[] = [];
  let currentSentence = '';
  let i = 0;

  while (i < text.length) {
    const char = text[i];
    currentSentence += char;

    if (char === '.' || char === '!' || char === '?') {
      const nextChar = text[i + 1] || '';
      const prevChars = currentSentence.slice(-4, -1);
      const isDate = /\d$/.test(prevChars) || /^\d/.test(nextChar);
      const isAbbreviation = /\b(Dr|Mr|Fr|Hr|Prof|bzw|z\.B|u\.a|d\.h|etc|ca|vs|Nr|Tel|Str|inkl|ggf|evtl|usw)\.$/.test(currentSentence);

      if (!isDate && !isAbbreviation) {
        while (i + 1 < text.length && /[\s"')\]]/.test(text[i + 1])) {
          i++;
          currentSentence += text[i];
        }
        if (currentSentence.trim()) {
          sentences.push(currentSentence);
        }
        currentSentence = '';
      }
    }
    i++;
  }

  if (currentSentence.trim()) {
    sentences.push(currentSentence);
  }

  if (sentences.length === 0) return [text];

  const chunks: string[] = [];
  let currentChunk = '';

  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (currentChunk.trim()) {
        chunks.push(currentChunk.trim());
        currentChunk = '';
      }
      chunks.push(sentence.trim());
      continue;
    }

    if (currentChunk.length + sentence.length > maxChars && currentChunk.trim()) {
      chunks.push(currentChunk.trim());
      currentChunk = '';
    }

    currentChunk += sentence;
  }

  if (currentChunk.trim()) {
    chunks.push(currentChunk.trim());
  }

  return chunks.length > 0 ? chunks : [text];
}

/**
 * Parse Double Precision log to extract both transcriptions
 * Format:
 * [DOUBLE PRECISION - UNTERSCHIEDE GEFUNDEN]
 * 
 * Transkription A (provider1):
 * <text1>
 * 
 * Transkription B (provider2):
 * <text2>
 * 
 * Markierte Unterschiede:
 * <mergedTextWithMarkers>
 */
function parseDoublePrecisionLog(logText: string): { text1: string; text2: string; provider1: string; provider2: string } | null {
  console.log(`[ReCorrect] Parsing Double Precision log (${logText.length} chars)`);
  
  // Provider names can contain nested parentheses like "whisperx (cstr/whisper-large-v3-turbo-german-int8_float32)"
  // So we need to match everything up to "):\n" at end of line
  
  // Match Transkription A - find the line, then capture provider and text
  const headerAMatch = logText.match(/Transkription A \((.+)\):\n/);
  if (!headerAMatch) {
    console.log('[ReCorrect] Failed to match Transkription A header');
    console.log('[ReCorrect] Log preview:', logText.substring(0, 500));
    return null;
  }
  
  const provider1 = headerAMatch[1];
  const afterHeaderA = logText.indexOf(headerAMatch[0]) + headerAMatch[0].length;
  
  // Find where Transkription B starts
  const headerBMatch = logText.match(/\n\nTranskription B \((.+)\):\n/);
  if (!headerBMatch) {
    console.log('[ReCorrect] Failed to match Transkription B header');
    return null;
  }
  
  const provider2 = headerBMatch[1];
  const startOfB = logText.indexOf(headerBMatch[0]);
  const afterHeaderB = startOfB + headerBMatch[0].length;
  
  // Text A is between end of header A and start of header B
  const text1 = logText.substring(afterHeaderA, startOfB).trim();
  
  // Find where "Markierte Unterschiede:" starts
  const markierteMatch = logText.indexOf('\n\nMarkierte Unterschiede:');
  if (markierteMatch === -1) {
    console.log('[ReCorrect] Failed to find "Markierte Unterschiede:" section');
    return null;
  }
  
  // Text B is between end of header B and start of Markierte Unterschiede
  const text2 = logText.substring(afterHeaderB, markierteMatch).trim();
  
  console.log(`[ReCorrect] Successfully parsed transcripts:`);
  console.log(`[ReCorrect]   A (${provider1}): ${text1.length} chars`);
  console.log(`[ReCorrect]   B (${provider2}): ${text2.length} chars`);
  
  return { provider1, text1, provider2, text2 };
}

// Helper function to extract doctor surname from username
function extractDoctorName(username: string): string {
  return username.replace(/\d+$/, '');
}

// LLM Config helper
async function getLLMConfig(request: NextRequest): Promise<{ provider: string; model: string }> {
  const runtimeConfig = await getRuntimeConfigWithRequest(request);
  const provider = runtimeConfig.llmProvider;
  
  if (provider === 'lmstudio') {
    return {
      provider: 'lmstudio',
      model: runtimeConfig.lmStudioModelOverride || process.env.LLM_STUDIO_MODEL || 'local-model'
    };
  }
  
  if (provider === 'mistral') {
    return {
      provider: 'mistral',
      model: runtimeConfig.mistralModel || 'mistral-large-latest'
    };
  }
  
  return {
    provider: 'openai',
    model: runtimeConfig.openaiModel || 'gpt-4o-mini'
  };
}

/**
 * Perform Double Precision merge using current LLM settings
 */
async function doublePrecisionMerge(
  request: NextRequest,
  dictationId: number,
  result1: TranscriptionResult,
  result2: TranscriptionResult,
  mergeContext?: MergeContext
): Promise<string> {
  console.log(`[ReCorrect DoublePrecision] Merging transcriptions from ${result1.provider} and ${result2.provider}`);
  
  const merged = mergeTranscriptionsWithMarkers(result1, result2);
  const runtimeConfig = await getRuntimeConfigWithRequest(request);
  const llmProvider = runtimeConfig.llmProvider;
  
  if (!merged.hasDifferences) {
    console.log('[ReCorrect DoublePrecision] No differences found, using first transcription');
    
    // Log that Double Precision was performed
    try {
      const dpLogText = `[DOUBLE PRECISION - KEINE UNTERSCHIEDE]\n\n` +
        `Transkription A (${result1.provider}):\n${result1.text}\n\n` +
        `Transkription B (${result2.provider}):\n${result2.text}\n\n` +
        `Ergebnis: Beide Transkriptionen sind identisch.`;
      
      await logDoublePrecisionCorrectionWithRequest(
        request,
        dictationId,
        dpLogText,
        result1.text,
        'keine Unterschiede',
        'double-precision',
        0
      );
    } catch (logError: any) {
      console.warn(`[ReCorrect DoublePrecision] Failed to log: ${logError.message}`);
    }
    
    return result1.text;
  }
  
  console.log('[ReCorrect DoublePrecision] Differences found, sending to LLM for resolution');
  
  const mergePrompt = createMergePrompt(merged, mergeContext);
  let finalText: string;
  let modelName: string;
  let modelProvider: string;
  
  if (llmProvider === 'openai') {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error('OPENAI_API_KEY not configured');
    
    modelName = runtimeConfig.openaiModel || 'gpt-4o-mini';
    modelProvider = 'openai';
    
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'system', content: mergePrompt },
          { role: 'user', content: 'Erstelle den finalen Text.' }
        ],
        temperature: 0.1,
      }),
    });
    
    if (!res.ok) throw new Error(`OpenAI API error: ${res.status}`);
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content;
    finalText = (typeof content === 'string' ? content.trim() : (content ? String(content) : '')) || result1.text;
  } else if (llmProvider === 'mistral') {
    const apiKey = process.env.MISTRAL_API_KEY;
    if (!apiKey) throw new Error('MISTRAL_API_KEY not configured');
    
    modelName = runtimeConfig.mistralModel || 'mistral-large-latest';
    modelProvider = 'mistral';
    
    const res = await fetch('https://api.mistral.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'system', content: mergePrompt },
          { role: 'user', content: 'Erstelle den finalen Text.' }
        ],
        temperature: 0.1,
      }),
    });
    
    if (!res.ok) throw new Error(`Mistral API error: ${res.status}`);
    const data = await res.json();
    const mistralContent = data.choices?.[0]?.message?.content;
    finalText = (typeof mistralContent === 'string' ? mistralContent.trim() : (mistralContent ? String(mistralContent) : '')) || result1.text;
  } else if (llmProvider === 'lmstudio') {
    const lmStudioUrl = process.env.LLM_STUDIO_URL || 'http://localhost:1234';
    // Use session override if available
    modelName = runtimeConfig.lmStudioModelOverride || process.env.LLM_STUDIO_MODEL || 'local-model';
    modelProvider = 'lmstudio';
    
    // LM Studio uses fixed max tokens
    const temperature = 0.1;
    const maxTokens = LM_STUDIO_MAX_TOKENS;
    
    console.log(`[ReCorrect DoublePrecision] Using LM Studio: ${lmStudioUrl}, model: ${modelName}`);
    
    const res = await fetch(`${lmStudioUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: modelName,
        messages: [
          { role: 'system', content: mergePrompt },
          { role: 'user', content: 'Erstelle den finalen Text.' }
        ],
        temperature,
        max_tokens: maxTokens,
      }),
    });
    
    if (!res.ok) {
      const errorText = await res.text();
      console.error(`[ReCorrect DoublePrecision] LM Studio error: ${res.status} - ${errorText.substring(0, 200)}`);
      throw new Error(`LM Studio API error: ${res.status}`);
    }
    
    const data = await res.json();
    const lmContent = data.choices?.[0]?.message?.content;
    finalText = (typeof lmContent === 'string' ? lmContent.trim() : (lmContent ? String(lmContent) : '')) || result1.text;
  } else {
    console.warn(`[ReCorrect DoublePrecision] Unknown LLM provider "${llmProvider}", using first transcription`);
    modelName = 'fallback';
    modelProvider = 'none';
    finalText = result1.text;
  }
  
  // Remove any Markdown formatting that the LLM may have added despite instructions
  finalText = removeMarkdownFormatting(finalText);
  
  console.log(`[ReCorrect DoublePrecision] ✓ Merged text length: ${finalText.length} chars (after Markdown cleanup)`);
  
  // Log double precision correction
  try {
    const dpChangeScore = calculateChangeScore(result1.text, finalText);
    const dpLogText = `[DOUBLE PRECISION - UNTERSCHIEDE GEFUNDEN]\n\n` +
      `Transkription A (${merged.provider1}):\n${merged.text1}\n\n` +
      `Transkription B (${merged.provider2}):\n${merged.text2}\n\n` +
      `Markierte Unterschiede:\n${merged.mergedTextWithMarkers}`;
    
    await logDoublePrecisionCorrectionWithRequest(
      request,
      dictationId,
      dpLogText,
      finalText,
      modelName,
      modelProvider,
      dpChangeScore
    );
    console.log(`[ReCorrect DoublePrecision] ✓ Logged (model: ${modelProvider}/${modelName}, score: ${dpChangeScore}%)`);
  } catch (logError: any) {
    console.warn(`[ReCorrect DoublePrecision] Failed to log: ${logError.message}`);
  }
  
  return finalText;
}

/**
 * Perform final LLM correction
 */
async function correctText(
  request: NextRequest,
  text: string,
  username: string,
  patientName?: string,
  patientDob?: string,
  dictionaryEntries?: DictionaryEntry[]
): Promise<string> {
  const runtimeConfig = await getRuntimeConfigWithRequest(request);
  const llmConfig = await getLLMConfig(request);
  const doctorName = extractDoctorName(username);
  const promptAddition = runtimeConfig.llmPromptAddition?.trim();
  
  // Build dictionary section
  let dictionaryPromptSection = '';
  if (dictionaryEntries && dictionaryEntries.length > 0) {
    const dictionaryLines = dictionaryEntries.map(e => `"${e.wrong}" → "${e.correct}"`).join(', ');
    dictionaryPromptSection = `\n\nWÖRTERBUCH (HÖCHSTE PRIORITÄT):\n${dictionaryLines}`;
  }
  
  // Build context section
  let contextPromptSection = '';
  const contextParts: string[] = [];
  // Ensure patientName and patientDob are strings before calling .trim()
  const patientNameStr = typeof patientName === 'string' ? patientName : '';
  const patientDobStr = typeof patientDob === 'string' ? patientDob : '';
  if (patientNameStr && patientNameStr.trim()) contextParts.push(`Patient: ${patientNameStr}`);
  if (patientDobStr && patientDobStr.trim()) contextParts.push(`Geb.: ${patientDobStr}`);
  if (doctorName) contextParts.push(`Arzt: Dr. ${doctorName}`);
  if (contextParts.length > 0) {
    contextPromptSection = `\n\nDIKTAT-KONTEXT:\n${contextParts.join(', ')}`;
  }
  
  const systemPrompt = `Du bist ein medizinischer Diktat-Korrektur-Assistent.

AUFGABE: Korrigiere den Text zwischen <<<DIKTAT_START>>> und <<<DIKTAT_ENDE>>> und gib NUR den korrigierten Text zurück.

REGELN:
1. Korrigiere Grammatik- und Rechtschreibfehler
2. Korrigiere falsch transkribierte medizinische Fachbegriffe
3. Wandle ausgeschriebene Zahlen in Ziffern um: "acht Millimeter" → "8 mm"
4. Behalte den Stil des Diktierenden bei
5. Gib AUSSCHLIESSLICH den korrigierten Text zurück - keine Erklärungen!${dictionaryPromptSection}${contextPromptSection}${promptAddition ? `\n\n=== OVERRULE - DIESE ANWEISUNGEN HABEN VORRANG ===\n${promptAddition}` : ''}`;

  // Helper to call a cloud LLM (OpenAI/Mistral) for a single chunk
  async function callCloudLLM(prompt: string, chunkText: string): Promise<string> {
    const chunkUserMessage = `<<<DIKTAT_START>>>\n${chunkText}\n<<<DIKTAT_ENDE>>>`;
    let url = '';
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    
    if (llmConfig.provider === 'openai') {
      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) return chunkText;
      url = 'https://api.openai.com/v1/chat/completions';
      headers['Authorization'] = `Bearer ${apiKey}`;
    } else if (llmConfig.provider === 'mistral') {
      const apiKey = process.env.MISTRAL_API_KEY;
      if (!apiKey) return chunkText;
      url = 'https://api.mistral.ai/v1/chat/completions';
      headers['Authorization'] = `Bearer ${apiKey}`;
    } else {
      return chunkText;
    }
    
    // Add timeout - 5 minutes for very long texts, 2 minutes for normal
    const totalChars = prompt.length + chunkText.length;
    const timeoutMs = totalChars > 20000 ? 300000 : 120000;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => {
      controller.abort();
      console.error(`[ReCorrect] Request TIMEOUT after ${timeoutMs / 1000}s for ${llmConfig.provider}`);
    }, timeoutMs);
    
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          model: llmConfig.model,
          messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: chunkUserMessage }
          ],
          temperature: 0.1,
        }),
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      
      if (res.ok) {
        const data = await res.json();
        const content = data.choices?.[0]?.message?.content;
        return (typeof content === 'string' ? content.trim() : (content ? String(content) : '')) || chunkText;
      }
      return chunkText;
    } catch (error: any) {
      clearTimeout(timeoutId);
      if (error.name === 'AbortError') {
        throw new Error(`LLM request timeout after ${timeoutMs / 1000}s (provider: ${llmConfig.provider}, input: ${totalChars} chars)`);
      }
      throw error;
    }
  }
  
  let correctedText = text;
  
  if (llmConfig.provider === 'openai' || llmConfig.provider === 'mistral') {
    // Check if text needs chunking
    if (text.length > CLOUD_LLM_MAX_CHARS) {
      const chunks = splitTextIntoChunksByCharLimit(text, CLOUD_LLM_MAX_CHARS);
      console.log(`[ReCorrect] Cloud LLM (${llmConfig.provider}): Text too long (${text.length} chars), splitting into ${chunks.length} chunks of max ${CLOUD_LLM_MAX_CHARS} chars`);
      
      const correctedChunks: string[] = [];
      
      for (let i = 0; i < chunks.length; i++) {
        const chunk = chunks[i];
        console.log(`[ReCorrect] Cloud chunk ${i + 1}/${chunks.length}: ${chunk.length} chars`);
        const result = await callCloudLLM(systemPrompt, chunk);
        correctedChunks.push(result);
      }
      
      correctedText = correctedChunks
        .join('\n\n')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[^\S\n]+/g, ' ')
        .trim();
    } else {
      correctedText = await callCloudLLM(systemPrompt, text);
    }
  } else if (llmConfig.provider === 'lmstudio') {
    const lmStudioUrl = process.env.LLM_STUDIO_URL || 'http://localhost:1234';
    
    // LM Studio uses fixed max tokens
    const temperature = 0.1;
    const maxTokens = LM_STUDIO_MAX_TOKENS;
    
    const res = await fetch(`${lmStudioUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: llmConfig.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `<<<DIKTAT_START>>>\n${text}\n<<<DIKTAT_ENDE>>>` }
        ],
        temperature,
        max_tokens: maxTokens,
      }),
    });
    
    if (res.ok) {
      const data = await res.json();
      const lmCorrContent = data.choices?.[0]?.message?.content;
      correctedText = (typeof lmCorrContent === 'string' ? lmCorrContent.trim() : (lmCorrContent ? String(lmCorrContent) : '')) || text;
    }
  }
  
  // Remove any Markdown formatting that the LLM may have added despite instructions
  correctedText = removeMarkdownFormatting(correctedText);
  
  return correctedText;
}

/**
 * POST: Re-run the complete LLM correction pipeline
 * - If Double Precision logs exist with two transcripts, re-run the merge
 * - Then run the final LLM correction
 */
export async function POST(req: NextRequest) {
  try {
    await initOfflineDictationTableWithRequest(req);
    await initCorrectionLogTableWithRequest(req);
    
    const { dictationId } = await req.json();
    
    if (!dictationId) {
      return NextResponse.json({ error: 'dictationId required' }, { status: 400 });
    }
    
    // Get dictation
    const dictation = await getDictationByIdWithRequest(req, dictationId);
    if (!dictation) {
      return NextResponse.json({ error: 'Dictation not found' }, { status: 404 });
    }
    
    if (dictation.status !== 'completed') {
      return NextResponse.json({ error: 'Dictation is not completed yet' }, { status: 400 });
    }
    
    console.log(`[ReCorrect] Starting re-correction for dictation #${dictationId}`);
    
    // Convert patient_name and patient_dob to strings (they may come as Date objects or null from DB)
    // Use 'any' cast because the DB may return Date objects even though TypeScript expects strings
    const rawPatientName = dictation.patient_name as any;
    const rawPatientDob = dictation.patient_dob as any;
    const patientName = typeof rawPatientName === 'string' 
      ? rawPatientName 
      : (rawPatientName instanceof Date 
          ? rawPatientName.toISOString().split('T')[0] 
          : (rawPatientName ? String(rawPatientName) : undefined));
    const patientDob = typeof rawPatientDob === 'string' 
      ? rawPatientDob 
      : (rawPatientDob instanceof Date 
          ? rawPatientDob.toISOString().split('T')[0] 
          : (rawPatientDob ? String(rawPatientDob) : undefined));
    
    console.log(`[ReCorrect] Patient context - name: "${patientName || '(none)'}", dob: "${patientDob || '(none)'}", username: "${dictation.username || '(none)'}"`);
    console.log(`[ReCorrect] Raw DB types - patient_name: ${typeof rawPatientName} (${rawPatientName instanceof Date ? 'Date' : 'not Date'}), patient_dob: ${typeof rawPatientDob} (${rawPatientDob instanceof Date ? 'Date' : 'not Date'})`);
    
    // Get correction logs to find Double Precision entries
    const logs = await getCorrectionLogByDictationIdWithRequest(req, dictationId);
    const doublePrecisionLog = logs.find(l => l.correction_type === 'doublePrecision');
    
    // Load dictionary
    const dictionary = dictation.username 
      ? await loadDictionaryWithRequest(req, dictation.username) 
      : { entries: [] };
    const dictionaryEntries = dictionary.entries;
    console.log(`[ReCorrect] Dictionary loaded: ${dictionaryEntries.length} entries for user "${dictation.username || '(none)'}"`);
    
    // Extract doctor name
    const doctorName = dictation.username ? extractDoctorName(dictation.username) : undefined;
    
    let textForCorrection: string;
    
    // Check if we have Double Precision transcripts to re-merge
    if (doublePrecisionLog && doublePrecisionLog.text_before) {
      const parsed = parseDoublePrecisionLog(doublePrecisionLog.text_before);
      
      if (parsed && parsed.text1 && parsed.text2) {
        console.log(`[ReCorrect] Found two transcripts from Double Precision log`);
        console.log(`[ReCorrect] Transcript A (${parsed.provider1}): ${parsed.text1.length} chars`);
        console.log(`[ReCorrect] Transcript B (${parsed.provider2}): ${parsed.text2.length} chars`);
        
        // Re-run Double Precision merge with current LLM settings
        const mergeContext: MergeContext = {
          dictionaryEntries,
          patientName,
          patientDob,
          doctorName,
        };
        
        textForCorrection = await doublePrecisionMerge(
          req,
          dictationId,
          { text: parsed.text1, provider: parsed.provider1 },
          { text: parsed.text2, provider: parsed.provider2 },
          mergeContext
        );
        
        console.log(`[ReCorrect] Double Precision merge complete: ${textForCorrection.length} chars`);
      } else {
        console.log(`[ReCorrect] Could not parse Double Precision log, using raw_transcript`);
        textForCorrection = dictation.raw_transcript || dictation.transcript || '';
      }
    } else {
      // No Double Precision - use raw transcript
      console.log(`[ReCorrect] No Double Precision log found, using raw_transcript`);
      textForCorrection = dictation.raw_transcript || dictation.transcript || '';
    }
    
    if (!textForCorrection) {
      return NextResponse.json({ error: 'No transcript available for correction' }, { status: 400 });
    }
    
    // Step 1: Preprocess (formatting + dictionary)
    const textBeforeFormatting = textForCorrection;
    const preprocessedText = preprocessTranscription(textForCorrection, dictionaryEntries);
    
    // Log text formatting if changed
    if (preprocessedText !== textBeforeFormatting) {
      try {
        const formattingChangeScore = calculateChangeScore(textBeforeFormatting, preprocessedText);
        await logTextFormattingCorrectionWithRequest(
          req,
          dictationId,
          textBeforeFormatting,
          preprocessedText,
          formattingChangeScore
        );
        console.log(`[ReCorrect] ✓ Text formatting logged (score: ${formattingChangeScore}%)`);
      } catch (logError: any) {
        console.warn(`[ReCorrect] Failed to log formatting: ${logError.message}`);
      }
    }
    
    // Step 2: Final LLM correction
    const textBeforeLLM = preprocessedText;
    const correctedText = await correctText(
      req,
      preprocessedText,
      dictation.username,
      patientName,
      patientDob,
      dictionaryEntries
    );
    
    // Log LLM correction if changed
    if (correctedText !== textBeforeLLM) {
      try {
        const llmChangeScore = calculateChangeScore(textBeforeLLM, correctedText);
        const llmConfig = await getLLMConfig(req);
        await logLLMCorrectionWithRequest(
          req,
          dictationId,
          textBeforeLLM,
          correctedText,
          llmConfig.model,
          llmConfig.provider,
          llmChangeScore
        );
        console.log(`[ReCorrect] ✓ LLM correction logged (model: ${llmConfig.provider}/${llmConfig.model}, score: ${llmChangeScore}%)`);
      } catch (logError: any) {
        console.warn(`[ReCorrect] Failed to log LLM correction: ${logError.message}`);
      }
    }
    
    // Calculate final change score (from raw transcript to final)
    const rawTranscript = dictation.raw_transcript || dictation.transcript || '';
    const finalChangeScore = calculateChangeScore(rawTranscript, correctedText);
    
    // Save corrected text to database immediately
    await updateCorrectedTextWithRequest(req, dictationId, correctedText, finalChangeScore);
    console.log(`[ReCorrect] ✓ Saved to DB - dictation #${dictationId}`);
    
    console.log(`[ReCorrect] ✓ Complete - Final text: ${correctedText.length} chars, change score: ${finalChangeScore}%`);
    
    return NextResponse.json({
      success: true,
      correctedText,
      changeScore: finalChangeScore,
      hadDoublePrecision: !!doublePrecisionLog,
      doublePrecisionReRan: !!(doublePrecisionLog && parseDoublePrecisionLog(doublePrecisionLog.text_before)),
      llmProvider: (await getLLMConfig(req)).provider,
      llmModel: (await getLLMConfig(req)).model,
    });
    
  } catch (error: any) {
    console.error('[ReCorrect] Error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
