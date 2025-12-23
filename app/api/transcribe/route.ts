import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    console.log('Transcribe API called');
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      console.error('ELEVENLABS_API_KEY missing');
      return NextResponse.json({ error: 'Server misconfigured: ELEVENLABS_API_KEY missing' }, { status: 500 });
    }

    const form = await request.formData();
    const file = form.get('file');
    console.log('File received:', file ? 'Yes' : 'No', file instanceof Blob ? 'Blob' : typeof file);
    if (!file || !(file instanceof Blob)) {
      console.error('Invalid file:', file);
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    console.log('Preparing ElevenLabs API call...');

    const upstream = new FormData();
    // Forward original file
    const filename = (file as File).name || 'audio.webm';
    upstream.append('file', file, filename);
    upstream.append('model_id', 'scribe_v1');
    upstream.append('language_code', 'de');
    // Deaktiviere Audio-Event-Tags wie (Blubbern), (Lachen), etc.
    upstream.append('tag_audio_events', 'false');

    const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
      },
      body: upstream,
    });

    console.log('ElevenLabs API response status:', res.status);

    if (!res.ok) {
      const text = await res.text();
      console.error('ElevenLabs API error:', res.status, text);
      return NextResponse.json({ error: 'Transcription failed', details: text }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json({ text: data.text ?? '' });
  } catch (err: any) {
    console.error('Unexpected error in transcribe API:', err);
    return NextResponse.json({ error: 'Unexpected error', message: err?.message }, { status: 500 });
  }
}
