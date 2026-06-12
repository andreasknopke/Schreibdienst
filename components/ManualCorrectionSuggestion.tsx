"use client";

import { useState } from 'react';
import { useAuth } from './AuthProvider';
import { areWordsPhoneticallySimilar } from '../lib/phoneticMatch';

const DICTIONARY_CHANGED_EVENT = 'schreibdienst:dictionary-changed';

interface ManualCorrectionSuggestionProps {
  originalWord: string;
  newWord: string;
  targetUsername?: string;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ManualCorrectionSuggestion({
  originalWord,
  newWord,
  targetUsername,
  onConfirm,
  onCancel,
}: ManualCorrectionSuggestionProps) {
  const { getAuthHeader, getDbTokenHeader } = useAuth();
  const [addToGroup, setAddToGroup] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [needsPhoneticConfirmation, setNeedsPhoneticConfirmation] = useState(false);

  const isPhoneticallyWeak = !areWordsPhoneticallySimilar(originalWord, newWord);

  const handleConfirm = async () => {
    setError('');

    // Wenn die Wörter phonetisch zu verschieden sind, erst Bestätigung einholen
    if (isPhoneticallyWeak && !needsPhoneticConfirmation) {
      setNeedsPhoneticConfirmation(true);
      return;
    }

    setIsSubmitting(true);

    try {
      const response = await fetch('/api/dictionary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': getAuthHeader(),
          ...getDbTokenHeader(),
        },
        body: JSON.stringify({
          wrong: originalWord,
          correct: newWord,
          username: targetUsername,
          addToGroup,
        }),
      });

      const data = await response.json();

      if (response.status === 401) {
        setError('Sitzung abgelaufen - bitte erneut anmelden');
        return;
      }

      if (response.status === 403) {
        setError('Keine Berechtigung für diese Aktion');
        return;
      }

      if (!response.ok || !data.success) {
        setError(data.error || 'Fehler beim Speichern im Wörterbuch');
        return;
      }

      window.dispatchEvent(new CustomEvent(DICTIONARY_CHANGED_EVENT, {
        detail: { scope: 'private', wrong: originalWord, correct: newWord },
      }));
      onConfirm();
    } catch (err) {
      console.error('[ManualCorrectionSuggestion] Add dictionary entry failed:', err);
      setError('Verbindungsfehler');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-3 text-sm dark:border-amber-800 dark:bg-amber-950/30">
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2 text-amber-900 dark:text-amber-100">
            <span className="rounded bg-white/70 px-2 py-1 line-through dark:bg-gray-900/40">{originalWord}</span>
            <span className="text-amber-700 dark:text-amber-300">→</span>
            <span className="rounded bg-white px-2 py-1 font-medium dark:bg-gray-900/60">{newWord}</span>
          </div>
          {needsPhoneticConfirmation && isPhoneticallyWeak ? (
            <div className="space-y-2">
              <div className="rounded border border-red-200 bg-red-50 px-2 py-2 text-xs text-red-800 dark:border-red-800 dark:bg-red-950/30 dark:text-red-200">
                <p className="font-medium">⚠️ Phonetische Distanz-Warnung</p>
                <p className="mt-1">
                  „{originalWord}“ und „{newWord}“ sind phonetisch sehr verschieden.
                  Dieser Eintrag könnte zu unerwünschten Ersetzungen führen.
                </p>
              </div>
              <p className="text-amber-800 dark:text-amber-200">Trotzdem ins Wörterbuch übernehmen?</p>
            </div>
          ) : (
            <>
              <p className="text-amber-800 dark:text-amber-200">Gleich ins Wörterbuch übernehmen?</p>
              <label className="flex items-center gap-2 text-xs text-amber-900 dark:text-amber-100 cursor-pointer">
                <input
                  type="checkbox"
                  checked={addToGroup}
                  onChange={(event) => setAddToGroup(event.target.checked)}
                  className="h-4 w-4 rounded border-amber-300 text-amber-600 focus:ring-amber-500"
                  disabled={isSubmitting}
                />
                <span>ins Abteilungswörterbuch übernehmen</span>
              </label>
            </>
          )}
          {error && (
            <div className="text-xs text-red-700 dark:text-red-300">{error}</div>
          )}
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => {
              if (needsPhoneticConfirmation) {
                setNeedsPhoneticConfirmation(false);
              }
              onCancel();
            }}
            className="rounded px-3 py-1.5 text-xs font-medium text-gray-600 transition-colors hover:bg-white/60 dark:text-gray-300 dark:hover:bg-gray-900/30"
            disabled={isSubmitting}
          >
            Schließen
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            className="rounded bg-amber-500 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSubmitting}
          >
            {isSubmitting ? 'Speichert...' : needsPhoneticConfirmation ? 'Trotzdem speichern' : 'Ok'}
          </button>
        </div>
      </div>
    </div>
  );
}