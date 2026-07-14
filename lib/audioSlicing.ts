/**
 * Extrahiert einen Audio-Abschnitt [startSec, endSec] aus einem Audio-Puffer.
 *
 * Strategie:
 *  1. Wenn der Puffer eine standardisierte PCM-WAV ist (Ergebnis von
 *     normalizeAudioForWhisper), Byte-Slicing ohne ffmpeg – deterministisch
 *     und不需要 FFmpeg.
 *  2. Sonst ffmpeg-basiert als Fallback.
 *
 * Wird sowohl beim Trainingserfolg-Check (Live-Transkription) als auch beim
 * Export der Trainingsdaten verwendet.
 */

import { spawn } from 'child_process';
import { join } from 'path';
import { tmpdir } from 'os';
import { writeFile, readFile, unlink } from 'fs/promises';
import { randomUUID } from 'crypto';

const WAV_HEADER_MAX_SEARCH = 4096;
const PCM_SAMPLE_RATES = [8000, 11025, 12000, 16000, 22050, 24000, 32000, 44100, 48000];

interface ParsedWavHeader {
  sampleRate: number;
  bitsPerSample: number;
  channels: number;
  dataOffset: number;
  dataSize: number;
  isPcm: boolean;
}

function parseWavHeader(buf: Buffer): ParsedWavHeader | null {
  if (buf.length < 44) return null;
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') {
    return null;
  }

  let offset = 12;
  let fmt: ParsedWavHeader = {
    sampleRate: 0,
    bitsPerSample: 0,
    channels: 0,
    dataOffset: -1,
    dataSize: 0,
    isPcm: false,
  };

  while (offset < buf.length - 8) {
    const chunkId = buf.toString('ascii', offset, offset + 4);
    const chunkSize = buf.readUInt32LE(offset + 4);
    if (chunkId === 'fmt ') {
      if (chunkSize >= 16) {
        const audioFormat = buf.readUInt16LE(offset + 8); // 1 = PCM
        const channels = buf.readUInt16LE(offset + 10);
        const sampleRate = buf.readUInt32LE(offset + 12);
        const bitsPerSample = buf.readUInt16LE(offset + 22);
        fmt = { ...fmt, channels, sampleRate, bitsPerSample, isPcm: audioFormat === 1 };
      }
    } else if (chunkId === 'data') {
      fmt.dataOffset = offset + 8;
      fmt.dataSize = chunkSize;
      break;
    }
    offset += 8 + chunkSize + (chunkSize % 2 === 1 ? 1 : 0); // pad to even
    if (offset - 12 > WAV_HEADER_MAX_SEARCH) break;
  }

  if (!fmt.isPcm || fmt.dataOffset < 0 || fmt.sampleRate === 0) return null;
  if (!PCM_SAMPLE_RATES.includes(fmt.sampleRate)) {
    // Unusual sample rate — still allow, but mark for clarity via log
    return fmt;
  }
  return fmt;
}

/**
 * Slice bytewise in a normalized PCM WAV. Start/end are seconds from the
 * beginning of the audio stream.
 *
 * Returns a new WAV with corrected headers reflecting the sliced size.
 */
function slicePcmWavInMemory(buf: Buffer, startSec: number, endSec: number): Buffer | null {
  const header = parseWavHeader(buf);
  if (!header) return null;

  const bytesPerSample = header.bitsPerSample / 8;
  const blockAlign = bytesPerSample * header.channels;
  if (blockAlign <= 0) return null;

  const dataStart = header.dataOffset;
  const dataEnd = Math.min(buf.length, dataStart + header.dataSize);
  const totalSamples = Math.floor((dataEnd - dataStart) / blockAlign);
  const sampleRate = header.sampleRate;

  const startSample = Math.max(0, Math.floor(startSec * sampleRate));
  const endSample = Math.min(totalSamples, Math.ceil(endSec * sampleRate));
  if (endSample <= startSample) return null;

  // Small padded head-room to avoid clipping coarticulated speech.
  const padding = Math.floor(sampleRate * 0.05); // 50 ms
  const paddedStart = Math.max(0, startSample - padding);
  const paddedEnd = Math.min(totalSamples, endSample + padding);

  const startByte = dataStart + paddedStart * blockAlign;
  const endByte = dataStart + paddedEnd * blockAlign;
  const slicedPayload = buf.subarray(startByte, endByte);

  // Build a new canonical 44-byte WAV header
  const out = Buffer.alloc(44 + slicedPayload.length);
  out.write('RIFF', 0, 'ascii');
  out.writeUInt32LE(36 + slicedPayload.length, 4);
  out.write('WAVE', 8, 'ascii');
  out.write('fmt ', 12, 'ascii');
  out.writeUInt32LE(16, 16);
  out.writeUInt16LE(1, 20); // PCM
  out.writeUInt16LE(header.channels, 22);
  out.writeUInt32LE(sampleRate, 24);
  out.writeUInt32LE(sampleRate * blockAlign, 28); // byte rate
  out.writeUInt16LE(blockAlign, 32);
  out.writeUInt16LE(header.bitsPerSample, 34);
  out.write('data', 36, 'ascii');
  out.writeUInt32LE(slicedPayload.length, 40);
  slicedPayload.copy(out, 44);

  return out;
}

/** ffmpeg-based fallback (Opus/WebM/MP3/SpeaKING etc.). */
async function sliceWithFfmpeg(
  buf: Buffer,
  mimeType: string,
  startSec: number,
  endSec: number
): Promise<Buffer | null> {
  const tempId = randomUUID();
  const ext =
    mimeType.includes('webm') ? 'webm' :
    mimeType.includes('ogg') ? 'ogg' :
    mimeType.includes('mp3') ? 'mp3' :
    mimeType.includes('mp4') ? 'm4a' :
    mimeType.includes('opus') ? 'opus' :
    mimeType.includes('wav') ? 'wav' : 'bin';
  const inputPath = join(tmpdir(), `slice_in_${tempId}.${ext}`);
  const outputPath = join(tmpdir(), `slice_out_${tempId}.wav`);

  try {
    await writeFile(inputPath, buf);

    await new Promise<void>((resolve, reject) => {
      const proc = spawn('ffmpeg', [
        '-y',
        '-ss', String(Math.max(0, startSec - 0.05)),
        '-to', String(endSec + 0.05),
        '-i', inputPath,
        '-vn',
        '-acodec', 'pcm_s16le',
        '-ar', '16000',
        '-ac', '1',
        outputPath,
      ]);
      let stderr = '';
      proc.stderr.on('data', (d) => { stderr += d.toString(); });
      proc.on('error', reject);
      proc.on('close', (code) => {
        if (code === 0) resolve();
        else reject(new Error(`ffmpeg exit ${code}: ${stderr.slice(0, 300)}`));
      });
      setTimeout(() => { try { proc.kill(); } catch {} }, 15000);
    });

    return await readFile(outputPath);
  } catch (err: any) {
    console.error('[AudioSlice] ffmpeg fallback failed:', err.message);
    return null;
  } finally {
    try { await unlink(inputPath); } catch {}
    try { await unlink(outputPath); } catch {}
  }
}

/**
 * Extract a slice [startSec, endSec] from an arbitrary audio buffer.
 * Always returns a 16kHz mono PCM WAV (or null on failure).
 *
 * If the input is already a canonical PCM WAV (which is the common path
 * because the Whisper/Voxtral pipeline normalises first), it uses byte slicing
 * with no external tools. Otherwise ffmpeg is required.
 */
export async function extractAudioSlice(
  audioBuffer: Buffer,
  mimeType: string,
  startSec: number,
  endSec: number
): Promise<Buffer | null> {
  // Try fast PCM byte-slice first
  const fast = slicePcmWavInMemory(audioBuffer, startSec, endSec);
  if (fast) return fast;

  // Fallback to ffmpeg
  return sliceWithFfmpeg(audioBuffer, mimeType, startSec, endSec);
}

/**
 * Convenience: convert any audio to 16kHz mono PCM WAV (canonical header).
 * Re-exports the logic from audioCompression without circular import.
 */
export interface WavInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  isPcm: boolean;
}

export function inspectWav(buf: Buffer): WavInfo | null {
  const h = parseWavHeader(buf);
  if (!h) return null;
  const { sampleRate, channels, bitsPerSample, isPcm } = h;
  return { sampleRate, channels, bitsPerSample, isPcm };
}
