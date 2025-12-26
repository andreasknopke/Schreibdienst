import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Transkriptions-Provider auswählen
type TranscriptionProvider = 'whisperx' | 'elevenlabs';

async function transcribeWithWhisperX(file: Blob, filename: string) {
  const whisperUrl = process.env.WHISPER_SERVICE_URL || 'http://localhost:5000';
  const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
  console.log(`[WhisperX] Starting transcription - File: ${filename}, Size: ${fileSizeMB}MB, URL: ${whisperUrl}`);

  const startTime = Date.now();
  
  // Check if it's a Gradio interface (port 7860 is typical for Gradio)
  const isGradio = whisperUrl.includes(':7860');
  
  if (isGradio) {
    console.log(`[WhisperX] Detected Gradio interface`);
    
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
    const sessionCookie = setCookieHeader?.split(';')[0] || '';
    
    // Step 2: Upload file
    const uploadFormData = new FormData();
    uploadFormData.append('files', file, filename);
    
    const uploadRes = await fetch(`${whisperUrl}/gradio_api/upload?upload_id=${Date.now()}`, {
      method: 'POST',
      headers: {
        'Cookie': sessionCookie,
      },
      body: uploadFormData,
    });
    
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
    
    const whisperModel = process.env.WHISPER_MODEL || 'large-v3';
    
    const processRes = await fetch(`${whisperUrl}/gradio_api/call/start_process`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Cookie': sessionCookie,
      },
      body: JSON.stringify({
        data: [
          fileDataObj,   // file
          "German",      // language
          whisperModel,  // model_name (from env or default large-v3)
          "cuda"         // device
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
    
    // Gradio returns array of results or update objects
    // Index 0 is TXT transcription - can be string or {value: string, __type__: "update"}
    let transcriptionText = '';
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
    
    return {
      text: transcriptionText,
      segments: [],
      language: 'de',
      provider: 'whisperx' as const
    };
  }
  
  // Original FastAPI implementation
  const upstream = new FormData();
  upstream.append('file', file, filename);
  upstream.append('language', 'de');
  upstream.append('align', 'true');

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
  
  return {
    text: data.text ?? '',
    segments: [],
    language: 'de',
    provider: 'elevenlabs' as const
  };
}

export async function POST(request: Request) {
  try {
    console.log('\n=== Transcription Request Started ===')
    const requestStart = Date.now();

    // Provider-Auswahl: whisperx (Standard) oder elevenlabs
    const provider = (process.env.TRANSCRIPTION_PROVIDER || 'whisperx') as TranscriptionProvider;
    console.log(`[Config] Provider: ${provider} (from env: ${process.env.TRANSCRIPTION_PROVIDER || 'not set - using default'})`);
    
    const form = await request.formData();
    const file = form.get('file');
    
    if (!file || !(file instanceof Blob)) {
      console.error('[Error] Invalid file:', file);
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const filename = (file as File).name || 'audio.webm';
    const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
    console.log(`[Input] File: ${filename}, Size: ${fileSizeMB}MB, Type: ${file.type || 'unknown'}`);

    // Transkription mit gewähltem Provider
    let result;
    
    if (provider === 'elevenlabs') {
      console.log('Using ElevenLabs as primary provider');
      result = await transcribeWithElevenLabs(file, filename);
    } else {
      // WhisperX ist Standard, mit Fallback zu ElevenLabs
      console.log('Using WhisperX as primary provider');
      try {
        result = await transcribeWithWhisperX(file, filename);
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
    console.log(`[Success] Provider: ${result.provider}, Total duration: ${totalDuration}s`);
    console.log('=== Transcription Request Complete ===\n');
    return NextResponse.json(result);
    
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
