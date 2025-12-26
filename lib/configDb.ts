import { query, execute } from './db';

export interface RuntimeConfig {
  transcriptionProvider: 'whisperx' | 'elevenlabs';
  llmProvider: 'openai' | 'lmstudio';
  whisperModel?: string;
  openaiModel?: string;
}

const DEFAULT_CONFIG: RuntimeConfig = {
  transcriptionProvider: (process.env.TRANSCRIPTION_PROVIDER as any) || 'whisperx',
  llmProvider: (process.env.LLM_PROVIDER as any) || 'openai',
  whisperModel: process.env.WHISPER_MODEL || 'medium',
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
