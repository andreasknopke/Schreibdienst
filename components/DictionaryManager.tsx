"use client";
import { useState, useEffect } from 'react';
import { useAuth } from './AuthProvider';

interface DictionaryEntry {
  wrong: string;
  correct: string;
  addedAt: string;
  useInPrompt?: boolean;  // Wort wird im Whisper initial_prompt verwendet
  matchStem?: boolean;    // Wortstamm-Matching aktivieren
}

interface DictionaryManagerProps {
  initialWrong?: string;
}

export default function DictionaryManager({ initialWrong = '' }: DictionaryManagerProps) {
  const { getAuthHeader, getDbTokenHeader } = useAuth();
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Form state
  const [wrong, setWrong] = useState(initialWrong);
  const [correct, setCorrect] = useState('');
  const [useInPrompt, setUseInPrompt] = useState(false);
  const [matchStem, setMatchStem] = useState(false);
  const [adding, setAdding] = useState(false);

  const fetchEntries = async () => {
    try {
      const response = await fetch('/api/dictionary', {
        headers: { 
          'Authorization': getAuthHeader(),
          ...getDbTokenHeader()
        }
      });
      const data = await response.json();
      if (data.entries) {
        setEntries(data.entries);
      }
    } catch {
      setError('Fehler beim Laden des Wörterbuchs');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEntries();
  }, []);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setAdding(true);

    try {
      const response = await fetch('/api/dictionary', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': getAuthHeader(),
          ...getDbTokenHeader()
        },
        body: JSON.stringify({ wrong, correct, useInPrompt, matchStem })
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

      if (!response.ok) {
        setError(data.error || `Fehler (${response.status})`);
        return;
      }

      if (data.success) {
        setSuccess(`"${wrong}" → "${correct}" hinzugefügt`);
        setWrong('');
        setCorrect('');
        setUseInPrompt(false);
        setMatchStem(false);
        fetchEntries();
      } else {
        setError(data.error || 'Fehler beim Hinzufügen');
      }
    } catch (err) {
      console.error('[DictionaryManager] Add error:', err);
      setError('Verbindungsfehler');
    } finally {
      setAdding(false);
    }
  };

  // Update entry options (useInPrompt, matchStem)
  const handleUpdateOptions = async (wrongWord: string, newUseInPrompt: boolean, newMatchStem: boolean) => {
    setError('');
    setSuccess('');

    try {
      const response = await fetch('/api/dictionary', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': getAuthHeader(),
          ...getDbTokenHeader()
        },
        body: JSON.stringify({ wrong: wrongWord, useInPrompt: newUseInPrompt, matchStem: newMatchStem })
      });

      const data = await response.json();

      if (response.status === 401) {
        setError('Sitzung abgelaufen - bitte erneut anmelden');
        return;
      }

      if (data.success) {
        // Update local state
        setEntries(prev => prev.map(e => 
          e.wrong === wrongWord 
            ? { ...e, useInPrompt: newUseInPrompt, matchStem: newMatchStem }
            : e
        ));
      } else {
        setError(data.error || 'Fehler beim Aktualisieren');
      }
    } catch {
      setError('Verbindungsfehler');
    }
  };

  const handleDelete = async (wrongWord: string) => {
    setError('');
    setSuccess('');

    try {
      const response = await fetch('/api/dictionary', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': getAuthHeader(),
          ...getDbTokenHeader()
        },
        body: JSON.stringify({ wrong: wrongWord })
      });

      const data = await response.json();

      if (response.status === 401) {
        setError('Sitzung abgelaufen - bitte erneut anmelden');
        return;
      }

      if (data.success) {
        setSuccess(`"${wrongWord}" gelöscht`);
        fetchEntries();
      } else {
        setError(data.error || 'Fehler beim Löschen');
      }
    } catch {
      setError('Verbindungsfehler');
    }
  };

  // Quick add from text selection
  const handleQuickAdd = (wrongText: string) => {
    setWrong(wrongText);
    setCorrect('');
    // Focus on correct field
    document.getElementById('correct-input')?.focus();
  };

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

      {/* Add Entry Form */}
      <form onSubmit={handleAdd} className="space-y-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <h4 className="font-medium text-sm">Neuen Eintrag hinzufügen</h4>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs text-gray-500 block mb-1">Falsch erkannt</label>
            <input
              type="text"
              className="input text-sm"
              placeholder="z.B. Osteosynth ese"
              value={wrong}
              onChange={(e) => setWrong(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="text-xs text-gray-500 block mb-1">Korrekt</label>
            <input
              id="correct-input"
              type="text"
              className="input text-sm"
              placeholder="z.B. Osteosynthese"
              value={correct}
              onChange={(e) => setCorrect(e.target.value)}
              required
            />
          </div>
        </div>
        
        {/* Options */}
        <div className="flex flex-wrap gap-4 text-xs">
          <label className="flex items-center gap-2 cursor-pointer" title="Wort wird an Whisper übergeben um die Erkennung zu verbessern">
            <input
              type="checkbox"
              checked={useInPrompt}
              onChange={(e) => setUseInPrompt(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-gray-600 dark:text-gray-400">🎤 Im Whisper-Prompt</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer" title="Korrigiert auch zusammengesetzte Wörter (z.B. Schole→Chole korrigiert auch Scholezystitis→Cholezystitis)">
            <input
              type="checkbox"
              checked={matchStem}
              onChange={(e) => setMatchStem(e.target.checked)}
              className="w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
            />
            <span className="text-gray-600 dark:text-gray-400">🌿 Wortstamm-Match</span>
          </label>
        </div>
        
        <div className="flex justify-end">
          <button type="submit" className="btn btn-primary text-sm" disabled={adding}>
            {adding ? 'Füge hinzu...' : 'Hinzufügen'}
          </button>
        </div>
      </form>

      {/* Entries List */}
      <div className="space-y-2">
        <h4 className="font-medium text-sm flex items-center justify-between">
          <span>Mein Wörterbuch</span>
          <span className="text-xs text-gray-500 font-normal">{entries.length} Einträge</span>
        </h4>
        
        {loading ? (
          <div className="text-sm text-gray-500">Lade...</div>
        ) : entries.length === 0 ? (
          <div className="text-sm text-gray-500 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
            Noch keine Einträge. Fügen Sie Wörter hinzu, die häufig falsch erkannt werden.
          </div>
        ) : (
          <div className="max-h-80 overflow-y-auto space-y-1">
            {entries.map((entry) => (
              <div key={entry.wrong} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm gap-2">
                <div className="flex items-center gap-2 overflow-hidden flex-1 min-w-0">
                  <span className="text-red-600 dark:text-red-400 line-through truncate">{entry.wrong}</span>
                  <span className="text-gray-400 flex-shrink-0">→</span>
                  <span className="text-green-600 dark:text-green-400 font-medium truncate">{entry.correct}</span>
                </div>
                
                {/* Option toggles */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => handleUpdateOptions(entry.wrong, !entry.useInPrompt, entry.matchStem ?? false)}
                    className={`p-1 rounded transition-colors ${entry.useInPrompt ? 'text-blue-600 bg-blue-100 dark:bg-blue-900/30' : 'text-gray-400 hover:text-blue-600'}`}
                    title={entry.useInPrompt ? 'Im Whisper-Prompt (aktiv)' : 'Im Whisper-Prompt (inaktiv)'}
                  >
                    🎤
                  </button>
                  <button
                    onClick={() => handleUpdateOptions(entry.wrong, entry.useInPrompt ?? false, !entry.matchStem)}
                    className={`p-1 rounded transition-colors ${entry.matchStem ? 'text-green-600 bg-green-100 dark:bg-green-900/30' : 'text-gray-400 hover:text-green-600'}`}
                    title={entry.matchStem ? 'Wortstamm-Match (aktiv)' : 'Wortstamm-Match (inaktiv)'}
                  >
                    🌿
                  </button>
                  <button
                    onClick={() => handleDelete(entry.wrong)}
                    className="text-gray-400 hover:text-red-600 p-1"
                    title="Löschen"
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 6L6 18"/>
                      <path d="M6 6l12 12"/>
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-gray-500">
        🎤 = Wort wird an Whisper übergeben | 🌿 = Korrigiert auch zusammengesetzte Wörter
      </p>
    </div>
  );
}

export { DictionaryManager };
