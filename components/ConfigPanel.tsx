"use client";
import { useState, useEffect } from 'react';
import { useAuth } from './AuthProvider';
import DbTokenManager from './DbTokenManager';

interface ProviderOption {
  id: string;
  name: string;
  available: boolean;
  reason?: string;
}

interface RuntimeConfig {
  transcriptionProvider: 'whisperx' | 'elevenlabs';
  llmProvider: 'openai' | 'lmstudio';
  whisperModel?: string;
  openaiModel?: string;
}

interface EnvInfo {
  hasOpenAIKey: boolean;
  hasElevenLabsKey: boolean;
  hasWhisperUrl: boolean;
  hasLMStudioUrl: boolean;
  whisperServiceUrl: string;
  lmStudioUrl: string;
}

export default function ConfigPanel() {
  const { getAuthHeader, getDbTokenHeader, username } = useAuth();
  const isRoot = username?.toLowerCase() === 'root';
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [envInfo, setEnvInfo] = useState<EnvInfo | null>(null);
  const [transcriptionProviders, setTranscriptionProviders] = useState<ProviderOption[]>([]);
  const [llmProviders, setLLMProviders] = useState<ProviderOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const fetchConfig = async () => {
    try {
      const response = await fetch('/api/config', {
        headers: { ...getDbTokenHeader() }
      });
      const data = await response.json();
      setConfig(data.config);
      setEnvInfo(data.envInfo);
      setTranscriptionProviders(data.availableTranscriptionProviders || []);
      setLLMProviders(data.availableLLMProviders || []);
    } catch {
      setError('Fehler beim Laden der Konfiguration');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchConfig();
  }, []);

  const updateConfig = async (updates: Partial<RuntimeConfig>) => {
    if (!isRoot) {
      setError('Nur der root-Benutzer kann die System-Konfiguration ändern');
      return;
    }

    setError('');
    setSuccess('');
    setSaving(true);

    try {
      const response = await fetch('/api/config', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': getAuthHeader(),
          ...getDbTokenHeader()
        },
        body: JSON.stringify(updates)
      });

      const data = await response.json();

      if (data.success) {
        setConfig(data.config);
        setSuccess('Konfiguration gespeichert');
        setTimeout(() => setSuccess(''), 3000);
      } else {
        setError(data.error || 'Fehler beim Speichern');
      }
    } catch {
      setError('Verbindungsfehler');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 flex justify-center">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="p-4 text-red-500">
        Konfiguration konnte nicht geladen werden
      </div>
    );
  }

  const whisperModels = [
    { id: 'tiny', name: 'Tiny (schnell, weniger genau)' },
    { id: 'base', name: 'Base' },
    { id: 'small', name: 'Small' },
    { id: 'medium', name: 'Medium (empfohlen)' },
    { id: 'large-v2', name: 'Large v2 (beste Qualität)' },
    { id: 'large-v3', name: 'Large v3 (neueste)' },
  ];

  const openaiModels = [
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini (schnell, günstig)' },
    { id: 'gpt-4o', name: 'GPT-4o (beste Qualität)' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo (günstigste)' },
  ];

  return (
    <div className="space-y-6">
      {error && (
        <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">
          {error}
        </div>
      )}

      {success && (
        <div className="text-sm text-green-600 bg-green-50 dark:bg-green-900/20 px-3 py-2 rounded-lg">
          {success}
        </div>
      )}

      {/* Transkriptions-Provider */}
      <div className="space-y-3">
        <h4 className="font-medium text-sm flex items-center gap-2">
          <span>🎙️</span>
          <span>Transkriptions-Provider</span>
        </h4>
        
        <div className="grid gap-2">
          {transcriptionProviders.map((provider) => (
            <label
              key={provider.id}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-colors cursor-pointer
                ${config.transcriptionProvider === provider.id 
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' 
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'}
                ${!provider.available ? 'opacity-50 cursor-not-allowed' : ''}
                ${!isRoot ? 'pointer-events-none' : ''}
              `}
            >
              <input
                type="radio"
                name="transcriptionProvider"
                value={provider.id}
                checked={config.transcriptionProvider === provider.id}
                onChange={() => updateConfig({ transcriptionProvider: provider.id as any })}
                disabled={!provider.available || !isRoot || saving}
                className="w-4 h-4 text-blue-600"
              />
              <div className="flex-1">
                <div className="font-medium text-sm">{provider.name}</div>
                {!provider.available && provider.reason && (
                  <div className="text-xs text-gray-500">{provider.reason}</div>
                )}
                {provider.id === 'whisperx' && envInfo?.whisperServiceUrl && (
                  <div className="text-xs text-gray-500 truncate">
                    {envInfo.whisperServiceUrl}
                  </div>
                )}
              </div>
              {config.transcriptionProvider === provider.id && (
                <span className="text-green-500">✓</span>
              )}
            </label>
          ))}
        </div>

        {/* Whisper Model Selection */}
        {config.transcriptionProvider === 'whisperx' && (
          <div className="ml-6 mt-2">
            <label className="text-xs text-gray-500 block mb-1">Whisper-Modell</label>
            <select
              value={config.whisperModel || 'medium'}
              onChange={(e) => updateConfig({ whisperModel: e.target.value as any })}
              disabled={!isRoot || saving}
              className="input text-sm w-full max-w-xs"
            >
              {whisperModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* LLM Provider */}
      <div className="space-y-3">
        <h4 className="font-medium text-sm flex items-center gap-2">
          <span>🤖</span>
          <span>KI-Korrektur (LLM)</span>
        </h4>
        
        <div className="grid gap-2">
          {llmProviders.map((provider) => (
            <label
              key={provider.id}
              className={`flex items-center gap-3 p-3 rounded-lg border transition-colors cursor-pointer
                ${config.llmProvider === provider.id 
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' 
                  : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'}
                ${!provider.available ? 'opacity-50 cursor-not-allowed' : ''}
                ${!isRoot ? 'pointer-events-none' : ''}
              `}
            >
              <input
                type="radio"
                name="llmProvider"
                value={provider.id}
                checked={config.llmProvider === provider.id}
                onChange={() => updateConfig({ llmProvider: provider.id as any })}
                disabled={!provider.available || !isRoot || saving}
                className="w-4 h-4 text-blue-600"
              />
              <div className="flex-1">
                <div className="font-medium text-sm">{provider.name}</div>
                {!provider.available && provider.reason && (
                  <div className="text-xs text-gray-500">{provider.reason}</div>
                )}
                {provider.id === 'lmstudio' && envInfo?.lmStudioUrl && (
                  <div className="text-xs text-gray-500 truncate">
                    {envInfo.lmStudioUrl}
                  </div>
                )}
              </div>
              {config.llmProvider === provider.id && (
                <span className="text-green-500">✓</span>
              )}
            </label>
          ))}
        </div>

        {/* OpenAI Model Selection */}
        {config.llmProvider === 'openai' && (
          <div className="ml-6 mt-2">
            <label className="text-xs text-gray-500 block mb-1">OpenAI-Modell</label>
            <select
              value={config.openaiModel || 'gpt-4o-mini'}
              onChange={(e) => updateConfig({ openaiModel: e.target.value })}
              disabled={!isRoot || saving}
              className="input text-sm w-full max-w-xs"
            >
              {openaiModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Status-Anzeige */}
      <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg text-xs text-gray-500 space-y-1">
        <div className="font-medium text-gray-700 dark:text-gray-300 mb-2">System-Status</div>
        <div className="flex items-center gap-2">
          <span className={envInfo?.hasWhisperUrl ? 'text-green-500' : 'text-red-500'}>●</span>
          <span>WhisperX Service: {envInfo?.hasWhisperUrl ? 'Konfiguriert' : 'Nicht konfiguriert'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={envInfo?.hasOpenAIKey ? 'text-green-500' : 'text-red-500'}>●</span>
          <span>OpenAI API: {envInfo?.hasOpenAIKey ? 'Konfiguriert' : 'Nicht konfiguriert'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={envInfo?.hasElevenLabsKey ? 'text-green-500' : 'text-gray-400'}>●</span>
          <span>ElevenLabs API: {envInfo?.hasElevenLabsKey ? 'Konfiguriert' : 'Nicht konfiguriert'}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className={envInfo?.hasLMStudioUrl ? 'text-green-500' : 'text-gray-400'}>●</span>
          <span>LM Studio: {envInfo?.hasLMStudioUrl ? 'Konfiguriert' : 'Nicht konfiguriert'}</span>
        </div>
      </div>

      {/* Datenbank-Token Manager - nur für root */}
      {isRoot && (
        <DbTokenManager isRoot={true} />
      )}
    </div>
  );
}
