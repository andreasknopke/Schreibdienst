import { NextRequest, NextResponse } from 'next/server';
import { getRuntimeConfigWithRequest } from '@/lib/configDb';

export const runtime = 'nodejs';

// Session-Cache für Gradio (geteilt mit transcribe route über global)
let gradioSessionCache: {
  cookie: string;
  timestamp: number;
  url: string;
} | null = null;
const SESSION_MAX_AGE = 5 * 60 * 1000; // 5 Minuten

// Minimaler WAV-Header für 0.1s Stille (16kHz, 16bit, mono)
function createSilentWav(): Buffer {
  const sampleRate = 16000;
  const duration = 0.1; // 100ms
  const numSamples = Math.floor(sampleRate * duration);
  const bytesPerSample = 2;
  const dataSize = numSamples * bytesPerSample;
  const fileSize = 44 + dataSize;
  
  const buffer = Buffer.alloc(fileSize);
  
  // RIFF header
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(fileSize - 8, 4);
  buffer.write('WAVE', 8);
  
  // fmt chunk
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16); // chunk size
  buffer.writeUInt16LE(1, 20); // PCM
  buffer.writeUInt16LE(1, 22); // mono
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * bytesPerSample, 28); // byte rate
  buffer.writeUInt16LE(bytesPerSample, 32); // block align
  buffer.writeUInt16LE(16, 34); // bits per sample
  
  // data chunk
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  // Samples are already 0 (silence)
  
  return buffer;
}

/**
 * Gradio-Warmup: Sendet minimalen Audio-Chunk um Modell vorzuladen
 */
async function warmupGradio(whisperUrl: string, whisperModel: string): Promise<{ success: boolean; message: string; duration?: number }> {
  const startTime = Date.now();
  const now = Date.now();
  let sessionCookie: string;
  
  console.log(`[Warmup] Starting Gradio warmup for ${whisperUrl}`);
  
  // Session erstellen oder aus Cache
  if (gradioSessionCache && 
      gradioSessionCache.url === whisperUrl && 
      (now - gradioSessionCache.timestamp) < SESSION_MAX_AGE) {
    sessionCookie = gradioSessionCache.cookie;
    console.log(`[Warmup] Using cached Gradio session`);
  } else {
    console.log(`[Warmup] Creating new Gradio session`);
    
    const authUser = process.env.WHISPER_AUTH_USERNAME;
    let authPass = process.env.WHISPER_AUTH_PASSWORD;
    
    if (!authPass) {
      const whisperEnvVars = Object.keys(process.env).filter(k => k.includes('WHISPER'));
      for (const key of whisperEnvVars) {
        if (key.includes('PASSWORD')) {
          authPass = process.env[key] || '';
        }
      }
    }
    
    const loginBody = `username=${encodeURIComponent(authUser || '')}&password=${encodeURIComponent(authPass || '')}`;
    
    const loginRes = await fetch(`${whisperUrl}/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: loginBody,
      signal: AbortSignal.timeout(10000),
    });
    
    if (!loginRes.ok) {
      return { success: false, message: `Gradio login failed: ${loginRes.status}` };
    }
    
    const setCookieHeader = loginRes.headers.get('set-cookie');
    sessionCookie = setCookieHeader?.split(';')[0] || '';
    
    gradioSessionCache = { cookie: sessionCookie, timestamp: now, url: whisperUrl };
  }
  
  // Minimale WAV-Datei erstellen
  const silentWav = createSilentWav();
  const blob = new Blob([silentWav], { type: 'audio/wav' });
  
  // Upload
  const uploadFormData = new FormData();
  uploadFormData.append('files', blob, 'warmup.wav');
  
  const uploadRes = await fetch(`${whisperUrl}/gradio_api/upload?upload_id=${Date.now()}`, {
    method: 'POST',
    headers: { 'Cookie': sessionCookie },
    body: uploadFormData,
    signal: AbortSignal.timeout(10000),
  });
  
  if (!uploadRes.ok) {
    return { success: false, message: `Upload failed: ${uploadRes.status}` };
  }
  
  const uploadData = await uploadRes.json();
  const filePath = uploadData[0]?.path || uploadData[0];
  
  // Transkription starten (lädt das Modell)
  const fileDataObj = {
    path: filePath,
    orig_name: 'warmup.wav',
    size: silentWav.length,
    mime_type: 'audio/wav',
    meta: { _type: 'gradio.FileData' }
  };
  
  const processRes = await fetch(`${whisperUrl}/gradio_api/call/start_process`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': sessionCookie,
    },
    body: JSON.stringify({
      data: [
        fileDataObj,
        'German',
        whisperModel,
        'cuda',
        '', // initial_prompt
        true // speed_mode
      ]
    }),
    signal: AbortSignal.timeout(60000), // 60s für Modell-Loading
  });
  
  if (!processRes.ok) {
    return { success: false, message: `Process start failed: ${processRes.status}` };
  }
  
  const processData = await processRes.json();
  const eventId = processData.event_id;
  
  // Auf Ergebnis warten (Modell wird geladen)
  const resultRes = await fetch(`${whisperUrl}/gradio_api/call/start_process/${eventId}`, {
    headers: { 'Cookie': sessionCookie },
    signal: AbortSignal.timeout(60000),
  });
  
  if (!resultRes.ok) {
    return { success: false, message: `Result fetch failed: ${resultRes.status}` };
  }
  
  const duration = (Date.now() - startTime) / 1000;
  console.log(`[Warmup] ✓ Gradio warmup complete in ${duration.toFixed(2)}s`);
  
  return { success: true, message: 'Model loaded', duration };
}

/**
 * Warmup-Endpoint für WhisperX Service
 * Ruft den Whisper-Service auf, um das Modell vorzuladen und CUDA-Kernel zu initialisieren.
 * Sollte beim Frontend-Start aufgerufen werden für minimale Latenz bei der ersten Transkription.
 * Wird nur ausgeführt wenn WhisperX als Transkriptions-Provider konfiguriert ist.
 */
export async function POST(request: NextRequest) {
  // Prüfe ob WhisperX als Provider konfiguriert ist
  const runtimeConfig = await getRuntimeConfigWithRequest(request);
  const provider = runtimeConfig.transcriptionProvider || 'whisperx';
  const whisperModel = runtimeConfig.whisperModel || process.env.WHISPER_MODEL || 'large-v3';
  
  if (provider !== 'whisperx') {
    console.log(`[Warmup] Skipping WhisperX warmup - using ${provider} provider`);
    return NextResponse.json({
      status: 'skipped',
      message: `WhisperX warmup not needed - using ${provider} provider`,
    });
  }
  
  const whisperUrl = process.env.WHISPER_SERVICE_URL || 'http://localhost:5000';
  const isGradio = whisperUrl.includes(':7860');
  
  console.log(`[Warmup] Triggering WhisperX warmup... (${isGradio ? 'Gradio' : 'Native'} mode)`);
  const startTime = Date.now();
  
  try {
    // Gradio-Modus: Sende minimalen Audio-Chunk
    if (isGradio) {
      const result = await warmupGradio(whisperUrl, whisperModel);
      
      if (result.success) {
        return NextResponse.json({
          status: 'warmed_up',
          mode: 'gradio',
          model: whisperModel,
          warmup_time: result.duration,
          message: result.message,
        });
      } else {
        console.warn(`[Warmup] Gradio warmup failed: ${result.message}`);
        return NextResponse.json({
          status: 'warmup_failed',
          mode: 'gradio',
          message: result.message,
        }, { status: 500 });
      }
    }
    
    // Native WhisperX-Modus: Health-Check und Warmup-Endpoint
    const healthRes = await fetch(`${whisperUrl}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    
    if (!healthRes.ok) {
      console.warn('[Warmup] Health check failed, service may be starting...');
      return NextResponse.json({
        status: 'service_unavailable',
        message: 'WhisperX service not ready',
      }, { status: 503 });
    }
    
    const healthData = await healthRes.json();
    console.log(`[Warmup] Health check passed: ${JSON.stringify(healthData)}`);
    
    // Wenn bereits aufgewärmt, nichts tun
    if (healthData.warmed_up) {
      console.log('[Warmup] Service already warmed up');
      return NextResponse.json({
        status: 'already_warmed_up',
        device: healthData.device,
        model: healthData.model,
        duration: 0,
      });
    }
    
    // Warmup-Endpoint aufrufen
    const warmupRes = await fetch(`${whisperUrl}/warmup`, {
      method: 'POST',
      signal: AbortSignal.timeout(60000),
    });
    
    if (!warmupRes.ok) {
      const text = await warmupRes.text();
      console.error(`[Warmup] Warmup failed: ${text}`);
      return NextResponse.json({
        status: 'warmup_failed',
        message: text,
      }, { status: 500 });
    }
    
    const warmupData = await warmupRes.json();
    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log(`[Warmup] ✓ Complete in ${totalDuration}s - Device: ${warmupData.device}, Model: ${warmupData.model}`);
    
    return NextResponse.json({
      status: 'warmed_up',
      device: warmupData.device,
      model: warmupData.model,
      warmup_time: warmupData.warmup_time,
      total_duration: parseFloat(totalDuration),
    });
    
  } catch (err: any) {
    // Timeout oder Netzwerkfehler - Service möglicherweise nicht erreichbar
    console.error('[Warmup] Error:', err.message);
    
    // Bei Timeout annehmen, dass Service noch startet
    if (err.name === 'AbortError' || err.name === 'TimeoutError') {
      return NextResponse.json({
        status: 'timeout',
        message: 'WhisperX service warmup timed out - may still be loading',
      }, { status: 504 });
    }
    
    return NextResponse.json({
      status: 'error',
      message: err.message,
    }, { status: 500 });
  }
}

/**
 * GET-Endpoint für Status-Check
 */
export async function GET() {
  const whisperUrl = process.env.WHISPER_SERVICE_URL || 'http://localhost:5000';
  
  try {
    const healthRes = await fetch(`${whisperUrl}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000),
    });
    
    if (!healthRes.ok) {
      return NextResponse.json({
        status: 'unavailable',
        whisper_url: whisperUrl,
      }, { status: 503 });
    }
    
    const healthData = await healthRes.json();
    return NextResponse.json({
      status: healthData.status,
      warmed_up: healthData.warmed_up,
      device: healthData.device,
      model: healthData.model,
      turbo_available: healthData.turbo_available,
      align_available: healthData.align_available,
    });
    
  } catch (err: any) {
    return NextResponse.json({
      status: 'error',
      message: err.message,
      whisper_url: whisperUrl,
    }, { status: 500 });
  }
}
