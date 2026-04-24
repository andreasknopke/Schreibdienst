"use client";
import { useState, useEffect } from 'react';
import { fetchWithDbToken } from '@/lib/fetchWithDbToken';
import Spinner from './Spinner';
import DiffHighlight from './DiffHighlight';
import { useAuth } from './AuthProvider';

interface DictionaryOperation {
  originalText: string;
  replacementText: string;
  dictionaryWrong: string;
  dictionaryCorrect: string;
  source: 'standard' | 'private';
  matchType: 'exact' | 'stem' | 'phonetic';
  confidence?: number;
  similarity?: number;
  minSimilarity?: number;
  targetUsername?: string;
}

interface CorrectionLogMetadata {
  version?: number;
  targetUsername?: string;
  dictionaryOperations?: DictionaryOperation[];
}

interface CorrectionLogEntry {
  id: number;
  dictation_id: number;
  correction_type: 'textFormatting' | 'dictionary' | 'standardDictionary' | 'privateDictionary' | 'llm' | 'doublePrecision' | 'manual';
  model_name?: string;
  model_provider?: string;
  username?: string;
  text_before: string;
  text_after: string;
  change_score?: number;
  metadata?: CorrectionLogMetadata;
  created_at: string;
}

type DisplayCorrectionLogEntry = CorrectionLogEntry;

type SelectedDictionaryAction = {
  logId: number;
  operation: DictionaryOperation;
};

const PREPROCESSING_TYPES = new Set<CorrectionLogEntry['correction_type']>([
  'textFormatting',
  'dictionary',
  'standardDictionary',
  'privateDictionary',
]);

interface CorrectionLogViewerProps {
  dictationId: number;
  onClose: () => void;
}

const correctionTypeLabels: Record<string, string> = {
  textFormatting: '📝 Text-Formatierung',
  dictionary: '📚 Wörterbuch-Korrektur',
  standardDictionary: '📘 Standardwörterbuch',
  privateDictionary: '📗 Privates Wörterbuch',
  llm: '🤖 KI-Korrektur',
  doublePrecision: '🔍 Double Precision Merge',
  manual: '✏️ Manuelle Korrektur'
};

const correctionTypeDescriptions: Record<string, string> = {
  textFormatting: 'Automatische Formatierung und Bereinigung von Diktierbefehlen',
  dictionary: 'Legacy-Eintrag: kombinierte Wörterbuch-Korrektur',
  standardDictionary: 'Deterministische Korrektur durch das Standardwörterbuch',
  privateDictionary: 'Deterministische Korrektur durch das private Wörterbuch',
  llm: 'KI-gestützte Grammatik- und Rechtschreibkorrektur',
  doublePrecision: 'Vergleich und Zusammenführung zweier Transkriptionen durch LLM',
  manual: 'Manuelle Korrektur durch Benutzer'
};

const correctionTypeStyles: Record<string, { container: string; header: string; label: string }> = {
  textFormatting: {
    container: 'border-gray-200 dark:border-gray-700',
    header: 'bg-gray-50 dark:bg-gray-900 hover:bg-gray-100 dark:hover:bg-gray-800',
    label: 'text-gray-700 dark:text-gray-200',
  },
  dictionary: {
    container: 'border-amber-200 dark:border-amber-800',
    header: 'bg-amber-50 dark:bg-amber-900/20 hover:bg-amber-100 dark:hover:bg-amber-900/30',
    label: 'text-amber-800 dark:text-amber-300',
  },
  standardDictionary: {
    container: 'border-blue-200 dark:border-blue-800',
    header: 'bg-blue-50 dark:bg-blue-900/20 hover:bg-blue-100 dark:hover:bg-blue-900/30',
    label: 'text-blue-800 dark:text-blue-300',
  },
  privateDictionary: {
    container: 'border-emerald-200 dark:border-emerald-800',
    header: 'bg-emerald-50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/30',
    label: 'text-emerald-800 dark:text-emerald-300',
  },
  llm: {
    container: 'border-violet-200 dark:border-violet-800',
    header: 'bg-violet-50 dark:bg-violet-900/20 hover:bg-violet-100 dark:hover:bg-violet-900/30',
    label: 'text-violet-800 dark:text-violet-300',
  },
  doublePrecision: {
    container: 'border-cyan-200 dark:border-cyan-800',
    header: 'bg-cyan-50 dark:bg-cyan-900/20 hover:bg-cyan-100 dark:hover:bg-cyan-900/30',
    label: 'text-cyan-800 dark:text-cyan-300',
  },
  manual: {
    container: 'border-rose-200 dark:border-rose-800',
    header: 'bg-rose-50 dark:bg-rose-900/20 hover:bg-rose-100 dark:hover:bg-rose-900/30',
    label: 'text-rose-800 dark:text-rose-300',
  },
};

export default function CorrectionLogViewer({ dictationId, onClose }: CorrectionLogViewerProps) {
  const { username, getAuthHeader, getDbTokenHeader } = useAuth();
  const isRootUser = username?.toLowerCase() === 'root';
  const [logs, setLogs] = useState<CorrectionLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [actionTarget, setActionTarget] = useState<SelectedDictionaryAction | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [actionFeedback, setActionFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    const fetchLogs = async () => {
      try {
        setLoading(true);
        setError(null);
        const response = await fetchWithDbToken(`/api/correction-log?dictationId=${dictationId}`);
        
        if (!response.ok) {
          throw new Error(`Fehler beim Laden: ${response.status}`);
        }
        
        const data = await response.json();
        setLogs(data);
      } catch (err: any) {
        console.error('[CorrectionLogViewer] Error:', err);
        setError(err.message || 'Unbekannter Fehler');
      } finally {
        setLoading(false);
      }
    };

    fetchLogs();
  }, [dictationId]);

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const getChangeScoreColor = (score?: number) => {
    if (score === undefined || score === null) return 'text-gray-500';
    if (score < 20) return 'text-green-600 dark:text-green-400';
    if (score < 40) return 'text-yellow-600 dark:text-yellow-400';
    return 'text-red-600 dark:text-red-400';
  };

  const displayLogs: DisplayCorrectionLogEntry[] = [];
  for (let index = 0; index < logs.length; index++) {
    const currentLog = logs[index];

    if (!PREPROCESSING_TYPES.has(currentLog.correction_type)) {
      displayLogs.push(currentLog);
      continue;
    }

    const mergedLogs = [currentLog];
    while (index + 1 < logs.length && PREPROCESSING_TYPES.has(logs[index + 1].correction_type)) {
      mergedLogs.push(logs[index + 1]);
      index++;
    }

    if (mergedLogs.length === 1 && currentLog.correction_type === 'textFormatting') {
      displayLogs.push(currentLog);
      continue;
    }

    const firstLog = mergedLogs[0];
    const lastLog = mergedLogs[mergedLogs.length - 1];
    const maxChangeScore = mergedLogs.reduce<number | undefined>((maxScore, log) => {
      if (log.change_score === undefined || log.change_score === null) return maxScore;
      if (maxScore === undefined) return log.change_score;
      return Math.max(maxScore, log.change_score);
    }, undefined);

    displayLogs.push({
      ...firstLog,
      correction_type: 'textFormatting',
      text_before: firstLog.text_before,
      text_after: lastLog.text_after,
      change_score: maxChangeScore,
      created_at: firstLog.created_at,
      metadata: {
        version: 1,
        targetUsername: firstLog.metadata?.targetUsername || lastLog.metadata?.targetUsername,
        dictionaryOperations: mergedLogs.flatMap((log) => log.metadata?.dictionaryOperations ?? []),
      },
    });
  }

  const getOperationLabel = (operation: DictionaryOperation) => {
    const sourceLabel = operation.source === 'standard' ? 'Standard' : 'User';
    const matchLabel = operation.matchType === 'phonetic'
      ? 'phonetisch'
      : operation.matchType === 'stem'
        ? 'Wortstamm'
        : 'direkt';

    return `${operation.originalText} -> ${operation.replacementText} (${sourceLabel}, ${matchLabel})`;
  };

  const handleTermAction = async (action: 'remove' | 'weaken') => {
    if (!actionTarget) return;

    setActionLoading(true);
    setActionFeedback(null);
    try {
      const response = await fetchWithDbToken('/api/correction-log/term-action', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': getAuthHeader(),
          ...getDbTokenHeader(),
        },
        body: JSON.stringify({
          action,
          scope: actionTarget.operation.source,
          wrong: actionTarget.operation.dictionaryWrong,
          targetUsername: actionTarget.operation.targetUsername || logs.find(log => log.id === actionTarget.logId)?.metadata?.targetUsername,
        }),
      });

      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Aktion fehlgeschlagen');
      }

      setActionFeedback({ type: 'success', message: data.message || 'Aktion ausgefuehrt' });
      setActionTarget(null);
    } catch (err: any) {
      setActionFeedback({ type: 'error', message: err.message || 'Aktion fehlgeschlagen' });
    } finally {
      setActionLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 p-4">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-xl font-semibold">📋 Korrekturprotokoll</h2>
          <button
            onClick={onClose}
            className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-2xl leading-none"
            title="Schließen"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {actionFeedback && (
            <div className={`mb-3 rounded-lg border p-3 text-sm ${actionFeedback.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-700 dark:border-green-800 dark:bg-green-900/20 dark:text-green-300'
              : 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300'
            }`}>
              {actionFeedback.message}
            </div>
          )}

          {loading && (
            <div className="flex items-center justify-center py-8">
              <Spinner size={32} />
              <span className="ml-3 text-gray-600 dark:text-gray-400">Lade Protokoll...</span>
            </div>
          )}

          {error && (
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 text-red-700 dark:text-red-400">
              ⚠️ {error}
            </div>
          )}

          {!loading && !error && logs.length === 0 && (
            <div className="text-center py-8 text-gray-500 dark:text-gray-400">
              Keine Korrekturen gefunden für dieses Diktat.
            </div>
          )}

          {!loading && !error && displayLogs.length > 0 && (
            <div className="space-y-3">
              {displayLogs.map((log, index) => (
                (() => {
                  const typeStyle = correctionTypeStyles[log.correction_type] || correctionTypeStyles.textFormatting;
                  return (
                <div
                  key={log.id}
                  className={`border rounded-lg overflow-hidden ${typeStyle.container}`}
                >
                  {/* Header */}
                  <div
                    className={`p-3 cursor-pointer transition-colors ${typeStyle.header}`}
                    onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className={`font-medium text-sm ${typeStyle.label}`}>
                            {index + 1}. {correctionTypeLabels[log.correction_type] || log.correction_type}
                          </span>
                          {log.change_score !== undefined && log.change_score !== null && (
                            <span className={`text-xs font-semibold ${getChangeScoreColor(log.change_score)}`}>
                              {log.change_score}%
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                          {correctionTypeDescriptions[log.correction_type]}
                        </div>
                        <div className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                          {formatDate(log.created_at)}
                          {log.model_name && ` • ${log.model_name}`}
                          {log.model_provider && ` (${log.model_provider})`}
                          {log.username && ` • Benutzer: ${log.username}`}
                        </div>
                      </div>
                      <div className="text-gray-400 ml-2">
                        {expandedId === log.id ? '▼' : '▶'}
                      </div>
                    </div>
                  </div>

                  {/* Expanded Content */}
                  {expandedId === log.id && (
                    <div className="p-3 space-y-3">
                      {/* Special rendering for Double Precision logs */}
                      {log.correction_type === 'doublePrecision' && log.text_before.startsWith('[DOUBLE PRECISION') ? (
                        <>
                          {/* Double Precision Details - parsed from text_before */}
                          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                            <div className="text-xs font-medium text-blue-700 dark:text-blue-300 mb-2">
                              🔍 Double Precision Analyse:
                            </div>
                            <pre className="text-xs whitespace-pre-wrap text-blue-800 dark:text-blue-200 max-h-64 overflow-y-auto">
                              {log.text_before}
                            </pre>
                          </div>

                          {/* Final merged text */}
                          <div>
                            <div className="text-xs font-medium text-green-700 dark:text-green-300 mb-1">
                              ✓ Finaler Text nach LLM-Auflösung:
                            </div>
                            <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded p-2 text-sm max-h-48 overflow-y-auto">
                              {log.text_after || '(leer)'}
                            </div>
                          </div>
                        </>
                      ) : (
                        <>
                          {/* Diff View - for non-DP logs */}
                          <div className="bg-gray-50 dark:bg-gray-900 rounded-lg p-3">
                            <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-2">
                              Änderungen:
                            </div>
                            <DiffHighlight
                              originalText={log.text_before}
                              correctedText={log.text_after}
                              showDiff={true}
                            />
                          </div>

                          {log.metadata?.dictionaryOperations && log.metadata.dictionaryOperations.length > 0 && (
                            <div>
                              <div className="mb-2 flex items-center justify-between gap-2">
                                <div className="text-xs font-medium text-gray-600 dark:text-gray-400">
                                  Wörterbuch-Ersetzungen:
                                </div>
                                {isRootUser && (
                                  <div className="text-[11px] text-gray-500 dark:text-gray-400">
                                    Anklicken fuer Root-Aktionen
                                  </div>
                                )}
                              </div>
                              <div className="flex flex-wrap gap-2">
                                {log.metadata.dictionaryOperations.map((operation, operationIndex) => (
                                  <button
                                    key={`${log.id}-${operationIndex}-${operation.dictionaryWrong}-${operation.replacementText}`}
                                    type="button"
                                    disabled={!isRootUser}
                                    onClick={() => isRootUser && setActionTarget({ logId: log.id, operation })}
                                    className={`rounded-full border px-3 py-1 text-left text-xs ${isRootUser
                                      ? 'border-slate-300 bg-slate-50 text-slate-700 hover:border-slate-400 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-900/40 dark:text-slate-200 dark:hover:bg-slate-800'
                                      : 'border-slate-200 bg-slate-50 text-slate-600 dark:border-slate-800 dark:bg-slate-900/20 dark:text-slate-300'
                                    }`}
                                    title={getOperationLabel(operation)}
                                  >
                                    <span className="font-medium">{operation.originalText}</span>
                                    <span className="mx-1">→</span>
                                    <span>{operation.replacementText}</span>
                                    <span className="ml-2 opacity-70">[{operation.source === 'standard' ? 'Standard' : 'User'} / {operation.matchType}]</span>
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}

                          {/* Original Text */}
                          <div>
                            <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                              Text vorher:
                            </div>
                            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-2 text-sm font-mono max-h-32 overflow-y-auto">
                              {log.text_before || '(leer)'}
                            </div>
                          </div>

                          {/* Corrected Text */}
                          <div>
                            <div className="text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                              Text nachher:
                            </div>
                            <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded p-2 text-sm font-mono max-h-32 overflow-y-auto">
                              {log.text_after || '(leer)'}
                            </div>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
                  );
                })()
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              {displayLogs.length > 0 && `${displayLogs.length} Korrektur${displayLogs.length !== 1 ? 'en' : ''}`}
            </div>
            <button
              onClick={onClose}
              className="btn btn-outline px-4 py-2"
            >
              Schließen
            </button>
          </div>
        </div>
      </div>

      {actionTarget && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl bg-white p-4 shadow-xl dark:bg-gray-900">
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100">Wörterbuch-Aktion</h3>
                <p className="mt-1 text-sm text-gray-600 dark:text-gray-300">{getOperationLabel(actionTarget.operation)}</p>
              </div>
              <button
                type="button"
                onClick={() => setActionTarget(null)}
                className="text-xl leading-none text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                title="Schließen"
              >
                ×
              </button>
            </div>

            <div className="space-y-2 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-200">
              <div>Quelle: {actionTarget.operation.source === 'standard' ? 'Standard-Wörterbuch' : 'Benutzer-Wörterbuch'}</div>
              <div>Dictionary: {actionTarget.operation.dictionaryWrong} → {actionTarget.operation.dictionaryCorrect}</div>
              <div>Match-Art: {actionTarget.operation.matchType}</div>
              {typeof actionTarget.operation.confidence === 'number' && (
                <div>Confidence: {(actionTarget.operation.confidence * 100).toFixed(1)}%</div>
              )}
              {typeof actionTarget.operation.minSimilarity === 'number' && (
                <div>Aktuelle Mindestähnlichkeit: {(actionTarget.operation.minSimilarity * 100).toFixed(0)}%</div>
              )}
            </div>

            <div className="mt-4 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleTermAction('remove')}
                disabled={actionLoading}
                className="rounded-lg bg-red-600 px-3 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
              >
                {actionLoading ? 'Arbeite...' : 'Aus Wörterbuch löschen'}
              </button>
              {actionTarget.operation.matchType === 'phonetic' && (
                <button
                  type="button"
                  onClick={() => handleTermAction('weaken')}
                  disabled={actionLoading}
                  className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-medium text-white hover:bg-amber-600 disabled:opacity-50"
                >
                  {actionLoading ? 'Arbeite...' : 'Phonetisches Matching abschwächen'}
                </button>
              )}
              <button
                type="button"
                onClick={() => setActionTarget(null)}
                disabled={actionLoading}
                className="rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
              >
                Abbrechen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
