import fs from 'fs';
import path from 'path';

const CONFIG_FILE = path.join(process.cwd(), 'cache', 'runtime-config.json');

// Verfügbare Provider
export interface RuntimeConfig {
  transcriptionProvider: 'whisperx' | 'elevenlabs';
  llmProvider: 'openai' | 'lmstudio';
  // WhisperX-spezifische Einstellungen
  whisperModel?: 'tiny' | 'base' | 'small' | 'medium' | 'large-v2' | 'large-v3';
  // OpenAI-spezifische Einstellungen
  openaiModel?: string;
}

const DEFAULT_CONFIG: RuntimeConfig = {
  transcriptionProvider: (process.env.TRANSCRIPTION_PROVIDER as any) || 'whisperx',
  llmProvider: (process.env.LLM_PROVIDER as any) || 'openai',
  whisperModel: (process.env.WHISPER_MODEL as any) || 'medium',
  openaiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
};

// Load config from file
export function getRuntimeConfig(): RuntimeConfig {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      const data = fs.readFileSync(CONFIG_FILE, 'utf-8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
    }
  } catch (error) {
    console.error('Error loading runtime config:', error);
  }
  return DEFAULT_CONFIG;
}

// Save config to file
export function saveRuntimeConfig(config: RuntimeConfig): void {
  try {
    const cacheDir = path.dirname(CONFIG_FILE);
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    console.error('Error saving runtime config:', error);
    throw error;
  }
}
