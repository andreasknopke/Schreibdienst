import { NextRequest, NextResponse } from 'next/server';
import {
  createOfflineDictationWithRequest,
  getUserDictationsWithRequest,
  getAllDictationsWithRequest,
  getDictationByIdWithRequest,
  getAudioDataWithRequest,
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
import { logManualCorrectionWithRequest, initCorrectionLogTableWithRequest } from '@/lib/correctionLogDb';
import { calculateChangeScore } from '@/lib/changeScore';
import { compressAudioForSpeech, getAudioDuration } from '@/lib/audioCompression';

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
      const extractPayload = searchParams.get('extract') === 'true';
      const dictationId = parseInt(id);
      
      // If audio requested, fetch from separate audio table
      if (includeAudio) {
        const audioResult = await getAudioDataWithRequest(req, dictationId);
        if (!audioResult) {
          return NextResponse.json({ error: 'Audio not found' }, { status: 404 });
        }
        let audioBuffer = Buffer.from(audioResult.audio_data);
        let contentType = audioResult.audio_mime_type || 'audio/webm';
        
        // If extract=true, try to extract payload from SpeaKING/WAV format
        if (extractPayload) {
          // Check for RIFF/WAVE header and extract data chunk payload
          if (audioBuffer.length > 44 && 
              audioBuffer.toString('ascii', 0, 4) === 'RIFF' && 
              audioBuffer.toString('ascii', 8, 12) === 'WAVE') {
            const dataIndex = audioBuffer.indexOf(Buffer.from('data'));
            if (dataIndex !== -1) {
              // 'data' tag (4 bytes) + size (4 bytes) = 8 bytes offset
              audioBuffer = audioBuffer.subarray(dataIndex + 8);
              contentType = 'application/octet-stream';
              console.log(`[Offline Dictations] Extracted payload: ${audioBuffer.length} bytes`);
            }
          }
        }
        
        return new Response(audioBuffer, {
          headers: {
            'Content-Type': contentType,
            'Content-Length': audioBuffer.length.toString(),
            'Cache-Control': 'private, max-age=3600',
          },
        });
      }
      
      // Return full detail data (includes text fields + segments)
      const dictation = await getDictationByIdWithRequest(req, dictationId);
      if (!dictation) {
        return NextResponse.json({ error: 'Dictation not found' }, { status: 404 });
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
    const bemerkung = formData.get('bemerkung') as string | null;
    const termin = formData.get('termin') as string | null;
    const fachabteilung = formData.get('fachabteilung') as string | null;
    const berechtigteRaw = formData.get('berechtigte') as string | null;
    const berechtigte = berechtigteRaw ? JSON.parse(berechtigteRaw) : undefined;
    
    if (!username || !audioFile || !orderNumber) {
      return NextResponse.json(
        { error: 'Username, audio file, and order number are required' },
        { status: 400 }
      );
    }
    
    // Convert file to buffer
    const arrayBuffer = await audioFile.arrayBuffer();
    let audioBuffer: Buffer = Buffer.from(arrayBuffer);
    let audioMimeType = audioFile.type || 'audio/webm';
    
    // Compress audio BEFORE storing to avoid MySQL max_allowed_packet errors
    // Large audio files can exceed the default 16MB limit
    const originalSize = audioBuffer.length;
    try {
      const compressed = await compressAudioForSpeech(audioBuffer, audioMimeType);
      if (compressed.compressed) {
        audioBuffer = Buffer.from(compressed.data);
        audioMimeType = compressed.mimeType;
        const ratio = ((1 - compressed.compressedSize / compressed.originalSize) * 100).toFixed(1);
        console.log(`[Offline Dictations] Audio compressed: ${(originalSize/1024/1024).toFixed(2)}MB → ${(compressed.compressedSize/1024/1024).toFixed(2)}MB (${ratio}% smaller)`);
      }
    } catch (compressError: any) {
      console.warn(`[Offline Dictations] Audio compression failed, using original: ${compressError.message}`);
    }
    
    // Get actual audio duration using ffprobe if not provided or 0
    let actualDuration = duration;
    if (actualDuration <= 0) {
      console.log(`[Offline Dictations] Duration not provided (${duration}), reading from audio file...`);
      try {
        actualDuration = await getAudioDuration(audioBuffer, audioMimeType);
        if (actualDuration > 0) {
          console.log(`[Offline Dictations] Detected audio duration: ${actualDuration.toFixed(2)}s`);
        } else {
          console.warn(`[Offline Dictations] Could not detect audio duration, using 0`);
        }
      } catch (durationError: any) {
        console.warn(`[Offline Dictations] Error detecting audio duration: ${durationError.message}`);
      }
    }
    
    const id = await createOfflineDictationWithRequest(req, {
      username,
      audioData: audioBuffer,
      audioMimeType: audioMimeType,
      audioDuration: actualDuration,
      orderNumber,
      patientName: patientName || undefined,
      patientDob: patientDob || undefined,
      priority,
      mode,
      bemerkung: bemerkung || undefined,
      termin: termin || undefined,
      fachabteilung: fachabteilung || undefined,
      berechtigte: berechtigte || undefined,
    });
    
    console.log(`[Offline Dictations] Created dictation #${id} for user ${username}, order ${orderNumber}, duration: ${actualDuration.toFixed(1)}s`);
    
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
    await initCorrectionLogTableWithRequest(req);
    
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
      
      // Get username from request for logging
      const { searchParams } = new URL(req.url);
      const username = searchParams.get('username');
      
      // Get the dictation to compare texts
      const dictation = await getDictationByIdWithRequest(req, id);
      if (dictation && username) {
        // Log manual correction only if text actually changed
        const textBefore = dictation.corrected_text || dictation.transcript || '';
        if (textBefore !== correctedText) {
          try {
            const manualChangeScore = calculateChangeScore(textBefore, correctedText);
            await logManualCorrectionWithRequest(
              req,
              id,
              textBefore,
              correctedText,
              username,
              manualChangeScore
            );
            console.log(`[Offline Dictations] ✓ Manual correction logged for #${id} by ${username} (score: ${manualChangeScore}%)`);
          } catch (logError: any) {
            console.warn(`[Offline Dictations] Failed to log manual correction: ${logError.message}`);
          }
        } else {
          console.log(`[Offline Dictations] No changes detected for #${id}, skipping log`);
        }
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
