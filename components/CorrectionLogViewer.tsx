"use client";
import { useState, useEffect } from 'react';
import { fetchWithDbToken } from '@/lib/fetchWithDbToken';
import Spinner from './Spinner';
import DiffHighlight from './DiffHighlight';

interface CorrectionLogEntry {
  id: number;
  dictation_id: number;
  correction_type: 'textFormatting' | 'llm' | 'doublePrecision' | 'manual';
  model_name?: string;
  model_provider?: string;
  username?: string;
  text_before: string;
  text_after: string;
  change_score?: number;
  created_at: string;
}

interface CorrectionLogViewerProps {
  dictationId: number;
  onClose: () => void;
}

const correctionTypeLabels: Record<string, string> = {
  textFormatting: '📝 Text-Formatierung',
  llm: '🤖 KI-Korrektur',
  doublePrecision: '🔍 Double Precision Merge',
  manual: '✏️ Manuelle Korrektur'
};

const correctionTypeDescriptions: Record<string, string> = {
  textFormatting: 'Automatische Formatierung (Absätze, Wörterbuch, etc.)',
  llm: 'KI-gestützte Grammatik- und Rechtschreibkorrektur',
  doublePrecision: 'Vergleich und Zusammenführung zweier Transkriptionen durch LLM',
  manual: 'Manuelle Korrektur durch Benutzer'
};

export default function CorrectionLogViewer({ dictationId, onClose }: CorrectionLogViewerProps) {
  const [logs, setLogs] = useState<CorrectionLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);

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

          {!loading && !error && logs.length > 0 && (
            <div className="space-y-3">
              {logs.map((log, index) => (
                <div
                  key={log.id}
                  className="border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden"
                >
                  {/* Header */}
                  <div
                    className="bg-gray-50 dark:bg-gray-900 p-3 cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                    onClick={() => setExpandedId(expandedId === log.id ? null : log.id)}
                  >
                    <div className="flex items-start justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">
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
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center justify-between">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              {logs.length > 0 && `${logs.length} Korrektur${logs.length !== 1 ? 'en' : ''}`}
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
    </div>
  );
}
