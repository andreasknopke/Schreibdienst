"use client";

import { useEffect, useState } from 'react';
import { useAuth } from './AuthProvider';
import { addDictionaryEntry } from '@/lib/dictionaryApi';

const DICTIONARY_CHANGED_EVENT = 'schreibdienst:dictionary-changed';

export interface WordCorrectionInfo {
  originalWord: string;
  correctedWord: string;
  dictionaryWrong: string;
  dictionaryCorrect: string;
  source: 'standard' | 'private' | 'group';
  matchType: 'exact' | 'phonetic';
  confidence?: number;
  targetUsername?: string;
  groupId?: number;
}

interface WordActionPopupProps {
  word: string;
  position: { x: number; y: number };
  correction: WordCorrectionInfo | null;
  targetUsername?: string;
  groupId?: number;
  onClose: () => void;
}

export default function WordActionPopup({
  word,
  position,
  correction,
  targetUsername,
  groupId,
  onClose,
}: WordActionPopupProps) {
  const { getAuthHeader, getDbTokenHeader } = useAuth();
  const [mode, setMode] = useState<'menu' | 'add-form'>('menu');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [correctValue, setCorrectValue] = useState(word);
  const [addToGroup, setAddToGroup] = useState(false);

  useEffect(() => {
    setMode('menu');
    setError('');
    setCorrectValue(word);
    setAddToGroup(false);
  }, [word]);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const dispatchDictionaryChanged = (wrong?: string, correct?: string, revertFrom?: string, revertTo?: string) => {
    window.dispatchEvent(new CustomEvent(DICTIONARY_CHANGED_EVENT, {
      detail: { scope: 'private', wrong, correct, revertFrom, revertTo },
    }));
  };

  const handleAddToDictionary = async () => {
    if (!correctValue.trim()) {
      setError('Bitte eine korrekte Schreibweise eingeben');
      return;
    }
    setIsSubmitting(true);
    setError('');
    try {
      const result = await addDictionaryEntry(
        {
          wrong: word,
          correct: correctValue.trim(),
          username: targetUsername,
          addToGroup,
        },
        {
          'Authorization': getAuthHeader(),
          ...getDbTokenHeader(),
        },
      );
      if (!result.success) {
        throw new Error(result.error || 'Fehler beim Speichern im Wörterbuch');
      }
      dispatchDictionaryChanged(word, correctValue.trim());
      onClose();
    } catch (err: any) {
      setError(err.message || 'Verbindungsfehler');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleKeep = () => {
    onClose();
  };

  const handleRemove = async () => {
    if (!correction) return;
    setIsSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/dictionary', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': getAuthHeader(),
          ...getDbTokenHeader(),
        },
        body: JSON.stringify({
          wrong: correction.dictionaryWrong,
          username: correction.targetUsername || targetUsername,
          scope: correction.source,
          groupId: correction.groupId,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Löschen fehlgeschlagen');
      }
      dispatchDictionaryChanged(undefined, undefined, correction.correctedWord, correction.originalWord);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Verbindungsfehler');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleWeaken = async () => {
    if (!correction) return;
    setIsSubmitting(true);
    setError('');
    try {
      const response = await fetch('/api/dictionary', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': getAuthHeader(),
          ...getDbTokenHeader(),
        },
        body: JSON.stringify({
          wrong: correction.dictionaryWrong,
          username: correction.targetUsername || targetUsername,
          scope: correction.source,
          groupId: correction.groupId,
          weakenPhonetic: true,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        throw new Error(data.error || 'Abschwächen fehlgeschlagen');
      }
      dispatchDictionaryChanged(undefined, undefined, correction.correctedWord, correction.originalWord);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Verbindungsfehler');
    } finally {
      setIsSubmitting(false);
    }
  };

  const popupStyle: React.CSSProperties = {
    position: 'fixed',
    top: Math.min(position.y, window.innerHeight - 320),
    left: Math.min(position.x, window.innerWidth - 320),
    zIndex: 60,
  };

  return (
    <>
      <div
        className="fixed inset-0 z-50"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        style={popupStyle}
        className="w-80 rounded-lg border border-gray-200 bg-white shadow-xl dark:border-gray-700 dark:bg-gray-800"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-gray-200 px-3 py-2 dark:border-gray-700">
          <div className="flex items-center gap-2 text-sm font-medium">
            <span className="rounded bg-gray-100 px-2 py-0.5 font-mono dark:bg-gray-700">
              {word}
            </span>
            {correction && (
              <span className="text-xs text-gray-500">
                korrigiert aus „{correction.originalWord}“
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
            aria-label="Schließen"
          >
            ×
          </button>
        </div>

        {mode === 'menu' && (
          <div className="space-y-1 p-2">
            {!correction && (
              <button
                type="button"
                onClick={() => setMode('add-form')}
                className="w-full rounded px-3 py-2 text-left text-sm transition-colors hover:bg-blue-50 dark:hover:bg-blue-950/40"
                disabled={isSubmitting}
              >
                <div className="font-medium">✎ Korrigieren und ins Wörterbuch übernehmen</div>
                <div className="text-xs text-gray-500">
                  Korrigierte Schreibweise eingeben und ins Wörterbuch speichern
                </div>
              </button>
            )}
            {correction && (
              <>
                <button
                  type="button"
                  onClick={handleKeep}
                  className="w-full rounded px-3 py-2 text-left text-sm transition-colors hover:bg-green-50 dark:hover:bg-green-950/40"
                  disabled={isSubmitting}
                >
                  <div className="font-medium">✓ Korrektur beibehalten</div>
                  <div className="text-xs text-gray-500">
                    Alles ist richtig – nichts ändern
                  </div>
                </button>
                <div className="my-1 border-t border-gray-200 dark:border-gray-700" />
                <div className="px-2 pt-1 pb-1 text-xs text-gray-500">
                  Wörterbuch-Eintrag:
                </div>
                <div className="rounded bg-gray-50 px-2 py-1.5 text-xs dark:bg-gray-900/40">
                  <span className="line-through">{correction.dictionaryWrong}</span>
                  <span className="mx-1 text-gray-400">→</span>
                  <span className="font-medium">{correction.dictionaryCorrect}</span>
                  <span className="ml-1 text-gray-400">
                    ({correction.source === 'standard' ? 'Standard'
                      : correction.source === 'group' ? 'Gruppe'
                      : 'Benutzer'} / {correction.matchType === 'phonetic' ? 'phonetisch' : 'exakt'})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={handleWeaken}
                  className="w-full rounded px-3 py-2 text-left text-sm transition-colors hover:bg-amber-50 dark:hover:bg-amber-950/40 disabled:opacity-50"
                  disabled={isSubmitting}
                >
                  <div className="font-medium">🪶 Matching abschwächen</div>
                  <div className="text-xs text-gray-500">
                    Schwelle heraufsetzen, damit dieser Match in Zukunft seltener greift
                  </div>
                </button>
                <button
                  type="button"
                  onClick={handleRemove}
                  className="w-full rounded px-3 py-2 text-left text-sm transition-colors hover:bg-red-50 dark:hover:bg-red-950/40 disabled:opacity-50"
                  disabled={isSubmitting}
                >
                  <div className="font-medium text-red-700 dark:text-red-300">🗑 Eintrag löschen</div>
                  <div className="text-xs text-red-600/80 dark:text-red-300/70">
                    Eintrag komplett aus dem Wörterbuch entfernen
                  </div>
                </button>
              </>
            )}
          </div>
        )}

        {mode === 'add-form' && (
          <div className="space-y-3 p-3">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                Falsche / STT-Variante (wrong)
              </label>
              <input
                type="text"
                value={word}
                disabled
                className="w-full rounded border border-gray-300 bg-gray-100 px-2 py-1.5 text-sm font-mono text-gray-700 dark:border-gray-600 dark:bg-gray-900/40 dark:text-gray-300"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-700 dark:text-gray-300">
                Korrekte Schreibweise (correct)
              </label>
              <input
                type="text"
                value={correctValue}
                onChange={(e) => setCorrectValue(e.target.value)}
                autoFocus
                className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm font-mono focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-900"
              />
            </div>
            {groupId != null && (
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={addToGroup}
                  onChange={(e) => setAddToGroup(e.target.checked)}
                  className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600"
                />
                <span className="text-gray-700 dark:text-gray-300">
                  Ins Abteilungswörterbuch übernehmen
                </span>
              </label>
            )}
            {error && (
              <div className="text-xs text-red-700 dark:text-red-300">{error}</div>
            )}
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setMode('menu')}
                className="rounded px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-700"
                disabled={isSubmitting}
              >
                Zurück
              </button>
              <button
                type="button"
                onClick={handleAddToDictionary}
                className="rounded bg-blue-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-blue-600 disabled:cursor-not-allowed disabled:opacity-60"
                disabled={isSubmitting}
              >
                {isSubmitting ? 'Speichert…' : 'Speichern'}
              </button>
            </div>
          </div>
        )}

        {mode === 'menu' && correction && error && (
          <div className="px-3 pb-3 text-xs text-red-700 dark:text-red-300">
            {error}
          </div>
        )}
      </div>
    </>
  );
}
