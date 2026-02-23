"use client";
import { useState, useEffect } from 'react';
import { useAuth } from './AuthProvider';
import DbTokenManager from './DbTokenManager';
import WhisperXRecoveryLogs from './WhisperXRecoveryLogs';

interface TranscriptionServiceOption {
  id: string;
  name: string;
  available: boolean;
  reason?: string;
  isCloud: boolean;
}

interface RuntimeConfig {
  // Legacy
  transcriptionProvider: 'whisperx' | 'elevenlabs' | 'mistral' | 'fast_whisper';
  whisperModel?: string;
  whisperOfflineModel?: string;
  doublePrecisionSecondProvider?: 'whisperx' | 'elevenlabs' | 'mistral';
  doublePrecisionWhisperModel?: string;
  // Unified service selections
  onlineService?: string;
  offlineService?: string;
  doublePrecisionService?: string;
  // LLM
  llmProvider: 'openai' | 'lmstudio' | 'mistral';
  openaiModel?: string;
  mistralModel?: string;
  llmPromptAddition?: string;
  // LM-Studio Session Override
  lmStudioModelOverride?: string;
  lmStudioUseApiMode?: boolean;
  // Double Precision Pipeline
  doublePrecisionEnabled?: boolean;
  doublePrecisionMode?: 'parallel' | 'sequential';
}

interface EnvInfo {
  hasOpenAIKey: boolean;
  hasElevenLabsKey: boolean;
  hasWhisperUrl: boolean;
  hasLMStudioUrl: boolean;
  hasMistralKey: boolean;
  hasFastWhisperUrl: boolean;
  whisperServiceUrl: string;
  lmStudioUrl: string;
  fastWhisperWsUrl: string;
}

interface MigrationStatus {
  templates: boolean;
  dictionary: boolean;
  users: boolean;
  config: boolean;
}

export default function ConfigPanel() {
  const { getAuthHeader, getDbTokenHeader, username } = useAuth();
  const isRoot = username?.toLowerCase() === 'root';
  const [config, setConfig] = useState<RuntimeConfig | null>(null);
  const [envInfo, setEnvInfo] = useState<EnvInfo | null>(null);
  const [transcriptionProviders, setTranscriptionProviders] = useState<{ id: string; name: string; available: boolean; reason?: string }[]>([]);
  const [transcriptionServices, setTranscriptionServices] = useState<TranscriptionServiceOption[]>([]);
  const [llmProviders, setLLMProviders] = useState<{ id: string; name: string; available: boolean; reason?: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [migrationStatus, setMigrationStatus] = useState<MigrationStatus | null>(null);
  const [runningMigration, setRunningMigration] = useState(false);

  const fetchConfig = async () => {
    try {
      const response = await fetch('/api/config', {
        headers: { ...getDbTokenHeader() }
      });
      const data = await response.json();
      setConfig(data.config);
      setEnvInfo(data.envInfo);
      setTranscriptionProviders(data.availableTranscriptionProviders || []);
      setTranscriptionServices(data.availableTranscriptionServices || []);
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

  // Datenbank-Migrationen ausführen
  const runMigrations = async () => {
    if (!isRoot) {
      setError('Nur der root-Benutzer kann Migrationen ausführen');
      return;
    }

    setError('');
    setSuccess('');
    setRunningMigration(true);

    try {
      const response = await fetch('/api/config/migrate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': getAuthHeader(),
          ...getDbTokenHeader()
        }
      });

      const data = await response.json();

      if (data.success) {
        setMigrationStatus(data.status);
        setSuccess('Datenbank-Migrationen erfolgreich ausgeführt');
        setTimeout(() => setSuccess(''), 5000);
      } else {
        setError(data.error || 'Migration fehlgeschlagen');
      }
    } catch (err: any) {
      setError('Migrations-Fehler: ' + (err.message || 'Unbekannt'));
    } finally {
      setRunningMigration(false);
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

  const openaiModels = [
    { id: 'gpt-4o-mini', name: 'GPT-4o Mini (schnell, günstig)' },
    { id: 'gpt-4o', name: 'GPT-4o (beste Qualität)' },
    { id: 'gpt-4-turbo', name: 'GPT-4 Turbo' },
    { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo (günstigste)' },
  ];

  const mistralModels = [
    { id: 'mistral-large-latest', name: 'Mistral Large (beste Qualität)' },
    { id: 'mistral-medium-latest', name: 'Mistral Medium (ausgewogen)' },
    { id: 'mistral-small-latest', name: 'Mistral Small (schnell, günstig)' },
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

      {/* Transkriptions-Services */}
      <div className="space-y-4">
        <h4 className="font-medium text-sm flex items-center gap-2">
          <span>🎙️</span>
          <span>Transkriptions-Dienste</span>
        </h4>
        
        <p className="text-xs text-gray-500">
          Wähle für Online- und Offline-Transkription jeweils einen Dienst. Cloud- und lokale Dienste können frei gemischt werden.
        </p>

        {/* Online-Transkription */}
        <div>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">
            🌐 Online-Transkription (Live-Diktat)
          </label>
          <select
            value={config.onlineService || 'whisperx:guillaumekln/faster-whisper-large-v2'}
            onChange={(e) => updateConfig({ onlineService: e.target.value })}
            disabled={!isRoot || saving}
            className="input text-sm w-full max-w-md"
          >
            {transcriptionServices.map((svc) => (
              <option key={svc.id} value={svc.id} disabled={!svc.available}>
                {svc.name}{svc.isCloud ? ' ☁️' : ' 💻'}{!svc.available ? ` (${svc.reason})` : ''}
              </option>
            ))}
          </select>
        </div>

        {/* Offline-Transkription */}
        <div>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400 block mb-1">
            📴 Offline-Transkription (Warteschlange)
          </label>
          <select
            value={config.offlineService || 'whisperx:guillaumekln/faster-whisper-large-v2'}
            onChange={(e) => updateConfig({ offlineService: e.target.value })}
            disabled={!isRoot || saving}
            className="input text-sm w-full max-w-md"
          >
            {transcriptionServices.map((svc) => (
              <option key={svc.id} value={svc.id} disabled={!svc.available}>
                {svc.name}{svc.isCloud ? ' ☁️' : ' 💻'}{!svc.available ? ` (${svc.reason})` : ''}
              </option>
            ))}
          </select>
        </div>
        
        {/* Double Precision Pipeline */}
        <div className="mt-2 p-4 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50">
          <div className="flex items-center gap-3 mb-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={config.doublePrecisionEnabled || false}
                onChange={(e) => updateConfig({ doublePrecisionEnabled: e.target.checked })}
                disabled={!isRoot || saving}
                className="w-4 h-4 rounded border-gray-300"
              />
              <span className="font-medium text-sm">🎯 Double Precision Pipeline</span>
            </label>
          </div>
          
          <p className="text-xs text-gray-500 mb-3">
            Führt die Transkription mit zwei verschiedenen Services durch und merged die Ergebnisse intelligent für höchste Genauigkeit.
          </p>
          
          {config.doublePrecisionEnabled && (
            <div className="space-y-3 pt-2 border-t border-gray-200 dark:border-gray-600">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Zweiter Service</label>
                <select
                  value={config.doublePrecisionService || 'elevenlabs'}
                  onChange={(e) => updateConfig({ doublePrecisionService: e.target.value })}
                  disabled={!isRoot || saving}
                  className="input text-sm w-full max-w-md"
                >
                  {transcriptionServices.map((svc) => (
                    <option key={svc.id} value={svc.id} disabled={!svc.available}>
                      {svc.name}{svc.isCloud ? ' ☁️' : ' 💻'}{svc.id === config.offlineService ? ' (wie Offline-Primär)' : ''}{!svc.available ? ` (${svc.reason})` : ''}
                    </option>
                  ))}
                </select>
                {config.doublePrecisionService === config.offlineService && (
                  <p className="text-xs text-blue-500 mt-1">
                    💡 Primär und Sekundär verwenden denselben Dienst — stelle sicher, dass unterschiedliche Modelle verglichen werden.
                  </p>
                )}
              </div>
              
              <div>
                <label className="text-xs text-gray-500 block mb-1">Ausführungsmodus</label>
                <div className="flex gap-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="doublePrecisionMode"
                      value="parallel"
                      checked={(config.doublePrecisionMode || 'parallel') === 'parallel'}
                      onChange={() => updateConfig({ doublePrecisionMode: 'parallel' })}
                      disabled={!isRoot || saving}
                    />
                    <span className="text-sm">Parallel (schneller)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="doublePrecisionMode"
                      value="sequential"
                      checked={config.doublePrecisionMode === 'sequential'}
                      onChange={() => updateConfig({ doublePrecisionMode: 'sequential' })}
                      disabled={!isRoot || saving}
                    />
                    <span className="text-sm">Nacheinander (stabiler)</span>
                  </label>
                </div>
              </div>
            </div>
          )}
        </div>
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

        {/* Mistral Model Selection */}
        {config.llmProvider === 'mistral' && (
          <div className="ml-6 mt-2">
            <label className="text-xs text-gray-500 block mb-1">Mistral-Modell</label>
            <select
              value={config.mistralModel || 'mistral-large-latest'}
              onChange={(e) => updateConfig({ mistralModel: e.target.value })}
              disabled={!isRoot || saving}
              className="input text-sm w-full max-w-xs"
            >
              {mistralModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* LM-Studio Model Override (nur für root) */}
        {isRoot && config.llmProvider === 'lmstudio' && (
          <div className="ml-6 mt-3 p-3 border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800/50">
            <label className="text-xs text-gray-500 block mb-1">
              LM-Studio Model Override (Session)
            </label>
            <div className="flex gap-2 items-start">
              <input
                type="text"
                value={config.lmStudioModelOverride || ''}
                onChange={(e) => updateConfig({ lmStudioModelOverride: e.target.value })}
                disabled={saving}
                placeholder={`Standard: ${process.env.LLM_STUDIO_MODEL || 'meta-llama-3.1-8b-instruct'}`}
                className="input text-sm flex-1"
              />
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Überschreibt das LM-Studio Model für diese Session. Leer lassen für Env-Einstellung.
            </p>
            
            <div className="mt-3 flex items-center gap-2">
              <input
                type="checkbox"
                id="lmStudioApiMode"
                checked={config.lmStudioUseApiMode || false}
                onChange={(e) => updateConfig({ lmStudioUseApiMode: e.target.checked })}
                disabled={saving}
                className="w-4 h-4 rounded border-gray-300"
              />
              <label htmlFor="lmStudioApiMode" className="text-sm cursor-pointer">
                API-Modus (wie OpenAI)
              </label>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              Aktiviert: Prompts wie bei API-Modellen (ganzer Text auf einmal, 10.000 Max Tokens).
              Deaktiviert: Chunked Processing für kleinere Modelle.
            </p>
          </div>
        )}

        {/* LLM Prompt-Ergänzung */}
        <div className="mt-4">
          <label className="text-xs text-gray-500 block mb-1">
            Zusätzliche Anweisungen für die KI-Korrektur (optional)
          </label>
          <textarea
            value={config.llmPromptAddition || ''}
            onChange={(e) => updateConfig({ llmPromptAddition: e.target.value })}
            disabled={!isRoot || saving}
            placeholder="z.B. 'Verwende immer die formelle Anrede' oder 'Ersetze Dr. durch Doktor'"
            className="input text-sm w-full h-24 resize-y"
          />
          <p className="text-xs text-gray-400 mt-1">
            Diese Anweisungen werden dem System-Prompt für die LLM-Korrektur hinzugefügt.
          </p>
        </div>
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
        <div className="flex items-center gap-2">
          <span className={envInfo?.hasMistralKey ? 'text-green-500' : 'text-gray-400'}>●</span>
          <span>Mistral AI: {envInfo?.hasMistralKey ? 'Konfiguriert' : 'Nicht konfiguriert'}</span>
        </div>
      </div>

      {/* Datenbank-Migrationen - nur für root */}
      {isRoot && (
        <div className="space-y-3">
          <h4 className="font-medium text-sm flex items-center gap-2">
            <span>🗄️</span>
            <span>Datenbank-Migrationen</span>
          </h4>
          <p className="text-xs text-gray-500">
            Führt alle notwendigen Datenbank-Migrationen für die aktuelle Datenbank aus.
            Dies erstellt fehlende Tabellen (templates, dictionary_entries, etc.).
          </p>
          <button
            onClick={runMigrations}
            disabled={runningMigration}
            className="w-full px-4 py-2 text-sm bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {runningMigration ? (
              <>
                <span className="animate-spin">⏳</span>
                <span>Migrationen werden ausgeführt...</span>
              </>
            ) : (
              <>
                <span>🔧</span>
                <span>Migrationen ausführen</span>
              </>
            )}
          </button>
          {migrationStatus && (
            <div className="p-2 bg-gray-50 dark:bg-gray-800 rounded text-xs space-y-1">
              <div className="flex items-center gap-2">
                <span className={migrationStatus.templates ? 'text-green-500' : 'text-gray-400'}>●</span>
                <span>Textbausteine (templates): {migrationStatus.templates ? 'OK' : 'Nicht erstellt'}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={migrationStatus.dictionary ? 'text-green-500' : 'text-gray-400'}>●</span>
                <span>Wörterbuch (dictionary_entries): {migrationStatus.dictionary ? 'OK' : 'Nicht erstellt'}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={migrationStatus.users ? 'text-green-500' : 'text-gray-400'}>●</span>
                <span>Benutzer (users): {migrationStatus.users ? 'OK' : 'Nicht erstellt'}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className={migrationStatus.config ? 'text-green-500' : 'text-gray-400'}>●</span>
                <span>Konfiguration (runtime_config): {migrationStatus.config ? 'OK' : 'Nicht erstellt'}</span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* WhisperX Recovery Logs - nur für root */}
      {isRoot && (
        <WhisperXRecoveryLogs />
      )}

      {/* Datenbank-Token Manager - nur für root */}
      {isRoot && (
        <DbTokenManager isRoot={true} />
      )}
    </div>
  );
}
