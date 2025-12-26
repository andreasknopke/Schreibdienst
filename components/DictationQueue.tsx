"use client";
import { useState, useEffect, useCallback } from 'react';
import Spinner from './Spinner';

interface Dictation {
  id: number;
  username: string;
  audio_duration_seconds: number;
  order_number: string;
  patient_name?: string;
  patient_dob?: string;
  priority: 'normal' | 'urgent' | 'stat';
  status: 'pending' | 'processing' | 'completed' | 'error';
  mode: 'befund' | 'arztbrief';
  transcript?: string;
  methodik?: string;
  befund?: string;
  beurteilung?: string;
  corrected_text?: string;
  error_message?: string;
  created_at: string;
  completed_at?: string;
}

interface DictationQueueProps {
  username: string;
  onRefreshNeeded?: () => void;
}

export default function DictationQueue({ username, onRefreshNeeded }: DictationQueueProps) {
  const [dictations, setDictations] = useState<Dictation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<number | null>(null);
  const [workerStatus, setWorkerStatus] = useState<{ isProcessing: boolean } | null>(null);

  // Load dictations
  const loadDictations = useCallback(async () => {
    try {
      const res = await fetch(`/api/offline-dictations?username=${encodeURIComponent(username)}`);
      if (!res.ok) throw new Error('Laden fehlgeschlagen');
      const data = await res.json();
      setDictations(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [username]);

  // Check worker status
  const checkWorkerStatus = useCallback(async () => {
    try {
      const res = await fetch('/api/offline-dictations/worker');
      if (res.ok) {
        const data = await res.json();
        setWorkerStatus(data);
      }
    } catch {
      // Ignore errors
    }
  }, []);

  // Trigger worker to process pending dictations
  const triggerWorker = async () => {
    try {
      await fetch('/api/offline-dictations/worker', { method: 'POST' });
      await checkWorkerStatus();
      setTimeout(loadDictations, 2000);
    } catch {
      // Ignore errors
    }
  };

  // Initial load and polling
  useEffect(() => {
    loadDictations();
    checkWorkerStatus();
    
    // Poll every 5 seconds for updates
    const interval = setInterval(() => {
      loadDictations();
      checkWorkerStatus();
    }, 5000);
    
    return () => clearInterval(interval);
  }, [loadDictations, checkWorkerStatus]);

  // Delete dictation
  const handleDelete = async (id: number, audioOnly: boolean = false) => {
    if (!confirm(audioOnly ? 'Audio-Daten löschen?' : 'Diktat vollständig löschen?')) return;
    
    try {
      await fetch(`/api/offline-dictations?id=${id}&audioOnly=${audioOnly}`, { method: 'DELETE' });
      loadDictations();
      if (selectedId === id && !audioOnly) setSelectedId(null);
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Retry failed dictation
  const handleRetry = async (id: number) => {
    try {
      await fetch('/api/offline-dictations', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, action: 'retry' })
      });
      loadDictations();
      triggerWorker();
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Copy text to clipboard
  const handleCopy = async (text: string, id: number) => {
    await navigator.clipboard.writeText(text);
    setCopyFeedback(id);
    setTimeout(() => setCopyFeedback(null), 1500);
  };

  // Get combined text for a dictation
  const getCombinedText = (d: Dictation): string => {
    if (d.mode === 'arztbrief') {
      return d.corrected_text || d.transcript || '';
    }
    
    const parts: string[] = [];
    if (d.methodik) parts.push(`Methodik:\n${d.methodik}`);
    if (d.befund) parts.push(`Befund:\n${d.befund}`);
    if (d.beurteilung) parts.push(`Beurteilung:\n${d.beurteilung}`);
    return parts.join('\n\n') || d.transcript || '';
  };

  // Format date
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  // Format duration
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // Priority badge
  const PriorityBadge = ({ priority }: { priority: string }) => {
    const colors = {
      stat: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
      urgent: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200',
      normal: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200'
    };
    const labels = { stat: 'STAT', urgent: 'Dringend', normal: 'Normal' };
    
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[priority as keyof typeof colors] || colors.normal}`}>
        {labels[priority as keyof typeof labels] || priority}
      </span>
    );
  };

  // Status badge
  const StatusBadge = ({ status }: { status: string }) => {
    const colors = {
      pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
      processing: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
      completed: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
      error: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
    };
    const labels = { pending: '⏳ Wartend', processing: '⚙️ Verarbeitung', completed: '✓ Fertig', error: '✗ Fehler' };
    
    return (
      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${colors[status as keyof typeof colors]}`}>
        {labels[status as keyof typeof labels] || status}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="card">
        <div className="card-body flex items-center justify-center py-8">
          <Spinner size={24} />
          <span className="ml-2">Lade Diktate...</span>
        </div>
      </div>
    );
  }

  const selectedDictation = dictations.find(d => d.id === selectedId);
  const pendingCount = dictations.filter(d => d.status === 'pending').length;
  const processingCount = dictations.filter(d => d.status === 'processing').length;

  return (
    <div className="space-y-4">
      {/* Header with stats */}
      <div className="card">
        <div className="card-body py-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h3 className="font-medium">Diktat-Warteschlange</h3>
              <div className="flex gap-2 text-sm">
                {pendingCount > 0 && (
                  <span className="text-yellow-600 dark:text-yellow-400">
                    {pendingCount} wartend
                  </span>
                )}
                {processingCount > 0 && (
                  <span className="text-blue-600 dark:text-blue-400 flex items-center gap-1">
                    <Spinner size={12} />
                    {processingCount} in Bearbeitung
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {pendingCount > 0 && (
                <button
                  className="btn btn-outline btn-sm"
                  onClick={triggerWorker}
                  disabled={workerStatus?.isProcessing}
                >
                  {workerStatus?.isProcessing ? (
                    <>
                      <Spinner size={12} className="mr-1" />
                      Verarbeitet...
                    </>
                  ) : (
                    '▶️ Verarbeiten'
                  )}
                </button>
              )}
              <button
                className="btn btn-outline btn-sm"
                onClick={loadDictations}
              >
                🔄
              </button>
            </div>
          </div>
        </div>
      </div>

      {error && <div className="alert alert-error">{error}</div>}

      {/* Dictation List */}
      {dictations.length === 0 ? (
        <div className="card">
          <div className="card-body text-center py-8 text-gray-500">
            Keine Diktate in der Warteschlange
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* List */}
          <div className="space-y-2">
            {dictations.map((d) => (
              <div
                key={d.id}
                className={`card cursor-pointer transition-all ${
                  selectedId === d.id 
                    ? 'ring-2 ring-blue-500' 
                    : 'hover:bg-gray-50 dark:hover:bg-gray-800/50'
                }`}
                onClick={() => setSelectedId(d.id)}
              >
                <div className="card-body py-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">{d.order_number}</span>
                        <PriorityBadge priority={d.priority} />
                        <StatusBadge status={d.status} />
                      </div>
                      <div className="text-sm text-gray-500 mt-1 flex items-center gap-2 flex-wrap">
                        <span>{formatDate(d.created_at)}</span>
                        <span>·</span>
                        <span>{formatDuration(d.audio_duration_seconds)}</span>
                        <span>·</span>
                        <span>{d.mode === 'befund' ? 'Befund' : 'Arztbrief'}</span>
                        {d.patient_name && (
                          <>
                            <span>·</span>
                            <span className="truncate max-w-32">{d.patient_name}</span>
                          </>
                        )}
                      </div>
                    </div>
                    
                    {d.status === 'completed' && (
                      <button
                        className={`btn btn-sm ${copyFeedback === d.id ? 'btn-success' : 'btn-outline'}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          handleCopy(getCombinedText(d), d.id);
                        }}
                      >
                        {copyFeedback === d.id ? '✓' : '📋'}
                      </button>
                    )}
                    
                    {d.status === 'error' && (
                      <button
                        className="btn btn-sm btn-outline"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleRetry(d.id);
                        }}
                      >
                        🔄
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Detail View */}
          {selectedDictation && (
            <div className="card sticky top-20">
              <div className="card-body space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-medium text-lg">{selectedDictation.order_number}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <PriorityBadge priority={selectedDictation.priority} />
                      <StatusBadge status={selectedDictation.status} />
                    </div>
                  </div>
                  <button
                    className="text-gray-400 hover:text-gray-600"
                    onClick={() => setSelectedId(null)}
                  >
                    ✕
                  </button>
                </div>

                {/* Metadata */}
                <div className="text-sm text-gray-600 dark:text-gray-400 space-y-1">
                  <p><strong>Erstellt:</strong> {formatDate(selectedDictation.created_at)}</p>
                  {selectedDictation.completed_at && (
                    <p><strong>Fertig:</strong> {formatDate(selectedDictation.completed_at)}</p>
                  )}
                  <p><strong>Dauer:</strong> {formatDuration(selectedDictation.audio_duration_seconds)}</p>
                  <p><strong>Typ:</strong> {selectedDictation.mode === 'befund' ? 'Befund' : 'Arztbrief'}</p>
                  {selectedDictation.patient_name && (
                    <p><strong>Patient:</strong> {selectedDictation.patient_name}</p>
                  )}
                  {selectedDictation.patient_dob && (
                    <p><strong>Geb.:</strong> {new Date(selectedDictation.patient_dob).toLocaleDateString('de-DE')}</p>
                  )}
                </div>

                {/* Error message */}
                {selectedDictation.status === 'error' && selectedDictation.error_message && (
                  <div className="alert alert-error text-sm">
                    {selectedDictation.error_message}
                  </div>
                )}

                {/* Results */}
                {selectedDictation.status === 'completed' && (
                  <div className="space-y-3">
                    {selectedDictation.mode === 'befund' ? (
                      <>
                        {selectedDictation.methodik && (
                          <div>
                            <label className="text-xs font-medium text-gray-500">Methodik</label>
                            <div className="mt-1 p-2 bg-gray-50 dark:bg-gray-800 rounded text-sm whitespace-pre-wrap">
                              {selectedDictation.methodik}
                            </div>
                          </div>
                        )}
                        {selectedDictation.befund && (
                          <div>
                            <label className="text-xs font-medium text-gray-500">Befund</label>
                            <div className="mt-1 p-2 bg-gray-50 dark:bg-gray-800 rounded text-sm whitespace-pre-wrap">
                              {selectedDictation.befund}
                            </div>
                          </div>
                        )}
                        {selectedDictation.beurteilung && (
                          <div>
                            <label className="text-xs font-medium text-gray-500">Beurteilung</label>
                            <div className="mt-1 p-2 bg-gray-50 dark:bg-gray-800 rounded text-sm whitespace-pre-wrap">
                              {selectedDictation.beurteilung}
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      <div>
                        <label className="text-xs font-medium text-gray-500">Ergebnis</label>
                        <div className="mt-1 p-2 bg-gray-50 dark:bg-gray-800 rounded text-sm whitespace-pre-wrap">
                          {selectedDictation.corrected_text || selectedDictation.transcript}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-2 border-t">
                  {selectedDictation.status === 'completed' && (
                    <>
                      <button
                        className={`btn btn-sm flex-1 ${copyFeedback === selectedDictation.id ? 'btn-success' : 'btn-primary'}`}
                        onClick={() => handleCopy(getCombinedText(selectedDictation), selectedDictation.id)}
                      >
                        {copyFeedback === selectedDictation.id ? '✓ Kopiert!' : '📋 In Zwischenablage'}
                      </button>
                      <button
                        className="btn btn-sm btn-outline"
                        onClick={() => handleDelete(selectedDictation.id, true)}
                        title="Audio löschen, Text behalten"
                      >
                        🎵✕
                      </button>
                    </>
                  )}
                  
                  {selectedDictation.status === 'error' && (
                    <button
                      className="btn btn-sm btn-outline flex-1"
                      onClick={() => handleRetry(selectedDictation.id)}
                    >
                      🔄 Erneut versuchen
                    </button>
                  )}
                  
                  <button
                    className="btn btn-sm btn-outline text-red-600"
                    onClick={() => handleDelete(selectedDictation.id)}
                  >
                    🗑️ Löschen
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
