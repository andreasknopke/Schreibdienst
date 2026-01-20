import { NextRequest, NextResponse } from 'next/server';
import { getRuntimeConfigWithRequest } from '@/lib/configDb';

export const runtime = 'nodejs';

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
  
  if (provider !== 'whisperx') {
    console.log(`[Warmup] Skipping WhisperX warmup - using ${provider} provider`);
    return NextResponse.json({
      status: 'skipped',
      message: `WhisperX warmup not needed - using ${provider} provider`,
    });
  }
  
  const whisperUrl = process.env.WHISPER_SERVICE_URL || 'http://localhost:5000';
  
  console.log('[Warmup] Triggering WhisperX warmup...');
  const startTime = Date.now();
  
  try {
    // Versuche zuerst den Health-Check
    const healthRes = await fetch(`${whisperUrl}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(5000), // 5s Timeout für Health-Check
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
      signal: AbortSignal.timeout(60000), // 60s Timeout für Warmup
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
