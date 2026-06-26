'use client';
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthProvider';
import TemplateRichTextEditor from './TemplateRichTextEditor';
import { normalizeRichTextRanges, type RichTextFormatRange } from '@/lib/richTextFormatting';

interface TemplateGroup {
  id: number;
  name: string;
  description: string;
  memberCount: number;
  entryCount: number;
}

interface GroupEntry {
  id: number;
  name: string;
  content: string;
  field: 'methodik' | 'befund' | 'beurteilung';
  formatRanges?: any[];
  addedBy?: string;
}

interface ImportCandidate {
  sourceUsername: string;
  name: string;
  content: string;
  field: 'methodik' | 'befund' | 'beurteilung';
  formatRanges?: any[];
  alreadyInGroup: boolean;
  groupName?: string;
}

const TEMPLATES_CHANGED_EVENT = 'templates-changed';

function notifyTemplatesChanged() {
  window.dispatchEvent(new CustomEvent(TEMPLATES_CHANGED_EVENT));
}

export default function GroupTemplateManager() {
  const { getAuthHeader, getDbTokenHeader } = useAuth();
  const [groups, setGroups] = useState<TemplateGroup[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [entries, setEntries] = useState<GroupEntry[]>([]);
  const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
  const [selectedCandidateKeys, setSelectedCandidateKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Entry form
  const [entryName, setEntryName] = useState('');
  const [entryContent, setEntryContent] = useState('');
  const [entryFormats, setEntryFormats] = useState<RichTextFormatRange[]>([]);
  const [entryField, setEntryField] = useState<'methodik' | 'befund' | 'beurteilung'>('befund');
  const [editingEntryName, setEditingEntryName] = useState<string | null>(null);
  const [overwriteExisting, setOverwriteExisting] = useState(false);

  const [filter, setFilter] = useState('');

  const selectedGroup = groups.find(g => g.id === selectedGroupId) || null;
  const normalizedFilter = filter.trim().toLowerCase();

  const visibleEntries = useMemo(
    () => entries.filter(e => !normalizedFilter || [e.name, e.content, e.field, e.addedBy].some(v => v?.toLowerCase().includes(normalizedFilter))),
    [entries, normalizedFilter]
  );

  const visibleCandidates = useMemo(
    () => candidates.filter(c => !normalizedFilter || [c.sourceUsername, c.name].some(v => v?.toLowerCase().includes(normalizedFilter))),
    [candidates, normalizedFilter]
  );

  const headers = () => ({
    'Authorization': getAuthHeader(),
    ...getDbTokenHeader(),
  });
  const jsonHeaders = () => ({ 'Content-Type': 'application/json', ...headers() });

  const fetchOverview = async () => {
    try {
      setError('');
      const res = await fetch('/api/template-groups', { headers: headers() });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Fehler'); return; }
      setGroups(data.groups || []);
      if (!selectedGroupId && data.groups?.length) setSelectedGroupId(data.groups[0].id);
    } catch { setError('Fehler beim Laden'); }
    finally { setLoading(false); }
  };

  const fetchGroupDetails = async (groupId: number) => {
    setDetailLoading(true);
    try {
      setError('');
      const [detailRes, candRes] = await Promise.all([
        fetch(`/api/template-groups?groupId=${groupId}`, { headers: headers() }),
        fetch(`/api/template-groups?groupId=${groupId}&include=import-candidates`, { headers: headers() }),
      ]);
      const detail = await detailRes.json();
      const cand = await candRes.json();
      if (!detailRes.ok) { setError(detail.error || 'Fehler'); return; }
      setEntries(detail.entries || []);
      setCandidates(cand.candidates || []);
      setSelectedCandidateKeys(new Set());
      setEditingEntryName(null);
    } catch { setError('Fehler beim Laden'); }
    finally { setDetailLoading(false); }
  };

  useEffect(() => { fetchOverview(); }, []);
  useEffect(() => {
    if (selectedGroupId) fetchGroupDetails(selectedGroupId);
    else { setEntries([]); setCandidates([]); }
  }, [selectedGroupId]);

  // ─── Add/Edit entry ────────────────────────────────────────
  const resetEntryForm = () => {
    setEntryName(''); setEntryContent(''); setEntryFormats([]); setEntryField('befund');
    setEditingEntryName(null);
  };

  const handleAddEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedGroupId) return;
    setError(''); setSuccess('');
    try {
      const res = await fetch('/api/template-groups', {
        method: 'POST', headers: jsonHeaders(),
        body: JSON.stringify({
          action: 'add-entry', groupId: selectedGroupId,
          name: entryName.trim(), content: entryContent.trim(),
          field: entryField, formatRanges: normalizeRichTextRanges(entryFormats, entryContent.length),
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { setError(data.error || 'Fehler'); return; }

      if (editingEntryName && editingEntryName !== entryName.trim()) {
        await fetch('/api/template-groups', {
          method: 'DELETE', headers: jsonHeaders(),
          body: JSON.stringify({ action: 'delete-entry', groupId: selectedGroupId, name: editingEntryName }),
        });
      }

      setSuccess(editingEntryName ? `"${entryName}" aktualisiert` : `"${entryName}" hinzugefügt`);
      resetEntryForm();
      await fetchGroupDetails(selectedGroupId);
      await fetchOverview();
      notifyTemplatesChanged();
    } catch { setError('Verbindungsfehler'); }
  };

  const handleEditEntry = (entry: GroupEntry) => {
    setEditingEntryName(entry.name);
    setEntryName(entry.name);
    setEntryContent(entry.content);
    setEntryFormats(entry.formatRanges ?? []);
    setEntryField(entry.field);
    setError(''); setSuccess('');
  };

  const handleDeleteEntry = async (name: string) => {
    if (!selectedGroupId) return;
    try {
      setError('');
      const res = await fetch('/api/template-groups', {
        method: 'DELETE', headers: jsonHeaders(),
        body: JSON.stringify({ action: 'delete-entry', groupId: selectedGroupId, name }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { setError(data.error || 'Fehler'); return; }
      await fetchGroupDetails(selectedGroupId);
      await fetchOverview();
      notifyTemplatesChanged();
    } catch { setError('Verbindungsfehler'); }
  };

  // ─── Import candidates ─────────────────────────────────────
  const candidateKey = (c: ImportCandidate) => `${c.sourceUsername}\u0000${c.name}`;
  const toggleCandidate = (key: string, checked: boolean) => {
    setSelectedCandidateKeys(prev => { const n = new Set(prev); if (checked) n.add(key); else n.delete(key); return n; });
  };
  const toggleAll = (checked: boolean) => {
    setSelectedCandidateKeys(checked ? new Set(visibleCandidates.map(candidateKey)) : new Set());
  };

  const handleImport = async () => {
    if (!selectedGroupId) return;
    const selected = candidates.filter(c => selectedCandidateKeys.has(candidateKey(c)));
    if (!selected.length) { setError('Keine ausgewählt'); return; }
    try {
      setError(''); setSuccess('');
      const res = await fetch('/api/template-groups', {
        method: 'POST', headers: jsonHeaders(),
        body: JSON.stringify({ action: 'import-entries', groupId: selectedGroupId, overwriteExisting, entries: selected }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { setError(data.error || 'Fehler'); return; }
      setSuccess(`${data.imported} Bausteine importiert, ${data.skipped} übersprungen`);
      await fetchGroupDetails(selectedGroupId);
      await fetchOverview();
      notifyTemplatesChanged();
    } catch { setError('Verbindungsfehler'); }
  };

  const fieldLabels: Record<string, string> = { methodik: 'Methodik', befund: 'Befund', beurteilung: 'Beurteilung' };

  if (loading) return <div className="text-center py-4 text-sm text-gray-500">Lade Gruppen...</div>;

  return (
    <div className="space-y-4">
      {/* Fehler + Erfolg */}
      {error && <div className="p-2 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded">{error}</div>}
      {success && <div className="p-2 text-sm text-green-600 bg-green-50 dark:bg-green-900/20 rounded">{success}</div>}

      <div className="flex gap-4">
        {/* ─── Linke Spalte: Gruppenliste ─────────────── */}
        <div className="w-56 shrink-0 space-y-3">
          <div className="space-y-1 max-h-[400px] overflow-y-auto">
            {groups.map(g => (
              <button key={g.id} onClick={() => setSelectedGroupId(g.id)}
                className={`w-full text-left px-2 py-1.5 text-xs rounded transition-colors ${
                  selectedGroupId === g.id ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium' : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                }`}>
                <div className="truncate font-medium">{g.name}</div>
                <div className="text-[10px] opacity-60">{g.memberCount} Mitglieder · {g.entryCount} Bausteine</div>
              </button>
            ))}
            {groups.length === 0 && <p className="text-xs text-gray-400 italic px-2">Keine Gruppen</p>}
          </div>
        </div>

        {/* ─── Rechte Spalte: Detailansicht ─────────────────── */}
        <div className="flex-1 min-w-0">
          {!selectedGroup ? (
            <p className="text-sm text-gray-500 italic">Bitte Gruppe auswählen</p>
          ) : detailLoading ? (
            <p className="text-sm text-gray-500">Lade...</p>
          ) : (
            <div className="space-y-4">
              {/* Gruppen-Header */}
              <div>
                <h3 className="font-semibold text-sm">{selectedGroup.name}</h3>
                {selectedGroup.description && <p className="text-xs text-gray-500">{selectedGroup.description}</p>}
              </div>

              {/* Filter */}
              <input type="text" value={filter} onChange={e => setFilter(e.target.value)}
                placeholder="Filtern..." className="w-full px-2 py-1 text-xs border rounded dark:bg-gray-700 dark:border-gray-600" />

              {/* Entry-Formular */}
              <form onSubmit={handleAddEntry} className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-2">
                <h4 className="text-xs font-medium">{editingEntryName ? 'Baustein bearbeiten' : 'Neuen Baustein hinzufügen'}</h4>
                <div className="flex gap-2">
                  <input type="text" value={entryName} onChange={e => setEntryName(e.target.value)}
                    placeholder="Name (z.B. CCT)" className="flex-1 px-2 py-1 text-xs border rounded dark:bg-gray-700 dark:border-gray-600" required />
                  <select value={entryField} onChange={e => setEntryField(e.target.value as any)}
                    className="px-2 py-1 text-xs border rounded dark:bg-gray-700 dark:border-gray-600">
                    <option value="methodik">Methodik</option>
                    <option value="befund">Befund</option>
                    <option value="beurteilung">Beurteilung</option>
                  </select>
                </div>
                <TemplateRichTextEditor
                  value={entryContent} formats={entryFormats}
                  onChange={(v, f) => { setEntryContent(v); setEntryFormats(f); }}
                  className="textarea w-full px-2 py-1 text-xs border rounded dark:bg-gray-700 dark:border-gray-600 min-h-[60px]"
                />
                <div className="flex gap-2">
                  <button type="submit" disabled={!entryName.trim() || !entryContent.trim()}
                    className="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50">
                    {editingEntryName ? 'Speichern' : 'Hinzufügen'}
                  </button>
                  {editingEntryName && (
                    <button type="button" onClick={resetEntryForm} className="px-3 py-1 text-xs bg-gray-300 dark:bg-gray-600 rounded hover:bg-gray-400">
                      Abbrechen
                    </button>
                  )}
                </div>
              </form>

              {/* Einträge */}
              <div className="space-y-1 max-h-[250px] overflow-y-auto">
                {visibleEntries.map(e => (
                  <div key={e.id} className="flex items-start justify-between gap-2 p-2 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded text-xs">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1">
                        <span className="font-medium">{e.name}</span>
                        <span className="px-1 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">{fieldLabels[e.field]}</span>
                      </div>
                      <p className="text-gray-500 truncate mt-0.5">{e.content}</p>
                      {e.addedBy && <p className="text-[10px] text-gray-400 mt-0.5">von {e.addedBy}</p>}
                    </div>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => handleEditEntry(e)} className="p-1 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded" title="Bearbeiten">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>
                      </button>
                      <button onClick={() => handleDeleteEntry(e.name)} className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded" title="Löschen">
                        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
                      </button>
                    </div>
                  </div>
                ))}
                {visibleEntries.length === 0 && <p className="text-xs text-gray-400 italic">Keine Einträge</p>}
              </div>

              {/* Import-Kandidaten */}
              {candidates.length > 0 && (
                <div className="space-y-2 border-t pt-3">
                  <div className="flex items-center justify-between">
                    <h4 className="text-xs font-medium text-gray-500">Benutzer-Bausteine importieren</h4>
                    <label className="flex items-center gap-1 text-xs text-gray-500">
                      <input type="checkbox" checked={overwriteExisting} onChange={e => setOverwriteExisting(e.target.checked)} className="rounded" />
                      Überschreiben
                    </label>
                  </div>
                  <div className="flex items-center gap-1 text-xs mb-1">
                    <button onClick={() => toggleAll(true)} className="text-blue-500 hover:underline">Alle</button>
                    <span className="text-gray-300">·</span>
                    <button onClick={() => toggleAll(false)} className="text-blue-500 hover:underline">Keine</button>
                  </div>
                  <div className="space-y-1 max-h-[200px] overflow-y-auto">
                    {visibleCandidates.map(c => {
                      const key = candidateKey(c);
                      const selected = selectedCandidateKeys.has(key);
                      return (
                        <div key={key} className={`flex items-center gap-2 p-1.5 rounded text-xs ${c.alreadyInGroup ? 'bg-gray-50 dark:bg-gray-800/50 opacity-60' : ''}`}>
                          <input type="checkbox" checked={selected} onChange={e => toggleCandidate(key, e.target.checked)}
                            disabled={!overwriteExisting && c.alreadyInGroup} className="rounded" />
                          <span className="font-medium w-20 truncate shrink-0 text-gray-500">{c.sourceUsername}</span>
                          <span className="font-medium truncate">{c.name}</span>
                          <span className="text-[10px] px-1 bg-blue-100 dark:bg-blue-900/30 rounded shrink-0">{fieldLabels[c.field]}</span>
                          {c.alreadyInGroup && <span className="text-[10px] text-amber-500 shrink-0">bereits vorhanden</span>}
                        </div>
                      );
                    })}
                  </div>
                  <button onClick={handleImport} disabled={selectedCandidateKeys.size === 0}
                    className="px-3 py-1 text-xs bg-emerald-500 text-white rounded hover:bg-emerald-600 disabled:opacity-50">
                    Ausgewählte importieren ({selectedCandidateKeys.size})
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
