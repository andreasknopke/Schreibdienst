"use client";
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { useAuth } from './AuthProvider';
import { areWordsPhoneticallySimilar } from '../lib/phoneticMatch';

interface StandardDictEntry {
  wrong: string;
  correct: string;
  category?: string;
}

const DICTIONARY_CHANGED_EVENT = 'schreibdienst:dictionary-changed';

/** Maximale Anzahl gerenderter Einträge ohne aktiven Filter */
const MAX_VISIBLE_ENTRIES_WITHOUT_FILTER = 200;

function notifyStandardDictionaryChanged() {
  window.dispatchEvent(new CustomEvent(DICTIONARY_CHANGED_EVENT, {
    detail: { scope: 'standard' }
  }));
}

export default function StandardDictionaryManager() {
  const { getAuthHeader, getDbTokenHeader } = useAuth();
  const [entries, setEntries] = useState<StandardDictEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [warning, setWarning] = useState('');
  const [needsPhoneticConfirmation, setNeedsPhoneticConfirmation] = useState(false);
  const [rawFilter, setRawFilter] = useState('');
  const [filter, setFilter] = useState('');

  // Debounced filter to avoid re-filtering 10k+ entries on every keystroke
  const filterTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleFilterChange = useCallback((value: string) => {
    setRawFilter(value);
    if (filterTimer.current) clearTimeout(filterTimer.current);
    filterTimer.current = setTimeout(() => setFilter(value), 250);
  }, []);

  // Form state
  const [wrong, setWrong] = useState('');
  const [correct, setCorrect] = useState('');
  const [adding, setAdding] = useState(false);
  
  // Bulk-Import state
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [bulkText, setBulkText] = useState('');
  const [importing, setImporting] = useState(false);
  const [importingMedicalTerms, setImportingMedicalTerms] = useState(false);

  const fetchEntries = useCallback(async () => {
    try {
      const response = await fetch('/api/standard-dictionary', {
        headers: { 'Authorization': getAuthHeader(), ...getDbTokenHeader() }
      });
      const data = await response.json();
      if (data.entries) {
        setEntries(data.entries);
      }
    } catch {
      setError('Fehler beim Laden');
    } finally {
      setLoading(false);
    }
  }, [getAuthHeader, getDbTokenHeader]);

  useEffect(() => { fetchEntries(); }, [fetchEntries]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!wrong.trim() || !correct.trim()) return;
    setError('');
    setSuccess('');

    // Phonetische Vorab-Prüfung: Wenn die Wörter zu verschieden sind,
    // muss der Benutzer explizit bestätigen.
    if (!needsPhoneticConfirmation && !areWordsPhoneticallySimilar(wrong.trim(), correct.trim())) {
      setNeedsPhoneticConfirmation(true);
      setWarning(
        `„${wrong.trim()}“ und „${correct.trim()}“ sind phonetisch sehr verschieden. ` +
        `Dieser Eintrag könnte zu unerwünschten Ersetzungen führen.\n` +
        `✅ Gut: „Schole“ → „Chole“ (klingt ähnlich)  —  ❌ Schlecht: „Patient“ → „Befund“ (klingt verschieden)`
      );
      return;
    }

    const trimmedWrong = wrong.trim();
    const trimmedCorrect = correct.trim();

    setAdding(true);
    setNeedsPhoneticConfirmation(false);

    try {
      const response = await fetch('/api/standard-dictionary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': getAuthHeader(), ...getDbTokenHeader() },
        body: JSON.stringify({ wrong: trimmedWrong, correct: trimmedCorrect })
      });
      const data = await response.json();
      if (response.ok && data.success) {
        const autoMappingHint = data.createdSelfMapping ? ' + phonetischer Self-Mapping-Eintrag' : '';
        setSuccess(`"${trimmedWrong}" → "${trimmedCorrect}" hinzugefügt${autoMappingHint}`);
        setWarning(data.warning || '');
        setWrong('');
        setCorrect('');
        // Lokal einfügen statt 10k+ Einträge neu zu laden
        setEntries(prev => {
          const filtered = prev.filter(e => e.wrong !== trimmedWrong);
          return [...filtered, { wrong: trimmedWrong, correct: trimmedCorrect, category: '' }];
        });
        notifyStandardDictionaryChanged();
      } else {
        setError(data.error || 'Fehler');
      }
    } catch {
      setError('Verbindungsfehler');
    } finally {
      setAdding(false);
    }
  };

  const handleDelete = async (wrongWord: string) => {
    setError('');
    setSuccess('');
    try {
      const response = await fetch('/api/standard-dictionary', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', 'Authorization': getAuthHeader(), ...getDbTokenHeader() },
        body: JSON.stringify({ wrong: wrongWord })
      });
      const data = await response.json();
      if (data.success) {
        setEntries(prev => prev.filter(e => e.wrong !== wrongWord));
        setSuccess(`"${wrongWord}" gelöscht`);
        notifyStandardDictionaryChanged();
      } else {
        setError(data.error || 'Fehler');
      }
    } catch {
      setError('Verbindungsfehler');
    }
  };

  const handleReset = async () => {
    if (!confirm('Standard-Wörterbuch auf Werkseinstellungen zurücksetzen? Alle manuellen Änderungen gehen verloren.')) return;
    setError('');
    setSuccess('');
    try {
      const response = await fetch('/api/standard-dictionary', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': getAuthHeader(), ...getDbTokenHeader() },
        body: JSON.stringify({ action: 'reset' })
      });
      const data = await response.json();
      if (data.success) {
        setSuccess(`Zurückgesetzt auf ${data.count} Standard-Einträge`);
        await fetchEntries();
        notifyStandardDictionaryChanged();
      } else {
        setError(data.error || 'Fehler');
      }
    } catch {
      setError('Verbindungsfehler');
    }
  };

  const handleBulkImport = async () => {
    if (!bulkText.trim()) return;
    setImporting(true);
    setError('');
    setSuccess('');

    // Jede Zeile = ein korrekter Begriff (self-mapping für phonetisches Matching)
    const lines = bulkText.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    let added = 0;
    let failed = 0;
    const importedEntries: StandardDictEntry[] = [];

    for (const line of lines) {
      try {
        const response = await fetch('/api/standard-dictionary', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': getAuthHeader(), ...getDbTokenHeader() },
          body: JSON.stringify({ wrong: line, correct: line })
        });
        if (response.ok) {
          added++;
          importedEntries.push({ wrong: line, correct: line, category: '' });
        } else {
          failed++;
        }
      } catch {
        failed++;
      }
    }

    setSuccess(`${added} Einträge importiert${failed > 0 ? `, ${failed} fehlgeschlagen` : ''}`);
    setBulkText('');
    setShowBulkImport(false);
    setImporting(false);
    // Lokal einfügen statt 10k+ Einträge neu zu laden
    if (importedEntries.length > 0) {
      setEntries(prev => {
        const existingWrongs = new Set(prev.map(e => e.wrong));
        const newEntries = importedEntries.filter(e => !existingWrongs.has(e.wrong));
        return [...prev, ...newEntries];
      });
    }
    notifyStandardDictionaryChanged();
  };

  const handleImportMedicalTerms = async () => {
    const confirmed = confirm(
      'Die externe Liste wird live von GitHub geladen und als Self-Mappings in das Standard-Wörterbuch importiert. Die Quelle steht laut Upstream unter GPL v3. Fortfahren?'
    );
    if (!confirmed) return;

    setImportingMedicalTerms(true);
    setError('');
    setSuccess('');

    try {
      const response = await fetch('/api/standard-dictionary', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Authorization': getAuthHeader(), ...getDbTokenHeader() },
        body: JSON.stringify({ action: 'import-glutanimate-medicalterms' })
      });
      const data = await response.json();

      if (response.ok && data.success) {
        setSuccess(`${data.imported} MedicalTerms importiert${data.skipped > 0 ? `, ${data.skipped} bereits vorhanden` : ''}`);
        // Große Massenimporte: komplett neu laden
        await fetchEntries();
        notifyStandardDictionaryChanged();
      } else {
        setError(data.error || 'Fehler beim Import');
      }
    } catch {
      setError('Verbindungsfehler');
    } finally {
      setImportingMedicalTerms(false);
    }
  };

  // Memoized filtered lists – vermeidet O(n) Filter-Durchläufe bei jedem Render
  const { filtered, selfMappings, corrections, totalCount } = useMemo(() => {
    const all = filter
      ? entries.filter(e => 
          e.wrong.toLowerCase().includes(filter.toLowerCase()) || 
          e.correct.toLowerCase().includes(filter.toLowerCase())
        )
      : entries;

    const self = all.filter(e => e.wrong === e.correct);
    const corr = all.filter(e => e.wrong !== e.correct);

    // Ohne Filter nur die ersten N Einträge rendern
    const hasActiveFilter = filter.length > 0;
    const visibleCorrections = hasActiveFilter ? corr : corr.slice(0, MAX_VISIBLE_ENTRIES_WITHOUT_FILTER);
    const visibleSelf = hasActiveFilter ? self : self.slice(0, MAX_VISIBLE_ENTRIES_WITHOUT_FILTER);
    const capped = [...visibleCorrections, ...visibleSelf];

    return {
      filtered: capped,
      selfMappings: visibleSelf,
      corrections: visibleCorrections,
      totalCount: all.length,
    };
  }, [entries, filter]);

  const hasActiveFilter = filter.length > 0;
  const isCapped = !hasActiveFilter && entries.length > MAX_VISIBLE_ENTRIES_WITHOUT_FILTER;

  return (
    <div className="space-y-4">
      {error && (
        <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">
          {error}
        </div>
      )}
      {success && (
        <div className="text-sm text-green-600 bg-green-50 dark:bg-green-900/20 px-3 py-2 rounded-lg">
          {success}
        </div>
      )}
      {warning && (
        <div className="text-sm text-amber-700 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 rounded-lg border border-amber-200 dark:border-amber-800">
          <span className="font-medium">⚠️ Hinweis zum phonetischen Matching: </span>
          {warning}
        </div>
      )}

      {/* Hinzufügen-Formular */}
      <form onSubmit={handleAdd} className="space-y-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <h4 className="font-medium text-sm">Eintrag hinzufügen</h4>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Falsch / Variante</label>
            <input
              type="text"
              className="input text-sm"
              placeholder="z.B. Spondylolithesis"
              value={wrong}
              onChange={(e) => { setWrong(e.target.value); setNeedsPhoneticConfirmation(false); setWarning(''); }}
              required
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Korrekt</label>
            <input
              type="text"
              className="input text-sm"
              placeholder="z.B. Spondylolisthesis"
              value={correct}
              onChange={(e) => { setCorrect(e.target.value); setNeedsPhoneticConfirmation(false); setWarning(''); }}
              required
            />
          </div>
        </div>
        <p className="text-xs text-gray-500">
          Für neue Korrekturen wird der korrekte Begriff automatisch auch als blauer phonetischer Eintrag angelegt.
        </p>
        <div className="flex justify-between items-center">
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setShowBulkImport(!showBulkImport)}
              className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400"
            >
              {showBulkImport ? 'Einzeleintrag' : 'Bulk-Import'}
            </button>
            <button
              type="button"
              onClick={handleReset}
              className="text-xs text-orange-600 hover:text-orange-800 dark:text-orange-400"
            >
              Werkseinstellungen
            </button>
            <button
              type="button"
              onClick={handleImportMedicalTerms}
              className="text-xs text-teal-600 hover:text-teal-800 dark:text-teal-400"
              disabled={importingMedicalTerms}
            >
              {importingMedicalTerms ? 'Importiere MedicalTerms...' : 'MedicalTerms importieren'}
            </button>
          </div>
          <button type="submit" className="btn btn-primary text-sm" disabled={adding}>
            {adding ? 'Füge hinzu...' : needsPhoneticConfirmation ? 'Trotzdem speichern' : 'Hinzufügen'}
          </button>
        </div>
      </form>

      {/* Bulk-Import */}
      {showBulkImport && (
        <div className="p-3 bg-blue-50 dark:bg-blue-900/20 rounded-lg space-y-2">
          <h4 className="font-medium text-sm">Bulk-Import (ein Begriff pro Zeile)</h4>
          <p className="text-xs text-gray-500">
            Jeden Begriff auf eine eigene Zeile. Wird als Self-Mapping angelegt (für phonetisches Matching).
          </p>
          <textarea
            className="input text-sm w-full h-32 font-mono"
            placeholder={"Spondylolisthesis\nSyringomyelie\nCharcot-Fuß"}
            value={bulkText}
            onChange={(e) => setBulkText(e.target.value)}
          />
          <div className="flex justify-between items-center">
            <span className="text-xs text-gray-500">
              {bulkText.split('\n').filter(l => l.trim()).length} Begriffe
            </span>
            <button
              onClick={handleBulkImport}
              className="btn btn-primary text-sm"
              disabled={importing || !bulkText.trim()}
            >
              {importing ? 'Importiere...' : 'Importieren'}
            </button>
          </div>
        </div>
      )}

      {/* Suchfilter */}
      <div>
        <input
          type="text"
          className="input text-sm w-full"
          placeholder="Einträge filtern (benötigt bei >200 Einträgen)..."
          value={rawFilter}
          onChange={(e) => handleFilterChange(e.target.value)}
        />
        {isCapped && (
          <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">
            Zeige die ersten {MAX_VISIBLE_ENTRIES_WITHOUT_FILTER} von {entries.length.toLocaleString()} Einträgen.
            Nutze die Suche, um den gewünschten Eintrag zu finden.
          </p>
        )}
      </div>

      {/* Einträge-Liste */}
      <div className="space-y-2">
        <h4 className="font-medium text-sm flex items-center justify-between">
          <span>Standard-Wörterbuch</span>
          <span className="text-xs text-gray-500 font-normal">
            {hasActiveFilter ? `${totalCount} von ${entries.length.toLocaleString()} Einträgen` : `${entries.length.toLocaleString()} Einträge`}
          </span>
        </h4>

        {loading ? (
          <div className="text-sm text-gray-500">Lade...</div>
        ) : entries.length === 0 ? (
          <div className="text-sm text-gray-500 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
            Keine Einträge vorhanden. Klicken Sie auf &quot;Werkseinstellungen&quot; für die Standard-Liste.
          </div>
        ) : (
          <div className="max-h-96 overflow-y-auto space-y-1">
            {/* Echte Korrekturen zuerst */}
            {corrections.map((entry) => (
              <div key={entry.wrong} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm gap-2">
                <div className="flex items-center gap-2 overflow-hidden flex-1 min-w-0">
                  <span className="text-red-600 dark:text-red-400 line-through truncate">{entry.wrong}</span>
                  <span className="text-gray-400 flex-shrink-0">→</span>
                  <span className="text-green-600 dark:text-green-400 font-medium truncate">{entry.correct}</span>
                </div>
                <button
                  onClick={() => handleDelete(entry.wrong)}
                  className="text-gray-400 hover:text-red-600 p-1 flex-shrink-0"
                  title="Löschen"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6L6 18"/><path d="M6 6l12 12"/>
                  </svg>
                </button>
              </div>
            ))}
            {/* Self-Mappings (Begriffe für phonetische Erkennung) */}
            {selfMappings.map((entry) => (
              <div key={entry.wrong} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm gap-2">
                <div className="flex items-center gap-2 overflow-hidden flex-1 min-w-0">
                  <span className="text-blue-600 dark:text-blue-400 truncate">{entry.correct}</span>
                  <span className="text-xs text-gray-400 flex-shrink-0">(phonetisch)</span>
                </div>
                <button
                  onClick={() => handleDelete(entry.wrong)}
                  className="text-gray-400 hover:text-red-600 p-1 flex-shrink-0"
                  title="Löschen"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6L6 18"/><path d="M6 6l12 12"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-gray-500">
        Begriffe werden für alle Benutzer verwendet. Phonetische Einträge erkennen auch ähnlich geschriebene STT-Varianten automatisch.
      </p>
    </div>
  );
}
