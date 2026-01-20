"use client";
import { useRef, useState, useCallback, useEffect } from 'react';
import Spinner from './Spinner';

interface OfflineRecorderProps {
  username: string;
  onSubmit: (data: {
    audioBlob: Blob;
    duration: number;
    orderNumber: string;
    patientName?: string;
    patientDob?: string;
    priority: 'normal' | 'urgent' | 'stat';
    mode: 'befund' | 'arztbrief';
    bemerkung?: string;
    termin?: string;
    fachabteilung?: string;
    berechtigte?: string[];
  }) => Promise<void>;
  onCancel?: () => void;
  availableUsers?: string[]; // Liste der verfügbaren Benutzer für Berechtigte
  availableDepartments?: string[]; // Liste der verfügbaren Fachabteilungen
}

// Erlaubte Audio-Formate
const ALLOWED_AUDIO_TYPES = [
  'audio/mpeg',      // MP3
  'audio/mp3',       // MP3 alternative
  'audio/wav',       // WAV
  'audio/wave',      // WAV alternative
  'audio/x-wav',     // WAV alternative
  'audio/aiff',      // AIFF
  'audio/x-aiff',    // AIFF alternative
  'audio/webm',      // WebM (für Konsistenz mit Aufnahmen)
  'audio/ogg',       // OGG
  'audio/opus',      // Opus
  'audio/mp4',       // M4A
  'audio/x-m4a',     // M4A alternative
];

// Accept all common audio extensions - server can handle various codecs
const ALLOWED_EXTENSIONS = '.mp3,.wav,.aiff,.aif,.webm,.ogg,.opus,.m4a';

export default function OfflineRecorder({ username, onSubmit, onCancel, availableUsers = [], availableDepartments = [] }: OfflineRecorderProps) {
  // Recording state
  const [isRecording, setIsRecording] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [duration, setDuration] = useState(0);
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [isUploadedFile, setIsUploadedFile] = useState(false); // Track if audio is from upload
  const [audioSource, setAudioSource] = useState<'microphone' | 'system'>('microphone'); // Audio source selection
  
  // Form state
  const [orderNumber, setOrderNumber] = useState('');
  const [patientName, setPatientName] = useState('');
  const [patientDob, setPatientDob] = useState('');
  const [priority, setPriority] = useState<'normal' | 'urgent' | 'stat'>('normal');
  const [mode] = useState<'befund' | 'arztbrief'>('arztbrief'); // Immer Arztbrief-Modus
  const [bemerkung, setBemerkung] = useState('');
  const [termin, setTermin] = useState('');
  const [fachabteilung, setFachabteilung] = useState('');
  const [berechtigte, setBerechtigte] = useState<string[]>([]);
  
  // UI state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [audioLevel, setAudioLevel] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [undoMessage, setUndoMessage] = useState<string | null>(null);
  const [uploadFileName, setUploadFileName] = useState<string | null>(null);
  const [playbackSpeed, setPlaybackSpeed] = useState(1.0);
  
  // Playback speed options
  const SPEED_OPTIONS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0];
  
  // Refs
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const deletedChunksRef = useRef<Blob[]>([]); // For redo functionality
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      stopRecording(true);
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, []);

  // Update audio level visualization
  const updateAudioLevel = useCallback(() => {
    if (!analyserRef.current) return;
    
    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteFrequencyData(dataArray);
    const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
    setAudioLevel(Math.min(100, (average / 128) * 100));
    
    animationFrameRef.current = requestAnimationFrame(updateAudioLevel);
  }, []);

  // Start recording
  const startRecording = async () => {
    setError(null);
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      
      // Setup audio visualization
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      const microphone = audioContext.createMediaStreamSource(stream);
      analyser.fftSize = 256;
      microphone.connect(analyser);
      
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      updateAudioLevel();
      
      // Setup MediaRecorder
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      chunksRef.current = [];
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };
      
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        
        stream.getTracks().forEach(t => t.stop());
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        if (audioContextRef.current) audioContextRef.current.close();
        setAudioLevel(0);
      };
      
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(1000);
      setIsRecording(true);
      setIsPaused(false);
      setDuration(0);
      
      // Start timer
      timerRef.current = setInterval(() => {
        setDuration(d => d + 1);
      }, 1000);
      
    } catch (err: any) {
      setError(`Mikrofon-Zugriff fehlgeschlagen: ${err.message}`);
    }
  };

  // Start recording from system audio (tab/screen)
  const startSystemAudioRecording = async () => {
    setError(null);
    
    try {
      // Request display media with audio
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true, // Required by browser, but we only use audio
        audio: true  // System audio from tab/screen
      });
      
      // Check if audio track is present
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        stream.getTracks().forEach(t => t.stop());
        setError('Kein Audio ausgewählt. Bitte wählen Sie einen Tab und aktivieren Sie "Tab-Audio teilen".');
        return;
      }
      
      // Stop video track - we only need audio
      stream.getVideoTracks().forEach(t => t.stop());
      
      // Create audio-only stream
      const audioStream = new MediaStream(audioTracks);
      streamRef.current = audioStream;
      
      // Setup audio visualization
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      const analyser = audioContext.createAnalyser();
      const source = audioContext.createMediaStreamSource(audioStream);
      analyser.fftSize = 256;
      source.connect(analyser);
      
      audioContextRef.current = audioContext;
      analyserRef.current = analyser;
      updateAudioLevel();
      
      // Setup MediaRecorder
      const mediaRecorder = new MediaRecorder(audioStream, { mimeType: 'audio/webm' });
      chunksRef.current = [];
      
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };
      
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        setAudioBlob(blob);
        const url = URL.createObjectURL(blob);
        setAudioUrl(url);
        
        audioStream.getTracks().forEach(t => t.stop());
        if (animationFrameRef.current) cancelAnimationFrame(animationFrameRef.current);
        if (audioContextRef.current) audioContextRef.current.close();
        setAudioLevel(0);
      };
      
      // Handle when user stops sharing
      audioTracks[0].onended = () => {
        stopRecording();
      };
      
      mediaRecorderRef.current = mediaRecorder;
      mediaRecorder.start(1000);
      setIsRecording(true);
      setIsPaused(false);
      setDuration(0);
      setAudioSource('system');
      
      // Start timer
      timerRef.current = setInterval(() => {
        setDuration(d => d + 1);
      }, 1000);
      
    } catch (err: any) {
      if (err.name === 'NotAllowedError') {
        setError('Bildschirmfreigabe abgebrochen.');
      } else {
        setError(`System-Audio Zugriff fehlgeschlagen: ${err.message}`);
      }
    }
  };

  // Stop recording
  const stopRecording = (cleanup = false) => {
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    
    if (audioContextRef.current) {
      audioContextRef.current.close();
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
    }
    
    if (!cleanup) {
      setIsRecording(false);
      setIsPaused(false);
    }
  };

  // Pause/Resume recording
  const togglePause = () => {
    if (!mediaRecorderRef.current) return;
    
    if (isPaused) {
      mediaRecorderRef.current.resume();
      timerRef.current = setInterval(() => {
        setDuration(d => d + 1);
      }, 1000);
      setIsPaused(false);
    } else {
      mediaRecorderRef.current.pause();
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
      setIsPaused(true);
    }
  };

  // Rewind - delete last few seconds of recording (during pause)
  const rewindRecording = (seconds: number = 5) => {
    if (!isPaused || chunksRef.current.length === 0) return;
    
    // Each chunk is ~1 second (from start(1000))
    const chunksToRemove = Math.min(seconds, chunksRef.current.length);
    
    // Save removed chunks for redo
    const removedChunks = chunksRef.current.splice(-chunksToRemove);
    deletedChunksRef.current = [...removedChunks, ...deletedChunksRef.current];
    
    // Update duration
    setDuration(d => Math.max(0, d - chunksToRemove));
    
    setUndoMessage(`${chunksToRemove}s gelöscht`);
    setTimeout(() => setUndoMessage(null), 2000);
  };

  // Redo - restore deleted chunks
  const redoRecording = () => {
    if (deletedChunksRef.current.length === 0) return;
    
    // Restore up to 5 seconds
    const chunksToRestore = deletedChunksRef.current.splice(0, 5);
    chunksRef.current.push(...chunksToRestore);
    
    // Update duration
    setDuration(d => d + chunksToRestore.length);
    
    setUndoMessage(`${chunksToRestore.length}s wiederhergestellt`);
    setTimeout(() => setUndoMessage(null), 2000);
  };

  // Delete recording and reset
  const deleteRecording = () => {
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(null);
    setAudioBlob(null);
    setDuration(0);
    setCurrentTime(0);
    setIsUploadedFile(false);
    setUploadFileName(null);
    chunksRef.current = [];
    deletedChunksRef.current = [];
    // Reset file input
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  // Handle file upload
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    console.log('[OfflineRecorder] File upload triggered');
    const file = e.target.files?.[0];
    if (!file) {
      console.log('[OfflineRecorder] No file selected');
      return;
    }
    
    console.log(`[OfflineRecorder] File selected: ${file.name}, type: ${file.type}, size: ${file.size}`);
    setError(null);
    
    // Validate file type - be more lenient, check extension if type is empty
    const hasValidExtension = file.name.match(/\.(mp3|wav|aiff?|webm|ogg|opus|m4a)$/i);
    const hasValidType = ALLOWED_AUDIO_TYPES.includes(file.type) || 
                         file.type.startsWith('audio/') ||
                         file.type === '' || // Some files have no MIME type
                         file.type === 'application/octet-stream'; // Generic binary
    
    if (!hasValidType && !hasValidExtension) {
      console.log(`[OfflineRecorder] Invalid file type: ${file.type}, extension check also failed`);
      setError('Ungültiges Dateiformat. Erlaubt: MP3, WAV, AIFF, WebM, OGG, Opus, M4A');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    
    // Validate file size (max 100MB)
    const maxSize = 100 * 1024 * 1024;
    if (file.size > maxSize) {
      console.log(`[OfflineRecorder] File too large: ${file.size}`);
      setError('Datei zu groß. Maximal 100MB erlaubt.');
      if (fileInputRef.current) fileInputRef.current.value = '';
      return;
    }
    
    try {
      // Read file as ArrayBuffer to properly handle binary data
      console.log('[OfflineRecorder] Reading file...');
      const arrayBuffer = await file.arrayBuffer();
      
      // Determine MIME type - use file type or infer from extension
      let mimeType = file.type;
      if (!mimeType || mimeType === 'application/octet-stream') {
        const ext = file.name.split('.').pop()?.toLowerCase();
        const mimeMap: Record<string, string> = {
          'mp3': 'audio/mpeg',
          'wav': 'audio/wav',
          'webm': 'audio/webm',
          'ogg': 'audio/ogg',
          'opus': 'audio/opus',
          'aiff': 'audio/aiff',
          'aif': 'audio/aiff',
          'm4a': 'audio/mp4',
        };
        mimeType = mimeMap[ext || ''] || 'audio/wav';
        console.log(`[OfflineRecorder] Inferred MIME type from extension: ${mimeType}`);
      }
      
      const blob = new Blob([arrayBuffer], { type: mimeType });
      const url = URL.createObjectURL(blob);
      console.log(`[OfflineRecorder] Blob created: ${blob.size} bytes, type: ${blob.type}, URL: ${url}`);
      
      // Try to get audio duration, but don't fail if it doesn't work
      // (Some codecs like Opus in WAV container can't be decoded by browser)
      let audioDuration = 0;
      try {
        const audio = new Audio(url);
        
        audioDuration = await new Promise<number>((resolve) => {
          const timeout = setTimeout(() => {
            console.log('[OfflineRecorder] Duration detection timeout - using 0 (will be calculated server-side)');
            resolve(0);
          }, 2000);
          
          audio.onloadedmetadata = () => {
            clearTimeout(timeout);
            if (audio.duration && isFinite(audio.duration)) {
              console.log(`[OfflineRecorder] Audio duration detected: ${audio.duration}s`);
              resolve(Math.round(audio.duration));
            } else {
              console.log('[OfflineRecorder] Duration not available from metadata');
              resolve(0);
            }
          };
          
          audio.onerror = () => {
            clearTimeout(timeout);
            // This is expected for some formats - browser can't decode but Whisper can
            console.log('[OfflineRecorder] Browser cannot decode audio (expected for Opus-in-WAV, etc.) - proceeding anyway');
            resolve(0);
          };
        });
      } catch (audioErr) {
        console.log('[OfflineRecorder] Audio metadata extraction failed, proceeding without duration');
      }
      
      setDuration(audioDuration);
      
      console.log('[OfflineRecorder] Setting audio state...');
      setAudioBlob(blob);
      setAudioUrl(url);
      setIsUploadedFile(true);
      setUploadFileName(file.name);
      console.log(`[OfflineRecorder] File upload complete! Duration: ${audioDuration}s (0 = will be calculated server-side)`);
      
    } catch (err: any) {
      console.error('[OfflineRecorder] Upload error:', err);
      setError(err.message || 'Fehler beim Laden der Audiodatei');
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Handle audio playback time update
  const handleTimeUpdate = () => {
    if (audioRef.current) {
      setCurrentTime(audioRef.current.currentTime);
    }
  };

  // Seek in audio
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const time = parseFloat(e.target.value);
    if (audioRef.current) {
      audioRef.current.currentTime = time;
      setCurrentTime(time);
    }
  };
  
  // Change playback speed (preservesPitch is default true in modern browsers)
  const changePlaybackSpeed = (speed: number) => {
    setPlaybackSpeed(speed);
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  };

  // Format time as MM:SS
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  // Submit dictation
  const handleSubmit = async () => {
    if (!audioBlob || !orderNumber.trim()) {
      setError('Bitte Auftragsnummer eingeben');
      return;
    }
    
    setIsSubmitting(true);
    setError(null);
    
    try {
      await onSubmit({
        audioBlob,
        duration,
        orderNumber: orderNumber.trim(),
        patientName: patientName.trim() || undefined,
        patientDob: patientDob || undefined,
        priority,
        mode,
        bemerkung: bemerkung.trim() || undefined,
        termin: termin || undefined,
        fachabteilung: fachabteilung || undefined,
        berechtigte: berechtigte.length > 0 ? berechtigte : undefined,
      });
      
      // Reset form after successful submit
      deleteRecording();
      setOrderNumber('');
      setPatientName('');
      setPatientDob('');
      setPriority('normal');
      setBemerkung('');
      setTermin('');
      setFachabteilung('');
      setBerechtigte([]);
      
    } catch (err: any) {
      setError(err.message || 'Fehler beim Speichern');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Recorder Card */}
      <div className="card">
        <div className="card-body space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Offline-Diktat {isUploadedFile ? '(Datei)' : 'aufnehmen'}</h3>
            {isRecording && (
              <span className="flex items-center gap-1.5 text-red-600 dark:text-red-400 text-sm">
                <span className="pulse-dot" style={{ width: 8, height: 8 }} />
                {isPaused ? 'Pausiert' : 'Aufnahme'}
              </span>
            )}
          </div>

          {/* Audio Level Indicator */}
          {isRecording && !isPaused && (
            <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
              <div 
                className="h-full bg-green-500 transition-all duration-75"
                style={{ width: `${audioLevel}%` }}
              />
            </div>
          )}

          {/* Recording Controls */}
          <div className="flex items-center justify-center gap-4">
            {!isRecording && !audioUrl && (
              <>
                {/* Microphone Recording */}
                <button
                  className="btn btn-primary flex items-center gap-2 px-4 py-3"
                  onClick={startRecording}
                  title="Mikrofon-Aufnahme starten"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                    <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                  </svg>
                  Mikrofon
                </button>
                
                {/* System Audio Recording */}
                <button
                  className="btn btn-secondary flex items-center gap-2 px-4 py-3"
                  onClick={startSystemAudioRecording}
                  title="System-Audio aufnehmen (Tab/Bildschirm)"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
                    <line x1="8" y1="21" x2="16" y2="21"/>
                    <line x1="12" y1="17" x2="12" y2="21"/>
                    <path d="M6 10h.01M9 10h.01"/>
                    <path d="M12 10l4 0"/>
                  </svg>
                  System-Audio
                </button>
                
                <span className="text-gray-400 text-sm">oder</span>
                
                {/* File Upload Button */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept={ALLOWED_EXTENSIONS}
                  onChange={handleFileUpload}
                  className="hidden"
                  id="audio-upload"
                />
                <label
                  htmlFor="audio-upload"
                  className="btn btn-outline flex items-center gap-2 px-6 py-3 cursor-pointer"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  Datei hochladen
                </label>
              </>
            )}

            {isRecording && (
              <>
                {/* Rewind button - only when paused */}
                <button
                  className={`btn btn-outline ${!isPaused || chunksRef.current.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                  onClick={() => rewindRecording(5)}
                  disabled={!isPaused || chunksRef.current.length === 0}
                  title="Letzte 5 Sekunden löschen (Pause erforderlich)"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/>
                    <path d="M3 3v5h5"/>
                    <text x="12" y="15" textAnchor="middle" fontSize="8" fill="currentColor">5</text>
                  </svg>
                </button>
                
                <button
                  className="btn btn-outline"
                  onClick={togglePause}
                  title={isPaused ? 'Fortsetzen' : 'Pause'}
                >
                  {isPaused ? (
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M8 5v14l11-7z"/>
                    </svg>
                  ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/>
                    </svg>
                  )}
                </button>
                
                <span className="font-mono text-lg min-w-16 text-center">
                  {formatTime(duration)}
                </span>
                
                {/* Redo button - only when paused and there are deleted chunks */}
                <button
                  className={`btn btn-outline ${!isPaused || deletedChunksRef.current.length === 0 ? 'opacity-50 cursor-not-allowed' : ''}`}
                  onClick={redoRecording}
                  disabled={!isPaused || deletedChunksRef.current.length === 0}
                  title="Gelöschte Sekunden wiederherstellen"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M21 12a9 9 0 1 1-9-9 9.75 9.75 0 0 1 6.74 2.74L21 8"/>
                    <path d="M21 3v5h-5"/>
                  </svg>
                </button>
                
                <button
                  className="btn btn-error"
                  onClick={() => stopRecording()}
                  title="Aufnahme beenden"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M6 6h12v12H6z"/>
                  </svg>
                </button>
              </>
            )}
          </div>
          
          {/* Undo/Redo Feedback */}
          {undoMessage && (
            <div className="text-center text-sm text-blue-600 dark:text-blue-400 animate-pulse">
              {undoMessage}
            </div>
          )}

          {/* Pause Hint */}
          {isRecording && isPaused && (
            <div className="text-center text-xs text-gray-500">
              💡 Im Pausemodus: ⏪ löscht die letzten 5 Sekunden, ⏩ stellt wieder her
            </div>
          )}

          {/* Playback Controls */}
          {audioUrl && !isRecording && (
            <div className="space-y-3">
              {/* Show filename if uploaded */}
              {isUploadedFile && uploadFileName && (
                <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2">
                  <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                    <polyline points="17 8 12 3 7 8"/>
                    <line x1="12" y1="3" x2="12" y2="15"/>
                  </svg>
                  <span className="truncate">{uploadFileName}</span>
                </div>
              )}
              
              <audio
                ref={audioRef}
                src={audioUrl}
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={(e) => {
                  handleTimeUpdate();
                  e.currentTarget.playbackRate = playbackSpeed;
                }}
                className="hidden"
              />
              
              <div className="flex items-center gap-3">
                <button
                  className="btn btn-outline btn-sm"
                  onClick={() => {
                    if (audioRef.current) {
                      if (audioRef.current.paused) {
                        audioRef.current.play();
                      } else {
                        audioRef.current.pause();
                      }
                    }
                  }}
                >
                  ▶️
                </button>
                
                <span className="text-sm font-mono">{formatTime(currentTime)}</span>
                
                <input
                  type="range"
                  min="0"
                  max={duration}
                  value={currentTime}
                  onChange={handleSeek}
                  className="flex-1"
                />
                
                <span className="text-sm font-mono">{formatTime(duration)}</span>
                
                {/* Speed control */}
                <select
                  value={playbackSpeed}
                  onChange={(e) => changePlaybackSpeed(parseFloat(e.target.value))}
                  className="select select-sm select-bordered text-xs w-16"
                  title="Wiedergabegeschwindigkeit"
                >
                  {SPEED_OPTIONS.map(speed => (
                    <option key={speed} value={speed}>
                      {speed === 1 ? '1x' : `${speed}x`}
                    </option>
                  ))}
                </select>
                
                <button
                  className="btn btn-outline btn-sm text-red-600"
                  onClick={deleteRecording}
                  title="Aufnahme löschen"
                >
                  🗑️
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Metadata Form */}
      {audioUrl && !isRecording && (
        <div className="card">
          <div className="card-body space-y-4">
            <h3 className="font-medium">Auftragsdaten</h3>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1">
                  Auftragsnummer <span className="text-red-500">*</span>
                </label>
                <input
                  type="text"
                  className="input w-full"
                  value={orderNumber}
                  onChange={(e) => setOrderNumber(e.target.value)}
                  placeholder="z.B. 2024-12345"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Dringlichkeit</label>
                <select
                  className="select w-full"
                  value={priority}
                  onChange={(e) => setPriority(e.target.value as any)}
                >
                  <option value="normal">Normal</option>
                  <option value="urgent">Dringend</option>
                  <option value="stat">STAT (sofort)</option>
                </select>
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Patientenname (optional)</label>
                <input
                  type="text"
                  className="input w-full"
                  value={patientName}
                  onChange={(e) => setPatientName(e.target.value)}
                  placeholder="Nachname, Vorname"
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Geburtsdatum (optional)</label>
                <input
                  type="date"
                  className="input w-full"
                  value={patientDob}
                  onChange={(e) => setPatientDob(e.target.value)}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Termin (optional)</label>
                <input
                  type="datetime-local"
                  className="input w-full"
                  value={termin}
                  onChange={(e) => setTermin(e.target.value)}
                />
              </div>
              
              <div>
                <label className="block text-sm font-medium mb-1">Fachabteilung (optional)</label>
                {availableDepartments.length > 0 ? (
                  <select
                    className="select w-full"
                    value={fachabteilung}
                    onChange={(e) => setFachabteilung(e.target.value)}
                  >
                    <option value="">-- Bitte wählen --</option>
                    {availableDepartments.map(dept => (
                      <option key={dept} value={dept}>{dept}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    className="input w-full"
                    value={fachabteilung}
                    onChange={(e) => setFachabteilung(e.target.value)}
                    placeholder="z.B. Radiologie, Innere Medizin"
                  />
                )}
              </div>
              
              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-1">Berechtigte (optional)</label>
                {availableUsers.length > 0 ? (
                  <div className="flex flex-wrap gap-2 p-2 border rounded-lg bg-gray-50 dark:bg-gray-800 min-h-[42px]">
                    {availableUsers.map(user => (
                      <label key={user} className="flex items-center gap-1 text-sm cursor-pointer">
                        <input
                          type="checkbox"
                          checked={berechtigte.includes(user)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setBerechtigte([...berechtigte, user]);
                            } else {
                              setBerechtigte(berechtigte.filter(u => u !== user));
                            }
                          }}
                          className="checkbox checkbox-sm"
                        />
                        {user}
                      </label>
                    ))}
                  </div>
                ) : (
                  <input
                    type="text"
                    className="input w-full"
                    value={berechtigte.join(', ')}
                    onChange={(e) => setBerechtigte(e.target.value.split(',').map(s => s.trim()).filter(Boolean))}
                    placeholder="Benutzernamen, kommagetrennt"
                  />
                )}
                <p className="text-xs text-gray-500 mt-1">Wer außer Ihnen darf dieses Diktat bearbeiten</p>
              </div>
              
              <div className="md:col-span-2">
                <label className="block text-sm font-medium mb-1">Bemerkung (optional)</label>
                <textarea
                  className="textarea w-full"
                  rows={2}
                  value={bemerkung}
                  onChange={(e) => setBemerkung(e.target.value)}
                  placeholder="Zusätzliche Hinweise oder Notizen..."
                />
              </div>
            </div>

            {error && (
              <div className="alert alert-error text-sm">{error}</div>
            )}

            <div className="flex gap-3">
              <button
                className="btn btn-primary flex-1"
                onClick={handleSubmit}
                disabled={isSubmitting || !orderNumber.trim()}
              >
                {isSubmitting ? (
                  <>
                    <Spinner size={16} className="mr-2" />
                    Wird gespeichert...
                  </>
                ) : (
                  '📤 In Warteschlange einreihen'
                )}
              </button>
              
              {onCancel && (
                <button
                  className="btn btn-outline"
                  onClick={onCancel}
                  disabled={isSubmitting}
                >
                  Abbrechen
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
