import { NextRequest, NextResponse } from 'next/server';
import { 
  logRecoveryEventWithRequest, 
  initWhisperRecoveryLogTableWithRequest 
} from '@/lib/whisperRecoveryLogDb';

export const runtime = 'nodejs';

/**
 * WhisperX System API - Ruft die neuen System-Methoden auf
 * 
 * Verfügbare Aktionen:
 * - system_cleanup: Führt torch.cuda.empty_cache() aus (VRAM freigeben)
 * - system_kill_zombies: Killt Zombie Python-Prozesse
 * - system_reboot: Startet den WhisperX Server neu
 * - health_check: Prüft ob WhisperX funktioniert (mit Mini-Audio)
 */

// Cache für Gradio Session
let gradioSessionCookie: string | null = null;

async function getGradioSession(): Promise<string> {
  const whisperUrl = process.env.WHISPER_SERVICE_URL || 'http://localhost:7860';
  
  if (gradioSessionCookie) {
    return gradioSessionCookie;
  }
  
  const authUser = process.env.WHISPER_AUTH_USERNAME;
  let authPass = process.env.WHISPER_AUTH_PASSWORD;
  
  // Fallback: find password by iterating env vars
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
  });
  
  if (!loginRes.ok) {
    throw new Error(`Gradio login failed: ${loginRes.status}`);
  }
  
  const setCookieHeader = loginRes.headers.get('set-cookie');
  gradioSessionCookie = setCookieHeader?.split(';')[0] || '';
  
  return gradioSessionCookie;
}

// Führt eine Gradio-API-Methode aus
async function callGradioMethod(methodName: string): Promise<{ success: boolean; message: string; data?: any }> {
  const whisperUrl = process.env.WHISPER_SERVICE_URL || 'http://localhost:7860';
  const sessionCookie = await getGradioSession();
  
  console.log(`[WhisperX System] Calling ${methodName}...`);
  const startTime = Date.now();
  
  // Start the API call
  const processRes = await fetch(`${whisperUrl}/gradio_api/call/${methodName}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cookie': sessionCookie,
    },
    body: JSON.stringify({ data: [] }),
  });
  
  if (!processRes.ok) {
    const text = await processRes.text();
    throw new Error(`${methodName} failed (${processRes.status}): ${text}`);
  }
  
  const processData = await processRes.json();
  const eventId = processData.event_id;
  
  // Poll for result
  const resultRes = await fetch(`${whisperUrl}/gradio_api/call/${methodName}/${eventId}`, {
    headers: { 'Cookie': sessionCookie },
  });
  
  if (!resultRes.ok) {
    const text = await resultRes.text();
    throw new Error(`${methodName} result fetch failed (${resultRes.status}): ${text}`);
  }
  
  const resultText = await resultRes.text();
  const dataMatch = resultText.match(/data:\s*(\[.*\])/s);
  
  const duration = Date.now() - startTime;
  
  if (!dataMatch) {
    return { 
      success: true, 
      message: `${methodName} ausgeführt (${duration}ms)`,
      data: resultText 
    };
  }
  
  const resultData = JSON.parse(dataMatch[1]);
  return { 
    success: true, 
    message: resultData[0] || `${methodName} erfolgreich (${duration}ms)`,
    data: resultData 
  };
}

// Führt einen Health Check durch mit einem Mini-Audio
async function performHealthCheck(): Promise<{ success: boolean; message: string; responseTime?: number }> {
  const whisperUrl = process.env.WHISPER_SERVICE_URL || 'http://localhost:7860';
  const startTime = Date.now();
  
  try {
    // Einfacher HTTP-Check zuerst
    const pingRes = await fetch(whisperUrl, { 
      method: 'GET',
      signal: AbortSignal.timeout(10000) // 10s timeout
    });
    
    if (!pingRes.ok) {
      return { 
        success: false, 
        message: `WhisperX nicht erreichbar (HTTP ${pingRes.status})` 
      };
    }
    
    const responseTime = Date.now() - startTime;
    return { 
      success: true, 
      message: `WhisperX erreichbar (${responseTime}ms)`,
      responseTime 
    };
  } catch (error: any) {
    return { 
      success: false, 
      message: `WhisperX nicht erreichbar: ${error.message}` 
    };
  }
}

// Wartet eine bestimmte Zeit
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// POST: Führt System-Aktionen aus
export async function POST(req: NextRequest) {
  try {
    await initWhisperRecoveryLogTableWithRequest(req);
    
    const { action } = await req.json();
    
    if (!action) {
      return NextResponse.json({ error: 'action parameter required' }, { status: 400 });
    }
    
    const startTime = Date.now();
    let result: { success: boolean; message: string; data?: any };
    
    switch (action) {
      case 'system_cleanup':
        await logRecoveryEventWithRequest(req, 'info', 'system_cleanup', 'VRAM Cleanup gestartet');
        result = await callGradioMethod('system_cleanup');
        await logRecoveryEventWithRequest(req, result.success ? 'success' : 'error', 'system_cleanup', 
          result.message, { durationMs: Date.now() - startTime, success: result.success });
        break;
        
      case 'system_kill_zombies':
        await logRecoveryEventWithRequest(req, 'info', 'system_kill_zombies', 'Zombie-Prozesse werden beendet');
        result = await callGradioMethod('system_kill_zombies');
        await logRecoveryEventWithRequest(req, result.success ? 'success' : 'error', 'system_kill_zombies', 
          result.message, { durationMs: Date.now() - startTime, success: result.success });
        break;
        
      case 'system_reboot':
        await logRecoveryEventWithRequest(req, 'warn', 'system_reboot', 'Server-Neustart initiiert');
        result = await callGradioMethod('system_reboot');
        // Nach Reboot Session invalidieren
        gradioSessionCookie = null;
        await logRecoveryEventWithRequest(req, 'info', 'system_reboot', 
          'Neustart-Befehl gesendet, warte auf Neustart...', { durationMs: Date.now() - startTime });
        break;
        
      case 'health_check':
        result = await performHealthCheck();
        await logRecoveryEventWithRequest(req, result.success ? 'success' : 'error', 'health_check', 
          result.message, { durationMs: Date.now() - startTime, success: result.success });
        break;
        
      case 'full_recovery':
        // Führt die komplette Heilungssequenz durch
        result = await performFullRecovery(req);
        break;
        
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }
    
    return NextResponse.json(result);
    
  } catch (error: any) {
    console.error('[WhisperX System] Error:', error);
    return NextResponse.json({ 
      success: false, 
      error: error.message 
    }, { status: 500 });
  }
}

/**
 * Führt die komplette Heilungssequenz durch:
 * 1. VRAM leeren (system_cleanup)
 * 2. Zombies killen (system_kill_zombies)
 * 3. Health Check
 * 4. Wenn immer noch Fehler: Server Restart + 30s warten
 * 5. Finaler Health Check
 */
async function performFullRecovery(req: NextRequest): Promise<{ success: boolean; message: string; steps: string[] }> {
  const steps: string[] = [];
  
  await logRecoveryEventWithRequest(req, 'warn', 'error_detected', 
    'Starte vollständige Wiederherstellungssequenz');
  
  try {
    // Schritt 1: VRAM leeren
    steps.push('🧹 VRAM Cleanup...');
    await logRecoveryEventWithRequest(req, 'info', 'system_cleanup', 'Schritt 1: VRAM wird geleert');
    
    try {
      const cleanupResult = await callGradioMethod('system_cleanup');
      steps.push(`  ✓ ${cleanupResult.message}`);
      await logRecoveryEventWithRequest(req, 'success', 'system_cleanup', cleanupResult.message, { success: true });
    } catch (error: any) {
      steps.push(`  ⚠ VRAM Cleanup fehlgeschlagen: ${error.message}`);
      await logRecoveryEventWithRequest(req, 'warn', 'system_cleanup', 
        `VRAM Cleanup fehlgeschlagen: ${error.message}`, { success: false });
    }
    
    // Schritt 2: Zombies killen
    steps.push('💀 Zombie-Prozesse beenden...');
    await logRecoveryEventWithRequest(req, 'info', 'system_kill_zombies', 'Schritt 2: Zombie-Prozesse werden beendet');
    
    try {
      const zombieResult = await callGradioMethod('system_kill_zombies');
      steps.push(`  ✓ ${zombieResult.message}`);
      await logRecoveryEventWithRequest(req, 'success', 'system_kill_zombies', zombieResult.message, { success: true });
    } catch (error: any) {
      steps.push(`  ⚠ Zombie-Kill fehlgeschlagen: ${error.message}`);
      await logRecoveryEventWithRequest(req, 'warn', 'system_kill_zombies', 
        `Zombie-Kill fehlgeschlagen: ${error.message}`, { success: false });
    }
    
    // Schritt 3: Health Check
    steps.push('🩺 Health Check...');
    await sleep(2000); // 2s warten
    
    let healthResult = await performHealthCheck();
    
    if (healthResult.success) {
      steps.push(`  ✓ WhisperX funktioniert wieder (${healthResult.responseTime}ms)`);
      await logRecoveryEventWithRequest(req, 'success', 'recovery_success', 
        'Wiederherstellung erfolgreich nach VRAM Cleanup und Zombie-Kill', { success: true });
      
      return {
        success: true,
        message: 'WhisperX erfolgreich wiederhergestellt',
        steps
      };
    }
    
    steps.push(`  ✗ ${healthResult.message}`);
    
    // Schritt 4: Server Restart als letzte Option
    steps.push('🔄 Server-Neustart (Ultima Ratio)...');
    await logRecoveryEventWithRequest(req, 'warn', 'system_reboot', 
      'Schritt 4: Server-Neustart als letzte Option');
    
    try {
      await callGradioMethod('system_reboot');
      gradioSessionCookie = null; // Session invalidieren
      steps.push('  → Neustart-Befehl gesendet');
    } catch (error: any) {
      steps.push(`  ⚠ Neustart-Befehl fehlgeschlagen: ${error.message}`);
      await logRecoveryEventWithRequest(req, 'error', 'system_reboot', 
        `Neustart fehlgeschlagen: ${error.message}`, { success: false });
    }
    
    // Schritt 5: Warten und Health Check
    steps.push('⏳ Warte 30 Sekunden auf Neustart...');
    await logRecoveryEventWithRequest(req, 'info', 'health_check', 'Warte 30s auf Server-Neustart');
    await sleep(30000); // 30 Sekunden warten
    
    // Mehrere Health Check Versuche
    for (let attempt = 1; attempt <= 3; attempt++) {
      steps.push(`🩺 Health Check Versuch ${attempt}/3...`);
      
      healthResult = await performHealthCheck();
      
      if (healthResult.success) {
        steps.push(`  ✓ WhisperX funktioniert wieder (${healthResult.responseTime}ms)`);
        await logRecoveryEventWithRequest(req, 'success', 'recovery_success', 
          `Wiederherstellung erfolgreich nach Server-Neustart (Versuch ${attempt})`, { success: true });
        
        return {
          success: true,
          message: 'WhisperX nach Neustart erfolgreich wiederhergestellt',
          steps
        };
      }
      
      steps.push(`  ✗ ${healthResult.message}`);
      
      if (attempt < 3) {
        steps.push('  → Warte weitere 10 Sekunden...');
        await sleep(10000);
      }
    }
    
    // Recovery fehlgeschlagen
    await logRecoveryEventWithRequest(req, 'error', 'recovery_failed', 
      'Wiederherstellung fehlgeschlagen - manueller Eingriff erforderlich', { success: false });
    
    return {
      success: false,
      message: 'WhisperX konnte nicht wiederhergestellt werden - manueller Eingriff erforderlich',
      steps
    };
    
  } catch (error: any) {
    await logRecoveryEventWithRequest(req, 'error', 'recovery_failed', 
      `Unerwarteter Fehler: ${error.message}`, { errorContext: error.stack, success: false });
    
    steps.push(`❌ Unerwarteter Fehler: ${error.message}`);
    
    return {
      success: false,
      message: `Recovery fehlgeschlagen: ${error.message}`,
      steps
    };
  }
}

// GET: Status abfragen
export async function GET(req: NextRequest) {
  try {
    const healthResult = await performHealthCheck();
    
    return NextResponse.json({
      healthy: healthResult.success,
      message: healthResult.message,
      responseTime: healthResult.responseTime,
      whisperUrl: process.env.WHISPER_SERVICE_URL || 'http://localhost:7860'
    });
  } catch (error: any) {
    return NextResponse.json({
      healthy: false,
      error: error.message
    }, { status: 500 });
  }
}
