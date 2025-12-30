import { NextRequest, NextResponse } from 'next/server';
import {
  createOfflineDictationWithRequest,
  getUserDictationsWithRequest,
  getAllDictationsWithRequest,
  getDictationByIdWithRequest,
  deleteDictationWithRequest,
  deleteAudioDataWithRequest,
  retryDictationWithRequest,
  updateCorrectedTextWithRequest,
  initOfflineDictationTableWithRequest,
  getQueueStatsWithRequest,
  getDictationUsersWithRequest,
  DictationPriority,
  DictationStatus,
} from '@/lib/offlineDictationDb';

export const runtime = 'nodejs';

// GET: List dictations for user or get single dictation
export async function GET(req: NextRequest) {
  try {
    await initOfflineDictationTableWithRequest(req);
    
    const { searchParams } = new URL(req.url);
    const username = searchParams.get('username');
    const id = searchParams.get('id');
    const stats = searchParams.get('stats');
    const all = searchParams.get('all');
    const statusFilter = searchParams.get('status') as DictationStatus | null;
    const userFilter = searchParams.get('user');
    const listUsers = searchParams.get('listUsers');
    
    // Get list of users with dictations
    if (listUsers === 'true') {
      const users = await getDictationUsersWithRequest(req);
      return NextResponse.json(users);
    }
    
    // Get queue statistics
    if (stats === 'true') {
      const queueStats = await getQueueStatsWithRequest(req);
      return NextResponse.json(queueStats);
    }
    
    // Get single dictation
    if (id) {
      const includeAudio = searchParams.get('audio') === 'true';
      const dictation = await getDictationByIdWithRequest(req, parseInt(id), includeAudio);
      if (!dictation) {
        return NextResponse.json({ error: 'Dictation not found' }, { status: 404 });
      }
      
      // If audio requested, return as binary stream
      if (includeAudio && dictation.audio_data) {
        const audioBuffer = Buffer.from(dictation.audio_data);
        return new Response(audioBuffer, {
          headers: {
            'Content-Type': dictation.audio_mime_type || 'audio/webm',
            'Content-Length': audioBuffer.length.toString(),
            'Cache-Control': 'private, max-age=3600',
          },
        });
      }
      
      return NextResponse.json(dictation);
    }
    
    // Get all dictations (for users with permission)
    if (all === 'true') {
      const dictations = await getAllDictationsWithRequest(req, statusFilter || undefined, userFilter || undefined);
      return NextResponse.json(dictations);
    }
    
    // Get user dictations
    if (!username) {
      return NextResponse.json({ error: 'Username required' }, { status: 400 });
    }
    
    const dictations = await getUserDictationsWithRequest(req, username);
    return NextResponse.json(dictations);
  } catch (error: any) {
    console.error('[Offline Dictations] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST: Create new offline dictation
export async function POST(req: NextRequest) {
  try {
    await initOfflineDictationTableWithRequest(req);
    
    const formData = await req.formData();
    
    const username = formData.get('username') as string;
    const audioFile = formData.get('audio') as File;
    const orderNumber = formData.get('orderNumber') as string;
    const patientName = formData.get('patientName') as string | null;
    const patientDob = formData.get('patientDob') as string | null;
    const priority = (formData.get('priority') as DictationPriority) || 'normal';
    const mode = (formData.get('mode') as 'befund' | 'arztbrief') || 'befund';
    const duration = parseFloat(formData.get('duration') as string) || 0;
    
    if (!username || !audioFile || !orderNumber) {
      return NextResponse.json(
        { error: 'Username, audio file, and order number are required' },
        { status: 400 }
      );
    }
    
    // Convert file to buffer
    const arrayBuffer = await audioFile.arrayBuffer();
    const audioBuffer = Buffer.from(arrayBuffer);
    
    const id = await createOfflineDictationWithRequest(req, {
      username,
      audioData: audioBuffer,
      audioMimeType: audioFile.type || 'audio/webm',
      audioDuration: duration,
      orderNumber,
      patientName: patientName || undefined,
      patientDob: patientDob || undefined,
      priority,
      mode,
    });
    
    console.log(`[Offline Dictations] Created dictation #${id} for user ${username}, order ${orderNumber}`);
    
    return NextResponse.json({ id, message: 'Dictation queued for processing' });
  } catch (error: any) {
    console.error('[Offline Dictations] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE: Remove dictation or just audio
export async function DELETE(req: NextRequest) {
  try {
    await initOfflineDictationTableWithRequest(req);
    
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    const audioOnly = searchParams.get('audioOnly') === 'true';
    
    if (!id) {
      return NextResponse.json({ error: 'ID required' }, { status: 400 });
    }
    
    const dictationId = parseInt(id);
    
    if (audioOnly) {
      await deleteAudioDataWithRequest(req, dictationId);
      console.log(`[Offline Dictations] Deleted audio for dictation #${dictationId}`);
      return NextResponse.json({ message: 'Audio deleted' });
    }
    
    await deleteDictationWithRequest(req, dictationId);
    console.log(`[Offline Dictations] Deleted dictation #${dictationId}`);
    return NextResponse.json({ message: 'Dictation deleted' });
  } catch (error: any) {
    console.error('[Offline Dictations] DELETE error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PATCH: Retry failed dictation or save corrected text
export async function PATCH(req: NextRequest) {
  try {
    await initOfflineDictationTableWithRequest(req);
    
    const { id, action, correctedText, changeScore } = await req.json();
    
    if (!id) {
      return NextResponse.json({ error: 'ID required' }, { status: 400 });
    }
    
    if (action === 'retry') {
      await retryDictationWithRequest(req, id);
      console.log(`[Offline Dictations] Retry queued for dictation #${id}`);
      return NextResponse.json({ message: 'Dictation queued for retry' });
    }
    
    if (action === 'save') {
      if (correctedText === undefined) {
        return NextResponse.json({ error: 'correctedText required for save action' }, { status: 400 });
      }
      await updateCorrectedTextWithRequest(req, id, correctedText, changeScore);
      console.log(`[Offline Dictations] Saved corrected text for dictation #${id}`);
      return NextResponse.json({ message: 'Corrected text saved' });
    }
    
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 });
  } catch (error: any) {
    console.error('[Offline Dictations] PATCH error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
