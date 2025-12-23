"use client";
import { useState, useEffect } from 'react';
import { useAuth } from './AuthProvider';

interface DictionaryEntry {
  wrong: string;
  correct: string;
  addedAt: string;
}

export default function DictionaryManager() {
  const { getAuthHeader } = useAuth();
  const [entries, setEntries] = useState<DictionaryEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Form state
  const [wrong, setWrong] = useState('');
  const [correct, setCorrect] = useState('');
  const [adding, setAdding] = useState(false);

  const fetchEntries = async () => {
    try {
      const response = await fetch('/api/dictionary', {
        headers: { 'Authorization': getAuthHeader() }
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
          'Authorization': getAuthHeader()
        },
        body: JSON.stringify({ wrong, correct })
      });

      const data = await response.json();

      if (data.success) {
        setSuccess(`"${wrong}" → "${correct}" hinzugefügt`);
        setWrong('');
        setCorrect('');
        fetchEntries();
      } else {
        setError(data.error || 'Fehler beim Hinzufügen');
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
      const response = await fetch('/api/dictionary', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': getAuthHeader()
        },
        body: JSON.stringify({ wrong: wrongWord })
      });

      const data = await response.json();

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
          <div className="max-h-60 overflow-y-auto space-y-1">
            {entries.map((entry) => (
              <div key={entry.wrong} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm">
                <div className="flex items-center gap-2 overflow-hidden">
                  <span className="text-red-600 dark:text-red-400 line-through truncate">{entry.wrong}</span>
                  <span className="text-gray-400">→</span>
                  <span className="text-green-600 dark:text-green-400 font-medium truncate">{entry.correct}</span>
                </div>
                <button
                  onClick={() => handleDelete(entry.wrong)}
                  className="text-gray-400 hover:text-red-600 p-1 flex-shrink-0"
                  title="Löschen"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M18 6L6 18"/>
                    <path d="M6 6l12 12"/>
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <p className="text-xs text-gray-500">
        Diese Wörter werden bei der Korrektur automatisch berücksichtigt.
      </p>
    </div>
  );
}

export { DictionaryManager };
