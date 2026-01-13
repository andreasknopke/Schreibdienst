import { NextRequest, NextResponse } from 'next/server';
import { authenticateUserWithRequest } from '@/lib/usersDb';
import { getRuntimeConfigWithRequest, saveRuntimeConfigWithRequest, WHISPER_OFFLINE_MODELS, type RuntimeConfig } from '@/lib/configDb';

// Authenticate root user only
async function getAuthenticatedRoot(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return false;
  }
  
  try {
    const credentials = Buffer.from(authHeader.slice(6), 'base64').toString();
    const [username, password] = credentials.split(':');
    
    // Only root user can change system config
    if (username.toLowerCase() !== 'root') {
      return false;
    }
    
    const result = await authenticateUserWithRequest(request, username, password);
    return result.success;
  } catch {
    // Invalid auth header
  }
  
  return false;
}

// GET /api/config - Get current config (any authenticated user)
export async function GET(request: NextRequest) {
  const config = await getRuntimeConfigWithRequest(request);
  
  // Return config with environment info
  const envInfo = {
    hasOpenAIKey: !!process.env.OPENAI_API_KEY,
    hasElevenLabsKey: !!process.env.ELEVENLABS_API_KEY,
    hasWhisperUrl: !!process.env.WHISPER_SERVICE_URL,
    hasLMStudioUrl: !!process.env.LLM_STUDIO_URL,
    hasMistralKey: !!process.env.MISTRAL_API_KEY,
    whisperServiceUrl: process.env.WHISPER_SERVICE_URL || 'http://localhost:5000',
    lmStudioUrl: process.env.LLM_STUDIO_URL || 'http://localhost:1234',
  };
  
  return NextResponse.json({ 
    config,
    envInfo,
    availableTranscriptionProviders: getAvailableTranscriptionProviders(envInfo),
    availableLLMProviders: getAvailableLLMProviders(envInfo),
  });
}

function getAvailableTranscriptionProviders(envInfo: any): { id: string; name: string; available: boolean; reason?: string }[] {
  return [
    {
      id: 'whisperx',
      name: 'WhisperX (Lokal/Remote)',
      available: envInfo.hasWhisperUrl,
      reason: envInfo.hasWhisperUrl ? undefined : 'WHISPER_SERVICE_URL nicht konfiguriert',
    },
    {
      id: 'elevenlabs',
      name: 'ElevenLabs (Cloud)',
      available: envInfo.hasElevenLabsKey,
      reason: envInfo.hasElevenLabsKey ? undefined : 'ELEVENLABS_API_KEY nicht konfiguriert',
    },
    {
      id: 'mistral',
      name: 'Mistral AI Voxtral (Cloud)',
      available: envInfo.hasMistralKey,
      reason: envInfo.hasMistralKey ? undefined : 'MISTRAL_API_KEY nicht konfiguriert',
    },
  ];
}

function getAvailableLLMProviders(envInfo: any): { id: string; name: string; available: boolean; reason?: string }[] {
  return [
    {
      id: 'openai',
      name: 'OpenAI (GPT-4o)',
      available: envInfo.hasOpenAIKey,
      reason: envInfo.hasOpenAIKey ? undefined : 'OPENAI_API_KEY nicht konfiguriert',
    },
    {
      id: 'lmstudio',
      name: 'LM Studio (Lokal)',
      available: envInfo.hasLMStudioUrl,
      reason: envInfo.hasLMStudioUrl ? undefined : 'LLM_STUDIO_URL nicht konfiguriert',
    },
    {
      id: 'mistral',
      name: 'Mistral AI',
      available: envInfo.hasMistralKey,
      reason: envInfo.hasMistralKey ? undefined : 'MISTRAL_API_KEY nicht konfiguriert',
    },
  ];
}

// POST /api/config - Update config (root only)
export async function POST(request: NextRequest) {
  const isRoot = await getAuthenticatedRoot(request);
  
  if (!isRoot) {
    return NextResponse.json({ success: false, error: 'Nur der root-Benutzer kann die System-Konfiguration ändern' }, { status: 403 });
  }

  try {
    const body = await request.json();
    const currentConfig = await getRuntimeConfigWithRequest(request);
    
    // Validate and merge
    const newConfig: RuntimeConfig = {
      ...currentConfig,
    };
    
    if (body.transcriptionProvider && ['whisperx', 'elevenlabs', 'mistral'].includes(body.transcriptionProvider)) {
      newConfig.transcriptionProvider = body.transcriptionProvider;
    }
    
    if (body.llmProvider && ['openai', 'lmstudio', 'mistral'].includes(body.llmProvider)) {
      newConfig.llmProvider = body.llmProvider;
    }
    
    // Validate whisperModel - accepts both short IDs and full HuggingFace paths
    const validWhisperModels = [
      'large-v3',
      'deepdml/faster-whisper-large-v3-german-2',
      'large-v2',
      'cstr/whisper-large-v3-turbo-german-int8_float32',
    ];
    if (body.whisperModel && validWhisperModels.includes(body.whisperModel)) {
      newConfig.whisperModel = body.whisperModel;
    }
    
    if (body.openaiModel) {
      newConfig.openaiModel = body.openaiModel;
    }
    
    if (body.mistralModel) {
      newConfig.mistralModel = body.mistralModel;
    }
    
    // Validate whisperOfflineModel
    if (body.whisperOfflineModel) {
      const validOfflineModels = WHISPER_OFFLINE_MODELS.map(m => m.id);
      if (validOfflineModels.includes(body.whisperOfflineModel)) {
        newConfig.whisperOfflineModel = body.whisperOfflineModel;
      }
    }
    
    if (typeof body.llmPromptAddition === 'string') {
      newConfig.llmPromptAddition = body.llmPromptAddition;
    }
    
    // Double Precision Pipeline settings
    if (typeof body.doublePrecisionEnabled === 'boolean') {
      newConfig.doublePrecisionEnabled = body.doublePrecisionEnabled;
    }
    
    if (body.doublePrecisionSecondProvider && ['whisperx', 'elevenlabs', 'mistral'].includes(body.doublePrecisionSecondProvider)) {
      newConfig.doublePrecisionSecondProvider = body.doublePrecisionSecondProvider;
    }
    
    if (body.doublePrecisionMode && ['parallel', 'sequential'].includes(body.doublePrecisionMode)) {
      newConfig.doublePrecisionMode = body.doublePrecisionMode;
    }
    
    await saveRuntimeConfigWithRequest(request, newConfig);
    
    return NextResponse.json({ success: true, config: newConfig });
  } catch (error) {
    console.error('Config update error:', error);
    return NextResponse.json({ success: false, error: 'Konfiguration konnte nicht gespeichert werden' }, { status: 500 });
  }
}
