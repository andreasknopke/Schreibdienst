"use client";
import { useState, useEffect, useCallback, useRef } from 'react';
import Spinner from './Spinner';
import { fetchWithDbToken } from '@/lib/fetchWithDbToken';
import { ChangeIndicator, ChangeIndicatorDot, ChangeWarningBanner } from './ChangeIndicator';

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
  raw_transcript?: string; // Pure Transkription vor LLM-Korrektur
  transcript?: string;
  methodik?: string;
  befund?: string;
  beurteilung?: string;
  corrected_text?: string;
  change_score?: number; // Änderungsscore für Ampelsystem
  error_message?: string;
  created_at: string;
  completed_at?: string;
}

interface DictationQueueProps {
  username: string;
  canViewAll?: boolean;
  isSecretariat?: boolean;
  onRefreshNeeded?: () => void;
}

export default function DictationQueue({ username, canViewAll = false, isSecretariat = false, onRefreshNeeded }: DictationQueueProps) {
  const [dictations, setDictations] = useState<Dictation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [copyFeedback, setCopyFeedback] = useState<number | null>(null);
  const [workerStatus, setWorkerStatus] = useState<{ isProcessing: boolean } | null>(null);
  // Sekretariat always views all, regular users start with 'mine'
  const [viewMode, setViewMode] = useState<'mine' | 'all'>(isSecretariat ? 'all' : 'mine');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [userFilter, setUserFilter] = useState<string>('');
  const [availableUsers, setAvailableUsers] = useState<string[]>([]);
  
  // Dictionary entry form state (for secretariat)
  const [showDictForm, setShowDictForm] = useState(false);
  const [dictWrong, setDictWrong] = useState('');
  const [dictCorrect, setDictCorrect] = useState('');
  const [dictFeedback, setDictFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  
  // Revert/Re-Correct state
  const [isReverted, setIsReverted] = useState(false);
  const [isReCorrecting, setIsReCorrecting] = useState(false);
  
  // Editable text state for completed dictations
  const [editedTexts, setEditedTexts] = useState<{
    methodik: string;
    befund: string;
    beurteilung: string;
    corrected_text: string;
  }>({ methodik: '', befund: '', beurteilung: '', corrected_text: '' });
  
  // Fullscreen mode for better readability of long texts
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Load available users for filter
  const loadUsers = useCallback(async () => {
    if (!canViewAll && !isSecretariat) return;
    try {
      const res = await fetchWithDbToken('/api/offline-dictations?listUsers=true');
      if (res.ok) {
        const users = await res.json();
        setAvailableUsers(users);
      }
    } catch {
      // Ignore errors
    }
  }, [canViewAll, isSecretariat]);

  // Load dictations
  const loadDictations = useCallback(async () => {
    try {
      let url = `/api/offline-dictations`;
      
      if ((viewMode === 'all' && canViewAll) || isSecretariat) {
        url += `?all=true`;
        if (statusFilter) {
          url += `&status=${statusFilter}`;
        }
        if (userFilter) {
          url += `&user=${encodeURIComponent(userFilter)}`;
        }
      } else {
        url += `?username=${encodeURIComponent(username)}`;
      }
      
      const res = await fetchWithDbToken(url);
      if (!res.ok) throw new Error('Laden fehlgeschlagen');
      const data = await res.json();
      setDictations(data);
      setError(null);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [username, viewMode, canViewAll, isSecretariat, statusFilter, userFilter]);

  // Check worker status
  const checkWorkerStatus = useCallback(async () => {
    try {
      const res = await fetchWithDbToken('/api/offline-dictations/worker');
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
      await fetchWithDbToken('/api/offline-dictations/worker', { method: 'POST' });
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
    loadUsers();
    
    // Poll every 5 seconds for updates
    const interval = setInterval(() => {
      loadDictations();
      checkWorkerStatus();
    }, 5000);
    
    return () => clearInterval(interval);
  }, [loadDictations, checkWorkerStatus, loadUsers]);

  // Delete dictation
  const handleDelete = async (id: number, audioOnly: boolean = false) => {
    if (!confirm(audioOnly ? 'Audio-Daten löschen?' : 'Diktat vollständig löschen?')) return;
    
    try {
      await fetchWithDbToken(`/api/offline-dictations?id=${id}&audioOnly=${audioOnly}`, { method: 'DELETE' });
      loadDictations();
      if (selectedId === id && !audioOnly) setSelectedId(null);
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Retry failed dictation
  const handleRetry = async (id: number) => {
    try {
      await fetchWithDbToken('/api/offline-dictations', {
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

  // Add word to user's dictionary (for secretariat)
  const handleAddToDictionary = async (targetUsername: string) => {
    if (!dictWrong.trim() || !dictCorrect.trim()) {
      setDictFeedback({ type: 'error', message: 'Beide Felder müssen ausgefüllt sein' });
      return;
    }
    
    try {
      const res = await fetchWithDbToken('/api/dictionary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: targetUsername,
          wrong: dictWrong.trim(),
          correct: dictCorrect.trim(),
        }),
      });
      
      const data = await res.json();
      
      if (res.ok) {
        setDictFeedback({ type: 'success', message: `"${dictWrong}" → "${dictCorrect}" hinzugefügt` });
        setDictWrong('');
        setDictCorrect('');
        setTimeout(() => {
          setDictFeedback(null);
          setShowDictForm(false);
        }, 2000);
      } else {
        setDictFeedback({ type: 'error', message: data.error || 'Fehler beim Speichern' });
      }
    } catch (err: any) {
      setDictFeedback({ type: 'error', message: err.message });
    }
  };

  // Revert to raw transcription (before LLM correction)
  const handleRevert = useCallback(() => {
    const selected = dictations.find(d => d.id === selectedId);
    if (!selected?.raw_transcript) return;
    
    setEditedTexts(prev => ({
      ...prev,
      corrected_text: selected.raw_transcript || ''
    }));
    setIsReverted(true);
  }, [selectedId, dictations]);

  // Re-correct with LLM
  const handleReCorrect = useCallback(async () => {
    const selected = dictations.find(d => d.id === selectedId);
    if (!selected?.raw_transcript) return;
    
    // Verwende den aktuell angezeigten Text (editedTexts wenn vorhanden, sonst raw_transcript)
    const textToCorrect = editedTexts.corrected_text || selected.raw_transcript;
    
    setIsReCorrecting(true);
    try {
      const res = await fetchWithDbToken('/api/correct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          text: textToCorrect,
          username: selected.username
        }),
      });
      
      if (res.ok) {
        const data = await res.json();
        setEditedTexts(prev => ({
          ...prev,
          corrected_text: data.correctedText || selected.raw_transcript
        }));
        setIsReverted(false);
      } else {
        throw new Error('Korrektur fehlgeschlagen');
      }
    } catch (err: any) {
      setError(err.message || 'Fehler bei erneuter Korrektur');
    } finally {
      setIsReCorrecting(false);
    }
  }, [selectedId, dictations, editedTexts.corrected_text]);

  // Get combined text for a dictation - always Arztbrief mode now
  const getCombinedText = (d: Dictation): string => {
    return d.corrected_text || d.transcript || '';
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

  // Initialize edited texts when selected dictation changes
  // Use ref to track previous selectedId to avoid resetting on polling updates
  const prevSelectedIdRef = useRef<number | null>(null);
  
  useEffect(() => {
    // Only initialize when selectedId actually changes, not on every dictations poll
    if (selectedId === prevSelectedIdRef.current) return;
    prevSelectedIdRef.current = selectedId;
    
    const selected = dictations.find(d => d.id === selectedId);
    if (selected && selected.status === 'completed') {
      setEditedTexts({
        methodik: selected.methodik || '',
        befund: selected.befund || '',
        beurteilung: selected.beurteilung || '',
        corrected_text: selected.corrected_text || selected.transcript || ''
      });
      setIsReverted(false); // Reset revert state when selection changes
    }
  }, [selectedId, dictations]);

  // Get combined text for copy (uses edited values) - always Arztbrief mode
  const getCombinedTextEdited = useCallback((): string => {
    return editedTexts.corrected_text;
  }, [editedTexts]);

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
        <div className="card-body py-3 space-y-3">
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
          
          {/* View mode toggle and filters */}
          {(canViewAll || isSecretariat) && (
            <div className="flex items-center gap-4 flex-wrap pt-2 border-t border-gray-200 dark:border-gray-700">
              {/* Only show Meine/Alle toggle for non-secretariat users with canViewAll */}
              {canViewAll && !isSecretariat && (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Ansicht:</span>
                  <div className="flex rounded-lg overflow-hidden border border-gray-300 dark:border-gray-600">
                    <button
                      className={`px-3 py-1 text-sm transition-colors ${
                        viewMode === 'mine'
                          ? 'bg-blue-500 text-white'
                          : 'bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                      onClick={() => setViewMode('mine')}
                    >
                      Meine
                    </button>
                    <button
                      className={`px-3 py-1 text-sm transition-colors ${
                        viewMode === 'all'
                          ? 'bg-blue-500 text-white'
                          : 'bg-white dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                      onClick={() => setViewMode('all')}
                    >
                      Alle
                    </button>
                  </div>
                </div>
              )}
              
              {/* Filters - show for secretariat always, for others only in 'all' mode */}
              {(isSecretariat || viewMode === 'all') && (
                <>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600 dark:text-gray-400">Benutzer:</span>
                    <select
                      className="input py-1 text-sm"
                      value={userFilter}
                      onChange={(e) => setUserFilter(e.target.value)}
                    >
                      <option value="">Alle</option>
                      {availableUsers.map(user => (
                        <option key={user} value={user}>{user}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-600 dark:text-gray-400">Status:</span>
                    <select
                      className="input py-1 text-sm"
                      value={statusFilter}
                      onChange={(e) => setStatusFilter(e.target.value)}
                    >
                      <option value="">Alle</option>
                      <option value="completed">Fertig</option>
                      <option value="pending">Wartend</option>
                      <option value="processing">In Bearbeitung</option>
                      <option value="error">Fehler</option>
                    </select>
                  </div>
                </>
              )}
            </div>
          )}
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
                        {viewMode === 'all' && (
                          <span className="px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                            👤 {d.username}
                          </span>
                        )}
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
                        {d.status === 'completed' && d.change_score !== undefined && (
                          <>
                            <span>·</span>
                            <ChangeIndicatorDot score={d.change_score} />
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
            <div className={`card ${
              isFullscreen 
                ? 'fixed inset-4 z-50 overflow-auto' 
                : 'sticky top-20'
            }`}>
              {/* Fullscreen backdrop */}
              {isFullscreen && (
                <div 
                  className="fixed inset-0 bg-black/50 -z-10" 
                  onClick={() => setIsFullscreen(false)}
                />
              )}
              <div className="card-body space-y-4">
                <div className="flex items-start justify-between">
                  <div>
                    <h3 className="font-medium text-lg">{selectedDictation.order_number}</h3>
                    <div className="flex items-center gap-2 mt-1">
                      <PriorityBadge priority={selectedDictation.priority} />
                      <StatusBadge status={selectedDictation.status} />
                      {viewMode === 'all' && (
                        <span className="px-2 py-0.5 rounded-full text-xs bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                          👤 {selectedDictation.username}
                        </span>
                      )}
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

                {/* Change score warning banner */}
                {selectedDictation.status === 'completed' && !isReverted && (
                  <ChangeWarningBanner score={selectedDictation.change_score} />
                )}

                {/* Results - always Arztbrief mode */}
                {selectedDictation.status === 'completed' && (
                  <div className="space-y-3">
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <label className="text-xs font-medium text-gray-500">
                            {isReverted ? 'Reine Transkription (vor Korrektur)' : 'Korrigiertes Ergebnis'}
                          </label>
                          {!isReverted && selectedDictation.change_score !== undefined && (
                            <ChangeIndicator score={selectedDictation.change_score} size="sm" />
                          )}
                        </div>
                        {isReverted && (
                          <span className="text-xs text-orange-600 dark:text-orange-400">⚠️ Unkorrigiert</span>
                        )}
                      </div>
                      <textarea
                        className={`mt-1 w-full p-2 rounded text-sm font-mono resize-y ${
                          isFullscreen ? 'min-h-[60vh]' : 'min-h-[200px]'
                        } ${
                          isReverted 
                            ? 'bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-800' 
                            : 'bg-gray-50 dark:bg-gray-800'
                        }`}
                        value={editedTexts.corrected_text}
                        onChange={(e) => setEditedTexts(prev => ({ ...prev, corrected_text: e.target.value }))}
                        placeholder="(leer)"
                      />
                    </div>
                    
                    {/* Revert/Re-Correct Buttons */}
                    {selectedDictation.raw_transcript && (
                      <div className="flex gap-2">
                        {!isReverted ? (
                          <button
                            className="btn btn-sm btn-outline flex-1"
                            onClick={handleRevert}
                            title="Zur reinen Transkription zurückkehren"
                          >
                            ↩️ Zur Transkription
                          </button>
                        ) : (
                          <button
                            className="btn btn-sm btn-primary flex-1"
                            onClick={handleReCorrect}
                            disabled={isReCorrecting}
                            title="Erneut mit KI korrigieren"
                          >
                            {isReCorrecting ? (
                              <>
                                <Spinner size={12} className="mr-1" />
                                Korrigiere...
                              </>
                            ) : (
                              '✨ Neu korrigieren'
                            )}
                          </button>
                        )}
                      </div>
                    )}
                    
                    <p className="text-xs text-gray-400 italic">
                      💡 Tipp: Texte können bearbeitet und an den Ecken vergrößert werden
                    </p>
                  </div>
                )}

                {/* Actions */}
                <div className="flex gap-2 pt-2 border-t flex-wrap">
                  {selectedDictation.status === 'completed' && (
                    <>
                      <button
                        className={`btn btn-sm flex-1 ${copyFeedback === selectedDictation.id ? 'btn-success' : 'btn-primary'}`}
                        onClick={() => handleCopy(getCombinedTextEdited(), selectedDictation.id)}
                      >
                        {copyFeedback === selectedDictation.id ? '✓ Kopiert!' : '📋 In Zwischenablage'}
                      </button>
                      <button
                        className="btn btn-sm btn-outline"
                        onClick={() => setIsFullscreen(!isFullscreen)}
                        title={isFullscreen ? 'Vollbild beenden' : 'Vollbild anzeigen'}
                      >
                        {isFullscreen ? '🗗✕' : '🗖'}
                      </button>
                      <button
                        className="btn btn-sm btn-outline"
                        onClick={() => handleDelete(selectedDictation.id, true)}
                        title="Audio löschen, Text behalten"
                      >
                        🎵✕
                      </button>
                      {isSecretariat && (
                        <button
                          className="btn btn-sm btn-outline"
                          onClick={() => setShowDictForm(!showDictForm)}
                          title="Wort zum Wörterbuch hinzufügen"
                        >
                          📖+
                        </button>
                      )}
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
                
                {/* Dictionary Entry Form (for secretariat) */}
                {isSecretariat && showDictForm && selectedDictation.status === 'completed' && (
                  <div className="mt-3 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
                    <h4 className="text-sm font-medium mb-2">
                      📖 Wörterbuch-Eintrag für <span className="text-purple-600 dark:text-purple-400">{selectedDictation.username}</span>
                    </h4>
                    <div className="space-y-2">
                      <input
                        type="text"
                        className="input w-full text-sm"
                        placeholder="Falsches Wort (wie diktiert)"
                        value={dictWrong}
                        onChange={(e) => setDictWrong(e.target.value)}
                      />
                      <input
                        type="text"
                        className="input w-full text-sm"
                        placeholder="Korrektes Wort"
                        value={dictCorrect}
                        onChange={(e) => setDictCorrect(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <button
                          className="btn btn-sm btn-primary flex-1"
                          onClick={() => handleAddToDictionary(selectedDictation.username)}
                        >
                          ✓ Hinzufügen
                        </button>
                        <button
                          className="btn btn-sm btn-outline"
                          onClick={() => {
                            setShowDictForm(false);
                            setDictWrong('');
                            setDictCorrect('');
                            setDictFeedback(null);
                          }}
                        >
                          ✕
                        </button>
                      </div>
                      {dictFeedback && (
                        <div className={`text-xs p-2 rounded ${
                          dictFeedback.type === 'success' 
                            ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
                            : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
                        }`}>
                          {dictFeedback.message}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
