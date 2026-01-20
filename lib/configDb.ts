import { NextRequest } from 'next/server';
import { query, execute, getPoolForRequest } from './db';

// Verfügbare Offline-Modelle für WhisperX (aus Model_Manager.py)
export type WhisperOfflineModel = 
  | 'large-v3'                 // Standard large-v3
  | 'large-v3-german-2'        // deepdml/faster-whisper-large-v3-german-2
  | 'large-v3-systran'         // systran/faster-whisper-large-v3
  | 'large-v3-turbo-german';   // cstr/whisper-large-v3-turbo-german-int8_float32

export const WHISPER_OFFLINE_MODELS: { id: WhisperOfflineModel; name: string; modelPath: string }[] = [
  { id: 'large-v3', name: 'Large-v3 (Standard)', modelPath: 'large-v3' },
  { id: 'large-v3-german-2', name: 'Large-v3 German 2 (empfohlen)', modelPath: 'deepdml/faster-whisper-large-v3-german-2' },
  { id: 'large-v3-systran', name: 'Large-v3 Systran', modelPath: 'systran/faster-whisper-large-v3' },
  { id: 'large-v3-turbo-german', name: 'Large-v3 Turbo German (schnell)', modelPath: 'cstr/whisper-large-v3-turbo-german-int8_float32' },
];

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
  transcriptionProvider: 'whisperx' | 'elevenlabs' | 'mistral';
  llmProvider: 'openai' | 'lmstudio' | 'mistral';
  whisperModel?: string;
  whisperOfflineModel?: WhisperOfflineModel;
  openaiModel?: string;
  mistralModel?: string;
  llmPromptAddition?: string;
  // Double Precision Pipeline
  doublePrecisionEnabled?: boolean;
  doublePrecisionSecondProvider?: 'whisperx' | 'elevenlabs' | 'mistral';
  doublePrecisionMode?: 'parallel' | 'sequential';
}

const DEFAULT_CONFIG: RuntimeConfig = {
  transcriptionProvider: (process.env.TRANSCRIPTION_PROVIDER as any) || 'whisperx',
  llmProvider: (process.env.LLM_PROVIDER as any) || 'openai',
  whisperModel: process.env.WHISPER_MODEL || 'deepdml/faster-whisper-large-v3-german-2',
  whisperOfflineModel: (process.env.WHISPER_OFFLINE_MODEL as WhisperOfflineModel) || 'large-v3-german-2',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  mistralModel: process.env.MISTRAL_MODEL || 'mistral-large-latest',
  doublePrecisionEnabled: false,
  doublePrecisionSecondProvider: 'elevenlabs',
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
          if (['whisperx', 'elevenlabs', 'mistral'].includes(row.config_value)) {
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
        case 'doublePrecisionMode':
          if (['parallel', 'sequential'].includes(row.config_value)) {
            config.doublePrecisionMode = row.config_value as any;
          }
          break;
      }
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
          if (['whisperx', 'elevenlabs', 'mistral'].includes(row.config_value)) {
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
        case 'doublePrecisionMode':
          if (['parallel', 'sequential'].includes(row.config_value)) {
            config.doublePrecisionMode = row.config_value as any;
          }
          break;
      }
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
