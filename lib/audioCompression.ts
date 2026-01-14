import { spawn } from 'child_process';
import { writeFile, readFile, unlink, access } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { randomUUID } from 'crypto';

/**
 * Audio compression for speech recordings
 * Uses Opus codec via FFmpeg for highly efficient speech compression
 * Opus is specifically designed for speech and provides excellent compression
 * at low bitrates while maintaining quality.
 */

// Check if FFmpeg is available
let ffmpegAvailable: boolean | null = null;

async function checkFfmpegAvailable(): Promise<boolean> {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  
  return new Promise((resolve) => {
    const proc = spawn('ffmpeg', ['-version']);
    proc.on('error', () => {
      console.log('[AudioCompression] FFmpeg not available');
      ffmpegAvailable = false;
      resolve(false);
    });
    proc.on('close', (code) => {
      ffmpegAvailable = code === 0;
      if (ffmpegAvailable) {
        console.log('[AudioCompression] FFmpeg available');
      }
      resolve(ffmpegAvailable);
    });
  });
}

/**
 * Detect SpeaKING proprietary format (WAV with format 0x0028)
 */
function isSpeaKINGFormat(buffer: Buffer): boolean {
  try {
    if (buffer.length < 44) return false;
    // Check RIFF header
    if (buffer.toString('ascii', 0, 4) !== 'RIFF' || buffer.toString('ascii', 8, 12) !== 'WAVE') return false;
    
    // Check format chunk
    let offset = 12;
    while (offset < buffer.length - 8) {
      const chunkId = buffer.toString('ascii', offset, offset + 4);
      const chunkSize = buffer.readUInt32LE(offset + 4);
      
      if (chunkId === 'fmt ') {
        // Format code is first 2 bytes of fmt chunk data
        if (chunkSize >= 2) {
          const formatCode = buffer.readUInt16LE(offset + 8);
          // Format 0x0028 is officially "Antex ADPCM" but used by SpeaKING/MediaInterface
          // as a wrapper for Opus or other codecs.
          // Format 0x704F (28751) is also seen in log files for Opus (Op[0][0])
          return formatCode === 0x0028 || formatCode === 0x704F;
        }
        return false;
      }
      
      offset += 8 + chunkSize;
      if (offset > 1024) break; // Stop searching if header is too large
    }
  } catch (e) {
    return false;
  }
  return false;
}

/**
 * Extract payload from SpeaKING/WAV file
 * Skips WAV header and returns data chunk content
 */
function extractSpeaKINGPayload(buffer: Buffer): Buffer {
  const dataIndex = buffer.indexOf(Buffer.from('data'));
  if (dataIndex === -1) return buffer;
  // 'data' tag (4 bytes) + size (4 bytes) = 8 bytes offset
  return buffer.subarray(dataIndex + 8);
}

/**
 * Compress audio using FFmpeg with Opus codec
 * Optimized for speech recordings (mono, 16kHz, low bitrate)
 * 
 * @param audioBuffer - Original audio data as Buffer
 * @param mimeType - Original MIME type (e.g., 'audio/webm', 'audio/wav')
 * @returns Compressed audio data and new MIME type, or original if compression fails/unavailable
 */
export async function compressAudioForSpeech(
  audioBuffer: Buffer,
  mimeType: string
): Promise<{ data: Buffer; mimeType: string; compressed: boolean; originalSize: number; compressedSize: number }> {
  const originalSize = audioBuffer.length;
  
  // Check if FFmpeg is available
  const hasFfmpeg = await checkFfmpegAvailable();
  if (!hasFfmpeg) {
    console.log('[AudioCompression] Skipping compression - FFmpeg not available');
    return { 
      data: audioBuffer, 
      mimeType, 
      compressed: false, 
      originalSize, 
      compressedSize: originalSize 
    };
  }
  
  // Generate temp file paths
  const tempId = randomUUID();
  const inputExt = getExtensionFromMime(mimeType);
  const inputPath = join(tmpdir(), `audio_in_${tempId}.${inputExt}`);
  const outputPath = join(tmpdir(), `audio_out_${tempId}.ogg`);
  const rawPath = join(tmpdir(), `audio_raw_${tempId}.bin`);
  
  try {
    // Special handling for SpeaKING format
    if (isSpeaKINGFormat(audioBuffer)) {
      console.log('[AudioCompression] Detected SpeaKING format (0x0028). specific processing...');
      const payload = extractSpeaKINGPayload(audioBuffer);
      await writeFile(rawPath, payload);
      
      try {
        // Attempt 1: Raw Opus
        console.log('[AudioCompression] Trying convert as raw Opus...');
        await runFfmpeg([
          '-f', 'opus', 
          '-i', rawPath,
          '-vn', '-c:a', 'libopus', '-b:a', '24k', '-ar', '16000', '-ac', '1', '-application', 'voip', 
          '-y', outputPath
        ]);
      } catch (e) {
        console.log('[AudioCompression] Raw Opus failed, trying raw PCM fallback...');
        // Attempt 2: Raw PCM (s16le)
        await runFfmpeg([
          '-f', 's16le', '-ar', '16000', '-ac', '1',
          '-i', rawPath,
          '-vn', '-c:a', 'libopus', '-b:a', '24k', '-ar', '16000', '-ac', '1', '-application', 'voip',
          '-y', outputPath
        ]);
      }
      
      // Clean raw file immediately
      await safeUnlink(rawPath);
      
      // If we are here, we likely succeeded or threw error to outer catch
      const compressedBuffer = await readFile(outputPath);
      const compressedSize = compressedBuffer.length;
      
      console.log(`[AudioCompression] Converted SpeaKING format: ${formatBytes(originalSize)} → ${formatBytes(compressedSize)}`);
      
      return {
        data: compressedBuffer,
        mimeType: 'audio/ogg',
        compressed: true,
        originalSize,
        compressedSize
      };
    }
    
    // Write input file
    await writeFile(inputPath, audioBuffer);
    
    // Run FFmpeg compression
    // Settings optimized for speech:
    // - Opus codec (best for speech)
    // - 24kbps bitrate (very efficient for mono speech)
    // - 16kHz sample rate (sufficient for speech, saves space)
    // - Mono audio (speech is typically mono)
    // - VBR for optimal quality/size ratio
    await runFfmpeg([
      '-i', inputPath,
      '-vn',                    // No video
      '-c:a', 'libopus',        // Opus codec
      '-b:a', '24k',            // 24kbps bitrate (excellent for speech)
      '-ar', '16000',           // 16kHz sample rate
      '-ac', '1',               // Mono
      '-application', 'voip',   // Optimized for speech
      '-compression_level', '10', // Maximum compression
      '-y',                     // Overwrite output
      outputPath
    ]);
    
    // Read compressed file
    const compressedBuffer = await readFile(outputPath);
    const compressedSize = compressedBuffer.length;
    
    // Only use compressed version if it's actually smaller
    if (compressedSize < originalSize) {
      const ratio = ((1 - compressedSize / originalSize) * 100).toFixed(1);
      console.log(`[AudioCompression] Compressed: ${formatBytes(originalSize)} → ${formatBytes(compressedSize)} (${ratio}% reduction)`);
      
      return {
        data: compressedBuffer,
        mimeType: 'audio/ogg',
        compressed: true,
        originalSize,
        compressedSize
      };
    } else {
      console.log(`[AudioCompression] Compressed file not smaller, keeping original`);
      return { 
        data: audioBuffer, 
        mimeType, 
        compressed: false, 
        originalSize, 
        compressedSize: originalSize 
      };
    }
    
  } catch (error: any) {
    console.error('[AudioCompression] Compression failed:', error.message);
    return { 
      data: audioBuffer, 
      mimeType, 
      compressed: false, 
      originalSize, 
      compressedSize: originalSize 
    };
    
  } finally {
    // Cleanup temp files
    await safeUnlink(inputPath);
    await safeUnlink(outputPath);
    // Try to cleanup raw path if it was used (construct path again or rely on variable if scoped correctly)
    try { await unlink(join(tmpdir(), `audio_raw_${tempId}.bin`)); } catch {}
  }
}

/**
 * Run FFmpeg with the given arguments
 */
function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn('ffmpeg', args, { stdio: ['pipe', 'pipe', 'pipe'] });
    
    let stderr = '';
    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });
    
    proc.on('error', (err) => {
      reject(new Error(`FFmpeg spawn error: ${err.message}`));
    });
    
    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`FFmpeg exited with code ${code}: ${stderr.slice(-500)}`));
      }
    });
    
    // Timeout after 60 seconds
    setTimeout(() => {
      proc.kill();
      reject(new Error('FFmpeg timeout'));
    }, 60000);
  });
}

/**
 * Get file extension from MIME type
 */
function getExtensionFromMime(mimeType: string): string {
  if (mimeType.includes('wav')) return 'wav';
  if (mimeType.includes('mp3') || mimeType.includes('mpeg')) return 'mp3';
  if (mimeType.includes('ogg')) return 'ogg';
  if (mimeType.includes('m4a')) return 'm4a';
  if (mimeType.includes('aiff')) return 'aiff';
  return 'webm'; // Default for audio/webm
}

/**
 * Safe file deletion (ignore errors)
 */
async function safeUnlink(path: string): Promise<void> {
  try {
    await unlink(path);
  } catch {
    // Ignore errors
  }
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/**
 * Normalize audio to a format that WhisperX can handle
 * Converts problematic formats (like Opus-in-WAV) to standard WAV PCM
 * 
 * @param audioBuffer - Original audio data as Buffer
 * @param mimeType - Original MIME type
 * @returns Normalized audio data and MIME type (WAV PCM), or original if FFmpeg unavailable
 */
export async function normalizeAudioForWhisper(
  audioBuffer: Buffer,
  mimeType: string
): Promise<{ data: Buffer; mimeType: string; normalized: boolean }> {
  // Check if FFmpeg is available
  const hasFfmpeg = await checkFfmpegAvailable();
  if (!hasFfmpeg) {
    console.log('[AudioNormalize] FFmpeg not available, returning original');
    return { data: audioBuffer, mimeType, normalized: false };
  }
  
  // Generate temp file paths
  const tempId = randomUUID();
  const inputExt = getExtensionFromMime(mimeType);
  const inputPath = join(tmpdir(), `audio_norm_in_${tempId}.${inputExt}`);
  const outputPath = join(tmpdir(), `audio_norm_out_${tempId}.wav`);
  const rawPath = join(tmpdir(), `audio_norm_raw_${tempId}.bin`);
  
  try {
    // Check for SpeaKING format and handle it specifically
    if (isSpeaKINGFormat(audioBuffer)) {
      console.log('[AudioNormalize] Detected SpeaKING format (0x0028/0x704F). Converting payload directly to WAV PCM...');
      const payload = extractSpeaKINGPayload(audioBuffer);
      await writeFile(rawPath, payload);
      
      try {
        // Attempt 1: Input is raw Opus. Convert to WAV PCM.
        console.log('[AudioNormalize] Trying to convert raw Opus payload to WAV PCM...');
        await runFfmpeg([
          '-f', 'opus', 
          '-i', rawPath,
          '-vn', 
          '-acodec', 'pcm_s16le',
          '-ar', '16000',
          '-ac', '1',
          '-y', outputPath
        ]);
      } catch (e) {
        console.log('[AudioNormalize] Raw Opus conversion failed, trying raw PCM fallback...');
        // Attempt 2: Input is maybe already raw PCM or ADPCM? Treat as s16le input just in case
        await runFfmpeg([
          '-f', 's16le', '-ar', '16000', '-ac', '1',
          '-i', rawPath,
          '-vn',
          '-acodec', 'pcm_s16le',
          '-ar', '16000',
          '-ac', '1',
          '-y', outputPath
        ]);
      }
      
      await safeUnlink(rawPath);
       // Read normalized file
      const normalizedBuffer = await readFile(outputPath);
      console.log(`[AudioNormalize] Converted SpeaKING format: ${formatBytes(audioBuffer.length)} → ${formatBytes(normalizedBuffer.length)}`);
      
      return { 
        data: normalizedBuffer, 
        mimeType: 'audio/wav', 
        normalized: true 
      };
    }

    // Write input file
    await writeFile(inputPath, audioBuffer);
    
    // Convert to standard WAV PCM format
    // This handles any codec (including Opus-in-WAV) and outputs standard PCM WAV
    console.log(`[AudioNormalize] Converting ${inputExt} to WAV PCM...`);
    await runFfmpeg([
      '-i', inputPath,
      '-vn',                    // No video
      '-acodec', 'pcm_s16le',   // Standard PCM 16-bit signed little-endian
      '-ar', '16000',           // 16kHz sample rate (standard for Whisper)
      '-ac', '1',               // Mono
      '-y',                     // Overwrite output
      outputPath
    ]);
    
    // Read normalized file
    const normalizedBuffer = await readFile(outputPath);
    console.log(`[AudioNormalize] Converted: ${formatBytes(audioBuffer.length)} → ${formatBytes(normalizedBuffer.length)}`);
    
    return { 
      data: normalizedBuffer, 
      mimeType: 'audio/wav', 
      normalized: true 
    };
    
  } catch (error: any) {
    console.error(`[AudioNormalize] Conversion failed: ${error.message}`);
    // Return original on failure - let server try to handle it
    return { data: audioBuffer, mimeType, normalized: false };
    
  } finally {
    // Cleanup temp files
    await safeUnlink(inputPath);
    await safeUnlink(outputPath);
    try { await unlink(join(tmpdir(), `audio_norm_raw_${tempId}.bin`)); } catch {}
  }
}
