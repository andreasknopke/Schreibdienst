import { NextRequest } from 'next/server';
import { query, execute, getPoolForRequest } from './db';

// Verfügbare Offline-Modelle für WhisperX
export type WhisperOfflineModel = 
  | 'large-v3-turbo-german'    // primeline/whisper-large-v3-turbo-german
  | 'large-v3-german'          // primeline/whisper-large-v3-german
  | 'medium-germanmed';        // Hanhpt23/whisper-medium-GermanMed-full

export const WHISPER_OFFLINE_MODELS: { id: WhisperOfflineModel; name: string; modelPath: string }[] = [
  { id: 'large-v3-turbo-german', name: 'Large-v3 German Turbo (empfohlen)', modelPath: 'primeline/whisper-large-v3-turbo-german' },
  { id: 'large-v3-german', name: 'Large-v3 German', modelPath: 'primeline/whisper-large-v3-german' },
  { id: 'medium-germanmed', name: 'Medium GermanMed (medizinisch)', modelPath: 'Hanhpt23/whisper-medium-GermanMed-full' },
];

export interface RuntimeConfig {
  transcriptionProvider: 'whisperx' | 'elevenlabs';
  llmProvider: 'openai' | 'lmstudio';
  whisperModel?: string;
  whisperOfflineModel?: WhisperOfflineModel;
  openaiModel?: string;
  llmPromptAddition?: string;
}

const DEFAULT_CONFIG: RuntimeConfig = {
  transcriptionProvider: (process.env.TRANSCRIPTION_PROVIDER as any) || 'whisperx',
  llmProvider: (process.env.LLM_PROVIDER as any) || 'openai',
  whisperModel: process.env.WHISPER_MODEL || 'medium',
  whisperOfflineModel: (process.env.WHISPER_OFFLINE_MODEL as WhisperOfflineModel) || 'large-v3-turbo-german',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
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
          if (['whisperx', 'elevenlabs'].includes(row.config_value)) {
            config.transcriptionProvider = row.config_value as any;
          }
          break;
        case 'llmProvider':
          if (['openai', 'lmstudio'].includes(row.config_value)) {
            config.llmProvider = row.config_value as any;
          }
          break;
        case 'whisperModel':
          config.whisperModel = row.config_value;
          break;
        case 'openaiModel':
          config.openaiModel = row.config_value;
          break;
        case 'whisperOfflineModel':
          if (WHISPER_OFFLINE_MODELS.some(m => m.id === row.config_value)) {
            config.whisperOfflineModel = row.config_value as WhisperOfflineModel;
          }
          break;
        case 'llmPromptAddition':
          config.llmPromptAddition = row.config_value;
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
          if (['whisperx', 'elevenlabs'].includes(row.config_value)) {
            config.transcriptionProvider = row.config_value as any;
          }
          break;
        case 'llmProvider':
          if (['openai', 'lmstudio'].includes(row.config_value)) {
            config.llmProvider = row.config_value as any;
          }
          break;
        case 'whisperModel':
          config.whisperModel = row.config_value;
          break;
        case 'openaiModel':
          config.openaiModel = row.config_value;
          break;
        case 'whisperOfflineModel':
          if (WHISPER_OFFLINE_MODELS.some(m => m.id === row.config_value)) {
            config.whisperOfflineModel = row.config_value as WhisperOfflineModel;
          }
          break;
        case 'llmPromptAddition':
          config.llmPromptAddition = row.config_value;
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
