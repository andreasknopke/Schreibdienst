"use client";
import { useState, useCallback, useEffect, useRef } from 'react';
import { useAuth } from '@/components/AuthProvider';
import OfflineRecorder from '@/components/OfflineRecorder';
import DictationQueue from '@/components/DictationQueue';
import { fetchWithDbToken } from '@/lib/fetchWithDbToken';

export default function OfflineDictationPage() {
  const { username, canViewAllDictations } = useAuth();
  
  // Sekretariat users only see the queue, not recording
  const isSecretariat = canViewAllDictations;
  const [activeTab, setActiveTab] = useState<'record' | 'queue'>(isSecretariat ? 'queue' : 'record');
  const [refreshKey, setRefreshKey] = useState(0);
  const [isImporting, setIsImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [importSuccess, setImportSuccess] = useState<string | null>(null);
  const [expectedAudioFile, setExpectedAudioFile] = useState<string | null>(null);
  const dictationInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  // Update tab when role changes
  useEffect(() => {
    if (isSecretariat) {
      setActiveTab('queue');
    }
  }, [isSecretariat]);

  // When .dictation file is selected, parse it to show expected audio filename
  const handleDictationFileChange = useCallback(async () => {
    const file = dictationInputRef.current?.files?.[0];
    if (!file) {
      setExpectedAudioFile(null);
      return;
    }
    
    try {
      const xmlContent = await file.text();
      const match = xmlContent.match(/<filename>([^<]+)<\/filename>/);
      if (match) {
        setExpectedAudioFile(match[1]);
        setImportError(null);
      } else {
        setExpectedAudioFile(null);
        setImportError('Keine Audio-Datei im XML referenziert');
      }
    } catch {
      setExpectedAudioFile(null);
    }
  }, []);

  // Import dictation from uploaded files
  const handleImport = useCallback(async () => {
    const dictationFile = dictationInputRef.current?.files?.[0];
    const audioFile = audioInputRef.current?.files?.[0];

    if (!dictationFile) {
      setImportError('Bitte .dictation Datei auswählen');
      return;
    }
    if (!audioFile) {
      setImportError(`Bitte Audio-Datei auswählen${expectedAudioFile ? ` (${expectedAudioFile})` : ''}`);
      return;
    }

    setIsImporting(true);
    setImportError(null);
    setImportSuccess(null);

    try {
      const formData = new FormData();
      formData.append('xml', dictationFile);
      formData.append('audio', audioFile);

      const res = await fetchWithDbToken('/api/import-dictation', {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Import fehlgeschlagen');
      }

      const result = await res.json();
      console.log('[Import] Success:', result);

      // Clear file inputs
      if (dictationInputRef.current) dictationInputRef.current.value = '';
      if (audioInputRef.current) audioInputRef.current.value = '';
      setExpectedAudioFile(null);

      // Show success and refresh queue
      setImportSuccess(`Diktat ${result.metadata?.orderNumber || '#' + result.dictationId} importiert`);
      setRefreshKey(k => k + 1);
      
      // Clear success after 3 seconds
      setTimeout(() => setImportSuccess(null), 3000);
    } catch (err: any) {
      console.error('[Import] Error:', err);
      setImportError(err.message);
    } finally {
      setIsImporting(false);
    }
  }, [expectedAudioFile]);

  // Submit a new dictation
  const handleSubmit = useCallback(async (data: {
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
  }) => {
    const formData = new FormData();
    formData.append('username', username || '');
    formData.append('audio', data.audioBlob, 'recording.webm');
    formData.append('duration', data.duration.toString());
    formData.append('orderNumber', data.orderNumber);
    formData.append('priority', data.priority);
    formData.append('mode', data.mode);
    if (data.patientName) formData.append('patientName', data.patientName);
    if (data.patientDob) formData.append('patientDob', data.patientDob);
    if (data.bemerkung) formData.append('bemerkung', data.bemerkung);
    if (data.termin) formData.append('termin', data.termin);
    if (data.fachabteilung) formData.append('fachabteilung', data.fachabteilung);
    if (data.berechtigte) formData.append('berechtigte', JSON.stringify(data.berechtigte));

    const res = await fetchWithDbToken('/api/offline-dictations', {
      method: 'POST',
      body: formData,
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.error || 'Speichern fehlgeschlagen');
    }

    // Trigger worker to process
    fetchWithDbToken('/api/offline-dictations/worker', { method: 'POST' }).catch(() => {});

    // Refresh queue and switch to queue tab
    setRefreshKey(k => k + 1);
    setActiveTab('queue');
  }, [username]);

  if (!username) {
    return (
      <div className="card">
        <div className="card-body text-center py-8 text-gray-500">
          Bitte melden Sie sich an, um Offline-Diktate zu verwenden.
        </div>
      </div>
    );
  }

  // Sekretariat view - only queue, no recording
  if (isSecretariat) {
    return (
      <div className="flex flex-col h-[calc(100vh-12rem)] space-y-4">
        <div className="card shrink-0">
          <div className="card-body py-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <h2 className="font-medium text-lg">📋 Sekretariat - Diktat-Übersicht</h2>
              
              {/* File Import Section */}
              <div className="flex items-center gap-2 flex-wrap">
                <input
                  type="file"
                  ref={dictationInputRef}
                  accept=".dictation,.xml"
                  onChange={handleDictationFileChange}
                  className="file-input file-input-sm file-input-bordered w-44"
                  title=".dictation Datei"
                />
                <input
                  type="file"
                  ref={audioInputRef}
                  accept="audio/*,.wav,.mp3,.ogg,.webm,.m4a"
                  className="file-input file-input-sm file-input-bordered w-44"
                  title={expectedAudioFile ? `Audio: ${expectedAudioFile}` : 'Audio-Datei'}
                />
                <button
                  onClick={handleImport}
                  disabled={isImporting}
                  className="px-3 py-1.5 rounded-lg text-sm font-medium bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-200 hover:bg-green-200 dark:hover:bg-green-800 disabled:opacity-50"
                >
                  {isImporting ? '⏳ Import...' : '📥 Import'}
                </button>
              </div>
              {expectedAudioFile && (
                <div className="text-xs text-gray-500 dark:text-gray-400">
                  Audio-Datei: <span className="font-mono">{expectedAudioFile}</span>
                </div>
              )}
            </div>
            {importError && (
              <div className="mt-2 text-sm text-red-600 dark:text-red-400">
                ⚠️ {importError}
              </div>
            )}
            {importSuccess && (
              <div className="mt-2 text-sm text-green-600 dark:text-green-400">
                ✓ {importSuccess}
              </div>
            )}
          </div>
        </div>
        <div className="flex-1 min-h-0 flex flex-col">
          <DictationQueue
            key={refreshKey}
            username={username}
            canViewAll={true}
            isSecretariat={true}
          />
        </div>
      </div>
    );
  }

  // Regular user view - recording and own queue (same table UI as Sekretariat)
  return (
    <div className="flex flex-col h-[calc(100vh-12rem)] space-y-4">
      {/* Header with tabs */}
      <div className="card shrink-0">
        <div className="card-body py-3">
          <div className="flex items-center justify-between">
            <h2 className="font-medium text-lg">📋 Meine Diktate</h2>
            <button
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'record'
                  ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200'
                  : 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200'
              }`}
              onClick={() => setActiveTab(activeTab === 'record' ? 'queue' : 'record')}
            >
              {activeTab === 'record' ? '✕ Schließen' : '🎙️ Neue Aufnahme'}
            </button>
          </div>
        </div>
      </div>

      {/* Recorder (collapsible) */}
      {activeTab === 'record' && (
        <div className="card shrink-0">
          <OfflineRecorder
            username={username}
            onSubmit={handleSubmit}
          />
        </div>
      )}

      {/* Queue - same table view as Sekretariat, but filtered to own dictations */}
      <div className="flex-1 min-h-0 flex flex-col">
        <DictationQueue
          key={refreshKey}
          username={username}
          canViewAll={false}
          isSecretariat={true}
        />
      </div>
    </div>
  );
}
