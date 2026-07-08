"use client";
import { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from './AuthProvider';
import PromptManager from './PromptManager';

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
  const [tab, setTab] = useState<'formattings' | 'abbreviations' | 'prompts'>('formattings');
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

  // Edit / New modal state
  const [editItem, setEditItem] = useState<FormattingRule | null>(null);
  const [editCommands, setEditCommands] = useState('');
  const [editReplacement, setEditReplacement] = useState('');
  const [showNewModal, setShowNewModal] = useState(false);
  const [newCommands, setNewCommands] = useState('');
  const [newReplacement, setNewReplacement] = useState('');
  const allSourceIdsRef = useRef<Set<string>>(new Set());

  // Generate ID from commands string (mirrors makeId in formattings route)
  const makeId = (commands: string): string => {
    return commands.toLowerCase().replace(/\s+/g, '-').replace(/[^a-zäöüß0-9-]/g, '');
  };

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

  const saveNewRule = useCallback(async () => {
    const trimmedCommands = newCommands.trim();
    const trimmedReplacement = newReplacement.trim();
    if (!trimmedCommands || !trimmedReplacement) return;

    const newId = makeId(trimmedCommands);
    const next = { ...customFormattings };
    next[newId] = { commands: trimmedCommands, replacement: trimmedReplacement };

    setCustomFormattings(next);
    setShowNewModal(false);
    setNewCommands('');
    setNewReplacement('');

    try {
      const res = await fetch('/api/users/settings', {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ customFormattings: next }),
      });
      if (!res.ok) {
        loadData(); // rollback
      }
    } catch {
      loadData(); // rollback
    }
  }, [newCommands, newReplacement, customFormattings, headers, loadData]);

  const deleteCustomRule = useCallback(async (id: string) => {
    const next = { ...customFormattings };
    delete next[id];
    setCustomFormattings(next);

    try {
      const res = await fetch('/api/users/settings', {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ customFormattings: next }),
      });
      if (!res.ok) {
        loadData(); // rollback
      }
    } catch {
      loadData(); // rollback
    }
  }, [customFormattings, headers, loadData]);

  const saveEdit = useCallback(async () => {
    if (!editItem) return;
    const next = { ...customFormattings };
    const trimmedCommands = editCommands.trim();
    const trimmedReplacement = editReplacement.trim();

    if (trimmedCommands === editItem.commands && trimmedReplacement === editItem.replacement) {
      if (!allSourceIdsRef.current.has(editItem.id)) {
        // Custom-only rule: no change = nichts tun (nicht löschen!)
        closeEdit();
        return;
      }
      // Override einer eingebauten Regel: kein Change → Override entfernen (Revert)
      if (next[editItem.id]) {
        delete next[editItem.id];
      } else {
        closeEdit();
        return;
      }
    } else {
      const existing = next[editItem.id] ?? {};
      next[editItem.id] = {
        commands: trimmedCommands !== editItem.commands ? trimmedCommands : existing.commands,
        replacement: trimmedReplacement !== editItem.replacement ? trimmedReplacement : existing.replacement,
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

  // Collect all known source IDs to distinguish overrides from new custom rules
  const allSourceIds = new Set<string>();
  for (const cat of categories) {
    for (const item of cat.items) {
      allSourceIds.add(item.id);
    }
  }
  for (const cat of abbrCategories) {
    for (const item of cat.items) {
      allSourceIds.add(item.id);
    }
  }
  allSourceIdsRef.current = allSourceIds;

  // Custom-only rules: entries in customFormattings whose ID doesn't exist in source
  const customOnlyRules: FormattingRule[] = [];
  // Also need ids that match the overrides pattern (allSourceIds check)
  const knownIdsFromCustom = new Set<string>();
  for (const [id, ov] of Object.entries(customFormattings)) {
    if (!allSourceIds.has(id)) {
      customOnlyRules.push({
        id,
        commands: ov.commands ?? id.replace(/-/g, ' '),
        replacement: ov.replacement ?? '',
      });
    }
  }

  const currentCategories = tab === 'formattings' ? categories : abbrCategories;

  // Prompt tab is only for root/admin
  const showPromptTab = username === 'root';

  if (loading) {
    return <div className="text-sm text-gray-500 dark:text-gray-400 p-4">Lade Formatierungsregeln…</div>;
  }

  if (error) {
    return <div className="text-sm text-red-500 p-4">Fehler: {error}</div>;
  }

  // Full-screen prompt editor when prompts tab is active
  if (tab === 'prompts') {
    return (
      <div className="space-y-3">
        <div className="flex gap-1 border-b border-gray-200 dark:border-gray-700 pb-1">
          <button
            onClick={() => setTab('formattings')}
            className="text-xs px-3 py-1 rounded-t font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
          >
            🔣 Formatierung
          </button>
          <button
            onClick={() => setTab('abbreviations')}
            className="text-xs px-3 py-1 rounded-t font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
          >
            📏 Abkürzungen
          </button>
          {showPromptTab && (
            <button
              onClick={() => setTab('prompts')}
              className="text-xs px-3 py-1 rounded-t font-medium bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 transition-colors"
            >
              📝 Prompts
            </button>
          )}
        </div>
        <PromptManager />
      </div>
    );
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
        {showPromptTab && (
          <button
            onClick={() => setTab('prompts')}
            className="text-xs px-3 py-1 rounded-t font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
          >
            📝 Prompts
          </button>
        )}
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

      {/* Neue Formatierung button */}
      <button
        onClick={() => { setShowNewModal(true); setNewCommands(''); setNewReplacement(''); }}
        className="text-xs px-3 py-1.5 rounded bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 hover:bg-green-200 dark:hover:bg-green-800/60 transition-colors w-full"
      >
        ➕ Neue {tab === 'formattings' ? 'Formatierung' : 'Abkürzung'}
      </button>

      <div className="space-y-4">
        {/* Custom-only rules section */}
        {customOnlyRules.length > 0 && tab === 'formattings' && (
          <div>
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1.5 flex items-center gap-1.5">
              <span>⭐</span>
              <span>Benutzerdefiniert</span>
            </h3>
            <div className="space-y-0.5">
              {customOnlyRules.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-gray-50 dark:hover:bg-gray-800/40"
                >
                  <div className="w-4 shrink-0" /> {/* spacer instead of checkbox */}
                  <button
                    onClick={() => openEdit(item)}
                    className="shrink-0 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                    title="Regel bearbeiten"
                  >
                    ✏️
                  </button>
                  <code className="font-medium shrink-0 text-blue-700 dark:text-blue-300">
                    {item.commands}
                  </code>
                  <span className="text-gray-400 dark:text-gray-500 mx-1">→</span>
                  <code className="shrink-0 font-mono text-[11px] text-blue-600 dark:text-blue-400">
                    {item.replacement}
                  </code>
                  <span className="text-[10px] text-blue-500 dark:text-blue-400 italic shrink-0">(benutzerdefiniert)</span>
                  <button
                    onClick={() => deleteCustomRule(item.id)}
                    className="ml-auto shrink-0 text-gray-400 hover:text-red-500 dark:hover:text-red-400 transition-colors"
                    title="Regel löschen"
                  >
                    🗑
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

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
              ✏️ {customOnlyRules.some(r => r.id === editItem.id) ? 'Benutzerdefinierte Regel bearbeiten' : 'Formatierung bearbeiten'}
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

      {/* New rule modal */}
      {showNewModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={() => setShowNewModal(false)}>
          <div
            className="bg-white dark:bg-gray-800 rounded-lg shadow-xl p-5 w-full max-w-md mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-4">
              ➕ Neue {tab === 'formattings' ? 'Formatierung' : 'Abkürzung'}
            </h3>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Sprachbefehl (commands)
                </label>
                <input
                  type="text"
                  value={newCommands}
                  onChange={(e) => setNewCommands(e.target.value)}
                  placeholder="z.B. herzlich willkommen"
                  className="w-full text-xs px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
                  Ersetzung (replacement)
                </label>
                <input
                  type="text"
                  value={newReplacement}
                  onChange={(e) => setNewReplacement(e.target.value)}
                  placeholder="z.B. Herzlich willkommen"
                  className="w-full text-xs px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button
                onClick={() => setShowNewModal(false)}
                className="text-xs px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              >
                Abbrechen
              </button>
              <button
                onClick={saveNewRule}
                disabled={!newCommands.trim() || !newReplacement.trim()}
                className="text-xs px-3 py-1.5 rounded bg-green-600 text-white hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                Anlegen
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
