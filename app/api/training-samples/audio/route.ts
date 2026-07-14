import { NextRequest } from 'next/server';
import { NextResponse } from 'next/server';
import { authenticateUserWithRequest } from '@/lib/usersDb';
import { parseBasicAuth } from '@/lib/apiHelpers';
import {
  initTrainingSamplesTableWithRequest,
  getTrainingSampleWithRequest,
} from '@/lib/trainingSamplesDb';
import {
  initOfflineDictationTableWithRequest,
  getAudioDataWithRequest,
} from '@/lib/offlineDictationDb';
import { extractAudioSlice } from '@/lib/audioSlicing';

export const runtime = 'nodejs';

async function getAuthenticatedRoot(request: NextRequest): Promise<string | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Basic ')) return null;
  try {
    const parsed = parseBasicAuth(authHeader);
    if (!parsed) return null;
    const result = await authenticateUserWithRequest(request, parsed.username, parsed.password);
    if (result.success && result.user && result.user.username.toLowerCase() === 'root') {
      return result.user.username;
    }
  } catch { /* invalid */ }
  return null;
}

// GET ?id=123 → 16kHz mono WAV slice for the given training sample
export async function GET(req: NextRequest) {
  const root = await getAuthenticatedRoot(req);
  if (!root) {
    return NextResponse.json({ error: 'Nur root darf Audio-Slices abrufen' }, { status: 403 });
  }
  try {
    await initOfflineDictationTableWithRequest(req);
    await initTrainingSamplesTableWithRequest(req);

    const { searchParams } = new URL(req.url);
    const id = Number(searchParams.get('id'));
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'id ist erforderlich' }, { status: 400 });
    }

    const sample = await getTrainingSampleWithRequest(req, id);
    if (!sample) {
      return NextResponse.json({ error: 'Sample nicht gefunden' }, { status: 404 });
    }

    const audioData = await getAudioDataWithRequest(req, sample.dictation_id);
    if (!audioData || !audioData.audio_data || audioData.audio_data.length === 0) {
      return NextResponse.json({ error: 'Audio nicht vorhanden' }, { status: 404 });
    }

    const slice = await extractAudioSlice(
      Buffer.from(audioData.audio_data),
      audioData.audio_mime_type || 'audio/wav',
      sample.start_time,
      sample.end_time
    );
    if (!slice) {
      return NextResponse.json({ error: 'Audio-Slice konnte nicht extrahiert werden' }, { status: 500 });
    }

    return new Response(slice, {
      headers: {
        'Content-Type': 'audio/wav',
        'Content-Length': slice.length.toString(),
        'Cache-Control': 'private, max-age=3600',
      },
    });
  } catch (error: any) {
    console.error('[TrainingSamples/audio] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
