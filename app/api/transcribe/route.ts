import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Transkriptions-Provider auswählen
type TranscriptionProvider = 'whisperx' | 'elevenlabs';

async function transcribeWithWhisperX(file: Blob, filename: string) {
  const whisperUrl = process.env.WHISPER_SERVICE_URL || 'http://localhost:5000';
  const fileSizeMB = (file.size / 1024 / 1024).toFixed(2);
  console.log(`[WhisperX] Starting transcription - File: ${filename}, Size: ${fileSizeMB}MB, URL: ${whisperUrl}`);

  const startTime = Date.now();
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
