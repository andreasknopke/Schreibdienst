"use client";
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthProvider';

interface FormattingRule {
  id: string;
  commands: string;
  replacement: string;
}

interface RuleCategory {
  category: string;
  icon: string;
  items: FormattingRule[];
}

type CustomFormattings = Record<string, { commands?: string; replacement?: string }>;

export default function FormattingRulesViewer() {
  const { username, getAuthHeader, getDbTokenHeader } = useAuth();
  const [tab, setTab] = useState<'formattings' | 'abbreviations'>('formattings');
  const [categories, setCategories] = useState<RuleCategory[]>([]);
  const [abbrCategories, setAbbrCategories] = useState<RuleCategory[]>([]);
  const [disabledIds, setDisabledIds] = useState<Set<string>>(new Set());
  const [disabledAbbrIds, setDisabledAbbrIds] = useState<Set<string>>(new Set());
  const [customFormattings, setCustomFormattings] = useState<CustomFormattings>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastMsg, setBroadcastMsg] = useState('');

  // Edit modal state
  const [editItem, setEditItem] = useState<FormattingRule | null>(null);
  const [editCommands, setEditCommands] = useState('');
  const [editReplacement, setEditReplacement] = useState('');

  const headers = useCallback(() => ({
    'Authorization': getAuthHeader(),
    ...getDbTokenHeader(),
    'Content-Type': 'application/json',
  }), [getAuthHeader, getDbTokenHeader]);

  const loadData = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch('/api/formattings').then(r => r.json()),
      fetch('/api/users/settings', { headers: { 'Authorization': getAuthHeader(), ...getDbTokenHeader() } }).then(r => r.json()),
    ])
      .then(([fmtData, settingsData]) => {
        setCategories(fmtData.rules || []);
        setAbbrCategories(fmtData.abbreviations || []);
        const d = settingsData.disabledFormattings;
        const da = settingsData.disabledAbbreviations;
        if (Array.isArray(d)) setDisabledIds(new Set(d));
        if (Array.isArray(da)) setDisabledAbbrIds(new Set(da));
        if (settingsData.customFormattings && typeof settingsData.customFormattings === 'object') {
          setCustomFormattings(settingsData.customFormattings as CustomFormattings);
        }
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [getAuthHeader, getDbTokenHeader]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const ids = tab === 'formattings' ? disabledIds : disabledAbbrIds;
  const setIds = tab === 'formattings'
    ? (next: Set<string>) => setDisabledIds(next)
    : (next: Set<string>) => setDisabledAbbrIds(next);
  const settingKey = tab === 'formattings' ? 'disabledFormattings' : 'disabledAbbreviations';

  const toggleRule = useCallback(async (id: string) => {
    setSavingId(id);
    const wasDisabled = ids.has(id);
    const next = new Set(ids);
    if (wasDisabled) next.delete(id); else next.add(id);
    setIds(next);

    try {
      const res = await fetch('/api/users/settings', {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ [settingKey]: [...next] }),
      });
      if (!res.ok) {
        setIds(ids); // rollback
      }
    } catch {
      setIds(ids); // rollback
    } finally {
      setSavingId(null);
    }
  }, [ids, setIds, settingKey, headers]);

  const broadcastSettings = useCallback(async () => {
    setBroadcasting(true);
    setBroadcastMsg('');
    const key = tab === 'formattings' ? 'disabledFormattings' : 'disabledAbbreviations';
    const value = tab === 'formattings' ? [...disabledIds] : [...disabledAbbrIds];
    try {
      const res = await fetch('/api/users/settings/broadcast', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ [key]: value }),
      });
      const data = await res.json();
      if (data.success) {
        setBroadcastMsg(`✓ Auf ${data.updatedUsers} Benutzer übertragen`);
      } else {
        setBroadcastMsg(`✗ ${data.error || 'Fehler'}`);
      }
    } catch {
      setBroadcastMsg('✗ Verbindungsfehler');
    } finally {
      setBroadcasting(false);
      setTimeout(() => setBroadcastMsg(''), 4000);
    }
  }, [tab, disabledIds, disabledAbbrIds, headers]);

  // --- Edit handling ---
  const openEdit = useCallback((item: FormattingRule) => {
    const ov = customFormattings[item.id];
    setEditItem(item);
    setEditCommands(ov?.commands ?? item.commands);
    setEditReplacement(ov?.replacement ?? item.replacement);
  }, [customFormattings]);

  const closeEdit = useCallback(() => {
    setEditItem(null);
  }, []);

  const saveEdit = useCallback(async () => {
    if (!editItem) return;
    const next = { ...customFormattings };
    const trimmedCommands = editCommands.trim();
    const trimmedReplacement = editReplacement.trim();

    if (trimmedCommands === editItem.commands && trimmedReplacement === editItem.replacement) {
      // No change: remove override if exists
      if (next[editItem.id]) {
        delete next[editItem.id];
      } else {
        closeEdit();
        return; // nothing to save
      }
    } else {
      next[editItem.id] = {
        commands: trimmedCommands !== editItem.commands ? trimmedCommands : undefined,
        replacement: trimmedReplacement !== editItem.replacement ? trimmedReplacement : undefined,
      };
    }

    // Optimistic update
    setCustomFormattings(next);
    closeEdit();

    try {
      const res = await fetch('/api/users/settings', {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ customFormattings: next }),
      });
      if (!res.ok) {
        loadData(); // rollback by reloading
      }
    } catch {
      loadData(); // rollback by reloading
    }
  }, [editItem, customFormattings, headers, closeEdit, loadData]);

  // Merge custom overrides into items
  const mergeItems = useCallback((items: FormattingRule[]): FormattingRule[] => {
    return items.map((item) => {
      const ov = customFormattings[item.id];
      if (!ov) return item;
      return {
        ...item,
        commands: ov.commands ?? item.commands,
        replacement: ov.replacement ?? item.replacement,
      };
    });
  }, [customFormattings]);

  const currentCategories = tab === 'formattings' ? categories : abbrCategories;

  if (loading) {
    return <div className="text-sm text-gray-500 dark:text-gray-400 p-4">Lade Formatierungsregeln…</div>;
  }

  if (error) {
    return <div className="text-sm text-red-500 p-4">Fehler: {error}</div>;
  }

  return (
    <div className="space-y-3">
      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 pb-1">
        <button
          onClick={() => setTab('formattings')}
          className={`text-xs px-3 py-1 rounded-t font-medium transition-colors ${tab === 'formattings' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
        >
          🔣 Formatierung
        </button>
        <button
          onClick={() => setTab('abbreviations')}
          className={`text-xs px-3 py-1 rounded-t font-medium transition-colors ${tab === 'abbreviations' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
        >
          📏 Abkürzungen
        </button>
      </div>

      {/* Root: Broadcast-Button */}
      {username === 'root' && (
        <div className="flex items-center gap-2">
          <button
            onClick={broadcastSettings}
            disabled={broadcasting}
            className="text-xs px-2 py-1 rounded bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-300 hover:bg-amber-200 dark:hover:bg-amber-800/60 disabled:opacity-50 transition-colors"
            title={'Aktuelle ' + (tab === 'formattings' ? 'Formatierungs' : 'Abkürzungs') + '-Einstellungen auf ALLE Benutzer übertragen'}
          >
            {broadcasting ? '⏳ Übertrage…' : '📢 Auf alle Benutzer übertragen'}
          </button>
          {broadcastMsg && (
            <span className={`text-xs ${broadcastMsg.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>
              {broadcastMsg}
            </span>
          )}
        </div>
      )}

      <div className="space-y-4">
        {currentCategories.map((cat) => (
          <div key={cat.category}>
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1.5 flex items-center gap-1.5">
              <span>{cat.icon}</span>
              <span>{cat.category}</span>
            </h3>
            <div className="space-y-0.5">
              {mergeItems(cat.items).map((item) => {
                const isDisabled = ids.has(item.id);
                const isCustomized = !!customFormattings[item.id];
                return (
                  <div
                    key={item.id}
                    className={`flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-gray-50 dark:hover:bg-gray-800/40 ${isDisabled ? 'opacity-50' : ''}`}
                  >
                    <input
                      type="checkbox"
                      checked={!isDisabled}
                      onChange={() => toggleRule(item.id)}
                      disabled={savingId === item.id}
                      className="rounded shrink-0"
                      title={isDisabled ? 'Regel aktivieren' : 'Regel deaktivieren'}
                    />
                    <button
                      onClick={() => openEdit(item)}
                      className="shrink-0 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                      title="Regel bearbeiten"
                    >
                      ✏️
                    </button>
                    <code className={`font-medium shrink-0 ${isDisabled ? 'line-through' : isCustomized ? 'text-blue-700 dark:text-blue-300' : 'text-gray-800 dark:text-gray-200'}`}>
                      {item.commands}
                    </code>
                    <span className="text-gray-400 dark:text-gray-500 mx-1">→</span>
                    <code className={`shrink-0 font-mono text-[11px] ${isCustomized ? 'text-blue-600 dark:text-blue-400' : 'text-green-700 dark:text-green-400'}`}>
                      {item.replacement}
                    </code>
                    {isCustomized && (
                      <span className="text-[10px] text-blue-500 dark:text-blue-400 italic shrink-0">(angepasst)</span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Edit Modal */}
      {editItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={closeEdit}>
          <div
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-5 w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-4">
              ✏️ Formatierung bearbeiten
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Sprachbefehl (commands)
                </label>
                <input
                  type="text"
                  value={editCommands}
                  onChange={(e) => setEditCommands(e.target.value)}
                  className="w-full text-xs px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Ersetzung (replacement)
                </label>
                <input
                  type="text"
                  value={editReplacement}
                  onChange={(e) => setEditReplacement(e.target.value)}
                  className="w-full text-xs px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={closeEdit}
                className="text-xs px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                Abbrechen
              </button>
              <button
                onClick={saveEdit}
                className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 transition-colors"
              >
                Speichern
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
