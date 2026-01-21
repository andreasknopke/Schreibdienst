import { NextRequest, NextResponse } from 'next/server';
import { createOfflineDictationWithRequest } from '@/lib/offlineDictationDb';
import { compressAudioForSpeech } from '@/lib/audioCompression';
import { XMLParser } from 'fast-xml-parser';

export const runtime = 'nodejs';

interface SpeaKINGDictation {
  uid: string;
  creator: string;
  priority: number;
  deadline?: string;
  typist?: string;
  data?: {
    key: Array<{
      '@_element': string;
      '#text'?: string;
    }> | {
      '@_element': string;
      '#text'?: string;
    };
  };
  audio?: {
    item?: {
      filename: string;
    } | Array<{
      filename: string;
    }>;
  };
  comment?: string;
}

/**
 * Parse SpeaKING XML and extract dictation metadata
 */
function parseSpeaKINGXml(xmlContent: string): {
  orderNumber: string;
  username: string;
  priority: 'normal' | 'urgent' | 'stat';
  termin?: string;
  berechtigte?: string[];
  patientName?: string;
  patientDob?: string;
  fachabteilung?: string;
  bemerkung?: string;
  audioFilename?: string;
} {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
  });
  
  const parsed = parser.parse(xmlContent);
  const dictation = parsed.dictation as SpeaKINGDictation;
  
  if (!dictation) {
    throw new Error('Invalid XML: No <dictation> element found');
  }
  
  // Extract data keys
  const dataKeys = dictation.data?.key;
  const keyArray = Array.isArray(dataKeys) ? dataKeys : dataKeys ? [dataKeys] : [];
  
  const getDataValue = (element: string): string | undefined => {
    const key = keyArray.find(k => k['@_element'] === element);
    return key?.['#text'];
  };
  
  // Map priority: 0=normal, 1=urgent, 2=stat
  const priorityMap: Record<number, 'normal' | 'urgent' | 'stat'> = {
    0: 'normal',
    1: 'urgent',
    2: 'stat',
  };
  
  // Extract audio filename
  let audioFilename: string | undefined;
  if (dictation.audio?.item) {
    const items = Array.isArray(dictation.audio.item) ? dictation.audio.item : [dictation.audio.item];
    if (items.length > 0) {
      audioFilename = items[0].filename;
    }
  }
  
  // Parse termin/deadline
  let termin: string | undefined;
  if (dictation.deadline) {
    try {
      const date = new Date(dictation.deadline);
      termin = date.toISOString().split('T')[0]; // YYYY-MM-DD format
    } catch {
      termin = dictation.deadline;
    }
  }
  
  // Parse berechtigte (typist)
  let berechtigte: string[] | undefined;
  if (dictation.typist) {
    berechtigte = [dictation.typist];
  }
  
  return {
    orderNumber: dictation.uid || '',
    username: dictation.creator || '',
    priority: priorityMap[dictation.priority] || 'normal',
    termin,
    berechtigte,
    patientName: getDataValue('subjectname'),
    patientDob: getDataValue('subjectdate'),
    fachabteilung: getDataValue('section'),
    bemerkung: dictation.comment,
    audioFilename,
  };
}

/**
 * Import a dictation from SpeaKING .dictation file
 * Expects multipart form data with:
 * - xml: The .dictation XML file
 * - audio: The audio file
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    
    const xmlFile = formData.get('xml') as File | null;
    const audioFile = formData.get('audio') as File | null;
    
    if (!xmlFile) {
      return NextResponse.json({ error: '.dictation Datei erforderlich' }, { status: 400 });
    }
    
    if (!audioFile) {
      return NextResponse.json({ error: 'Audio-Datei erforderlich' }, { status: 400 });
    }
    
    // Read and parse XML
    const xmlContent = await xmlFile.text();
    console.log(`[Import] Parsing XML file: ${xmlFile.name} (${xmlContent.length} chars)`);
    
    let metadata;
    try {
      metadata = parseSpeaKINGXml(xmlContent);
    } catch (parseError: any) {
      console.error(`[Import] XML parse error: ${parseError.message}`);
      return NextResponse.json({ error: `XML parse error: ${parseError.message}` }, { status: 400 });
    }
    
    console.log(`[Import] Parsed metadata:`, {
      orderNumber: metadata.orderNumber,
      username: metadata.username,
      priority: metadata.priority,
      patientName: metadata.patientName,
      expectedAudio: metadata.audioFilename,
      actualAudio: audioFile.name,
    });
    
    // Read audio file
    const audioBuffer = Buffer.from(await audioFile.arrayBuffer());
    const audioMimeType = audioFile.type || 'audio/wav';
    
    console.log(`[Import] Audio file: ${audioFile.name}, ${(audioBuffer.length / 1024).toFixed(1)} KB, type: ${audioMimeType}`);
    
    // Compress audio for storage
    let finalAudioBuffer = audioBuffer;
    let finalMimeType = audioMimeType;
    
    try {
      const compressed = await compressAudioForSpeech(audioBuffer, audioMimeType);
      if (compressed.compressed) {
        const originalSize = audioBuffer.length;
        const compressedSize = compressed.data.length;
        const reduction = ((1 - compressedSize / originalSize) * 100).toFixed(1);
        console.log(`[Import] Audio compressed: ${(originalSize / 1024).toFixed(1)}KB → ${(compressedSize / 1024).toFixed(1)}KB (${reduction}% reduction)`);
        finalAudioBuffer = Buffer.from(compressed.data);
        finalMimeType = compressed.mimeType;
      }
    } catch (compressError: any) {
      console.warn(`[Import] Audio compression failed, using original: ${compressError.message}`);
    }
    
    // Calculate audio duration based on format
    // WebM/OGG are compressed (~10-20 KB/s), WAV is uncompressed (~32 KB/s for 16kHz mono 16-bit)
    let estimatedDuration: number;
    if (audioMimeType.includes('webm') || audioMimeType.includes('ogg')) {
      // WebM/OGG: roughly 10-15 KB per second
      estimatedDuration = Math.round(audioBuffer.length / 12000);
    } else if (audioMimeType.includes('mp3') || audioMimeType.includes('mpeg')) {
      // MP3: roughly 16 KB per second at 128kbps
      estimatedDuration = Math.round(audioBuffer.length / 16000);
    } else {
      // WAV: roughly 32 KB per second at 16kHz mono 16-bit
      estimatedDuration = Math.round(audioBuffer.length / 32000);
    }
    
    console.log(`[Import] Estimated duration: ${estimatedDuration}s (${(audioBuffer.length / 1024).toFixed(1)} KB, ${audioMimeType})`);
    
    // Create dictation in database
    const dictationId = await createOfflineDictationWithRequest(request, {
      username: metadata.username,
      audioData: finalAudioBuffer,
      audioMimeType: finalMimeType,
      audioDuration: estimatedDuration,
      orderNumber: metadata.orderNumber,
      patientName: metadata.patientName,
      patientDob: metadata.patientDob,
      priority: metadata.priority,
      mode: 'befund',
      bemerkung: metadata.bemerkung,
      termin: metadata.termin,
      fachabteilung: metadata.fachabteilung,
      berechtigte: metadata.berechtigte,
    });
    
    console.log(`[Import] ✓ Created dictation #${dictationId} for user ${metadata.username}, order ${metadata.orderNumber}`);
    
    // Trigger worker to process - use internal fetch with same cookies
    const workerUrl = new URL('/api/offline-dictations/worker', request.url);
    try {
      const workerRes = await fetch(workerUrl, {
        method: 'POST',
        headers: {
          'Cookie': request.headers.get('cookie') || '',
          'Content-Type': 'application/json',
        },
      });
      console.log(`[Import] Worker triggered: ${workerRes.status}`);
    } catch (workerErr: any) {
      console.warn(`[Import] Worker trigger failed: ${workerErr.message}`);
    }
    
    return NextResponse.json({
      success: true,
      dictationId,
      metadata: {
        orderNumber: metadata.orderNumber,
        username: metadata.username,
        priority: metadata.priority,
        patientName: metadata.patientName,
      },
    });
    
  } catch (error: any) {
    console.error(`[Import] Error: ${error.message}`);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
