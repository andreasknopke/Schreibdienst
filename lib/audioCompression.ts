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
  
  try {
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
