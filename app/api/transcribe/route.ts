import { NextRequest, NextResponse } from 'next/server';
import { getRuntimeConfigWithRequest } from '@/lib/configDb';
import { loadDictionaryWithRequest, DictionaryEntry } from '@/lib/dictionaryDb';
import { normalizeAudioForWhisper } from '@/lib/audioCompression';

export const runtime = 'nodejs';

/**
 * Erkennt und entfernt Whisper-Halluzinationen (Wiederholungsmuster)
 * z.B. "Das ist ein Test, das ist ein Test, das ist ein Test" -> "Das ist ein Test"
 * z.B. "keine Mittellinien, keine Mittellinne" -> "keine Mittellinienverschiebung"
 */
function detectAndRemoveRepetition(text: string): string {
  if (!text || text.length < 20) return text;
  
  // Normalisiere Text für Vergleich
  const normalized = text.toLowerCase().trim();
  
  // 1. Erkenne ähnliche aufeinanderfolgende Phrasen (Levenshtein-ähnlich)
  // z.B. "keine Mittellinien, keine Mittellinne" 
  const parts = text.split(/[,،]+/).map(p => p.trim());
  if (parts.length >= 2) {
    const uniqueParts: string[] = [];
    for (const part of parts) {
      if (!part) continue;
      // Prüfe ob dieser Teil sehr ähnlich zu einem bereits gesehenen ist
      const isDuplicate = uniqueParts.some(existing => {
        const existingLower = existing.toLowerCase();
        const partLower = part.toLowerCase();
        // Exakte Übereinstimmung
        if (existingLower === partLower) return true;
        // Eine ist Präfix der anderen (mind. 80% Überlappung)
        const minLen = Math.min(existingLower.length, partLower.length);
        const maxLen = Math.max(existingLower.length, partLower.length);
        if (minLen > 5 && minLen / maxLen > 0.7) {
          // Prüfe ob sie mit denselben Wörtern beginnen
          const existingWords = existingLower.split(/\s+/);
          const partWords = partLower.split(/\s+/);
          const commonWords = existingWords.filter((w, i) => partWords[i] === w);
          if (commonWords.length >= Math.min(existingWords.length, partWords.length) * 0.6) {
            return true;
          }
        }
        return false;
      });
      
      if (!isDuplicate) {
        uniqueParts.push(part);
      }
    }
    
    // Wenn wir Duplikate entfernt haben, rekonstruiere den Text
    if (uniqueParts.length < parts.length) {
      const cleaned = uniqueParts.join(', ');
      return cleaned;
    }
  }
  
  // 2. Suche nach exakten Wiederholungsmustern unterschiedlicher Längen
  for (let patternLen = 5; patternLen <= Math.floor(normalized.length / 2); patternLen++) {
    // Extrahiere potentielles Muster vom Anfang
    const pattern = normalized.substring(0, patternLen);
    
    // Zähle wie oft das Muster vorkommt
    let count = 0;
    let pos = 0;
    while (pos < normalized.length) {
      const nextOccurrence = normalized.indexOf(pattern, pos);
      if (nextOccurrence === -1) break;
      count++;
      pos = nextOccurrence + 1;
    }
    
    // Wenn das Muster mehr als 2x vorkommt, ist es wahrscheinlich eine Halluzination
    if (count >= 3) {
      // Finde das erste vollständige Vorkommen und gib es zurück
      // Suche nach einem sinnvollen Abschluss (Satzzeichen oder Wortgrenze)
      const originalPattern = text.substring(0, patternLen);
      
      // Erweitere bis zum nächsten Satzzeichen oder Komma
      let endPos = patternLen;
      const punctuation = ['.', ',', '!', '?', ';', ':'];
      for (let i = patternLen; i < text.length; i++) {
        if (punctuation.includes(text[i])) {
          endPos = i + 1;
          break;
        }
        // Prüfe ob wir am Anfang einer Wiederholung sind
        if (text.substring(i).toLowerCase().startsWith(pattern)) {
          break;
        }
        endPos = i + 1;
      }
      
      const cleaned = text.substring(0, endPos).trim();
      // Entferne trailing Komma
      return cleaned.replace(/,\s*$/, '');
    }
  }
  
  return text;
}

// Extrahiere eindeutige korrekte Wörter aus dem Wörterbuch für initial_prompt
// Nur Einträge mit useInPrompt=true werden berücksichtigt
function getUniqueCorrectWords(dictionary: { entries: DictionaryEntry[] }): string {
  if (!dictionary?.entries || dictionary.entries.length === 0) return '';
  
  // Sammle alle korrekten Wörter von Einträgen mit useInPrompt=true
  const uniqueWords = new Set<string>();
  for (const entry of dictionary.entries) {
    // Nur Einträge mit useInPrompt flag verwenden
    if (entry.correct && entry.useInPrompt) {
      // Füge das gesamte korrekte Wort/Phrase hinzu
      uniqueWords.add(entry.correct.trim());
    }
  }
  
  // Verbinde mit Komma für den initial_prompt
  return Array.from(uniqueWords).join(', ');
}

// Transkriptions-Provider auswählen
type TranscriptionProvider = 'whisperx' | 'elevenlabs' | 'mistral';

// Session-Cache für Gradio (vermeidet wiederholtes Login)
let gradioSessionCache: {
  cookie: string;
  timestamp: number;
  url: string;
} | null = null;
const SESSION_MAX_AGE = 5 * 60 * 1000; // 5 Minuten

async function transcribeWithWhisperX(file: Blob, filename: string, initialPrompt?: string, whisperModel?: string, speedMode: 'turbo' | 'precision' | 'auto' = 'turbo') {
  const whisperUrl = process.env.WHISPER_SERVICE_URL || 'http://localhost:5000';
  const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
  // Use provided model or fallback to env/default
  const modelToUse = whisperModel || process.env.WHISPER_MODEL || 'large-v3';
  console.log(`[WhisperX] Starting transcription - File: ${filename}, Size: ${fileSizeMB}MB, URL: ${whisperUrl}, Model: ${modelToUse}, Mode: ${speedMode}${initialPrompt ? `, Initial prompt: ${initialPrompt.length} chars` : ''}`);

  const startTime = Date.now();
  
  // Check if it's a Gradio interface (port 7860 is typical for Gradio)
  const isGradio = whisperUrl.includes(':7860');
  
  if (isGradio) {
    // Prüfe ob wir eine gültige gecachte Session haben
    const now = Date.now();
    let sessionCookie: string;
    
    if (gradioSessionCache && 
        gradioSessionCache.url === whisperUrl && 
        (now - gradioSessionCache.timestamp) < SESSION_MAX_AGE) {
      // Nutze gecachte Session
      sessionCookie = gradioSessionCache.cookie;
      console.log(`[WhisperX] Using cached Gradio session`);
    } else {
      // Neue Session erstellen
      console.log(`[WhisperX] Creating new Gradio session`);
      
      // Get auth credentials (with workaround for env var names with trailing newlines)
      const authUser = process.env.WHISPER_AUTH_USERNAME;
      let authPass = process.env.WHISPER_AUTH_PASSWORD;
      
      // Fallback: find password by iterating env vars (handles malformed var names)
      if (!authPass) {
        const whisperEnvVars = Object.keys(process.env).filter(k => k.includes('WHISPER'));
        for (const key of whisperEnvVars) {
          if (key.includes('PASSWORD')) {
            authPass = process.env[key] || '';
          }
        }
      }
      
      // Step 1: Login to get session cookie
      const loginBody = `username=${encodeURIComponent(authUser || '')}&password=${encodeURIComponent(authPass || '')}`;
      
      const loginRes = await fetch(`${whisperUrl}/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: loginBody,
      });
      
      if (!loginRes.ok) {
        const errorText = await loginRes.text();
        throw new Error(`Gradio login failed (${loginRes.status}): ${errorText}`);
      }
      
      // Get session cookie from response
      const setCookieHeader = loginRes.headers.get('set-cookie');
      sessionCookie = setCookieHeader?.split(';')[0] || '';
      
      // Cache die Session
      gradioSessionCache = {
        cookie: sessionCookie,
        timestamp: now,
        url: whisperUrl
      };
    }
    
    // Step 2: Upload file
    const uploadFormData = new FormData();
    uploadFormData.append('files', file, filename);
    
    let uploadRes = await fetch(`${whisperUrl}/gradio_api/upload?upload_id=${Date.now()}`, {
      method: 'POST',
      headers: {
        'Cookie': sessionCookie,
      },
      body: uploadFormData,
    });
    
    // Bei 401/403: Session abgelaufen, Cache invalidieren und neu versuchen
    if (uploadRes.status === 401 || uploadRes.status === 403) {
      console.log(`[WhisperX] Session expired, re-authenticating...`);
      gradioSessionCache = null;
      // Rekursiver Aufruf mit frischer Session
      return transcribeWithWhisperX(file, filename, initialPrompt, whisperModel, speedMode);
    }
    
    if (!uploadRes.ok) {
      const text = await uploadRes.text();
      throw new Error(`Gradio upload failed (${uploadRes.status}): ${text}`);
    }
    
    const uploadData = await uploadRes.json();
    
    // uploadData is array of file info objects
    const uploadedFile = uploadData[0];
    const filePath = uploadedFile.path || uploadedFile;
    
    // Step 3: Call start_process API
    
    // Create FileData object as expected by Gradio
    const fileDataObj = {
      path: filePath,
      orig_name: filename,
      size: file.size,
      mime_type: file.type || 'audio/webm',
      meta: { _type: 'gradio.FileData' }
    };
    
    // Language for WhisperX Gradio - must match dropdown options (full name, not ISO code)
    const languageCode = 'German';

    const processRes = await fetch(`${whisperUrl}/gradio_api/call/start_process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': sessionCookie,
      },
      body: JSON.stringify({
        data: [
          fileDataObj,   // file
          languageCode,  // language (ISO code)
          modelToUse,    // model_name (from runtime config)
          "cuda",        // device
          initialPrompt || "" // medical dictionary terms for better recognition
        ]
      }),
    });
    
    if (!processRes.ok) {
      const text = await processRes.text();
      throw new Error(`Gradio process start failed (${processRes.status}): ${text}`);
    }
    
    const processData = await processRes.json();
    const eventId = processData.event_id;
    
    // Step 4: Poll for result using SSE endpoint
    
    const resultRes = await fetch(`${whisperUrl}/gradio_api/call/start_process/${eventId}`, {
      headers: {
        'Cookie': sessionCookie,
      },
    });
    
    if (!resultRes.ok) {
      const text = await resultRes.text();
      throw new Error(`Gradio result fetch failed (${resultRes.status}): ${text}`);
    }
    
    // Parse SSE response
    const resultText = await resultRes.text();
    
    // SSE format: "event: complete\ndata: [...]"
    const dataMatch = resultText.match(/data:\s*(\[.*\])/s);
    if (!dataMatch) {
      throw new Error(`Could not parse Gradio response: ${resultText.substring(0, 200)}`);
    }
    
    const resultData = JSON.parse(dataMatch[1]);
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    let transcriptionText = '';
    // Online-Modus: Keine Segmente extrahieren (Mitlesen nicht benötigt, spart Zeit)
    const segments: any[] = [];
    
    // Extract transcription text from first result
    const firstResult = resultData[0];
    if (typeof firstResult === 'string') {
      transcriptionText = firstResult;
    } else if (firstResult && typeof firstResult === 'object') {
      if (firstResult.value) {
        // Check if it's an error message
        if (firstResult.value.toString().startsWith('Error')) {
          console.error(`[WhisperX Gradio] ✗ Server error: ${firstResult.value}`);
          throw new Error(`WhisperX server error: ${firstResult.value}`);
        }
        transcriptionText = firstResult.value;
      }
    }
    
    const textLength = transcriptionText.length;
    console.log(`[WhisperX Gradio] ✓ Transcription complete - Duration: ${duration}s, Text length: ${textLength} chars`);
    
    if (!transcriptionText || textLength === 0) {
      console.warn(`[WhisperX Gradio] Warning: Empty transcription returned`);
    }
    
    // Halluzinations-Erkennung: Wiederholungsmuster erkennen
    // z.B. "Das ist ein Test, das ist ein Test, das ist ein Test"
    const cleanedText = detectAndRemoveRepetition(transcriptionText);
    if (cleanedText !== transcriptionText) {
      console.warn(`[WhisperX Gradio] ⚠ Repetition detected and cleaned: "${transcriptionText.substring(0, 50)}..." -> "${cleanedText}"`);
    }
    
    return {
      text: cleanedText,
      segments: segments, // Now includes word-level timestamps for frontend highlighting
      language: 'de',
      provider: 'whisperx' as const
    };
  }
  
  // Original FastAPI implementation
  const upstream = new FormData();
  upstream.append('file', file, filename);
  upstream.append('language', 'de');
  upstream.append('align', speedMode === 'precision' ? 'true' : 'false'); // Turbo: kein Alignment für Speed
  upstream.append('speed_mode', speedMode); // turbo, precision, auto
  
  // Füge initial_prompt hinzu wenn Wörterbuch-Wörter vorhanden
  if (initialPrompt) {
    upstream.append('initial_prompt', initialPrompt);
    console.log(`[WhisperX] Using initial_prompt with dictionary words: "${initialPrompt.substring(0, 100)}${initialPrompt.length > 100 ? '...' : ''}"`);
  }

  const res = await fetch(`${whisperUrl}/transcribe`, {
    method: 'POST',
    body: upstream,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`WhisperX API error (${res.status}): ${text}`);
  }

  const data = await res.json();
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  const textLength = (data.text ?? '').length;
  const segmentCount = (data.segments || []).length;
  console.log(`[WhisperX] ✓ Transcription complete - Duration: ${duration}s, Text length: ${textLength} chars, Segments: ${segmentCount}`);
  
  return {
    text: data.text ?? '',
    segments: data.segments || [],
    language: data.language || 'de',
    provider: 'whisperx' as const
  };
}

async function transcribeWithElevenLabs(file: Blob, filename: string) {
  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw new Error('ELEVENLABS_API_KEY not configured');
  }

  const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
  console.log(`[ElevenLabs] Starting transcription - File: ${filename}, Size: ${fileSizeMB}MB, Model: scribe_v1`);
  const startTime = Date.now();

  const upstream = new FormData();
  upstream.append('file', file, filename);
  upstream.append('model_id', 'scribe_v1');
  upstream.append('language_code', 'de');
  upstream.append('tag_audio_events', 'false');
  // Request word-level timestamps for Mitlesen feature
  upstream.append('timestamps_granularity', 'word');

  const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
    },
    body: upstream,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`ElevenLabs API error (${res.status}): ${text}`);
  }

  const data = await res.json();
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  const textLength = (data.text ?? '').length;
  console.log(`[ElevenLabs] ✓ Transcription complete - Duration: ${duration}s, Text length: ${textLength} chars`);
  
  // Build segments from word timestamps
  let segments: any[] = [];
  if (data.words && Array.isArray(data.words)) {
    const words = data.words
      .filter((w: any) => w.type === 'word' || !w.type)
      .map((w: any) => ({
        word: w.text || w.word,
        start: w.start_time ?? w.start,
        end: w.end_time ?? w.end
      }));
    
    if (words.length > 0) {
      segments = [{
        text: data.text ?? '',
        start: words[0].start,
        end: words[words.length - 1].end,
        words: words
      }];
    }
    console.log(`[ElevenLabs] Received ${words.length} words with timestamps`);
  }
  
  return {
    text: data.text ?? '',
    segments: segments,
    language: 'de',
    provider: 'elevenlabs' as const
  };
}

/**
 * Transkription mit Mistral AI Voxtral
 * Verwendet den dedizierten Audio-Transkriptions-Endpunkt von Mistral
 * API-Dokumentation: https://docs.mistral.ai/capabilities/audio_transcription
 */
async function transcribeWithMistral(file: Blob, filename: string) {
  const apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    throw new Error('MISTRAL_API_KEY not configured');
  }

  const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
  console.log(`[Mistral] Starting transcription - File: ${filename}, Size: ${fileSizeMB}MB, Type: ${file.type}`);
  const startTime = Date.now();

  // Convert audio to Buffer first
  const arrayBuffer = await file.arrayBuffer();
  let audioBuffer = Buffer.from(arrayBuffer);
  let mimeType = file.type || 'audio/webm';
  
  // ALWAYS convert to WAV for reliable Mistral API compatibility
  // The /audio/transcriptions endpoint has issues with some formats like m4a
  console.log(`[Mistral] Converting ${mimeType} to WAV for reliable Mistral API...`);
  const { data: normalizedData, mimeType: normalizedMime, normalized } = 
    await normalizeAudioForWhisper(audioBuffer, mimeType);
  if (normalized) {
    audioBuffer = normalizedData;
    mimeType = normalizedMime;
    console.log(`[Mistral] Converted to WAV: ${(audioBuffer.length / 1024 / 1024).toFixed(2)}MB`);
  } else {
    console.log(`[Mistral] Warning: Could not convert audio to WAV`);
  }
  
  // Use the dedicated audio/transcriptions endpoint
  const formData = new FormData();
  
  console.log(`[Mistral] Sending file as audio.wav with mime ${mimeType}`);
  
  // Use File object instead of Blob for proper multipart/form-data handling in Node.js
  const audioFile = new File([audioBuffer], 'audio.wav', { type: mimeType });
  formData.append('file', audioFile);
  formData.append('model', 'voxtral-mini-latest');
  formData.append('language', 'de'); // Force German to prevent hallucinations

  const res = await fetch('https://api.mistral.ai/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
    },
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Mistral API error (${res.status}): ${text}`);
  }

  const data = await res.json();
  const transcriptionText = data.text || '';
  
  const duration = ((Date.now() - startTime) / 1000).toFixed(2);
  const textLength = transcriptionText.length;
  console.log(`[Mistral] ✓ Transcription complete - Duration: ${duration}s, Text length: ${textLength} chars`);
  
  return {
    text: transcriptionText,
    segments: [],
    language: 'de',
    provider: 'mistral' as const
  };
}

export async function POST(request: NextRequest) {
  try {
    console.log('\n=== Transcription Request Started ===')
    const requestStart = Date.now();

    // Provider-Auswahl aus Runtime-Konfiguration
    const runtimeConfig = await getRuntimeConfigWithRequest(request);
    const provider = runtimeConfig.transcriptionProvider;
    console.log(`[Config] Provider: ${provider} (from runtime config)`);
    
    const form = await request.formData();
    const file = form.get('file');
    const username = form.get('username') as string | null;
    
    if (!file || !(file instanceof Blob)) {
      console.error('[Error] Invalid file:', file);
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const filename = (file as File).name || 'audio.webm';
    const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
    console.log(`[Input] File: ${filename}, Size: ${fileSizeMB}MB, Type: ${file.type || 'unknown'}, User: ${username || 'unknown'}`);

    // Lade Wörterbuch für initial_prompt bei WhisperX
    // Begrenzt auf MAX_PROMPT_WORDS wichtigste Begriffe um Halluzinationen zu vermeiden
    const MAX_PROMPT_WORDS = 30;
    let initialPrompt: string | undefined;
    if (username && provider !== 'elevenlabs') {
      try {
        const dictionary = await loadDictionaryWithRequest(request, username);
        const allWords = getUniqueCorrectWords(dictionary);
        if (allWords) {
          // Begrenze auf die ersten MAX_PROMPT_WORDS Begriffe
          const wordList = allWords.split(', ');
          const limitedWords = wordList.slice(0, MAX_PROMPT_WORDS);
          initialPrompt = limitedWords.join(', ');
          console.log(`[Dictionary] Using ${limitedWords.length}/${wordList.length} words for initial_prompt (max ${MAX_PROMPT_WORDS})`);
        }
      } catch (err) {
        console.warn('[Dictionary] Failed to load dictionary:', err);
      }
    }
    
    // Fallback: Medizinische Basis-Begriffe wenn kein Wörterbuch
    if (!initialPrompt) {
      // Häufige medizinische Begriffe die Whisper sonst falsch schreibt
      initialPrompt = "Liquorräume, Mittellinie, Mittellinienverschiebung, parenchymatös, Hirnparenchym, periventrikulär, supratentoriell, infratentoriell, Basalganglien, Thalamus, Kleinhirn, Hirnstamm, Ventrikel, Sulci, Gyri, Marklager";
      console.log(`[Dictionary] Using default medical terms (${initialPrompt.split(', ').length} words)`);
    }

    // Get whisper model from runtime config (Online-Transkription)
    // For online mode, use whisperModel directly (full HuggingFace path)
    const whisperModel = runtimeConfig.whisperModel || 'deepdml/faster-whisper-large-v3-german-2';
    console.log(`[Config] WhisperX Online Model: ${whisperModel} (from config)`);

    // Online-Transkription nutzt Turbo-Modus für minimale Latenz
    const speedMode: 'turbo' | 'precision' | 'auto' = 'turbo';
    console.log(`[Config] Speed Mode: ${speedMode} (optimized for live transcription)`);

    // Transkription mit gewähltem Provider
    let result;
    
    if (provider === 'elevenlabs') {
      console.log('Using ElevenLabs as primary provider');
      result = await transcribeWithElevenLabs(file, filename);
    } else if (provider === 'mistral') {
      console.log('Using Mistral AI Voxtral as primary provider');
      result = await transcribeWithMistral(file, filename);
    } else {
      // WhisperX ist Standard, mit Fallback zu ElevenLabs
      console.log('Using WhisperX as primary provider');
      try {
        result = await transcribeWithWhisperX(file, filename, initialPrompt, whisperModel, speedMode);
        
        // Detect if Whisper is hallucinating/repeating the initial_prompt
        // This is a known Whisper bug where it repeats prompt words instead of transcribing
        if (initialPrompt && result.text) {
          const promptWords = initialPrompt.split(',').map(w => w.trim().toLowerCase());
          const transcriptionWords = result.text.toLowerCase().split(/\s+/);
          
          // Check if transcription is just repeating prompt words
          const uniqueTranscriptionWords = [...new Set(transcriptionWords)] as string[];
          const allWordsFromPrompt = uniqueTranscriptionWords.every((word: string) => 
            promptWords.some(promptWord => promptWord.includes(word) || word.includes(promptWord))
          );
          
          // If transcription only contains prompt words and is repetitive, retry without prompt
          if (allWordsFromPrompt && transcriptionWords.length > 2 && uniqueTranscriptionWords.length <= 3) {
            console.warn(`[WhisperX] Detected Whisper hallucination (repeating prompt words). Retrying without initial_prompt...`);
            result = await transcribeWithWhisperX(file, filename, undefined, whisperModel, speedMode);
          }
        }
      } catch (whisperError: any) {
        console.warn('WhisperX failed, trying ElevenLabs fallback:', whisperError.message);
        
        // Fallback zu ElevenLabs wenn konfiguriert
        if (process.env.ELEVENLABS_API_KEY) {
          console.log('Falling back to ElevenLabs...');
          result = await transcribeWithElevenLabs(file, filename);
        } else {
          console.error('No fallback available - ElevenLabs API key not configured');
          throw whisperError;
        }
      }
    }

    const totalDuration = ((Date.now() - requestStart) / 1000).toFixed(2);
    console.log(`[Success] Provider: ${result.provider}, Total duration: ${totalDuration}s, Segments: ${result.segments?.length || 0}`);
    console.log('=== Transcription Request Complete ===\n');
    return NextResponse.json({
      text: result.text,
      segments: result.segments, // Word-level timestamps for frontend highlighting
      language: result.language,
      provider: result.provider,
      duration: parseFloat(totalDuration)
    });
    
  } catch (err: any) {
    console.error('[Error] Transcription failed:', err.message);
    console.error('[Error] Stack:', err.stack);
    console.log('=== Transcription Request Failed ===\n');
    return NextResponse.json({ 
      error: 'Transcription failed', 
      message: err?.message 
    }, { status: 500 });
  }
}
