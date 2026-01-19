import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';
import dns from 'dns';
import { promisify } from 'util';

export const runtime = 'nodejs';

const dnsLookup = promisify(dns.lookup);
const dnsResolve4 = promisify(dns.resolve4);
const dnsResolve6 = promisify(dns.resolve6);

// Helper to test LM Studio connection
async function testLMStudioConnection(url: string): Promise<{
  reachable: boolean;
  latencyMs: number | null;
  error: string | null;
  details: any;
}> {
  const result = {
    reachable: false,
    latencyMs: null as number | null,
    error: null as string | null,
    details: {} as any,
  };
  
  try {
    const urlObj = new URL(url);
    result.details.parsedUrl = {
      protocol: urlObj.protocol,
      hostname: urlObj.hostname,
      port: urlObj.port || (urlObj.protocol === 'https:' ? '443' : '80'),
      pathname: urlObj.pathname,
    };
    
    // DNS lookup
    try {
      const dnsResult = await dnsLookup(urlObj.hostname);
      result.details.dns = {
        address: dnsResult.address,
        family: dnsResult.family,
      };
    } catch (dnsErr: any) {
      result.details.dns = { error: dnsErr.message, code: dnsErr.code };
    }
    
    // Try IPv4 resolution
    try {
      const ipv4 = await dnsResolve4(urlObj.hostname);
      result.details.ipv4 = ipv4;
    } catch (e: any) {
      result.details.ipv4Error = e.message;
    }
    
    // Try IPv6 resolution
    try {
      const ipv6 = await dnsResolve6(urlObj.hostname);
      result.details.ipv6 = ipv6;
    } catch (e: any) {
      result.details.ipv6Error = e.message;
    }
    
    // Test connection to /v1/models endpoint
    const modelsUrl = `${url}/v1/models`;
    const startTime = Date.now();
    
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout
    
    try {
      const response = await fetch(modelsUrl, {
        method: 'GET',
        signal: controller.signal,
      });
      
      clearTimeout(timeoutId);
      result.latencyMs = Date.now() - startTime;
      result.details.httpStatus = response.status;
      result.details.httpStatusText = response.statusText;
      
      if (response.ok) {
        result.reachable = true;
        try {
          const data = await response.json();
          result.details.models = data.data?.map((m: any) => m.id) || [];
        } catch {
          result.details.responseBody = 'Could not parse JSON';
        }
      } else {
        result.error = `HTTP ${response.status}: ${response.statusText}`;
        result.details.responseBody = await response.text().catch(() => '(could not read body)');
      }
    } catch (fetchErr: any) {
      clearTimeout(timeoutId);
      result.latencyMs = Date.now() - startTime;
      result.error = fetchErr.message;
      result.details.fetchError = {
        name: fetchErr.name,
        code: fetchErr.code,
        cause: fetchErr.cause ? String(fetchErr.cause) : null,
      };
      
      // Diagnosis
      if (fetchErr.name === 'AbortError') {
        result.details.diagnosis = 'Request timed out after 10 seconds';
      } else if (fetchErr.code === 'ECONNREFUSED') {
        result.details.diagnosis = 'Connection refused - service not running or wrong port';
      } else if (fetchErr.code === 'ENOTFOUND') {
        result.details.diagnosis = 'DNS lookup failed - hostname not found';
      } else if (fetchErr.code === 'ETIMEDOUT') {
        result.details.diagnosis = 'Connection timed out - network/firewall issue';
      } else if (fetchErr.code === 'ENETUNREACH') {
        result.details.diagnosis = 'Network unreachable';
      }
    }
  } catch (err: any) {
    result.error = err.message;
  }
  
  return result;
}

export async function GET() {
  const cwd = process.cwd();
  const cacheDir = path.join(cwd, 'cache');
  const dictionariesDir = path.join(cacheDir, 'dictionaries');
  const usersFile = path.join(cacheDir, 'users.json');
  
  // Environment variables
  const lmStudioUrl = process.env.LLM_STUDIO_URL || 'http://localhost:1234';
  const whisperUrl = process.env.WHISPER_SERVICE_URL || 'http://localhost:5000';
  
  const checks = {
    ok: true,
    time: new Date().toISOString(),
    cwd,
    environment: {
      LLM_STUDIO_URL: process.env.LLM_STUDIO_URL || '(not set, using default)',
      LLM_STUDIO_MODEL: process.env.LLM_STUDIO_MODEL || '(not set)',
      WHISPER_SERVICE_URL: process.env.WHISPER_SERVICE_URL || '(not set)',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ? '***set***' : '(not set)',
      NODE_ENV: process.env.NODE_ENV,
    },
    cacheDir,
    cacheDirExists: false,
    cacheDirWritable: false,
    dictionariesDirExists: false,
    usersFileExists: false,
    files: [] as string[],
    lmStudio: null as any,
    error: null as string | null,
  };
  
  try {
    checks.cacheDirExists = fs.existsSync(cacheDir);
    checks.dictionariesDirExists = fs.existsSync(dictionariesDir);
    checks.usersFileExists = fs.existsSync(usersFile);
    
    // Try to list files
    if (checks.cacheDirExists) {
      checks.files = fs.readdirSync(cacheDir);
    }
    
    // Try to write a test file
    const testFile = path.join(cacheDir, '.write-test');
    try {
      // Ensure cache dir exists
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
        checks.cacheDirExists = true;
      }
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      checks.cacheDirWritable = true;
    } catch (writeErr: any) {
      checks.cacheDirWritable = false;
      checks.error = writeErr.message;
    }
    
    // Test LM Studio connection
    console.log(`[Health] Testing LM Studio connection to: ${lmStudioUrl}`);
    checks.lmStudio = await testLMStudioConnection(lmStudioUrl);
    console.log(`[Health] LM Studio test result:`, JSON.stringify(checks.lmStudio, null, 2));
    
    if (!checks.lmStudio.reachable) {
      console.warn(`[Health] LM Studio NOT reachable: ${checks.lmStudio.error}`);
    }
  } catch (err: any) {
    checks.ok = false;
    checks.error = err.message;
  }
  
  return NextResponse.json(checks);
}
