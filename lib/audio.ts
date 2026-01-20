export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// SpeaKING XML Metadata Interface
export interface SpeaKINGMetadata {
  patientName?: string;
  patientId?: string;
  docType?: string;
  creator?: string;
  creationTime?: string;
  audioFile?: string;
  [key: string]: string | undefined;
}

// Read file as text
export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsText(file);
  });
}

// Parse SpeaKING XML file to extract metadata
export function parseSpeaKINGXml(xmlContent: string): SpeaKINGMetadata | null {
  try {
    const parser = new DOMParser();
    const doc = parser.parseFromString(xmlContent, 'application/xml');
    
    // Check for parse errors
    const parseError = doc.querySelector('parsererror');
    if (parseError) {
      console.error('[SpeaKING] XML Parse Error:', parseError.textContent);
      return null;
    }
    
    const metadata: SpeaKINGMetadata = {};
    
    // Common XML paths for SpeaKING metadata
    // Try different possible tag names
    const getValue = (tagNames: string[]): string | undefined => {
      for (const tagName of tagNames) {
        const el = doc.querySelector(tagName) || doc.getElementsByTagName(tagName)[0];
        if (el?.textContent) {
          return el.textContent.trim();
        }
      }
      return undefined;
    };
    
    // Extract common fields
    metadata.patientName = getValue(['PatientName', 'patientName', 'patient_name', 'Patient', 'patient']);
    metadata.patientId = getValue(['PatientID', 'patientId', 'patient_id', 'PatID', 'patid']);
    metadata.docType = getValue(['DocType', 'docType', 'doc_type', 'DocumentType', 'documentType', 'Type', 'type']);
    metadata.creator = getValue(['Creator', 'creator', 'Author', 'author', 'Dictator', 'dictator', 'UserName', 'userName']);
    metadata.creationTime = getValue(['CreationTime', 'creationTime', 'creation_time', 'DateTime', 'dateTime', 'Date', 'date', 'Timestamp', 'timestamp']);
    metadata.audioFile = getValue(['AudioFile', 'audioFile', 'audio_file', 'WavFile', 'wavFile', 'MediaFile', 'mediaFile']);
    
    // Check if we got any useful data
    const hasData = Object.values(metadata).some(v => v !== undefined);
    if (!hasData) {
      console.warn('[SpeaKING] No metadata found in XML');
      return null;
    }
    
    return metadata;
  } catch (err) {
    console.error('[SpeaKING] Error parsing XML:', err);
    return null;
  }
}

export function detectAudioExt(mime?: string): string {
  if (!mime) return 'webm';
  if (mime.includes('wav')) return 'wav';
  if (mime.includes('mp3')) return 'mp3';
  if (mime.includes('m4a')) return 'm4a';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}
