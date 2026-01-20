"use client";
import { useState, useCallback } from 'react';
import { useAuth } from '@/components/AuthProvider';
import OfflineRecorder from '@/components/OfflineRecorder';
import DictationQueue from '@/components/DictationQueue';
import { fetchWithDbToken } from '@/lib/fetchWithDbToken';

export default function OfflineDictationPage() {
  const { username, canViewAllDictations } = useAuth();
  
  const isSecretariat = canViewAllDictations;
  const [showRecorder, setShowRecorder] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

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

    // Refresh queue and hide recorder
    setRefreshKey(k => k + 1);
    setShowRecorder(false);
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

  // Both Sekretariat and Diktierende get the same view structure
  // - Sekretariat can see all dictations (canViewAll=true)
  // - Diktierende see only their own dictations (canViewAll=false) but same UI
  return (
    <div className="flex flex-col h-[calc(100vh-12rem)] space-y-4">
      <div className="card shrink-0">
        <div className="card-body py-3 flex items-center justify-between">
          <h2 className="font-medium text-lg">
            {isSecretariat ? '📋 Sekretariat - Diktat-Übersicht' : '📋 Meine Diktate'}
          </h2>
          {/* Diktierende können neue Aufnahmen erstellen */}
          {!isSecretariat && (
            <button
              onClick={() => setShowRecorder(!showRecorder)}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition-all flex items-center gap-2 ${
                showRecorder
                  ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200'
                  : 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200'
              }`}
            >
              {showRecorder ? '✕ Schließen' : '🎙️ Neue Aufnahme'}
            </button>
          )}
        </div>
      </div>
      
      {/* Recorder anzeigen wenn aktiviert */}
      {!isSecretariat && showRecorder && (
        <div className="card shrink-0">
          <OfflineRecorder
            username={username}
            onSubmit={handleSubmit}
          />
        </div>
      )}
      
      {/* DictationQueue - gleiche Ansicht für alle, nur mit unterschiedlichem Filter */}
      <div className="flex-1 min-h-0 flex flex-col">
        <DictationQueue
          key={refreshKey}
          username={username}
          canViewAll={isSecretariat}
          isSecretariat={isSecretariat}
        />
      </div>
    </div>
  );
}
