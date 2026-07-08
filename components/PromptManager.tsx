"use client";
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthProvider';

interface PromptTemplate {
  id: string;
  label: string;
  group: string;
  file: string;
  defaultContent: string;
  overrideContent: string;
}

export default function PromptManager() {
  const { username, getAuthHeader, getDbTokenHeader } = useAuth();
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState('');

  const headers = useCallback(() => ({
    'Authorization': getAuthHeader(),
    ...getDbTokenHeader(),
    'Content-Type': 'application/json',
  }), [getAuthHeader, getDbTokenHeader]);

  const loadData = useCallback(() => {
    setLoading(true);
    fetch('/api/prompts', { headers: headers() })
      .then((r) => {
        if (!r.ok) throw new Error(r.status === 403 ? 'Nur root' : 'Fehler beim Laden');
        return r.json();
      })
      .then((data) => {
        setTemplates(data.templates || []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [headers]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Group templates by category
  const groups = new Map<string, PromptTemplate[]>();
  for (const t of templates) {
    const list = groups.get(t.group) || [];
    list.push(t);
    groups.set(t.group, list);
  }

  const selected = templates.find((t) => t.id === selectedId);

  const openEditor = useCallback((tpl: PromptTemplate) => {
    setSelectedId(tpl.id);
    setEditContent(tpl.overrideContent || tpl.defaultContent);
    setSaveMsg('');
  }, []);

  const closeEditor = useCallback(() => {
    setSelectedId(null);
    setEditContent('');
    setSaveMsg('');
  }, []);

  const savePrompt = useCallback(async () => {
    if (!selectedId) return;
    setSaving(true);
    setSaveMsg('');
    try {
      const res = await fetch('/api/prompts', {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ id: selectedId, content: editContent }),
      });
      const data = await res.json();
      if (data.success) {
        setSaveMsg('✓ Gespeichert');
        // Update override in local state
        setTemplates((prev) =>
          prev.map((t) =>
            t.id === selectedId
              ? { ...t, overrideContent: editContent.trim() ? editContent : '' }
              : t
          )
        );
      } else {
        setSaveMsg(`✗ ${data.error || 'Fehler'}`);
      }
    } catch {
      setSaveMsg('✗ Verbindungsfehler');
    } finally {
      setSaving(false);
      setTimeout(() => setSaveMsg(''), 3000);
    }
  }, [selectedId, editContent, headers]);

  const resetToDefault = useCallback(() => {
    const tpl = templates.find((t) => t.id === selectedId);
    if (tpl) {
      setEditContent(tpl.defaultContent);
    }
  }, [selectedId, templates]);

  if (loading) {
    return <div className="text-sm text-gray-500 dark:text-gray-400 p-4">Lade Prompt-Vorlagen…</div>;
  }

  if (error) {
    return <div className="text-sm text-red-500 p-4">Fehler: {error}</div>;
  }

  return (
    <div className="space-y-3">
      {selected ? (
        /* Editor */
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <button
                onClick={closeEditor}
                className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 shrink-0"
              >
                ← Zurück
              </button>
              <span className="text-sm font-semibold text-gray-800 dark:text-gray-200">
                {selected.label}
              </span>
              <span className="text-[10px] text-gray-400 dark:text-gray-500">
                ({selected.file})
              </span>
            </div>
            <div className="flex items-center gap-2">
              {selected.overrideContent && (
                <span className="text-[10px] text-blue-500 italic">(angepasst)</span>
              )}
              {saveMsg && (
                <span className={`text-xs ${saveMsg.startsWith('✓') ? 'text-green-600' : 'text-red-500'}`}>
                  {saveMsg}
                </span>
              )}
            </div>
          </div>
          <textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full h-[400px] text-xs font-mono px-3 py-2 border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-800 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500 resize-y"
            spellCheck={false}
          />
          <div className="flex justify-end gap-2 mt-3">
            <button
              onClick={resetToDefault}
              className="text-xs px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              Auf Standard zurücksetzen
            </button>
            <button
              onClick={closeEditor}
              className="text-xs px-3 py-1.5 rounded border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
            >
              Abbrechen
            </button>
            <button
              onClick={savePrompt}
              disabled={saving}
              className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {saving ? 'Speichere…' : 'Speichern'}
            </button>
          </div>
        </div>
      ) : (
        /* List view */
        <>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            Wähle eine Prompt-Vorlage zum Bearbeiten aus. Änderungen werden in der Datenbank gespeichert und sind sofort wirksam.
          </div>
          {Array.from(groups.entries()).map(([group, items]) => (
            <div key={group}>
              <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1.5">
                {group}
              </h3>
              <div className="space-y-0.5">
                {items.map((tpl) => {
                  const hasOverride = !!tpl.overrideContent;
                  return (
                    <button
                      key={tpl.id}
                      onClick={() => openEditor(tpl)}
                      className={`w-full text-left flex items-center gap-2 rounded px-2 py-1.5 text-xs hover:bg-gray-50 dark:hover:bg-gray-800/40 transition-colors ${hasOverride ? 'text-blue-700 dark:text-blue-300' : 'text-gray-700 dark:text-gray-300'}`}
                    >
                      <span className="shrink-0">{hasOverride ? '📝' : '📄'}</span>
                      <span className="font-medium">{tpl.label}</span>
                      {hasOverride && (
                        <span className="text-[10px] text-blue-500 italic">(angepasst)</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
