import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

// Transkriptions-Provider auswählen
type TranscriptionProvider = 'whisperx' | 'elevenlabs';

async function transcribeWithWhisperX(file: Blob, filename: string) {
  const whisperUrl = process.env.WHISPER_SERVICE_URL || 'http://localhost:5000';
  console.log(`Using WhisperX at ${whisperUrl}`);

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

  console.log('Using ElevenLabs API');

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
  return {
    text: data.text ?? '',
    segments: [],
    language: 'de',
    provider: 'elevenlabs' as const
  };
}

export async function POST(request: Request) {
  try {
    console.log('Transcribe API called');

    // Provider-Auswahl: whisperx (Standard) oder elevenlabs
    const provider = (process.env.TRANSCRIPTION_PROVIDER || 'whisperx') as TranscriptionProvider;
    console.log(`Selected transcription provider: ${provider} (from env: ${process.env.TRANSCRIPTION_PROVIDER || 'not set - using default'})`);
    
    const form = await request.formData();
    const file = form.get('file');
    
    console.log('File received:', file ? 'Yes' : 'No', file instanceof Blob ? 'Blob' : typeof file);
    if (!file || !(file instanceof Blob)) {
      console.error('Invalid file:', file);
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const filename = (file as File).name || 'audio.webm';

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

    console.log(`Transcription successful with ${result.provider}`);
    return NextResponse.json(result);
    
  } catch (err: any) {
    console.error('Transcription error:', err);
    return NextResponse.json({ 
      error: 'Transcription failed', 
      message: err?.message 
    }, { status: 500 });
  }
}
