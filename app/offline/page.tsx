"use client";
import { useState, useCallback, useEffect } from 'react';
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

  // Update tab when role changes
  useEffect(() => {
    if (isSecretariat) {
      setActiveTab('queue');
    }
  }, [isSecretariat]);

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
            <h2 className="font-medium text-lg">📋 Sekretariat - Diktat-Übersicht</h2>
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

  // Regular user view - recording and own queue
  return (
    <div className="space-y-4">
      {/* Tab Navigation */}
      <div className="card">
        <div className="card-body py-2">
          <div className="flex gap-2">
            <button
              className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'record'
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
              onClick={() => setActiveTab('record')}
            >
              🎙️ Neue Aufnahme
            </button>
            <button
              className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-all ${
                activeTab === 'queue'
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-800'
              }`}
              onClick={() => setActiveTab('queue')}
            >
              📋 Meine Diktate
            </button>
          </div>
        </div>
      </div>

      {/* Tab Content */}
      {activeTab === 'record' ? (
        <OfflineRecorder
          username={username}
          onSubmit={handleSubmit}
        />
      ) : (
        <DictationQueue
          key={refreshKey}
          username={username}
          canViewAll={false}
        />
      )}
    </div>
  );
}
