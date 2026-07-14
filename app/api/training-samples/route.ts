import { NextRequest, NextResponse } from 'next/server';
import { authenticateUserWithRequest } from '@/lib/usersDb';
import { parseBasicAuth } from '@/lib/apiHelpers';
import {
  initTrainingSamplesTableWithRequest,
  createTrainingSampleWithRequest,
  listTrainingSamplesForDictationWithRequest,
  listAllTrainingSamplesWithRequest,
  updateTrainingSampleWithRequest,
  deleteTrainingSampleWithRequest,
  getTrainingStatsWithRequest,
  type TrainingSample,
} from '@/lib/trainingSamplesDb';
import { initOfflineDictationTableWithRequest } from '@/lib/offlineDictationDb';

export const runtime = 'nodejs';

/** Root-only auth guard, mirrors app/api/config/route.ts pattern. */
async function getAuthenticatedRoot(request: NextRequest): Promise<{ username: string } | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Basic ')) return null;
  try {
    const parsed = parseBasicAuth(authHeader);
    if (!parsed) return null;
    const result = await authenticateUserWithRequest(request, parsed.username, parsed.password);
    if (result.success && result.user && result.user.username.toLowerCase() === 'root') {
      return { username: result.user.username };
    }
  } catch { /* invalid auth header */ }
  return null;
}

// GET ?dictationId=123            → samples for one dictation (also used in archive UI)
// GET (no params)                  → all samples (training view)
// GET ?stats=true                  → aggregate stats
export async function GET(req: NextRequest) {
  const auth = await getAuthenticatedRoot(req);
  if (!auth) {
    return NextResponse.json({ error: 'Nur root darf Trainingsdaten abrufen' }, { status: 403 });
  }
  try {
    await initOfflineDictationTableWithRequest(req);
    await initTrainingSamplesTableWithRequest(req);

    const { searchParams } = new URL(req.url);
    const dictationId = searchParams.get('dictationId');
    const stats = searchParams.get('stats');

    if (stats === 'true') {
      const s = await getTrainingStatsWithRequest(req);
      return NextResponse.json(s);
    }

    let samples: TrainingSample[];
    if (dictationId) {
      samples = await listTrainingSamplesForDictationWithRequest(req, parseInt(dictationId, 10));
    } else {
      samples = await listAllTrainingSamplesWithRequest(req);
    }
    return NextResponse.json({ samples });
  } catch (error: any) {
    console.error('[TrainingSamples] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST create new sample
export async function POST(req: NextRequest) {
  const auth = await getAuthenticatedRoot(req);
  if (!auth) {
    return NextResponse.json({ error: 'Nur root darf Trainingsdaten anlegen' }, { status: 403 });
  }
  try {
    await initOfflineDictationTableWithRequest(req);
    await initTrainingSamplesTableWithRequest(req);

    const body = await req.json();
    const dictation_id = Number(body.dictation_id);
    const voxtral_raw_text = typeof body.voxtral_raw_text === 'string' ? body.voxtral_raw_text.trim() : '';
    const corrected_text = typeof body.corrected_text === 'string' ? body.corrected_text.trim() : '';
    const start_time = Number(body.start_time);
    const end_time = Number(body.end_time);
    const note = typeof body.note === 'string' ? body.note.trim() : undefined;

    if (!Number.isInteger(dictation_id) || dictation_id <= 0) {
      return NextResponse.json({ error: 'dictation_id ist erforderlich' }, { status: 400 });
    }
    if (!voxtral_raw_text) {
      return NextResponse.json({ error: 'voxtral_raw_text ist erforderlich' }, { status: 400 });
    }
    if (!corrected_text) {
      return NextResponse.json({ error: 'corrected_text ist erforderlich' }, { status: 400 });
    }
    if (!Number.isFinite(start_time) || !Number.isFinite(end_time) || end_time <= start_time) {
      return NextResponse.json({ error: 'start_time und end_time müssen gültig sein (end > start)' }, { status: 400 });
    }

    const id = await createTrainingSampleWithRequest(req, {
      dictation_id,
      marked_by: auth.username,
      voxtral_raw_text,
      corrected_text,
      start_time,
      end_time,
      note,
    });
    return NextResponse.json({ id });
  } catch (error: any) {
    console.error('[TrainingSamples] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH update sample (corrected text / timestamps / note)
export async function PATCH(req: NextRequest) {
  const auth = await getAuthenticatedRoot(req);
  if (!auth) {
    return NextResponse.json({ error: 'Nur root darf Trainingsdaten ändern' }, { status: 403 });
  }
  try {
    await initOfflineDictationTableWithRequest(req);
    await initTrainingSamplesTableWithRequest(req);

    const body = await req.json();
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'id ist erforderlich' }, { status: 400 });
    }

    const patch: Partial<TrainingSample> = {};
    if (typeof body.voxtral_raw_text === 'string') patch.voxtral_raw_text = body.voxtral_raw_text.trim();
    if (typeof body.corrected_text === 'string') patch.corrected_text = body.corrected_text.trim();
    if (body.start_time !== undefined) patch.start_time = Number(body.start_time);
    if (body.end_time !== undefined) patch.end_time = Number(body.end_time);
    if (typeof body.note === 'string') patch.note = body.note.trim();

    await updateTrainingSampleWithRequest(req, id, patch);
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[TrainingSamples] PATCH error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE ?id=123
export async function DELETE(req: NextRequest) {
  const auth = await getAuthenticatedRoot(req);
  if (!auth) {
    return NextResponse.json({ error: 'Nur root darf Trainingsdaten löschen' }, { status: 403 });
  }
  try {
    await initOfflineDictationTableWithRequest(req);
    await initTrainingSamplesTableWithRequest(req);

    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    if (!id) {
      return NextResponse.json({ error: 'id ist erforderlich' }, { status: 400 });
    }
    await deleteTrainingSampleWithRequest(req, parseInt(id, 10));
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[TrainingSamples] DELETE error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
