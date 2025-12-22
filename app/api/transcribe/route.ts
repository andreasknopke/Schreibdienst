import { NextResponse } from 'next/server';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  try {
    const apiKey = process.env.ELEVENLABS_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'Server misconfigured: ELEVENLABS_API_KEY missing' }, { status: 500 });
    }

    const form = await request.formData();
    const file = form.get('file');
    if (!file || !(file instanceof Blob)) {
      return NextResponse.json({ error: 'No file provided' }, { status: 400 });
    }

    const upstream = new FormData();
    // Forward original file
    upstream.append('file', file, 'audio');
    upstream.append('model_id', 'scribe_v1');
    upstream.append('language_code', 'de');

    const res = await fetch('https://api.elevenlabs.io/v1/speech-to-text', {
      method: 'POST',
      headers: {
        'xi-api-key': apiKey,
      },
      body: upstream,
    });

    if (!res.ok) {
      const text = await res.text();
      return NextResponse.json({ error: 'Transcription failed', details: text }, { status: res.status });
    }

    const data = await res.json();
    return NextResponse.json({ text: data.text ?? '' });
  } catch (err: any) {
    return NextResponse.json({ error: 'Unexpected error', message: err?.message }, { status: 500 });
  }
}
