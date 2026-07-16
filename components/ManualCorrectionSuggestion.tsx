"use client";

import { useState } from 'react';
import { useAuth } from './AuthProvider';
import { areWordsPhoneticallySimilar } from '../lib/phoneticMatch';
import { addDictionaryEntry } from '@/lib/dictionaryApi';

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
      const result = await addDictionaryEntry(
        {
          wrong: originalWord,
          correct: newWord,
          username: targetUsername,
          addToGroup,
        },
        { 'Authorization': getAuthHeader(), ...getDbTokenHeader() },
      );

      if (!result.success) {
        setError(result.error || 'Fehler beim Speichern im Wörterbuch');
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
        <div className="flex-1 space-y-2">
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
                <p className="mt-2 italic opacity-80">
                  ✅ Gut: „Schole“ → „Chole“ (klingt ähnlich) &nbsp;—&nbsp; ❌ Schlecht: „Patient“ → „Befund“ (klingt verschieden)
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
              {/* Immer sichtbare Beispiele für gute und schlechte Wörterbuch-Einträge */}
              <div className="flex gap-2 w-full text-[11px]">
                <div
                  className="flex-1 rounded border border-green-200 bg-green-50/60 px-2 py-1.5 dark:border-green-800 dark:bg-green-950/20"
                  title="✅ Guter Eintrag: ‚Herz im Park‘ und ‚Herzinfarkt‘ klingen ähnlich (phonetische Verwechslung). Das Wörterbuch kann diese typische Hörverwechslung zuverlässig korrigieren."
                >
                  <span className="font-medium text-green-700 dark:text-green-300">Beispiel: Guter Eintrag</span>
                  <div className="mt-0.5 text-green-600 dark:text-green-400">
                    <span className="line-through">Herz im Park</span>
                    <span className="mx-1">→</span>
                    <span className="font-medium">Herzinfarkt</span>
                  </div>
                </div>
                <div
                  className="flex-1 rounded border border-red-200 bg-red-50/60 px-2 py-1.5 dark:border-red-800 dark:bg-red-950/20"
                  title="❌ Schlechter Eintrag: ‚Hypertonie‘ (Bluthochdruck) und ‚Hypotonie‘ (niedriger Blutdruck) sind bedeutungsverschiedene medizinische Begriffe. Das Wörterbuch würde hier fälschlich korrigieren und einen schweren Dokumentationsfehler verursachen."
                >
                  <span className="font-medium text-red-700 dark:text-red-300">Beispiel: Schlechter Eintrag</span>
                  <div className="mt-0.5 text-red-600 dark:text-red-400">
                    <span className="line-through">Hypertonie</span>
                    <span className="mx-1">→</span>
                    <span className="font-medium">Hypotonie</span>
                  </div>
                </div>
              </div>
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