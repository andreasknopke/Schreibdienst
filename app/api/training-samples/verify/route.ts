import { NextRequest, NextResponse } from 'next/server';
import { authenticateUserWithRequest } from '@/lib/usersDb';
import { parseBasicAuth } from '@/lib/apiHelpers';
import {
  initTrainingSamplesTableWithRequest,
  listAllTrainingSamplesWithRequest,
  getTrainingSampleWithRequest,
  saveVerifyResultWithRequest,
  type VerifyResult,
} from '@/lib/trainingSamplesDb';
import {
  transcribeBufferWithVoxtral,
  computeWer,
  computeWordDiff,
} from '@/lib/voxtralTranscribe';
import { getRuntimeConfigWithRequest } from '@/lib/configDb';
import {
  initOfflineDictationTableWithRequest,
  getDictationByIdWithRequest,
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

interface VerifyTarget {
  id: number;
  voxtral_raw_text: string;
  corrected_text: string;
  start_time: number;
  end_time: number;
}

async function verifySingle(req: NextRequest, target: VerifyTarget): Promise<VerifyResult> {
  // We need the dictation_id to look up the source audio. We fetch the full
  // joined sample row (it includes dictation_id).
  const sample = await getTrainingSampleWithRequest(req, target.id);
  if (!sample) throw new Error(`Sample ${target.id} nicht gefunden`);
  const dictationId = sample.dictation_id;

  const audioData = await getAudioDataWithRequest(req, dictationId);
  if (!audioData || !audioData.audio_data || audioData.audio_data.length === 0) {
    throw new Error(`Kein Audio für Diktat ${dictationId} vorhanden`);
  }

  const slice = await extractAudioSlice(
    Buffer.from(audioData.audio_data),
    audioData.audio_mime_type || 'audio/wav',
    target.start_time,
    target.end_time
  );
  if (!slice) {
    throw new Error('Audio-Slice konnte nicht extrahiert werden (ffmpeg fehlt oder Format nicht unterstützt)');
  }

  // Transcribe the slice with current Voxtral (no dictionary corrections).
  let transcription: string | null = null;
  let transcription_error: string | null = null;
  let modelName = '';
  try {
    const runtimeConfig = await getRuntimeConfigWithRequest(req);
    const result = await transcribeBufferWithVoxtral(slice, 'audio/wav', { useFinetune: runtimeConfig.voxtralLocalUseFinetune });
    transcription = result.text;
    modelName = result.model;
  } catch (err: any) {
    transcription_error = err.message || String(err);
  }

  if (transcription === null) {
    return {
      sample_id: target.id,
      voxtral_raw_text: target.voxtral_raw_text,
      corrected_text: target.corrected_text,
      transcription: null,
      transcription_error,
      wer: null,
      error_count: null,
      diff: [],
    };
  }

  const werResult = computeWer(transcription, target.corrected_text);
  await saveVerifyResultWithRequest(req, target.id, {
    text: transcription,
    model: modelName,
    wer: werResult.wer,
    errorCount: werResult.errorCount,
  });

  return {
    sample_id: target.id,
    voxtral_raw_text: target.voxtral_raw_text,
    corrected_text: target.corrected_text,
    transcription,
    transcription_error: null,
    wer: werResult.wer,
    error_count: werResult.errorCount,
    diff: computeWordDiff(transcription, target.corrected_text).map((d) => ({
      type: d.type,
      value: d.value,
    })),
  };
}

// POST  { id: number }          → verify single sample
// POST  { all: true }           → verify all samples (batch)
export async function POST(req: NextRequest) {
  const root = await getAuthenticatedRoot(req);
  if (!root) {
    return NextResponse.json({ error: 'Nur root darf Trainingserfolg prüfen' }, { status: 403 });
  }
  try {
    await initOfflineDictationTableWithRequest(req);
    await initTrainingSamplesTableWithRequest(req);

    const body = await req.json().catch(() => ({}));
    const id = body.id !== undefined ? Number(body.id) : null;

    if (body.all === true) {
      const samples = await listAllTrainingSamplesWithRequest(req);
      const results: VerifyResult[] = [];
      for (const s of samples) {
        try {
          results.push(await verifySingle(req, {
            id: s.id,
            voxtral_raw_text: s.voxtral_raw_text,
            corrected_text: s.corrected_text,
            start_time: s.start_time,
            end_time: s.end_time,
          }));
        } catch (err: any) {
          results.push({
            sample_id: s.id,
            voxtral_raw_text: s.voxtral_raw_text,
            corrected_text: s.corrected_text,
            transcription: null,
            transcription_error: err.message || String(err),
            wer: null,
            error_count: null,
            diff: [],
          });
        }
      }
      return NextResponse.json({ results });
    }

    if (id === null || !Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: 'id oder all=true erforderlich' }, { status: 400 });
    }

    const sample = await getTrainingSampleWithRequest(req, id);
    if (!sample) {
      return NextResponse.json({ error: 'Sample nicht gefunden' }, { status: 404 });
    }
    const result = await verifySingle(req, {
      id: sample.id,
      voxtral_raw_text: sample.voxtral_raw_text,
      corrected_text: sample.corrected_text,
      start_time: sample.start_time,
      end_time: sample.end_time,
    });
    return NextResponse.json(result);
  } catch (error: any) {
    console.error('[TrainingSamples/Verify] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
