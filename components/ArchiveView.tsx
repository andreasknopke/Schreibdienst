"use client";
import { useState, useEffect, useCallback, useRef } from 'react';
import { fetchWithDbToken } from '@/lib/fetchWithDbToken';
import { useAuth } from './AuthProvider';
import Spinner from './Spinner';
import { ChangeIndicator } from './ChangeIndicator';
import CorrectionLogViewer from './CorrectionLogViewer';
import EditableTextWithMitlesen from './EditableTextWithMitlesen';
import TrainingMarker from './TrainingMarker';
import { preprocessTranscription } from '@/lib/textFormatting';

// Segment interface for word-level highlighting (Mitlesen)
interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
  words?: {
    word: string;
    start: number;
    end: number;
  }[];
}

interface ArchivedDictation {
  id: number;
  username: string;
  audio_mime_type?: string;
  audio_duration_seconds: number;
  order_number: string;
  patient_name?: string;
  patient_dob?: string;
  priority: 'normal' | 'urgent' | 'stat';
  status: 'pending' | 'processing' | 'completed' | 'error';
  mode: 'befund' | 'arztbrief';
  bemerkung?: string;
  termin?: string;
  fachabteilung?: string;
  raw_transcript?: string;
  transcript?: string;
  segments?: string;
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
  
  // Audio player state
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  // Mirror of audioUrl so other effects/handlers can read its current value
  // without depending on the state itself (avoids stale closures & re-runs).
  const audioUrlRef = useRef<string | null>(null);
  useEffect(() => { audioUrlRef.current = audioUrl; }, [audioUrl]);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  
  // Mitlesen state
  const [showMitlesen, setShowMitlesen] = useState(false);
  const [rawTranscriptCollapsed, setRawTranscriptCollapsed] = useState(false);
  const parsedSegmentsRef = useRef<HTMLDivElement>(null);
  const [parsedSegments, setParsedSegments] = useState<TranscriptSegment[]>([]);
  const [formattedRawText, setFormattedRawText] = useState('');
  
  // Playback speed
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
  
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
    // Reset audio state when switching dictations (or closing detail).
    // Without this, the audio element keeps pointing at the previous
    // dictation's blob URL and the player shows stale state.
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.removeAttribute('src');
      audioRef.current.load?.();
    }
    const prevUrl = audioUrlRef.current;
    if (prevUrl) {
      URL.revokeObjectURL(prevUrl);
    }
    setAudioUrl(null);
    setAudioError(null);
    setAudioCurrentTime(0);
    setAudioDuration(0);
    setIsPlaying(false);
    setShowMitlesen(false);
    setRawTranscriptCollapsed(false);

    if (!selectedId) {
      setDetailData(null);
      setParsedSegments([]);
      setFormattedRawText('');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setDetailLoading(true);
        const res = await fetchWithDbToken(`/api/offline-dictations?id=${selectedId}`);
        if (!res.ok) throw new Error('Detail-Laden fehlgeschlagen');
        const data = await res.json();
        if (!cancelled) {
          setDetailData(data);
          // Parse segments for Mitlesen
          if (data.segments) {
            try {
              const segs = JSON.parse(data.segments);
              if (Array.isArray(segs)) setParsedSegments(segs);
            } catch { /* ignore */ }
          }
          // Preprocess raw transcript for diff comparison
          if (data.raw_transcript) {
            setFormattedRawText(preprocessTranscription(data.raw_transcript));
          }
        }
      } catch (err) {
        console.error('[Archive] detail load error:', err);
        if (!cancelled) setDetailData(null);
      } finally {
        if (!cancelled) setDetailLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [selectedId]);

  // --- Audio playback functions ---
  const loadAudio = useCallback(async (id: number) => {
    setAudioLoading(true);
    setAudioError(null);
    
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    
    try {
      const res = await fetchWithDbToken(`/api/offline-dictations?id=${id}&audio=true`);
      if (!res.ok) {
        if (res.status === 404) setAudioError('Audio nicht verfügbar');
        else setAudioError('Fehler beim Laden');
        return;
      }
      const contentType = res.headers.get('Content-Type') || 'audio/webm';
      const arrayBuffer = await res.arrayBuffer();
      if (arrayBuffer.byteLength === 0) { setAudioError('Audio wurde gelöscht'); return; }
      const blob = new Blob([arrayBuffer], { type: contentType });
      setAudioUrl(URL.createObjectURL(blob));
    } catch (err) {
      console.error('[Archive] Audio load error:', err);
      setAudioError('Fehler beim Laden');
    } finally {
      setAudioLoading(false);
    }
  }, [audioUrl]);

  const togglePlayPause = () => {
    if (!audioRef.current) return;
    if (isPlaying) audioRef.current.pause();
    else audioRef.current.play();
  };

  const seekToStart = () => { if (audioRef.current) audioRef.current.currentTime = 0; };

  // Seek audio to start of a word (used by Mitlesen original-transcript panel)
  const seekToWord = (time: number) => {
    if (audioRef.current) audioRef.current.currentTime = time;
  };

  // Jump audio player to a specific time (used by TrainingMarker)
  const seekToTime = useCallback((seconds: number) => {
    const apply = () => {
      if (!audioRef.current) return false;
      try {
        audioRef.current.currentTime = Math.max(0, seconds);
        audioRef.current.play().catch(() => {});
        return true;
      } catch {
        return false;
      }
    };
    if (audioRef.current) {
      apply();
      return;
    }
    // Auto-load audio first if not yet loaded, then seek.
    if (selectedId) {
      loadAudio(selectedId).then(() => {
        setTimeout(apply, 200);
      });
    }
  }, [selectedId, loadAudio]);
  const seekRelative = (s: number) => {
    if (audioRef.current) audioRef.current.currentTime = Math.max(0, Math.min(audioDuration, audioRef.current.currentTime + s));
  };
  const changePlaybackSpeed = (s: number) => { setPlaybackSpeed(s); if (audioRef.current) audioRef.current.playbackRate = s; };
  
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60); const s = Math.floor(secs % 60);
    return `${m.toString().padStart(2,'0')}:${s.toString().padStart(2,'0')}`;
  };

  // Collapsible panel showing the original (raw) Whisper transcript with
  // word-level Mitlesen highlighting. Mirrors DictationQueue's compact panel.
  const renderOriginalTranscriptPanel = useCallback(() => {
    if (!showMitlesen || parsedSegments.length === 0) return null;
    return (
      <div
        ref={parsedSegmentsRef}
        className="bg-yellow-50 dark:bg-yellow-900/20 rounded-lg p-3 border border-yellow-200 dark:border-yellow-800"
      >
        <div
          className="text-sm font-medium flex items-center justify-between cursor-pointer select-none"
          onClick={() => setRawTranscriptCollapsed(!rawTranscriptCollapsed)}
        >
          <div className="flex items-center gap-2">
            <span className={`transform transition-transform ${rawTranscriptCollapsed ? '' : 'rotate-90'}`}>▶</span>
            <span>📖 Originaltranskript (Mitlesen)</span>
            <span className="text-xs text-gray-500">- Klicke auf ein Wort zum Springen</span>
          </div>
          <span className="text-xs text-gray-400">
            {rawTranscriptCollapsed ? '(eingeklappt)' : '(einklappen)'}
          </span>
        </div>
        {!rawTranscriptCollapsed && (
          <div className="text-sm leading-relaxed mt-2 overflow-auto max-h-48">
            {parsedSegments.map((segment, segIdx) => (
              <span key={segIdx}>
                {segment.words ? (
                  segment.words.map((word, wordIdx) => {
                    if (word.start === undefined || word.end === undefined) {
                      return <span key={`${segIdx}-${wordIdx}`}>{word.word}{' '}</span>;
                    }
                    const isCurrentWord = audioCurrentTime >= word.start && audioCurrentTime < word.end;
                    return (
                      <span
                        key={`${segIdx}-${wordIdx}`}
                        className={`cursor-pointer rounded px-0.5 transition-colors duration-100 ${
                          isCurrentWord
                            ? 'bg-yellow-300 dark:bg-yellow-600 font-medium'
                            : audioCurrentTime > word.end
                              ? 'text-gray-500 dark:text-gray-500'
                              : 'hover:bg-yellow-200 dark:hover:bg-yellow-700'
                        }`}
                        onClick={() => seekToWord(word.start)}
                        title={`${word.start.toFixed(1)}s - ${word.end.toFixed(1)}s`}
                      >
                        {word.word}{' '}
                      </span>
                    );
                  })
                ) : (
                  <span
                    className={`cursor-pointer rounded px-0.5 transition-colors duration-100 ${
                      audioCurrentTime >= segment.start && audioCurrentTime < segment.end
                        ? 'bg-yellow-300 dark:bg-yellow-600 font-medium'
                        : audioCurrentTime > segment.end
                          ? 'text-gray-500 dark:text-gray-500'
                          : 'hover:bg-yellow-200 dark:hover:bg-yellow-700'
                    }`}
                    onClick={() => seekToWord(segment.start)}
                  >
                    {segment.text}{' '}
                  </span>
                )}
              </span>
            ))}
          </div>
        )}
      </div>
    );
  }, [showMitlesen, parsedSegments, audioCurrentTime, rawTranscriptCollapsed]);

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
      
      {/* Detail View — always as fixed overlay (like Queue fullscreen) */}
      {selectedDictation && (
        <div className="fixed inset-4 z-50 card overflow-hidden">
          {/* Backdrop */}
          <div className="fixed inset-0 bg-black/50 -z-10" onClick={() => setSelectedId(null)} />
          <div className="card-body flex h-full min-h-0 flex-col gap-4 overflow-y-auto">
            {/* Header */}
            <div className="flex items-center justify-between shrink-0">
              <h4 className="font-medium">Diktat #{selectedDictation.order_number}</h4>
              <button className="text-gray-500 hover:text-gray-700 text-xl" onClick={() => setSelectedId(null)}>✕</button>
            </div>

            {/* Metadata */}
            <div className="text-sm grid grid-cols-2 md:grid-cols-3 gap-2 shrink-0">
              <div><span className="text-gray-500">Erstellt:</span> {formatDate(selectedDictation.created_at)}</div>
              {selectedDictation.completed_at && <div><span className="text-gray-500">Fertig:</span> {formatDate(selectedDictation.completed_at)}</div>}
              <div><span className="text-gray-500">Archiviert:</span> {selectedDictation.archived_at ? formatDate(selectedDictation.archived_at) : '-'}</div>
              <div><span className="text-gray-500">Von:</span> {selectedDictation.archived_by || '-'}</div>
              <div><span className="text-gray-500">Typ:</span> {selectedDictation.mode === 'befund' ? 'Befund' : 'Arztbrief'}</div>
              <div><span className="text-gray-500">Dauer:</span> {formatDuration(selectedDictation.audio_duration_seconds)}</div>
              {selectedDictation.change_score !== undefined && (
                <div className="flex items-center gap-1"><span className="text-gray-500">Score:</span><ChangeIndicator score={selectedDictation.change_score} size="sm" /></div>
              )}
            </div>

            {/* Audio Player Bar */}
            <div className="shrink-0 bg-gray-100 dark:bg-gray-800 rounded-lg p-3">
              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 mb-2">
                <span>🎵 Audio-Wiedergabe</span>
                {audioLoading && <Spinner size={14} />}
                {audioError && <span className="text-orange-500">{audioError}</span>}
              </div>

              {!audioUrl && !audioLoading && (
                <button className="btn btn-sm btn-outline" onClick={() => loadAudio(selectedDictation.id)}>
                  🔄 Audio laden
                </button>
              )}

              {audioUrl && (
                <>
                  <audio
                    ref={audioRef}
                    src={audioUrl}
                    onTimeUpdate={(e) => setAudioCurrentTime(e.currentTarget.currentTime)}
                    onLoadedMetadata={(e) => { setAudioDuration(e.currentTarget.duration); e.currentTarget.playbackRate = playbackSpeed; }}
                    onEnded={() => setIsPlaying(false)}
                    onPlay={() => setIsPlaying(true)}
                    onPause={() => setIsPlaying(false)}
                  />
                  <div className="flex items-center gap-2 flex-wrap">
                    <button className="btn btn-sm btn-outline" onClick={seekToStart} title="Zum Anfang">⏮️</button>
                    <button className="btn btn-sm btn-outline" onClick={() => seekRelative(-10)} title="10s zurück">⏪ 10</button>
                    <button className="btn btn-sm btn-primary" onClick={togglePlayPause} title={isPlaying ? 'Pause' : 'Abspielen'}>
                      {isPlaying ? '⏸️' : '▶️'}
                    </button>
                    <button className="btn btn-sm btn-outline" onClick={() => seekRelative(10)} title="10s vorwärts">10 ⏩</button>
                    <span className="text-sm font-mono text-gray-600 dark:text-gray-400 ml-2">{formatTime(audioCurrentTime)} / {formatTime(audioDuration)}</span>
                    <input type="range" min="0" max={audioDuration || 100} value={audioCurrentTime} onChange={(e) => { if (audioRef.current) audioRef.current.currentTime = parseFloat(e.target.value); }} className="flex-1 h-2 rounded-lg appearance-none cursor-pointer bg-gray-300 dark:bg-gray-600" />
                    <select value={playbackSpeed} onChange={(e) => changePlaybackSpeed(parseFloat(e.target.value))} className="select select-sm select-bordered text-xs w-16" title="Geschwindigkeit">
                      {SPEED_OPTIONS.map(s => <option key={s} value={s}>{s === 1 ? '1x' : `${s}x`}</option>)}
                    </select>
                  </div>
                </>
              )}

              {/* Mitlesen Toggle */}
              {audioUrl && (
                <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 flex items-center gap-2 flex-wrap">
                  {parsedSegments.length > 0 ? (
                    <button className={`btn btn-sm ${showMitlesen ? 'btn-primary' : 'btn-outline'}`} onClick={() => setShowMitlesen(!showMitlesen)} title="Originaltext mit Wortmarkierung beim Abspielen">
                      {showMitlesen ? '📖 Mitlesen aus' : '📖 Mitlesen an'}
                    </button>
                  ) : (
                    <span className="text-xs text-gray-400">ℹ️ Mitlesen nicht verfügbar (keine Wort-Zeitstempel)</span>
                  )}
                </div>
              )}
            </div>

            {/* Original transcript panel (Mitlesen) - shows raw transcription
                alongside the corrected text, like in the queue view */}
            {renderOriginalTranscriptPanel()}

            {/* EditableTextWithMitlesen — read-only with audio sync */}
            {detailData && (
              <div className="flex-1 min-h-0">
                {detailLoading ? (
                  <div className="flex items-center justify-center py-8"><Spinner size={20} /><span className="ml-2">Lade Details...</span></div>
                ) : (
                  <EditableTextWithMitlesen
                    key={selectedDictation.id}
                    text={detailData.corrected_text || detailData.transcript || ''}
                    originalText={formattedRawText || detailData.raw_transcript || ''}
                    savedText={detailData.corrected_text || detailData.transcript || ''}
                    originalSegments={parsedSegments}
                    audioCurrentTime={audioCurrentTime}
                    audioRef={audioRef}
                    showMitlesen={showMitlesen}
                    showDiff={showAllLayers}
                    disabled={true}
                    className="min-h-[40vh]"
                    dictionaryTargetUsername={selectedDictation.username}
                    onChange={() => {}}
                  />
                )}
              </div>
            )}

            {/* Befund mode fields (showAllLayers) */}
            {showAllLayers && selectedDictation.mode === 'befund' && detailData && (
              <div className="space-y-2">
                {detailData.methodik && (
                  <div><label className="text-xs font-medium text-gray-600 dark:text-gray-400">📋 Methodik</label>
                    <textarea className="mt-1 w-full p-2 rounded-lg text-sm border bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800 min-h-[80px]" value={detailData.methodik} readOnly />
                  </div>
                )}
                {detailData.befund && (
                  <div><label className="text-xs font-medium text-gray-600 dark:text-gray-400">📝 Befund</label>
                    <textarea className="mt-1 w-full p-2 rounded-lg text-sm border bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800 min-h-[80px]" value={detailData.befund} readOnly />
                  </div>
                )}
                {detailData.beurteilung && (
                  <div><label className="text-xs font-medium text-gray-600 dark:text-gray-400">💡 Beurteilung</label>
                    <textarea className="mt-1 w-full p-2 rounded-lg text-sm border bg-blue-50 dark:bg-blue-900/10 border-blue-200 dark:border-blue-800 min-h-[80px]" value={detailData.beurteilung} readOnly />
                  </div>
                )}
              </div>
            )}

            {/* Raw Transcript */}
            {showAllLayers && detailData?.raw_transcript && (
              <div><label className="text-xs font-medium text-gray-600 dark:text-gray-400">🎤 Rohe Transkription</label>
                <textarea className="mt-1 w-full p-2 rounded-lg text-sm font-mono border bg-orange-50 dark:bg-orange-900/10 border-orange-200 dark:border-orange-800 min-h-[80px]" value={detailData.raw_transcript} readOnly />
              </div>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-2 border-t flex-wrap">
              <button
                className={`btn btn-sm flex-1 ${copyFeedback === selectedDictation.id ? 'btn-success' : 'btn-primary'}`}
                onClick={() => handleCopy(selectedCorrectedText, selectedDictation.id)}
              >{copyFeedback === selectedDictation.id ? '✓ Kopiert!' : '📋 Kopieren'}</button>
              <button className="btn btn-sm btn-outline" onClick={() => setShowAllLayers(!showAllLayers)}>
                {showAllLayers ? '🔽 Details aus' : '🔼 Details an'}
              </button>
              <button className="btn btn-sm btn-outline" onClick={() => setShowCorrectionLog(true)}>📋 Protokoll</button>
              <button className="btn btn-sm btn-outline" onClick={() => handleUnarchive(selectedDictation.id)}>↩️ Wiederherstellen</button>
            </div>

            {detailData && (
              <TrainingMarker
                dictationId={detailData.id}
                segments={parsedSegments}
                defaultCorrectedText={detailData.corrected_text || detailData.transcript || ''}
                onSeek={seekToTime}
              />
            )}
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
