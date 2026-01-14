"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import Spinner from './Spinner';
import { fetchWithDbToken } from '@/lib/fetchWithDbToken';
import { useAuth } from './AuthProvider';
import { ChangeIndicator, ChangeIndicatorDot, ChangeWarningBanner } from './ChangeIndicator';
import { preprocessTranscription } from '@/lib/textFormatting';
import CustomActionButtons from './CustomActionButtons';
import CustomActionsManager from './CustomActionsManager';
import DiffHighlight, { DiffStats } from './DiffHighlight';
import CorrectionLogViewer from './CorrectionLogViewer';
import ArchiveView from './ArchiveView';
import EditableTextWithMitlesen from './EditableTextWithMitlesen';

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
  segments?: string; // JSON with word-level timestamps for highlighting
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

// Segment interface for word-level highlighting
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

interface DictationQueueProps {
  username: string;
  canViewAll?: boolean;
  isSecretariat?: boolean;
  onRefreshNeeded?: () => void;
}

// Word with timestamp for corrected text mapping
interface TimestampedWord {
  word: string;
  start: number;
  end: number;
  isInterpolated?: boolean; // True if timestamp was estimated
}

/**
 * Maps timestamps from original transcription to corrected text using word matching.
 * Unchanged words get their exact timestamps, changed words get interpolated timestamps.
 */
function mapTimestampsToCorrectedText(
  originalSegments: TranscriptSegment[],
  correctedText: string
): TimestampedWord[] {
  // Extract all words with timestamps from original segments
  const originalWords: { word: string; start: number; end: number }[] = [];
  for (const segment of originalSegments) {
    if (segment.words) {
      for (const word of segment.words) {
        if (word.start !== undefined && word.end !== undefined) {
          originalWords.push({
            word: word.word.toLowerCase().replace(/[.,!?;:"""„'']/g, ''),
            start: word.start,
            end: word.end
          });
        }
      }
    }
  }
  
  if (originalWords.length === 0) {
    return [];
  }
  
  // Split corrected text into words
  const correctedWords = correctedText.split(/\s+/).filter(w => w.length > 0);
  const result: TimestampedWord[] = [];
  
  // Use a greedy matching algorithm with lookahead
  let origIdx = 0;
  const audioDuration = originalWords.length > 0 
    ? originalWords[originalWords.length - 1].end 
    : 0;
  
  for (let corrIdx = 0; corrIdx < correctedWords.length; corrIdx++) {
    const corrWord = correctedWords[corrIdx];
    const corrWordNorm = corrWord.toLowerCase().replace(/[.,!?;:"""„'']/g, '');
    
    // Look for matching word in original (with some lookahead tolerance)
    let foundMatch = false;
    const maxLookahead = Math.min(5, originalWords.length - origIdx);
    
    for (let lookahead = 0; lookahead < maxLookahead; lookahead++) {
      const checkIdx = origIdx + lookahead;
      if (checkIdx < originalWords.length) {
        const origWord = originalWords[checkIdx];
        
        // Check for exact or fuzzy match
        if (origWord.word === corrWordNorm || 
            origWord.word.includes(corrWordNorm) || 
            corrWordNorm.includes(origWord.word)) {
          // Found a match - use exact timestamp
          result.push({
            word: corrWord,
            start: origWord.start,
            end: origWord.end,
            isInterpolated: false
          });
          origIdx = checkIdx + 1;
          foundMatch = true;
          break;
        }
      }
    }
    
    if (!foundMatch) {
      // No match found - interpolate timestamp
      // Use position between previous and next known timestamps
      const prevEnd = result.length > 0 ? result[result.length - 1].end : 0;
      const nextStart = origIdx < originalWords.length 
        ? originalWords[origIdx].start 
        : audioDuration;
      
      // Estimate duration based on word length
      const wordDuration = Math.min(0.3, (nextStart - prevEnd) * 0.5);
      
      result.push({
        word: corrWord,
        start: prevEnd,
        end: prevEnd + wordDuration,
        isInterpolated: true
      });
    }
  }
  
  return result;
}

/**
 * CorrectedTextMitlesen - Smart highlighting of corrected text during audio playback
 * Uses timestamp mapping from original transcription for precise word highlighting.
 */
function CorrectedTextMitlesen({ 
  correctedText, 
  originalSegments,
  audioCurrentTime, 
  audioDuration,
  audioRef
}: { 
  correctedText: string; 
  originalSegments: TranscriptSegment[];
  audioCurrentTime: number; 
  audioDuration: number;
  audioRef: React.RefObject<HTMLAudioElement | null>;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Map timestamps from original to corrected text
  const timestampedWords = useMemo(() => {
    return mapTimestampsToCorrectedText(originalSegments, correctedText);
  }, [originalSegments, correctedText]);
  
  // Find current word based on audio time
  const currentWordIndex = useMemo(() => {
    for (let i = 0; i < timestampedWords.length; i++) {
      const word = timestampedWords[i];
      if (audioCurrentTime >= word.start && audioCurrentTime < word.end) {
        return i;
      }
    }
    // If not in any word, find closest upcoming word
    for (let i = 0; i < timestampedWords.length; i++) {
      if (timestampedWords[i].start > audioCurrentTime) {
        return i - 1;
      }
    }
    return timestampedWords.length - 1;
  }, [timestampedWords, audioCurrentTime]);
  
  // Auto-scroll to current position
  useEffect(() => {
    if (!containerRef.current) return;
    const currentEl = containerRef.current.querySelector('.bg-green-300, .dark\\:bg-green-600');
    if (currentEl) {
      currentEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [currentWordIndex]);
  
  // Calculate match quality for display
  const matchQuality = useMemo(() => {
    if (timestampedWords.length === 0) return 0;
    const matched = timestampedWords.filter(w => !w.isInterpolated).length;
    return Math.round((matched / timestampedWords.length) * 100);
  }, [timestampedWords]);
  
  if (timestampedWords.length === 0) {
    // Fallback to proportional if no timestamps available
    const progress = audioDuration > 0 ? audioCurrentTime / audioDuration : 0;
    const words = correctedText.split(/(\s+)/);
    const actualWords = words.filter(w => w.trim().length > 0);
    const propCurrentIdx = Math.floor(progress * actualWords.length);
    let wordCounter = 0;
    
    return (
      <div 
        ref={containerRef}
        className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 max-h-40 overflow-y-auto"
      >
        <div className="text-xs text-green-600 dark:text-green-400 mb-2 font-medium flex items-center justify-between">
          <span>✨ Korrigierter Text (proportional)</span>
          <span className="text-green-500">{Math.round(progress * 100)}%</span>
        </div>
        <div className="text-sm leading-relaxed">
          {words.map((word, idx) => {
            if (word.trim().length === 0) return <span key={idx}>{word}</span>;
            const wIdx = wordCounter++;
            return (
              <span
                key={idx}
                className={`transition-colors duration-100 ${
                  wIdx === propCurrentIdx 
                    ? 'bg-green-300 dark:bg-green-600 font-semibold rounded px-0.5' 
                    : wIdx < propCurrentIdx ? 'text-gray-500' : ''
                }`}
              >
                {word}{' '}
              </span>
            );
          })}
        </div>
      </div>
    );
  }
  
  return (
    <div 
      ref={containerRef}
      className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 max-h-40 overflow-y-auto"
    >
      <div className="text-xs text-green-600 dark:text-green-400 mb-2 font-medium flex items-center justify-between">
        <span>✨ Korrigierter Text (Timestamp-Mapping: {matchQuality}% exakt)</span>
        <span className="text-green-500">{audioCurrentTime.toFixed(1)}s</span>
      </div>
      <div className="text-sm leading-relaxed">
        {timestampedWords.map((tw, idx) => {
          const isCurrent = idx === currentWordIndex;
          const isPast = audioCurrentTime > tw.end;
          
          return (
            <span
              key={idx}
              className={`transition-colors duration-100 ${
                isCurrent 
                  ? 'bg-green-300 dark:bg-green-600 font-semibold rounded px-0.5' 
                  : isPast 
                    ? 'text-gray-500 dark:text-gray-500' 
                    : ''
              } ${tw.isInterpolated ? 'italic' : ''}`}
              onClick={() => {
                if (audioRef.current) {
                  audioRef.current.currentTime = tw.start;
                }
              }}
              style={{ cursor: 'pointer' }}
              title={`${tw.start.toFixed(1)}s - ${tw.end.toFixed(1)}s${tw.isInterpolated ? ' (geschätzt)' : ''}`}
            >
              {tw.word}{' '}
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default function DictationQueue({ username, canViewAll = false, isSecretariat = false, onRefreshNeeded }: DictationQueueProps) {
  const { getAuthHeader } = useAuth();
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
  
  // View toggle: queue or archive
  const [currentView, setCurrentView] = useState<'queue' | 'archive'>('queue');
  
  // Dictionary entry form state (for secretariat)
  const [showDictForm, setShowDictForm] = useState(false);
  const [dictWrong, setDictWrong] = useState('');
  const [dictCorrect, setDictCorrect] = useState('');
  const [dictFeedback, setDictFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  
  // Revert/Re-Correct state
  const [isReverted, setIsReverted] = useState(false);
  const [isReCorrecting, setIsReCorrecting] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [applyFormatting, setApplyFormatting] = useState(false); // Formatierung auf unkorrigierten Text anwenden
  
  // Diff view state - show differences between formatted raw and LLM corrected
  const [showDiffView, setShowDiffView] = useState(false);
  const [formattedRawText, setFormattedRawText] = useState<string>(''); // raw_transcript after textFormatting
  
  // Editable text state for completed dictations
  const [editedTexts, setEditedTexts] = useState<{
    methodik: string;
    befund: string;
    beurteilung: string;
    corrected_text: string;
  }>({ methodik: '', befund: '', beurteilung: '', corrected_text: '' });
  
  // Track last saved text to detect manual changes
  const [savedText, setSavedText] = useState<string>('');
  
  // Fullscreen mode for better readability of long texts
  const [isFullscreen, setIsFullscreen] = useState(false);
  
  // Custom Actions Manager modal
  const [showCustomActionsManager, setShowCustomActionsManager] = useState(false);
  
  // Correction Log Viewer modal
  const [showCorrectionLog, setShowCorrectionLog] = useState(false);
  
  // Text selection for dictionary feature
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  
  // Audio player state for fullscreen mode
  const audioRef = useRef<HTMLAudioElement>(null);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioLoading, setAudioLoading] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  
  // "Mitlesen" mode - show original transcript with word highlighting
  const [showMitlesen, setShowMitlesen] = useState(false);
  const [parsedSegments, setParsedSegments] = useState<TranscriptSegment[]>([]);
  const mitlesenRef = useRef<HTMLDivElement>(null);
  
  // Playback speed control
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];

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

  // Load audio for fullscreen playback
  const loadAudio = useCallback(async (id: number) => {
    setAudioLoading(true);
    setAudioError(null);
    
    // Clean up previous audio URL
    if (audioUrl) {
      URL.revokeObjectURL(audioUrl);
      setAudioUrl(null);
    }
    
    try {
      const res = await fetchWithDbToken(`/api/offline-dictations?id=${id}&audio=true`);
      if (!res.ok) {
        if (res.status === 404) {
          setAudioError('Audio nicht mehr verfügbar');
        } else {
          setAudioError('Fehler beim Laden');
        }
        return;
      }
      
      const blob = await res.blob();
      if (blob.size === 0) {
        setAudioError('Audio wurde gelöscht');
        return;
      }
      
      const url = URL.createObjectURL(blob);
      setAudioUrl(url);
    } catch (err) {
      setAudioError('Fehler beim Laden');
    } finally {
      setAudioLoading(false);
    }
  }, [audioUrl]);
  
  // Audio control functions
  const togglePlayPause = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  };
  
  const seekToStart = () => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = 0;
  };
  
  const seekRelative = (seconds: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = Math.max(0, Math.min(audioDuration, audioRef.current.currentTime + seconds));
  };
  
  // Change playback speed (preservesPitch is default true in modern browsers)
  const changePlaybackSpeed = (speed: number) => {
    setPlaybackSpeed(speed);
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  };
  
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };
  
  // Download audio file
  const downloadAudio = () => {
    if (!audioUrl || !selectedDictation) return;
    const link = document.createElement('a');
    link.href = audioUrl;
    // Use dictation ID and timestamp for filename
    const date = new Date(selectedDictation.created_at).toISOString().split('T')[0];
    link.download = `diktat_${selectedDictation.id}_${date}.webm`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  
  // Auto-scroll to current word in Mitlesen panel
  useEffect(() => {
    if (!showMitlesen || !mitlesenRef.current || !isPlaying) return;
    
    const currentWordEl = mitlesenRef.current.querySelector('.bg-yellow-300, .dark\\:bg-yellow-600');
    if (currentWordEl) {
      currentWordEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [audioCurrentTime, showMitlesen, isPlaying]);
  
  // Load audio when entering fullscreen
  useEffect(() => {
    if (isFullscreen && selectedId) {
      loadAudio(selectedId);
    } else {
      // Clean up audio when leaving fullscreen
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
        setAudioUrl(null);
      }
      setIsPlaying(false);
      setAudioCurrentTime(0);
      setAudioError(null);
    }
  }, [isFullscreen, selectedId]);
  
  // Handle Escape key to exit fullscreen
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isFullscreen) {
        setIsFullscreen(false);
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);
  
  // Clean up audio URL on unmount
  useEffect(() => {
    return () => {
      if (audioUrl) {
        URL.revokeObjectURL(audioUrl);
      }
    };
  }, [audioUrl]);

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

  // Archive dictation
  const handleArchive = async (id: number) => {
    if (!confirm('Diktat archivieren? Es wird aus der Warteschlange entfernt und ist dann nur noch im Archiv sichtbar.')) return;
    
    try {
      await fetchWithDbToken('/api/archive', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, archivedBy: username })
      });
      loadDictations();
      if (selectedId === id) setSelectedId(null);
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

  // Identifier für PowerShell Clipboard-Listener (RadCentre Integration)
  const CLIPBOARD_IDENTIFIER = '##RAD##';

  // Copy text to clipboard
  const handleCopy = async (text: string, id: number) => {
    await navigator.clipboard.writeText(CLIPBOARD_IDENTIFIER + text);
    setCopyFeedback(id);
    setTimeout(() => setCopyFeedback(null), 1500);
  };

  // Open dictionary form and pre-fill with selected text if any
  const handleOpenDictForm = () => {
    // Get selected text from textarea
    const textarea = textareaRef.current;
    if (textarea) {
      const selectedText = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd).trim();
      if (selectedText) {
        setDictWrong(selectedText);
      }
    }
    setShowDictForm(true);
  };

  // Add word to user's dictionary (for secretariat or own dictations)
  const handleAddToDictionary = async (targetUsername: string) => {
    if (!dictWrong.trim() || !dictCorrect.trim()) {
      setDictFeedback({ type: 'error', message: 'Beide Felder müssen ausgefüllt sein' });
      return;
    }
    
    try {
      const res = await fetchWithDbToken('/api/dictionary', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': getAuthHeader(),
        },
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
    setApplyFormatting(false); // Reset Formatierungs-Toggle
  }, [selectedId, dictations]);

  // Formatierung auf den unkorrigierten Text anwenden/entfernen
  const handleApplyFormattingToggle = useCallback((apply: boolean) => {
    const selected = dictations.find(d => d.id === selectedId);
    if (!selected?.raw_transcript) return;
    
    setApplyFormatting(apply);
    
    if (apply) {
      // Formatierung anwenden
      setEditedTexts(prev => ({
        ...prev,
        corrected_text: preprocessTranscription(selected.raw_transcript || '')
      }));
    } else {
      // Zurück zum Original (ohne Formatierung)
      setEditedTexts(prev => ({
        ...prev,
        corrected_text: selected.raw_transcript || ''
      }));
    }
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
        setHasUnsavedChanges(true);
      } else {
        throw new Error('Korrektur fehlgeschlagen');
      }
    } catch (err: any) {
      setError(err.message || 'Fehler bei erneuter Korrektur');
    } finally {
      setIsReCorrecting(false);
    }
  }, [selectedId, dictations, editedTexts.corrected_text]);

  // Save corrected text to database
  const handleSave = useCallback(async () => {
    const selected = dictations.find(d => d.id === selectedId);
    if (!selected) return;
    
    try {
      const res = await fetchWithDbToken(`/api/offline-dictations?username=${encodeURIComponent(username)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          id: selected.id,
          action: 'save',
          correctedText: editedTexts.corrected_text,
        }),
      });
      
      if (res.ok) {
        setHasUnsavedChanges(false);
        setSavedText(editedTexts.corrected_text); // Update saved state after successful save
        // Reload to get updated data
        loadDictations();
      } else {
        throw new Error('Speichern fehlgeschlagen');
      }
    } catch (err: any) {
      setError(err.message || 'Fehler beim Speichern');
    }
  }, [selectedId, dictations, editedTexts.corrected_text, loadDictations, username]);

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
      const initialText = selected.corrected_text || selected.transcript || '';
      setEditedTexts({
        methodik: selected.methodik || '',
        befund: selected.befund || '',
        beurteilung: selected.beurteilung || '',
        corrected_text: initialText
      });
      setSavedText(initialText); // Track the initial/saved state
      setIsReverted(false); // Reset revert state when selection changes
      setApplyFormatting(false); // Reset formatting toggle when selection changes
      setHasUnsavedChanges(false); // Reset unsaved changes when selection changes
      setShowMitlesen(false); // Reset Mitlesen mode when selection changes
      setShowDiffView(false); // Reset diff view when selection changes
      
      // Calculate formatted raw text for diff comparison
      if (selected.raw_transcript) {
        const formatted = preprocessTranscription(selected.raw_transcript);
        setFormattedRawText(formatted);
      } else {
        setFormattedRawText('');
      }
      
      // Parse segments for word-level highlighting
      if (selected.segments) {
        try {
          const segments = JSON.parse(selected.segments);
          if (Array.isArray(segments)) {
            setParsedSegments(segments);
          } else {
            setParsedSegments([]);
          }
        } catch (e) {
          console.warn('Could not parse segments:', e);
          setParsedSegments([]);
        }
      } else {
        setParsedSegments([]);
      }
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
      {/* View Toggle Tabs */}
      <div className="card">
        <div className="card-body py-2">
          <div className="flex gap-2">
            <button
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                currentView === 'queue'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
              onClick={() => setCurrentView('queue')}
            >
              📋 Warteschlange
            </button>
            <button
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                currentView === 'archive'
                  ? 'bg-blue-500 text-white'
                  : 'bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700'
              }`}
              onClick={() => setCurrentView('archive')}
            >
              📦 Archiv
            </button>
          </div>
        </div>
      </div>
      
      {/* Conditional View Rendering */}
      {currentView === 'archive' ? (
        <ArchiveView username={username} canViewAll={canViewAll} />
      ) : (
        <>
      {/* Header with stats */}
      <div className="card">
        <div className="card-body py-3 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <h3 className="font-medium">Diktat-Warteschlange</h3>
              <div className="flex gap-2 text-sm">{pendingCount > 0 && (
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
                onClick={() => {
                  setSelectedId(d.id);
                  // Bei fertigen Diktaten direkt Vollbild öffnen
                  if (d.status === 'completed') {
                    setIsFullscreen(true);
                  }
                }}
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

                {/* Audio Player - only in fullscreen mode */}
                {isFullscreen && selectedDictation.status === 'completed' && (
                  <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-3">
                    <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 mb-2">
                      <span>🎵 Audio-Wiedergabe</span>
                      {audioLoading && <Spinner size={14} />}
                      {audioError && <span className="text-orange-500">{audioError}</span>}
                    </div>
                    
                    {audioUrl && (
                      <>
                        <audio
                          ref={audioRef}
                          src={audioUrl}
                          onTimeUpdate={(e) => setAudioCurrentTime(e.currentTarget.currentTime)}
                          onLoadedMetadata={(e) => {
                            setAudioDuration(e.currentTarget.duration);
                            e.currentTarget.playbackRate = playbackSpeed;
                          }}
                          onEnded={() => setIsPlaying(false)}
                          onPlay={() => setIsPlaying(true)}
                          onPause={() => setIsPlaying(false)}
                        />
                        
                        <div className="flex items-center gap-2">
                          {/* Skip to start */}
                          <button
                            className="btn btn-sm btn-outline"
                            onClick={seekToStart}
                            title="Zum Anfang"
                          >
                            ⏮️
                          </button>
                          
                          {/* Rewind 10s */}
                          <button
                            className="btn btn-sm btn-outline"
                            onClick={() => seekRelative(-10)}
                            title="10s zurück"
                          >
                            ⏪ 10
                          </button>
                          
                          {/* Play/Pause */}
                          <button
                            className="btn btn-sm btn-primary"
                            onClick={togglePlayPause}
                            title={isPlaying ? 'Pause' : 'Abspielen'}
                          >
                            {isPlaying ? '⏸️' : '▶️'}
                          </button>
                          
                          {/* Forward 10s */}
                          <button
                            className="btn btn-sm btn-outline"
                            onClick={() => seekRelative(10)}
                            title="10s vorwärts"
                          >
                            10 ⏩
                          </button>
                          
                          {/* Time display */}
                          <span className="text-sm font-mono text-gray-600 dark:text-gray-400 ml-2">
                            {formatTime(audioCurrentTime)} / {formatTime(audioDuration)}
                          </span>
                          
                          {/* Progress bar */}
                          <input
                            type="range"
                            min="0"
                            max={audioDuration || 100}
                            value={audioCurrentTime}
                            onChange={(e) => {
                              if (audioRef.current) {
                                audioRef.current.currentTime = parseFloat(e.target.value);
                              }
                            }}
                            className="flex-1 h-2 rounded-lg appearance-none cursor-pointer bg-gray-300 dark:bg-gray-600"
                          />
                          
                          {/* Download button */}
                          <button
                            className="btn btn-sm btn-outline ml-2"
                            onClick={downloadAudio}
                            title="Audio herunterladen"
                          >
                            ⬇️
                          </button>
                          
                          {/* Speed control */}
                          <div className="flex items-center gap-1 ml-2">
                            <span className="text-xs text-gray-500 dark:text-gray-400">🏃</span>
                            <select
                              value={playbackSpeed}
                              onChange={(e) => changePlaybackSpeed(parseFloat(e.target.value))}
                              className="select select-sm select-bordered text-xs w-20"
                              title="Wiedergabegeschwindigkeit"
                            >
                              {SPEED_OPTIONS.map(speed => (
                                <option key={speed} value={speed}>
                                  {speed === 1 ? '1x' : `${speed}x`}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </>
                    )}
                    
                    {!audioUrl && !audioLoading && !audioError && (
                      <button
                        className="btn btn-sm btn-outline"
                        onClick={() => loadAudio(selectedDictation.id)}
                      >
                        🔄 Audio laden
                      </button>
                    )}
                    
                    {/* Mitlesen toggle button - show even without segments for info */}
                    {audioUrl && (
                      <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                        {parsedSegments.length > 0 ? (
                          <>
                            <button
                              className={`btn btn-sm ${showMitlesen ? 'btn-primary' : 'btn-outline'}`}
                              onClick={() => setShowMitlesen(!showMitlesen)}
                              title="Zeigt die originale Transkription mit Wort-Highlighting während der Wiedergabe"
                            >
                              {showMitlesen ? '📖 Mitlesen aus' : '📖 Mitlesen an'}
                            </button>
                            {showMitlesen && (
                              <span className="ml-2 text-xs text-gray-500">
                                Original + korrigierter Text synchron
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-xs text-gray-400">
                            📖 Mitlesen nicht verfügbar (Diktat wurde vor dem Update erstellt)
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
                
                {/* Mitlesen Panel - Word-level highlighting of original transcription */}
                {isFullscreen && showMitlesen && parsedSegments.length > 0 && (
                  <div className="space-y-3">
                    {/* Original Transcription with word-level timestamps */}
                    <div 
                      ref={mitlesenRef}
                      className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 max-h-40 overflow-y-auto"
                    >
                      <div className="text-xs text-blue-600 dark:text-blue-400 mb-2 font-medium">
                        📖 Original Whisper-Transkription
                      </div>
                      <div className="text-sm leading-relaxed">
                        {parsedSegments.map((segment, segIdx) => (
                          <span key={segIdx}>
                            {segment.words ? (
                              // Word-level highlighting
                              segment.words.map((word, wordIdx) => {
                                // Skip words without valid timestamps
                                if (word.start === undefined || word.end === undefined) {
                                  return <span key={`${segIdx}-${wordIdx}`}>{word.word}{' '}</span>;
                                }
                                const isCurrentWord = audioCurrentTime >= word.start && audioCurrentTime < word.end;
                                return (
                                  <span
                                    key={`${segIdx}-${wordIdx}`}
                                    className={`transition-colors duration-100 ${
                                      isCurrentWord 
                                        ? 'bg-yellow-300 dark:bg-yellow-600 font-semibold rounded px-0.5' 
                                        : audioCurrentTime > word.end 
                                          ? 'text-gray-500 dark:text-gray-500' 
                                          : ''
                                    }`}
                                    onClick={() => {
                                      if (audioRef.current) {
                                        audioRef.current.currentTime = word.start;
                                      }
                                    }}
                                    style={{ cursor: 'pointer' }}
                                    title={`${word.start.toFixed(1)}s - ${word.end.toFixed(1)}s`}
                                  >
                                    {word.word}{' '}
                                  </span>
                                );
                              })
                            ) : (
                              // Segment-level highlighting (fallback if no words)
                              segment.start !== undefined && segment.end !== undefined ? (
                                <span
                                  className={`transition-colors duration-100 ${
                                    audioCurrentTime >= segment.start && audioCurrentTime < segment.end
                                      ? 'bg-yellow-300 dark:bg-yellow-600 font-semibold rounded px-0.5'
                                      : audioCurrentTime > segment.end
                                        ? 'text-gray-500 dark:text-gray-500'
                                        : ''
                                  }`}
                                  onClick={() => {
                                    if (audioRef.current) {
                                      audioRef.current.currentTime = segment.start;
                                    }
                                  }}
                                  style={{ cursor: 'pointer' }}
                                >
                                  {segment.text}{' '}
                                </span>
                              ) : (
                                <span>{segment.text}{' '}</span>
                              )
                            )}
                          </span>
                        ))}
                      </div>
                    </div>
                    
                    {/* Corrected Text with smart timestamp mapping - now integrated in EditableTextWithMitlesen below */}
                  </div>
                )}

                {/* Change score warning banner */}
                {selectedDictation.status === 'completed' && !isReverted && (
                  <ChangeWarningBanner score={selectedDictation.change_score} />
                )}

                {/* Results - always Arztbrief mode */}
                {selectedDictation.status === 'completed' && (
                  <div className="space-y-3">
                    {/* Header with labels and buttons */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <label className="text-xs font-medium text-gray-500">
                          {isReverted ? 'Reine Transkription (vor Korrektur)' : 'Korrigiertes Ergebnis'}
                        </label>
                        {!isReverted && selectedDictation.change_score !== undefined && (
                          <ChangeIndicator score={selectedDictation.change_score} size="sm" />
                        )}
                        {/* Diff View Toggle */}
                        {!isReverted && formattedRawText && (
                          <button
                            className={`btn btn-xs ${showDiffView ? 'btn-primary' : 'btn-outline'}`}
                            onClick={() => setShowDiffView(!showDiffView)}
                            title="Zeigt Unterschiede farbig an (grün=KI-Änderung, blau=manuell)"
                          >
                            {showDiffView ? '🔍 Diff aus' : '🔍 Diff an'}
                          </button>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {isReverted && (
                          <span className="text-xs text-orange-600 dark:text-orange-400">⚠️ Unkorrigiert</span>
                        )}
                        <button
                          className="btn btn-xs btn-ghost"
                          onClick={() => setIsFullscreen(!isFullscreen)}
                          title={isFullscreen ? 'Vollbild beenden (Esc)' : 'Vollbild anzeigen'}
                        >
                          {isFullscreen ? '🗗 Verkleinern' : '🗖 Vollbild'}
                        </button>
                      </div>
                    </div>
                    
                    {/* EditableTextWithMitlesen - single panel with Mitlesen, Diff, and editing */}
                    <div className="flex gap-2">
                      <div className="flex-1">
                        <EditableTextWithMitlesen
                          text={editedTexts.corrected_text}
                          originalText={formattedRawText}
                          savedText={savedText}
                          originalSegments={parsedSegments}
                          audioCurrentTime={audioCurrentTime}
                          audioRef={audioRef}
                          showMitlesen={showMitlesen}
                          showDiff={showDiffView}
                          onChange={(newText) => {
                            setEditedTexts(prev => ({ ...prev, corrected_text: newText }));
                            setHasUnsavedChanges(true);
                          }}
                          className={`${isFullscreen ? 'min-h-[60vh]' : 'min-h-[200px]'} ${
                            isReverted 
                              ? 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800' 
                              : ''
                          }`}
                        />
                      </div>
                      
                      {/* Custom Action Buttons - right side */}
                      {isFullscreen && (
                        <div className="w-28 flex-shrink-0">
                          <div className="sticky top-4">
                            <CustomActionButtons
                              currentField="transcript"
                              getText={() => editedTexts.corrected_text}
                              onResult={(result) => {
                                setEditedTexts(prev => ({ ...prev, corrected_text: result }));
                                setHasUnsavedChanges(true);
                              }}
                              disabled={isReCorrecting}
                              onManageClick={() => setShowCustomActionsManager(true)}
                            />
                          </div>
                        </div>
                      )}
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
                        {isReverted && (
                          <label 
                            className="flex items-center gap-1.5 text-xs cursor-pointer select-none px-2 py-1 rounded border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800"
                            title="Sprachbefehle wie 'Punkt eins', 'Nächster Punkt', 'Absatz' anwenden"
                          >
                            <input
                              type="checkbox"
                              checked={applyFormatting}
                              onChange={(e) => handleApplyFormattingToggle(e.target.checked)}
                              className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                            />
                            <span className="text-gray-600 dark:text-gray-400">Formatierung</span>
                          </label>
                        )}
                      </div>
                    )}
                    
                    {/* Diff legend when active */}
                    {showDiffView && !isReverted && (
                      <p className="text-xs text-gray-400 italic">
                        💡 Legende: <span className="text-green-600">grün</span> = KI-Korrektur, <span className="text-blue-600">blau</span> = manuelle Änderung, <span className="bg-yellow-200 text-gray-800 px-1 rounded">gelb</span> = aktuelles Wort (Mitlesen)
                      </p>
                    )}
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
                      {hasUnsavedChanges && (
                        <button
                          className="btn btn-sm btn-warning"
                          onClick={handleSave}
                          title="Änderungen speichern"
                        >
                          💾 Speichern
                        </button>
                      )}
                      <button
                        className="btn btn-sm btn-outline"
                        onClick={() => setShowCorrectionLog(true)}
                        title="Korrekturprotokoll anzeigen"
                      >
                        📋 Protokoll
                      </button>
                      <button
                        className="btn btn-sm btn-outline"
                        onClick={() => handleArchive(selectedDictation.id)}
                        title="Diktat archivieren"
                      >
                        📦 Archivieren
                      </button>
                      {isSecretariat && (
                        <button
                          className="btn btn-sm btn-outline"
                          onClick={() => handleDelete(selectedDictation.id, true)}
                          title="Audio löschen, Text behalten"
                        >
                          🎵✕
                        </button>
                      )}
                      {/* Dictionary button: visible for secretariat (all dictations) or regular users (own dictations) */}
                      {(isSecretariat || selectedDictation.username === username) && (
                        <button
                          className="btn btn-sm btn-outline"
                          onClick={() => showDictForm ? setShowDictForm(false) : handleOpenDictForm()}
                          title={isSecretariat && selectedDictation.username !== username 
                            ? `Wort zu ${selectedDictation.username}s Wörterbuch hinzufügen (Text markieren!)`
                            : "Wort zu meinem Wörterbuch hinzufügen (Text markieren!)"
                          }
                        >
                          📖+
                        </button>
                      )}
                    </>
                  )}
                  
                  {selectedDictation.status === 'error' && (
                    <button
                      className="btn btn-sm btn-outline flex-1"
                      onClick={async () => {
                        try {
                          // Download with extract=true to get raw payload without WAV headers
                          const res = await fetchWithDbToken(`/api/offline-dictations?id=${selectedDictation.id}&audio=true&extract=true`);
                          if (!res.ok) {
                            alert('Audio nicht verfügbar');
                            return;
                          }
                          const blob = await res.blob();
                          const url = URL.createObjectURL(blob);
                          const a = document.createElement('a');
                          a.href = url;
                          a.download = `dictation_${selectedDictation.id}_${selectedDictation.order_number}_payload.bin`;
                          document.body.appendChild(a);
                          a.click();
                          document.body.removeChild(a);
                          URL.revokeObjectURL(url);
                        } catch (err) {
                          alert('Fehler beim Herunterladen');
                        }
                      }}
                    >
                      ⬇️ Payload herunterladen
                    </button>
                  )}
                  
                  <button
                    className="btn btn-sm btn-outline text-red-600"
                    onClick={() => handleDelete(selectedDictation.id)}
                  >
                    🗑️ Löschen
                  </button>
                </div>
                
                {/* Dictionary Entry Form (for secretariat or own dictations) */}
                {(isSecretariat || selectedDictation.username === username) && showDictForm && selectedDictation.status === 'completed' && (
                  <div className="mt-3 p-3 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
                    <h4 className="text-sm font-medium mb-2">
                      📖 Wörterbuch-Eintrag {isSecretariat && selectedDictation.username !== username 
                        ? <>für <span className="text-purple-600 dark:text-purple-400">{selectedDictation.username}</span></>
                        : <>(mein Wörterbuch)</>}
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
      </>
      )}
      
      {/* Custom Actions Manager Modal */}
      {showCustomActionsManager && (
        <CustomActionsManager onClose={() => setShowCustomActionsManager(false)} />
      )}
      
      {/* Correction Log Viewer Modal */}
      {showCorrectionLog && selectedId && (
        <CorrectionLogViewer
          dictationId={selectedId}
          onClose={() => setShowCorrectionLog(false)}
        />
      )}
    </div>
  );
}
