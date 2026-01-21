import { NextRequest, NextResponse } from 'next/server';
import { createOfflineDictationWithRequest } from '@/lib/offlineDictationDb';
import { compressAudioForSpeech } from '@/lib/audioCompression';
import { XMLParser } from 'fast-xml-parser';
import { promises as fs } from 'fs';
import path from 'path';

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
 * Expects JSON body with:
 * - path: Path to the .dictation XML file (audio file is read from same directory)
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const dictationPath = body.path as string;
    
    if (!dictationPath) {
      return NextResponse.json({ error: 'Pfad zur .dictation Datei erforderlich' }, { status: 400 });
    }
    
    // Verify file exists and has correct extension
    if (!dictationPath.endsWith('.dictation')) {
      return NextResponse.json({ error: 'Datei muss .dictation Endung haben' }, { status: 400 });
    }
    
    // Read XML file
    let xmlContent: string;
    try {
      xmlContent = await fs.readFile(dictationPath, 'utf-8');
    } catch (err: any) {
      console.error(`[Import] Cannot read file: ${err.message}`);
      return NextResponse.json({ error: `Datei nicht lesbar: ${dictationPath}` }, { status: 400 });
    }
    
    console.log(`[Import] Parsing XML file: ${dictationPath} (${xmlContent.length} chars)`);
    
    // Parse XML
    let metadata;
    try {
      metadata = parseSpeaKINGXml(xmlContent);
    } catch (parseError: any) {
      console.error(`[Import] XML parse error: ${parseError.message}`);
      return NextResponse.json({ error: `XML parse error: ${parseError.message}` }, { status: 400 });
    }
    
    if (!metadata.audioFilename) {
      return NextResponse.json({ error: 'Keine Audio-Datei im XML referenziert' }, { status: 400 });
    }
    
    console.log(`[Import] Parsed metadata:`, {
      orderNumber: metadata.orderNumber,
      username: metadata.username,
      priority: metadata.priority,
      patientName: metadata.patientName,
      audioFilename: metadata.audioFilename,
    });
    
    // Construct audio file path (same directory as .dictation file)
    const dirPath = path.dirname(dictationPath);
    const audioPath = path.join(dirPath, metadata.audioFilename);
    
    // Read audio file
    let audioBuffer: Buffer;
    try {
      audioBuffer = await fs.readFile(audioPath);
    } catch (err: any) {
      console.error(`[Import] Cannot read audio file: ${err.message}`);
      return NextResponse.json({ error: `Audio-Datei nicht gefunden: ${metadata.audioFilename}` }, { status: 400 });
    }
    
    // Determine MIME type from extension
    const ext = path.extname(metadata.audioFilename).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.webm': 'audio/webm',
      '.wav': 'audio/wav',
      '.mp3': 'audio/mpeg',
      '.ogg': 'audio/ogg',
      '.m4a': 'audio/mp4',
    };
    const audioMimeType = mimeTypes[ext] || 'audio/wav';
    
    console.log(`[Import] Audio file: ${metadata.audioFilename}, ${(audioBuffer.length / 1024).toFixed(1)} KB, type: ${audioMimeType}`);
    
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
    
    // Calculate audio duration (rough estimate based on file size)
    const estimatedDuration = Math.round(audioBuffer.length / 32000);
    
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
    
    // Trigger worker to process
    fetch(new URL('/api/offline-dictations/worker', request.url), {
      method: 'POST',
      headers: request.headers,
    }).catch(() => {});
    
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
