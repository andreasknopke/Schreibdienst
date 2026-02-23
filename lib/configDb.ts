import { NextRequest } from 'next/server';
import { query, execute, getPoolForRequest } from './db';

// Verfügbare Offline-Modelle für WhisperX (aus Model_Manager.py)
export type WhisperOfflineModel = 
  | 'large-v3'                                        // Standard large-v3
  | 'guillaumekln/faster-whisper-large-v2'            // Large-v2 (empfohlen)
  | 'large-v2'                                        // Standard large-v2
  | 'cstr/whisper-large-v3-turbo-german-int8_float32'; // Turbo German

export const WHISPER_OFFLINE_MODELS: { id: WhisperOfflineModel; name: string; modelPath: string }[] = [
  { id: 'large-v3', name: 'Large-v3', modelPath: 'large-v3' },
  { id: 'guillaumekln/faster-whisper-large-v2', name: 'Large-v2 (empfohlen)', modelPath: 'guillaumekln/faster-whisper-large-v2' },
  { id: 'large-v2', name: 'Large-v2', modelPath: 'large-v2' },
  { id: 'cstr/whisper-large-v3-turbo-german-int8_float32', name: 'Large-v3 Turbo German (schnell)', modelPath: 'cstr/whisper-large-v3-turbo-german-int8_float32' },
];

// ============================================================
// Unified Transcription Service List
// Ein Service-Eintrag kombiniert Provider + ggf. WhisperX-Modell
// ============================================================

export type TranscriptionProvider = 'whisperx' | 'elevenlabs' | 'mistral' | 'fast_whisper';

export interface TranscriptionServiceOption {
  /** Unique service ID, e.g. "elevenlabs" or "whisperx:large-v3" */
  id: string;
  /** Display name shown in UI */
  name: string;
  /** Underlying provider */
  provider: TranscriptionProvider;
  /** WhisperX model (only for whisperx provider) */
  whisperModel?: string;
  /** Whether this is a cloud service */
  isCloud: boolean;
}

/** All available transcription services (static list). Availability is checked at runtime via env vars. */
export const TRANSCRIPTION_SERVICES: TranscriptionServiceOption[] = [
  { id: 'elevenlabs',                                       name: 'ElevenLabs (Cloud)',                    provider: 'elevenlabs',    isCloud: true },
  { id: 'mistral',                                          name: 'Mistral AI Voxtral (Cloud)',            provider: 'mistral',       isCloud: true },
  { id: 'fast_whisper',                                     name: 'Fast Whisper (WebSocket)',               provider: 'fast_whisper',  isCloud: false },
  { id: 'whisperx:large-v3',                                name: 'WhisperX: Model 1 (large-v3)',          provider: 'whisperx',      isCloud: false, whisperModel: 'large-v3' },
  { id: 'whisperx:guillaumekln/faster-whisper-large-v2',    name: 'WhisperX: Model 2 (large-v2, empfohlen)', provider: 'whisperx',    isCloud: false, whisperModel: 'guillaumekln/faster-whisper-large-v2' },
  { id: 'whisperx:large-v2',                                name: 'WhisperX: Model 3 (large-v2)',          provider: 'whisperx',      isCloud: false, whisperModel: 'large-v2' },
  { id: 'whisperx:cstr/whisper-large-v3-turbo-german-int8_float32', name: 'WhisperX: Model 4 (Turbo German)', provider: 'whisperx', isCloud: false, whisperModel: 'cstr/whisper-large-v3-turbo-german-int8_float32' },
];

/** Parse a unified service ID into provider + optional whisper model */
export function parseServiceId(serviceId: string): { provider: TranscriptionProvider; whisperModel?: string } {
  const svc = TRANSCRIPTION_SERVICES.find(s => s.id === serviceId);
  if (svc) {
    return { provider: svc.provider, whisperModel: svc.whisperModel };
  }
  // Legacy fallback: bare provider names
  if (['whisperx', 'elevenlabs', 'mistral', 'fast_whisper'].includes(serviceId)) {
    return { provider: serviceId as TranscriptionProvider };
  }
  // Default
  return { provider: 'whisperx', whisperModel: 'guillaumekln/faster-whisper-large-v2' };
}

/** Build a unified service ID from provider + optional whisper model */
export function buildServiceId(provider: TranscriptionProvider, whisperModel?: string): string {
  if (provider === 'whisperx' && whisperModel) {
    return `whisperx:${whisperModel}`;
  }
  return provider;
}

// Get the HuggingFace model path from the offline model ID
export function getWhisperOfflineModelPath(modelId: WhisperOfflineModel | string | undefined): string {
  if (!modelId) {
    // Default to the first model
    return WHISPER_OFFLINE_MODELS[0].modelPath;
  }
  const model = WHISPER_OFFLINE_MODELS.find(m => m.id === modelId);
  return model?.modelPath || WHISPER_OFFLINE_MODELS[0].modelPath;
}

export interface RuntimeConfig {
  // --- Legacy fields (still read for backwards compatibility) ---
  transcriptionProvider: TranscriptionProvider;
  whisperModel?: string;
  whisperOfflineModel?: WhisperOfflineModel;
  doublePrecisionSecondProvider?: 'whisperx' | 'elevenlabs' | 'mistral';
  doublePrecisionWhisperModel?: string;

  // --- New unified service fields ---
  onlineService?: string;         // e.g. "elevenlabs" or "whisperx:large-v3"
  offlineService?: string;        // e.g. "whisperx:guillaumekln/faster-whisper-large-v2"
  doublePrecisionService?: string; // e.g. "mistral" or "whisperx:large-v2"

  // --- LLM ---
  llmProvider: 'openai' | 'lmstudio' | 'mistral';
  openaiModel?: string;
  mistralModel?: string;
  llmPromptAddition?: string;
  // LM-Studio Session Override
  lmStudioModelOverride?: string;  // Überschreibt LLM_STUDIO_MODEL für diese Session
  lmStudioUseApiMode?: boolean;    // true = Prompts wie API-Model (OpenAI), false = wie LM-Studio (Chunking)
  // Double Precision Pipeline
  doublePrecisionEnabled?: boolean;
  doublePrecisionMode?: 'parallel' | 'sequential';
}

/** Resolve the effective online service (new field → legacy fallback) */
export function getEffectiveOnlineService(config: RuntimeConfig): { provider: TranscriptionProvider; whisperModel?: string } {
  if (config.onlineService) {
    return parseServiceId(config.onlineService);
  }
  // Legacy fallback
  return { provider: config.transcriptionProvider, whisperModel: config.whisperModel };
}

/** Resolve the effective offline service (new field → legacy fallback) */
export function getEffectiveOfflineService(config: RuntimeConfig): { provider: TranscriptionProvider; whisperModel?: string } {
  if (config.offlineService) {
    return parseServiceId(config.offlineService);
  }
  // Legacy fallback: same provider as online, but with offline model
  return { provider: config.transcriptionProvider, whisperModel: config.whisperOfflineModel || config.whisperModel };
}

/** Resolve the effective double precision service (new field → legacy fallback) */
export function getEffectiveDoublePrecisionService(config: RuntimeConfig): { provider: TranscriptionProvider; whisperModel?: string } {
  if (config.doublePrecisionService) {
    return parseServiceId(config.doublePrecisionService);
  }
  // Legacy fallback
  return { provider: (config.doublePrecisionSecondProvider || 'elevenlabs') as TranscriptionProvider, whisperModel: config.doublePrecisionWhisperModel };
}

const DEFAULT_ONLINE_SERVICE = buildServiceId(
  (process.env.TRANSCRIPTION_PROVIDER as TranscriptionProvider) || 'whisperx',
  process.env.WHISPER_MODEL || 'guillaumekln/faster-whisper-large-v2'
);

const DEFAULT_OFFLINE_SERVICE = buildServiceId(
  (process.env.TRANSCRIPTION_PROVIDER as TranscriptionProvider) || 'whisperx',
  process.env.WHISPER_OFFLINE_MODEL || 'guillaumekln/faster-whisper-large-v2'
);

const DEFAULT_CONFIG: RuntimeConfig = {
  transcriptionProvider: (process.env.TRANSCRIPTION_PROVIDER as any) || 'whisperx',
  llmProvider: (process.env.LLM_PROVIDER as any) || 'openai',
  whisperModel: process.env.WHISPER_MODEL || 'guillaumekln/faster-whisper-large-v2',
  whisperOfflineModel: (process.env.WHISPER_OFFLINE_MODEL as WhisperOfflineModel) || 'guillaumekln/faster-whisper-large-v2',
  onlineService: DEFAULT_ONLINE_SERVICE,
  offlineService: DEFAULT_OFFLINE_SERVICE,
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  mistralModel: process.env.MISTRAL_MODEL || 'mistral-large-latest',
  doublePrecisionEnabled: false,
  doublePrecisionSecondProvider: 'elevenlabs',
  doublePrecisionService: 'elevenlabs',
  doublePrecisionMode: 'parallel',
};

// Get runtime config from database
export async function getRuntimeConfig(): Promise<RuntimeConfig> {
  try {
    const rows = await query<{ config_key: string; config_value: string }>(
      'SELECT config_key, config_value FROM config'
    );
    
    const config: RuntimeConfig = { ...DEFAULT_CONFIG };
    
    for (const row of rows) {
      switch (row.config_key) {
        case 'transcriptionProvider':
          if (['whisperx', 'elevenlabs', 'mistral', 'fast_whisper'].includes(row.config_value)) {
            config.transcriptionProvider = row.config_value as any;
          }
          break;
        case 'llmProvider':
          if (['openai', 'lmstudio', 'mistral'].includes(row.config_value)) {
            config.llmProvider = row.config_value as any;
          }
          break;
        case 'whisperModel':
          config.whisperModel = row.config_value;
          break;
        case 'openaiModel':
          config.openaiModel = row.config_value;
          break;
        case 'mistralModel':
          config.mistralModel = row.config_value;
          break;
        case 'whisperOfflineModel':
          if (WHISPER_OFFLINE_MODELS.some(m => m.id === row.config_value)) {
            config.whisperOfflineModel = row.config_value as WhisperOfflineModel;
          }
          break;
        case 'llmPromptAddition':
          config.llmPromptAddition = row.config_value;
          break;
        case 'doublePrecisionEnabled':
          config.doublePrecisionEnabled = row.config_value === 'true';
          break;
        case 'doublePrecisionSecondProvider':
          if (['whisperx', 'elevenlabs', 'mistral'].includes(row.config_value)) {
            config.doublePrecisionSecondProvider = row.config_value as any;
          }
          break;
        case 'doublePrecisionWhisperModel':
          config.doublePrecisionWhisperModel = row.config_value;
          break;
        case 'doublePrecisionMode':
          if (['parallel', 'sequential'].includes(row.config_value)) {
            config.doublePrecisionMode = row.config_value as any;
          }
          break;
        case 'lmStudioModelOverride':
          config.lmStudioModelOverride = row.config_value;
          break;
        case 'lmStudioUseApiMode':
          config.lmStudioUseApiMode = row.config_value === 'true';
          break;
        case 'onlineService':
          config.onlineService = row.config_value;
          break;
        case 'offlineService':
          config.offlineService = row.config_value;
          break;
        case 'doublePrecisionService':
          config.doublePrecisionService = row.config_value;
          break;
      }
    }
    
    // Auto-migrate: if new fields are missing but legacy fields exist, derive them
    if (!config.onlineService && config.transcriptionProvider) {
      config.onlineService = buildServiceId(config.transcriptionProvider, config.whisperModel);
    }
    if (!config.offlineService && config.transcriptionProvider) {
      config.offlineService = buildServiceId(config.transcriptionProvider, config.whisperOfflineModel || config.whisperModel);
    }
    if (!config.doublePrecisionService && config.doublePrecisionSecondProvider) {
      config.doublePrecisionService = buildServiceId(config.doublePrecisionSecondProvider as TranscriptionProvider, config.doublePrecisionWhisperModel);
    }
    
    return config;
  } catch (error) {
    console.error('[Config] Get config error:', error);
    return DEFAULT_CONFIG;
  }
}

// Save runtime config to database
export async function saveRuntimeConfig(config: Partial<RuntimeConfig>): Promise<void> {
  try {
    const entries = Object.entries(config).filter(([_, v]) => v !== undefined);
    
    for (const [key, value] of entries) {
      await execute(
        `INSERT INTO config (config_key, config_value) VALUES (?, ?) 
         ON DUPLICATE KEY UPDATE config_value = ?`,
        [key, String(value), String(value)]
      );
    }
    
    console.log('[Config] Saved config:', config);
  } catch (error) {
    console.error('[Config] Save config error:', error);
    throw error;
  }
}

// ============================================================
// Request-basierte Funktionen (für dynamische DB über Token)
// ============================================================

// Get runtime config with Request context
export async function getRuntimeConfigWithRequest(request: NextRequest): Promise<RuntimeConfig> {
  try {
    const db = await getPoolForRequest(request);
    const [rows] = await db.execute<any[]>('SELECT config_key, config_value FROM config');
    
    const config: RuntimeConfig = { ...DEFAULT_CONFIG };
    
    for (const row of rows as { config_key: string; config_value: string }[]) {
      switch (row.config_key) {
        case 'transcriptionProvider':
          if (['whisperx', 'elevenlabs', 'mistral', 'fast_whisper'].includes(row.config_value)) {
            config.transcriptionProvider = row.config_value as any;
          }
          break;
        case 'llmProvider':
          if (['openai', 'lmstudio', 'mistral'].includes(row.config_value)) {
            config.llmProvider = row.config_value as any;
          }
          break;
        case 'whisperModel':
          config.whisperModel = row.config_value;
          break;
        case 'openaiModel':
          config.openaiModel = row.config_value;
          break;
        case 'mistralModel':
          config.mistralModel = row.config_value;
          break;
        case 'whisperOfflineModel':
          if (WHISPER_OFFLINE_MODELS.some(m => m.id === row.config_value)) {
            config.whisperOfflineModel = row.config_value as WhisperOfflineModel;
          }
          break;
        case 'llmPromptAddition':
          config.llmPromptAddition = row.config_value;
          break;
        case 'doublePrecisionEnabled':
          config.doublePrecisionEnabled = row.config_value === 'true';
          break;
        case 'doublePrecisionSecondProvider':
          if (['whisperx', 'elevenlabs', 'mistral'].includes(row.config_value)) {
            config.doublePrecisionSecondProvider = row.config_value as any;
          }
          break;
        case 'doublePrecisionWhisperModel':
          config.doublePrecisionWhisperModel = row.config_value;
          break;
        case 'doublePrecisionMode':
          if (['parallel', 'sequential'].includes(row.config_value)) {
            config.doublePrecisionMode = row.config_value as any;
          }
          break;
        case 'lmStudioModelOverride':
          config.lmStudioModelOverride = row.config_value;
          break;
        case 'lmStudioUseApiMode':
          config.lmStudioUseApiMode = row.config_value === 'true';
          break;
        case 'onlineService':
          config.onlineService = row.config_value;
          break;
        case 'offlineService':
          config.offlineService = row.config_value;
          break;
        case 'doublePrecisionService':
          config.doublePrecisionService = row.config_value;
          break;
      }
    }
    
    // Auto-migrate: if new fields are missing but legacy fields exist, derive them
    if (!config.onlineService && config.transcriptionProvider) {
      config.onlineService = buildServiceId(config.transcriptionProvider, config.whisperModel);
    }
    if (!config.offlineService && config.transcriptionProvider) {
      config.offlineService = buildServiceId(config.transcriptionProvider, config.whisperOfflineModel || config.whisperModel);
    }
    if (!config.doublePrecisionService && config.doublePrecisionSecondProvider) {
      config.doublePrecisionService = buildServiceId(config.doublePrecisionSecondProvider as TranscriptionProvider, config.doublePrecisionWhisperModel);
    }
    
    return config;
  } catch (error) {
    console.error('[Config] Get config error (with request):', error);
    return DEFAULT_CONFIG;
  }
}

// Save runtime config with Request context
export async function saveRuntimeConfigWithRequest(request: NextRequest, config: Partial<RuntimeConfig>): Promise<void> {
  try {
    const db = await getPoolForRequest(request);
    const entries = Object.entries(config).filter(([_, v]) => v !== undefined);
    
    for (const [key, value] of entries) {
      await db.execute(
        `INSERT INTO config (config_key, config_value) VALUES (?, ?) 
         ON DUPLICATE KEY UPDATE config_value = ?`,
        [key, String(value), String(value)]
      );
    }
    
    console.log('[Config] Saved config (with request):', config);
  } catch (error) {
    console.error('[Config] Save config error (with request):', error);
    throw error;
  }
}
