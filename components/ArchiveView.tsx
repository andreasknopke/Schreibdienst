"use client";
import { useState, useEffect, useCallback } from 'react';
import { fetchWithDbToken } from '@/lib/fetchWithDbToken';
import { useAuth } from './AuthProvider';
import Spinner from './Spinner';
import { ChangeIndicator } from './ChangeIndicator';
import CorrectionLogViewer from './CorrectionLogViewer';

interface ArchivedDictation {
  id: number;
  username: string;
  audio_duration_seconds: number;
  order_number: string;
  patient_name?: string;
  patient_dob?: string;
  priority: 'normal' | 'urgent' | 'stat';
  status: 'pending' | 'processing' | 'completed' | 'error';
  mode: 'befund' | 'arztbrief';
  raw_transcript?: string;
  transcript?: string;
  methodik?: string;
  befund?: string;
  beurteilung?: string;
  corrected_text?: string;
  change_score?: number;
  archived_at?: string;
  archived_by?: string;
  created_at: string;
  completed_at?: string;
}

interface ArchiveViewProps {
  username: string;
  canViewAll?: boolean;
}

export default function ArchiveView({ username, canViewAll = false }: ArchiveViewProps) {
  const { getAuthHeader } = useAuth();
  const [dictations, setDictations] = useState<ArchivedDictation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [showCorrectionLog, setShowCorrectionLog] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<number | null>(null);
  const [showAllLayers, setShowAllLayers] = useState(false);
  const [detailData, setDetailData] = useState<ArchivedDictation | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  
  // Filters
  const [filterUsername, setFilterUsername] = useState<string>('');
  const [filterArchivedBy, setFilterArchivedBy] = useState<string>('');
  const [filterPatient, setFilterPatient] = useState<string>('');
  const [filterFromDate, setFilterFromDate] = useState<string>('');
  const [filterToDate, setFilterToDate] = useState<string>('');
  
  const loadArchivedDictations = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      const params = new URLSearchParams();
      if (!canViewAll) {
        params.append('username', username);
      } else if (filterUsername) {
        params.append('username', filterUsername);
      }
      if (filterArchivedBy) params.append('archivedBy', filterArchivedBy);
      if (filterPatient) params.append('patientName', filterPatient);
      if (filterFromDate) params.append('fromDate', filterFromDate);
      if (filterToDate) params.append('toDate', filterToDate);
      
      const response = await fetchWithDbToken(`/api/archive?${params.toString()}`);
      
      if (!response.ok) {
        throw new Error(`Fehler beim Laden: ${response.status}`);
      }
      
      const data = await response.json();
      setDictations(data.dictations || []);
    } catch (err: any) {
      console.error('[Archive] Load error:', err);
      setError(err.message || 'Unbekannter Fehler');
    } finally {
      setLoading(false);
    }
  }, [username, canViewAll, filterUsername, filterArchivedBy, filterPatient, filterFromDate, filterToDate]);
  
  useEffect(() => {
    loadArchivedDictations();
  }, [loadArchivedDictations]);
  
  // Load detail data on demand when a dictation is selected
  useEffect(() => {
    if (!selectedId) { setDetailData(null); return; }
    let cancelled = false;
    (async () => {
      try {
        setDetailLoading(true);
        const res = await fetchWithDbToken(`/api/offline-dictations?id=${selectedId}`);
        if (!res.ok) throw new Error('Detail-Laden fehlgeschlagen');
        const data = await res.json();
        if (!cancelled) setDetailData(data);
      } catch (err) {
        console.error('[Archive] detail load error:', err);
        if (!cancelled) setDetailData(null);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId]);
  
  const handleUnarchive = async (id: number) => {
    if (!confirm('Diktat wirklich wiederherstellen?')) return;
    
    try {
      const response = await fetchWithDbToken(`/api/archive?id=${id}`, {
        method: 'DELETE'
      });
      
      if (!response.ok) {
        throw new Error('Fehler beim Wiederherstellen');
      }
      
      // Reload list
      await loadArchivedDictations();
    } catch (err: any) {
      alert(`Fehler: ${err.message}`);
    }
  };
  
  const handleCopy = async (text: string, id: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyFeedback(id);
      setTimeout(() => setCopyFeedback(null), 2000);
    } catch (err) {
      alert('Fehler beim Kopieren');
    }
  };
  
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('de-DE', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };
  
  const formatDuration = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  const selectedDictation = dictations.find(d => d.id === selectedId);
  const selectedCorrectedText =
    (detailData && detailData.id === selectedId ? detailData.corrected_text : undefined)
    || selectedDictation?.corrected_text
    || '';
  
  return (
    <div className="space-y-4">
      {/* Header with filters */}
      <div className="card">
        <div className="card-body py-3 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">📦 Archivierte Diktate</h3>
            <button
              className="btn btn-outline btn-sm"
              onClick={loadArchivedDictations}
            >
              🔄 Aktualisieren
            </button>
          </div>
          
          {/* Filters */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
            {canViewAll && (
              <input
                type="text"
                className="input input-sm"
                placeholder="Erstellt von..."
                value={filterUsername}
                onChange={(e) => setFilterUsername(e.target.value)}
              />
            )}
            <input
              type="text"
              className="input input-sm"
              placeholder="Archiviert von..."
              value={filterArchivedBy}
              onChange={(e) => setFilterArchivedBy(e.target.value)}
            />
            <input
              type="text"
              className="input input-sm"
              placeholder="Patient..."
              value={filterPatient}
              onChange={(e) => setFilterPatient(e.target.value)}
            />
            <input
              type="date"
              className="input input-sm"
              placeholder="Von Datum"
              value={filterFromDate}
              onChange={(e) => setFilterFromDate(e.target.value)}
            />
            <input
              type="date"
              className="input input-sm"
              placeholder="Bis Datum"
              value={filterToDate}
              onChange={(e) => setFilterToDate(e.target.value)}
            />
            <button
              className="btn btn-sm btn-outline"
              onClick={() => {
                setFilterUsername('');
                setFilterArchivedBy('');
                setFilterPatient('');
                setFilterFromDate('');
                setFilterToDate('');
              }}
            >
              ✕ Filter zurücksetzen
            </button>
          </div>
        </div>
      </div>
      
      {/* Loading/Error */}
      {loading && (
        <div className="card">
          <div className="card-body flex items-center justify-center py-8">
            <Spinner size={24} />
            <span className="ml-2">Lade archivierte Diktate...</span>
          </div>
        </div>
      )}
      
      {error && (
        <div className="alert alert-error">
          ⚠️ {error}
        </div>
      )}
      
      {/* Results Table */}
      {!loading && !error && (
        <div className="card overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Auftragsnr.</th>
                  <th className="px-3 py-2 text-left font-medium">Patient</th>
                  {canViewAll && <th className="px-3 py-2 text-left font-medium">Erstellt von</th>}
                  <th className="px-3 py-2 text-left font-medium">Archiviert</th>
                  <th className="px-3 py-2 text-left font-medium">Archiviert von</th>
                  <th className="px-3 py-2 text-left font-medium">Dauer</th>
                  <th className="px-3 py-2 text-left font-medium">Typ</th>
                  <th className="px-3 py-2 text-left font-medium">Score</th>
                  <th className="px-3 py-2 text-right font-medium">Aktionen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 dark:divide-gray-700">
                {dictations.length === 0 ? (
                  <tr>
                    <td colSpan={canViewAll ? 9 : 8} className="px-3 py-8 text-center text-gray-500">
                      Keine archivierten Diktate gefunden
                    </td>
                  </tr>
                ) : (
                  dictations.map((dict) => (
                    <tr
                      key={dict.id}
                      className={`hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer ${
                        selectedId === dict.id ? 'bg-blue-50 dark:bg-blue-900/20' : ''
                      }`}
                      onClick={() => setSelectedId(selectedId === dict.id ? null : dict.id)}
                    >
                      <td className="px-3 py-2 font-mono text-xs">{dict.order_number}</td>
                      <td className="px-3 py-2">
                        {dict.patient_name || '-'}
                        {dict.patient_dob && (
                          <div className="text-xs text-gray-500">
                            {new Date(dict.patient_dob).toLocaleDateString('de-DE')}
                          </div>
                        )}
                      </td>
                      {canViewAll && <td className="px-3 py-2">{dict.username}</td>}
                      <td className="px-3 py-2 text-xs text-gray-600">
                        {dict.archived_at ? formatDate(dict.archived_at) : '-'}
                      </td>
                      <td className="px-3 py-2">{dict.archived_by || '-'}</td>
                      <td className="px-3 py-2 font-mono text-xs">
                        {formatDuration(dict.audio_duration_seconds)}
                      </td>
                      <td className="px-3 py-2 text-xs">
                        {dict.mode === 'befund' ? '📋 Befund' : '📄 Brief'}
                      </td>
                      <td className="px-3 py-2">
                        {dict.change_score !== undefined && (
                          <ChangeIndicator score={dict.change_score} size="sm" />
                        )}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex gap-1 justify-end">
                          <button
                            className="btn btn-xs btn-outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedId(dict.id);
                              setShowCorrectionLog(true);
                            }}
                            title="Korrekturprotokoll"
                          >
                            📋
                          </button>
                          <button
                            className="btn btn-xs btn-outline"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleUnarchive(dict.id);
                            }}
                            title="Wiederherstellen"
                          >
                            ↩️
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
      
      {/* Detail View */}
      {selectedDictation && (
        <div className="card">
          <div className="card-body space-y-3">
            <div className="flex items-center justify-between">
              <h4 className="font-medium">Diktat #{selectedDictation.order_number}</h4>
              <button
                className="text-gray-500 hover:text-gray-700"
                onClick={() => setSelectedId(null)}
              >
                ✕
              </button>
            </div>
            
            {/* Metadata */}
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-gray-500">Erstellt:</span> {formatDate(selectedDictation.created_at)}
              </div>
              {selectedDictation.completed_at && (
                <div>
                  <span className="text-gray-500">Fertiggestellt:</span> {formatDate(selectedDictation.completed_at)}
                </div>
              )}
              <div>
                <span className="text-gray-500">Archiviert:</span>{' '}
                {selectedDictation.archived_at ? formatDate(selectedDictation.archived_at) : '-'}
              </div>
              <div>
                <span className="text-gray-500">Archiviert von:</span> {selectedDictation.archived_by || '-'}
              </div>
              <div>
                <span className="text-gray-500">Modus:</span>{' '}
                {selectedDictation.mode === 'befund' ? 'Befund' : 'Arztbrief'}
              </div>
              {selectedDictation.change_score !== undefined && (
                <div className="flex items-center gap-2">
                  <span className="text-gray-500">Änderungs-Score:</span>
                  <ChangeIndicator score={selectedDictation.change_score} size="sm" />
                </div>
              )}
            </div>
            
            {/* All Text Layers */}
            <div className="space-y-3">
              {/* Info Box */}
              <div className="bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded-lg p-3">
                <div className="flex items-start justify-between">
                  <div className="space-y-1">
                    <div className="text-sm font-medium text-blue-900 dark:text-blue-100">
                      📚 Diktat-Informationen
                    </div>
                    <div className="text-xs text-blue-700 dark:text-blue-300 space-y-0.5">
                      <div>• Modus: {selectedDictation.mode === 'befund' ? 'Befund (3 Felder)' : 'Arztbrief'}</div>
                      {detailData?.raw_transcript && <div>• Rohe Transkription verfügbar</div>}
                      {selectedDictation.change_score !== undefined && (
                        <div className="flex items-center gap-1">
                          • Änderungs-Score: <ChangeIndicator score={selectedDictation.change_score} size="sm" />
                        </div>
                      )}
                    </div>
                  </div>
                  <button
                    className="btn btn-xs btn-outline"
                    onClick={() => setShowCorrectionLog(true)}
                    title="Vollständiges Änderungsprotokoll anzeigen"
                  >
                    📋 Protokoll
                  </button>
                </div>
              </div>
              
              {/* Toggle Button for All Layers */}
              <div className="flex items-center gap-2">
                <button
                  className={`btn btn-sm ${showAllLayers ? 'btn-primary' : 'btn-outline'}`}
                  onClick={() => setShowAllLayers(!showAllLayers)}
                >
                  {showAllLayers ? '🔽 Alle Layer ausblenden' : '🔼 Alle Layer anzeigen'}
                </button>
                <span className="text-xs text-gray-500">
                  Zeigt Rohtranskrip, formatierte Versionen und Änderungen
                </span>
              </div>
              
              {/* Detail loading indicator */}
              {detailLoading && showAllLayers && (
                <div className="flex items-center gap-2 text-sm text-gray-500">
                  <Spinner size={16} /> Lade Detaildaten...
                </div>
              )}
              
              {/* Raw Transcript - only if showing all layers */}
              {showAllLayers && detailData?.raw_transcript && (
                <div>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400 flex items-center gap-2">
                    🎤 Rohe Transkription (vor Formatierung)
                  </label>
                  <textarea
                    className="mt-1 w-full p-3 rounded-lg text-sm font-mono resize-y border bg-orange-50 dark:bg-orange-900/10 border-orange-200 dark:border-orange-800 min-h-[120px]"
                    value={detailData.raw_transcript}
                    readOnly
                  />
                </div>
              )}
              
              {/* Befund Mode: Show all three fields */}
              {showAllLayers && selectedDictation.mode === 'befund' && detailData && (
                <>
                  {detailData.methodik && (
                    <div>
                      <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                        📋 Methodik
                      </label>
                      <textarea
                        className="mt-1 w-full p-3 rounded-lg text-sm font-mono resize-y border bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800 min-h-[100px]"
                        value={detailData.methodik}
                        readOnly
                      />
                    </div>
                  )}
                  
                  {detailData.befund && (
                    <div>
                      <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                        📝 Befund
                      </label>
                      <textarea
                        className="mt-1 w-full p-3 rounded-lg text-sm font-mono resize-y border bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800 min-h-[150px]"
                        value={detailData.befund}
                        readOnly
                      />
                    </div>
                  )}
                  
                  {detailData.beurteilung && (
                    <div>
                      <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                        💡 Beurteilung/Zusammenfassung
                      </label>
                      <textarea
                        className="mt-1 w-full p-3 rounded-lg text-sm font-mono resize-y border bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800 min-h-[100px]"
                        value={detailData.beurteilung}
                        readOnly
                      />
                    </div>
                  )}
                </>
              )}
              
              {/* Corrected/Final Text */}
              <div>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400 flex items-center gap-2">
                  ✨ {selectedDictation.mode === 'befund' ? 'Korrigierter Text (Arztbrief-Format)' : 'Korrigierter Text'}
                  {selectedDictation.change_score !== undefined && (
                    <ChangeIndicator score={selectedDictation.change_score} size="sm" />
                  )}
                </label>
                <textarea
                  className="mt-1 w-full p-3 rounded-lg text-sm font-mono resize-y border bg-green-50 dark:bg-green-900/10 border-green-200 dark:border-green-800 min-h-[200px]"
                  value={selectedCorrectedText || '(kein Text)'}
                  readOnly
                />
              </div>
            </div>
            
            {/* Actions */}
            <div className="flex gap-2 pt-2 border-t">
              <button
                className={`btn btn-sm flex-1 ${
                  copyFeedback === selectedDictation.id ? 'btn-success' : 'btn-primary'
                }`}
                onClick={() => handleCopy(selectedCorrectedText, selectedDictation.id)}
              >
                {copyFeedback === selectedDictation.id ? '✓ Kopiert!' : '📋 Kopieren'}
              </button>
              <button
                className="btn btn-sm btn-outline"
                onClick={() => setShowCorrectionLog(true)}
              >
                📋 Protokoll
              </button>
              <button
                className="btn btn-sm btn-outline"
                onClick={() => handleUnarchive(selectedDictation.id)}
              >
                ↩️ Wiederherstellen
              </button>
            </div>
          </div>
        </div>
      )}
      
      {/* Correction Log Modal */}
      {showCorrectionLog && selectedId && (
        <CorrectionLogViewer
          dictationId={selectedId}
          onClose={() => setShowCorrectionLog(false)}
        />
      )}
    </div>
  );
}
