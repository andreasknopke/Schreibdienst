"use client";
import { useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthProvider';

interface User {
  username: string;
  isAdmin: boolean;
}

interface DictionaryGroup {
  id: number;
  name: string;
  description: string;
  promptInsert?: string;
  memberCount: number;
  entryCount: number;
}

interface GroupMember {
  username: string;
}

interface GroupEntry {
  id: number;
  wrong: string;
  correct: string;
  useInPrompt?: boolean;
  matchStem?: boolean;
  addedBy?: string;
}

interface ImportCandidate {
  sourceUsername: string;
  wrong: string;
  correct: string;
  useInPrompt?: boolean;
  matchStem?: boolean;
  alreadyInGroup: boolean;
  groupCorrect?: string;
}

interface EditableEntryDraft {
  originalWrong: string;
  wrong: string;
  correct: string;
  useInPrompt: boolean;
  matchStem: boolean;
}

interface EditableCandidateDraft extends EditableEntryDraft {
  sourceUsername: string;
}

const DICTIONARY_CHANGED_EVENT = 'schreibdienst:dictionary-changed';

function candidateKey(candidate: ImportCandidate): string {
  return `${candidate.sourceUsername}\u0000${candidate.wrong}\u0000${candidate.correct}`;
}

function notifyDictionaryChanged() {
  window.dispatchEvent(new CustomEvent(DICTIONARY_CHANGED_EVENT, {
    detail: { scope: 'group' }
  }));
}

export default function GroupDictionaryManager() {
  const { getAuthHeader, getDbTokenHeader, username } = useAuth();
  const isRoot = username?.toLowerCase() === 'root';
  const [groups, setGroups] = useState<DictionaryGroup[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [selectedTab, setSelectedTab] = useState<'groups' | 'all-user-entries'>('groups');
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [entries, setEntries] = useState<GroupEntry[]>([]);
  const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
  const [selectedCandidateKeys, setSelectedCandidateKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [warning, setWarning] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDescription, setNewGroupDescription] = useState('');
  const [wrong, setWrong] = useState('');
  const [correct, setCorrect] = useState('');
  const [useInPrompt, setUseInPrompt] = useState(false);
  const [matchStem, setMatchStem] = useState(false);
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [filter, setFilter] = useState('');
  const [editingGroupEntry, setEditingGroupEntry] = useState<EditableEntryDraft | null>(null);
  const [editingCandidate, setEditingCandidate] = useState<EditableCandidateDraft | null>(null);
  const [savingCandidateEdit, setSavingCandidateEdit] = useState(false);
  const [groupPromptInsert, setGroupPromptInsert] = useState('');
  const [savingGroupPromptInsert, setSavingGroupPromptInsert] = useState(false);

  // Alle Benutzerwörterbucheinträge (nur root)
  const [allUserEntries, setAllUserEntries] = useState<Array<{
    username: string;
    wrong: string;
    correct: string;
    addedAt: string;
    useInPrompt?: boolean;
    matchStem?: boolean;
  }>>([]);
  const [allUserEntriesLoading, setAllUserEntriesLoading] = useState(false);
  const [allUserEntriesFilter, setAllUserEntriesFilter] = useState('');

  const selectedGroup = groups.find(group => group.id === selectedGroupId) || null;
  const selectedMemberNames = useMemo(() => new Set(members.map(member => member.username)), [members]);
  const normalizedFilter = filter.trim().toLowerCase();
  const normalizedAllUserFilter = allUserEntriesFilter.trim().toLowerCase();
  const visibleAllUserEntries = useMemo(
    () => allUserEntries.filter((entry) => {
      if (!normalizedAllUserFilter) return true;
      return [entry.username, entry.wrong, entry.correct]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalizedAllUserFilter));
    }),
    [allUserEntries, normalizedAllUserFilter]
  );
  const visibleEntries = useMemo(
    () => entries.filter((entry) => {
      if (!normalizedFilter) return true;
      return [entry.wrong, entry.correct, entry.addedBy]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalizedFilter));
    }),
    [entries, normalizedFilter]
  );
  const visibleCandidates = useMemo(
    () => candidates.filter((candidate) => {
      if (!normalizedFilter) return true;
      return [candidate.sourceUsername, candidate.wrong, candidate.correct, candidate.groupCorrect]
        .filter(Boolean)
        .some((value) => value!.toLowerCase().includes(normalizedFilter));
    }),
    [candidates, normalizedFilter]
  );
  const selectableCandidateKeys = useMemo(
    () => visibleCandidates
      .filter(candidate => overwriteExisting || !candidate.alreadyInGroup)
      .map(candidateKey),
    [visibleCandidates, overwriteExisting]
  );

  const requestHeaders = () => ({
    'Authorization': getAuthHeader(),
    ...getDbTokenHeader(),
  });

  const requestJsonHeaders = () => ({
    'Content-Type': 'application/json',
    ...requestHeaders(),
  });

  const fetchOverview = async () => {
    try {
      setError('');
      const response = await fetch('/api/dictionary-groups', { headers: requestHeaders() });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Fehler beim Laden der Gruppen');
        return;
      }
      setGroups(data.groups || []);
      setUsers(data.users || []);
      if (!selectedGroupId && data.groups?.length) {
        setSelectedGroupId(data.groups[0].id);
      }
    } catch {
      setError('Fehler beim Laden der Gruppen');
    } finally {
      setLoading(false);
    }
  };

  const fetchGroupDetails = async (groupId: number) => {
    setDetailLoading(true);
    try {
      setError('');
      const [detailResponse, candidatesResponse] = await Promise.all([
        fetch(`/api/dictionary-groups?groupId=${groupId}`, { headers: requestHeaders() }),
        fetch(`/api/dictionary-groups?groupId=${groupId}&include=import-candidates`, { headers: requestHeaders() }),
      ]);
      const detailData = await detailResponse.json();
      const candidatesData = await candidatesResponse.json();

      if (!detailResponse.ok) {
        setError(detailData.error || 'Fehler beim Laden der Gruppe');
        return;
      }
      if (!candidatesResponse.ok) {
        setError(candidatesData.error || 'Fehler beim Laden der Importliste');
        return;
      }

      setEntries(detailData.entries || []);
      setMembers(detailData.members || []);
      setCandidates(candidatesData.candidates || []);
      setSelectedCandidateKeys(new Set());
      setEditingGroupEntry(null);
      setEditingCandidate(null);
    } catch {
      setError('Fehler beim Laden der Gruppe');
    } finally {
      setDetailLoading(false);
    }
  };

  const fetchAllUserEntries = async () => {
    setAllUserEntriesLoading(true);
    try {
      setError('');
      const response = await fetch('/api/dictionary-groups?include=all-user-entries', {
        headers: requestHeaders(),
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Fehler beim Laden der Benutzerwörterbücher');
        return;
      }
      setAllUserEntries(data.entries || []);
    } catch {
      setError('Verbindungsfehler');
    } finally {
      setAllUserEntriesLoading(false);
    }
  };

  const handleDeleteAllUserEntry = async (targetUsername: string, wrongWord: string) => {
    setError('');
    setSuccess('');
    try {
      const response = await fetch('/api/dictionary', {
        method: 'DELETE',
        headers: requestJsonHeaders(),
        body: JSON.stringify({ username: targetUsername, wrong: wrongWord }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setError(data.error || 'Fehler beim Löschen');
        return;
      }
      setSuccess(`„${wrongWord}“ von ${targetUsername} gelöscht`);
      // Tabelle aktualisieren
      setAllUserEntries(prev => prev.filter(
        e => !(e.username === targetUsername && e.wrong === wrongWord)
      ));
      notifyDictionaryChanged();
    } catch {
      setError('Verbindungsfehler');
    }
  };

  useEffect(() => {
    fetchOverview();
  }, []);

  useEffect(() => {
    if (selectedTab === 'all-user-entries' && isRoot) {
      fetchAllUserEntries();
    }
  }, [selectedTab]);

  useEffect(() => {
    if (selectedGroupId) {
      fetchGroupDetails(selectedGroupId);
    } else {
      setMembers([]);
      setEntries([]);
      setCandidates([]);
    }
  }, [selectedGroupId]);

  useEffect(() => {
    setGroupPromptInsert(selectedGroup?.promptInsert || '');
  }, [selectedGroup?.id, selectedGroup?.promptInsert]);

  const resetEntryForm = () => {
    setWrong('');
    setCorrect('');
    setUseInPrompt(false);
    setMatchStem(false);
    setEditingGroupEntry(null);
  };

  const handleCreateGroup = async (event: React.FormEvent) => {
    event.preventDefault();
    setError('');
    setSuccess('');

    try {
      const response = await fetch('/api/dictionary-groups', {
        method: 'POST',
        headers: requestJsonHeaders(),
        body: JSON.stringify({ action: 'create-group', name: newGroupName, description: newGroupDescription }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setError(data.error || 'Fehler beim Anlegen');
        return;
      }
      setSuccess(`Gruppe "${newGroupName}" angelegt`);
      setNewGroupName('');
      setNewGroupDescription('');
      setSelectedGroupId(data.id);
      await fetchOverview();
    } catch {
      setError('Verbindungsfehler');
    }
  };

  const handleMemberToggle = async (username: string, checked: boolean) => {
    if (!selectedGroupId) return;
    const nextMembers = new Set(selectedMemberNames);
    if (checked) nextMembers.add(username);
    else nextMembers.delete(username);

    try {
      setError('');
      const response = await fetch('/api/dictionary-groups', {
        method: 'PATCH',
        headers: requestJsonHeaders(),
        body: JSON.stringify({ action: 'set-members', groupId: selectedGroupId, usernames: [...nextMembers] }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setError(data.error || 'Fehler beim Speichern der Mitglieder');
        return;
      }
      await fetchGroupDetails(selectedGroupId);
      await fetchOverview();
      notifyDictionaryChanged();
    } catch {
      setError('Verbindungsfehler');
    }
  };

  const handleAddEntry = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedGroupId) return;
    setError('');
    setSuccess('');
    setWarning('');

    try {
      const trimmedWrong = wrong.trim();
      const trimmedCorrect = correct.trim();
      const response = await fetch('/api/dictionary-groups', {
        method: 'POST',
        headers: requestJsonHeaders(),
        body: JSON.stringify({ action: 'add-entry', groupId: selectedGroupId, wrong: trimmedWrong, correct: trimmedCorrect, useInPrompt, matchStem }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setError(data.error || 'Fehler beim Speichern');
        return;
      }

      if (editingGroupEntry && editingGroupEntry.originalWrong !== trimmedWrong) {
        const deleteResponse = await fetch('/api/dictionary-groups', {
          method: 'DELETE',
          headers: requestJsonHeaders(),
          body: JSON.stringify({ action: 'delete-entry', groupId: selectedGroupId, wrong: editingGroupEntry.originalWrong }),
        });
        const deleteData = await deleteResponse.json();
        if (!deleteResponse.ok || !deleteData.success) {
          setError(deleteData.error || 'Eintrag aktualisiert, alter Schlüssel konnte aber nicht entfernt werden');
          return;
        }
      }

      setSuccess(editingGroupEntry ? `"${trimmedWrong}" aktualisiert` : `"${trimmedWrong}" in Gruppe übernommen`);
      setWarning(data.warning || '');
      resetEntryForm();
      await fetchGroupDetails(selectedGroupId);
      await fetchOverview();
      notifyDictionaryChanged();
    } catch {
      setError('Verbindungsfehler');
    }
  };

  const handleDeleteEntry = async (entryWrong: string) => {
    if (!selectedGroupId) return;
    try {
      setError('');
      const response = await fetch('/api/dictionary-groups', {
        method: 'DELETE',
        headers: requestJsonHeaders(),
        body: JSON.stringify({ action: 'delete-entry', groupId: selectedGroupId, wrong: entryWrong }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setError(data.error || 'Fehler beim Löschen');
        return;
      }
      await fetchGroupDetails(selectedGroupId);
      await fetchOverview();
      notifyDictionaryChanged();
    } catch {
      setError('Verbindungsfehler');
    }
  };

  const handleEditGroupEntry = (entry: GroupEntry) => {
    setEditingCandidate(null);
    setEditingGroupEntry({
      originalWrong: entry.wrong,
      wrong: entry.wrong,
      correct: entry.correct,
      useInPrompt: Boolean(entry.useInPrompt),
      matchStem: Boolean(entry.matchStem),
    });
    setWrong(entry.wrong);
    setCorrect(entry.correct);
    setUseInPrompt(Boolean(entry.useInPrompt));
    setMatchStem(Boolean(entry.matchStem));
    setSuccess('');
    setError('');
  };

  const handleEditCandidate = (candidate: ImportCandidate) => {
    setEditingGroupEntry(null);
    setEditingCandidate({
      sourceUsername: candidate.sourceUsername,
      originalWrong: candidate.wrong,
      wrong: candidate.wrong,
      correct: candidate.correct,
      useInPrompt: Boolean(candidate.useInPrompt),
      matchStem: Boolean(candidate.matchStem),
    });
    setSuccess('');
    setError('');
  };

  const handleSaveCandidateEdit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!editingCandidate) return;

    setSavingCandidateEdit(true);
    setError('');
    setSuccess('');

    try {
      const trimmedWrong = editingCandidate.wrong.trim();
      const trimmedCorrect = editingCandidate.correct.trim();

      const upsertResponse = await fetch('/api/dictionary', {
        method: 'POST',
        headers: requestJsonHeaders(),
        body: JSON.stringify({
          username: editingCandidate.sourceUsername,
          wrong: trimmedWrong,
          correct: trimmedCorrect,
          useInPrompt: editingCandidate.useInPrompt,
          matchStem: editingCandidate.matchStem,
        }),
      });
      const upsertData = await upsertResponse.json();
      if (!upsertResponse.ok || !upsertData.success) {
        setError(upsertData.error || 'Fehler beim Aktualisieren des Benutzereintrag');
        return;
      }

      if (editingCandidate.originalWrong !== trimmedWrong) {
        const deleteResponse = await fetch('/api/dictionary', {
          method: 'DELETE',
          headers: requestJsonHeaders(),
          body: JSON.stringify({ username: editingCandidate.sourceUsername, wrong: editingCandidate.originalWrong }),
        });
        const deleteData = await deleteResponse.json();
        if (!deleteResponse.ok || !deleteData.success) {
          setError(deleteData.error || 'Eintrag aktualisiert, alter Schlüssel konnte aber nicht entfernt werden');
          return;
        }
      }

      setSuccess(`Benutzereintrag von ${editingCandidate.sourceUsername} aktualisiert`);
      setEditingCandidate(null);
      await fetchGroupDetails(selectedGroupId!);
      notifyDictionaryChanged();
    } catch {
      setError('Verbindungsfehler');
    } finally {
      setSavingCandidateEdit(false);
    }
  };

  const toggleCandidate = (key: string, checked: boolean) => {
    setSelectedCandidateKeys(prev => {
      const next = new Set(prev);
      if (checked) next.add(key);
      else next.delete(key);
      return next;
    });
  };

  const toggleAllCandidates = (checked: boolean) => {
    setSelectedCandidateKeys(checked ? new Set(selectableCandidateKeys) : new Set());
  };

  const handleImportSelected = async () => {
    if (!selectedGroupId) return;
    const selected = candidates.filter(candidate => selectedCandidateKeys.has(candidateKey(candidate)));
    if (selected.length === 0) {
      setError('Keine Einträge ausgewählt');
      return;
    }

    try {
      setError('');
      setSuccess('');
      const response = await fetch('/api/dictionary-groups', {
        method: 'POST',
        headers: requestJsonHeaders(),
        body: JSON.stringify({ action: 'import-entries', groupId: selectedGroupId, overwriteExisting, entries: selected }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setError(data.error || 'Fehler beim Importieren');
        return;
      }
      setSuccess(`${data.imported} Einträge importiert, ${data.skipped} übersprungen`);
      await fetchGroupDetails(selectedGroupId);
      await fetchOverview();
      notifyDictionaryChanged();
    } catch {
      setError('Verbindungsfehler');
    }
  };

  const handleDeleteGroup = async () => {
    if (!selectedGroupId || !selectedGroup) return;
    if (!confirm(`Gruppe "${selectedGroup.name}" wirklich löschen?`)) return;

    try {
      setError('');
      const response = await fetch('/api/dictionary-groups', {
        method: 'DELETE',
        headers: requestJsonHeaders(),
        body: JSON.stringify({ action: 'delete-group', groupId: selectedGroupId }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setError(data.error || 'Fehler beim Löschen');
        return;
      }
      setSelectedGroupId(null);
      setSuccess(`Gruppe "${selectedGroup.name}" gelöscht`);
      await fetchOverview();
      notifyDictionaryChanged();
    } catch {
      setError('Verbindungsfehler');
    }
  };

  const handleSaveGroupPromptInsert = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!selectedGroupId) return;

    try {
      setSavingGroupPromptInsert(true);
      setError('');
      setSuccess('');
      const response = await fetch('/api/dictionary-groups', {
        method: 'PATCH',
        headers: requestJsonHeaders(),
        body: JSON.stringify({
          action: 'set-prompt-insert',
          groupId: selectedGroupId,
          promptInsert: groupPromptInsert,
        }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setError(data.error || 'Fehler beim Speichern des Prompt-Insert');
        return;
      }
      setSuccess(`Prompt-Insert für "${selectedGroup?.name}" gespeichert`);
      await fetchOverview();
    } catch {
      setError('Verbindungsfehler');
    } finally {
      setSavingGroupPromptInsert(false);
    }
  };

  if (loading) {
    return <div className="text-sm text-gray-500 p-4">Lade Gruppenwörterbücher...</div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">{error}</div>}
      {success && <div className="text-sm text-green-600 bg-green-50 dark:bg-green-900/20 px-3 py-2 rounded-lg">{success}</div>}
      {warning && (
        <div className="text-sm text-amber-700 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 rounded-lg border border-amber-200 dark:border-amber-800">
          <span className="font-medium">⚠️ Hinweis zum phonetischen Matching: </span>
          {warning}
        </div>
      )}

      {/* Tabs: Gruppen-Manager / Alle Benutzerwörterbücher (nur root) */}
      {isRoot && (
        <div className="flex gap-1 border-b dark:border-gray-700 pb-0">
          <button
            type="button"
            onClick={() => { setSelectedTab('groups'); setSelectedGroupId(null); }}
            className={`px-3 py-1.5 text-sm rounded-t-lg border border-b-0 -mb-px ${
              selectedTab === 'groups'
                ? 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 font-medium'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 border-transparent'
            }`}
          >
            Gruppen-Manager
          </button>
          <button
            type="button"
            onClick={() => setSelectedTab('all-user-entries')}
            className={`px-3 py-1.5 text-sm rounded-t-lg border border-b-0 -mb-px ${
              selectedTab === 'all-user-entries'
                ? 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 font-medium'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 border-transparent'
            }`}
          >
            Alle Benutzerwörterbücher
          </button>
        </div>
      )}

      {selectedTab === 'all-user-entries' && isRoot ? (
        /* ===== ALLE BENUTZERWÖRTERBÜCHER-TABELLE ===== */
        <div className="space-y-3">
          {allUserEntriesLoading ? (
            <div className="text-sm text-gray-500 p-4">Lade alle Benutzerwörterbücher...</div>
          ) : (
            <>
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <div>
                  <h4 className="font-semibold text-sm">Alle Benutzerwörterbucheinträge</h4>
                  <div className="text-xs text-gray-500">
                    {allUserEntries.length} Einträge von {
                      new Set(allUserEntries.map(e => e.username)).size
                    } Benutzern
                  </div>
                </div>
                <button
                  type="button"
                  onClick={fetchAllUserEntries}
                  className="btn btn-outline text-xs"
                >
                  Neu laden
                </button>
              </div>

              <div className="flex items-center gap-2">
                <input
                  className="input text-sm flex-1"
                  value={allUserEntriesFilter}
                  onChange={(e) => setAllUserEntriesFilter(e.target.value)}
                  placeholder="Nach Benutzer, Begriff oder Korrektur suchen..."
                />
                {allUserEntriesFilter && (
                  <button
                    type="button"
                    onClick={() => setAllUserEntriesFilter('')}
                    className="text-xs text-gray-500 hover:text-gray-700"
                  >
                    Filter löschen
                  </button>
                )}
              </div>

              {allUserEntries.length === 0 ? (
                <div className="text-sm text-gray-500 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  Keine Benutzerwörterbucheinträge gefunden.
                </div>
              ) : visibleAllUserEntries.length === 0 ? (
                <div className="text-sm text-gray-500 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  Keine Einträge für den aktuellen Suchbegriff.
                </div>
              ) : (
                <div className="border dark:border-gray-700 rounded-lg overflow-hidden">
                  <div className="max-h-[60vh] overflow-y-auto">
                    <table className="w-full text-sm">
                      <thead className="sticky top-0 bg-gray-100 dark:bg-gray-800">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium whitespace-nowrap">Benutzer</th>
                          <th className="text-left px-3 py-2 font-medium whitespace-nowrap">Falsch erkannt</th>
                          <th className="text-left px-3 py-2 font-medium whitespace-nowrap">Korrekt</th>
                          <th className="text-left px-3 py-2 font-medium whitespace-nowrap">Hinzugefügt</th>
                          <th className="text-center px-3 py-2 font-medium whitespace-nowrap w-14">Prompt</th>
                          <th className="text-center px-3 py-2 font-medium whitespace-nowrap w-14">Stamm</th>
                          <th className="text-center px-3 py-2 font-medium whitespace-nowrap w-14">Aktion</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y dark:divide-gray-700">
                        {visibleAllUserEntries.map((entry, idx) => (
                          <tr
                            key={`${entry.username}-${entry.wrong}-${idx}`}
                            className="hover:bg-gray-50 dark:hover:bg-gray-800/50"
                          >
                            <td className="px-3 py-1.5 font-medium whitespace-nowrap">{entry.username}</td>
                            <td className="px-3 py-1.5 text-red-600 dark:text-red-400 line-through max-w-[200px] truncate">{entry.wrong}</td>
                            <td className="px-3 py-1.5 text-green-600 dark:text-green-400 font-medium max-w-[200px] truncate">{entry.correct}</td>
                            <td className="px-3 py-1.5 text-gray-500 whitespace-nowrap text-xs">
                              {new Date(entry.addedAt).toLocaleDateString('de-DE')}
                            </td>
                            <td className="px-3 py-1.5 text-center">{entry.useInPrompt ? '✓' : ''}</td>
                            <td className="px-3 py-1.5 text-center">{entry.matchStem ? '✓' : ''}</td>
                            <td className="px-3 py-1.5 text-center">
                              <button
                                type="button"
                                onClick={() => handleDeleteAllUserEntry(entry.username, entry.wrong)}
                                className="text-xs text-red-600 hover:text-red-800 dark:text-red-400 dark:hover:text-red-300 hover:underline"
                                title={`Eintrag „${entry.wrong}“ von ${entry.username} löschen`}
                              >
                                Löschen
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        /* ===== GRUPPEN-MANAGER ===== */
        <>
      <form onSubmit={handleCreateGroup} className="space-y-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <h4 className="font-medium text-sm">Neue Gruppe</h4>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <input className="input text-sm" value={newGroupName} onChange={event => setNewGroupName(event.target.value)} placeholder="z.B. Chirurgie" required />
          <input className="input text-sm" value={newGroupDescription} onChange={event => setNewGroupDescription(event.target.value)} placeholder="Beschreibung optional" />
        </div>
        <div className="flex justify-end">
          <button type="submit" className="btn btn-primary text-sm">Anlegen</button>
        </div>
      </form>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] gap-4">
        <div className="space-y-2">
          <h4 className="font-medium text-sm">Gruppen</h4>
          {groups.length === 0 ? (
            <div className="text-sm text-gray-500 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">Noch keine Gruppen angelegt.</div>
          ) : (
            <div className="space-y-1 max-h-80 overflow-y-auto">
              {groups.map(group => (
                <button
                  key={group.id}
                  type="button"
                  onClick={() => setSelectedGroupId(group.id)}
                  className={`w-full text-left p-2 rounded-lg text-sm border ${selectedGroupId === group.id ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20' : 'border-transparent bg-gray-50 dark:bg-gray-800 hover:border-gray-300'}`}
                >
                  <div className="font-medium truncate">{group.name}</div>
                  <div className="text-xs text-gray-500">{group.memberCount} User · {group.entryCount} Einträge</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {selectedGroup ? (
          <div className="space-y-4 min-w-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h4 className="font-semibold truncate">{selectedGroup.name}</h4>
                {selectedGroup.description && <div className="text-sm text-gray-500 truncate">{selectedGroup.description}</div>}
              </div>
              <button type="button" onClick={handleDeleteGroup} className="text-xs text-red-600 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20">Löschen</button>
            </div>

            {detailLoading ? <div className="text-sm text-gray-500">Lade Gruppe...</div> : (
              <>
                <form onSubmit={handleSaveGroupPromptInsert} className="space-y-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <h5 className="font-medium text-sm">Gruppenspezifischer Prompt-Insert</h5>
                      <div className="text-xs text-gray-500">Zusätzlicher Hinweis für das Korrekturmodul, z.B. für häufig verunstaltete Floskeln der Abteilung.</div>
                    </div>
                    <button type="submit" className="btn btn-primary text-sm" disabled={savingGroupPromptInsert}>
                      {savingGroupPromptInsert ? 'Speichere...' : 'Prompt speichern'}
                    </button>
                  </div>
                  <textarea
                    className="textarea textarea-bordered w-full min-h-28 text-sm"
                    value={groupPromptInsert}
                    onChange={(event) => setGroupPromptInsert(event.target.value)}
                    placeholder="z.B. Bei unverständlichen Wortkombinationen rund um Ambulanz-/Abteilungsnamen prüfen, ob 'Rheumatologische Fachambulanz' gemeint ist."
                  />
                </form>

                <div className="space-y-2">
                  <h5 className="font-medium text-sm">Mitglieder</h5>
                  <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-36 overflow-y-auto p-2 bg-gray-50 dark:bg-gray-800 rounded-lg">
                    {users.map(user => (
                      <label key={user.username} className="flex items-center gap-2 text-sm min-w-0">
                        <input type="checkbox" checked={selectedMemberNames.has(user.username)} onChange={event => handleMemberToggle(user.username, event.target.checked)} />
                        <span className="truncate">{user.username}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <form onSubmit={handleAddEntry} className="space-y-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <div className="flex items-center justify-between gap-3">
                    <h5 className="font-medium text-sm">{editingGroupEntry ? 'Gruppeneintrag bearbeiten' : 'Gruppeneintrag hinzufügen'}</h5>
                    {editingGroupEntry && (
                      <button type="button" onClick={resetEntryForm} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">Bearbeitung abbrechen</button>
                    )}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input className="input text-sm" value={wrong} onChange={event => setWrong(event.target.value)} placeholder="Falsch erkannt" required />
                    <input className="input text-sm" value={correct} onChange={event => setCorrect(event.target.value)} placeholder="Korrekt" required />
                  </div>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex gap-4 text-xs">
                      <label className="flex items-center gap-2"><input type="checkbox" checked={useInPrompt} onChange={event => setUseInPrompt(event.target.checked)} /> Im Prompt</label>
                      <label className="flex items-center gap-2"><input type="checkbox" checked={matchStem} onChange={event => setMatchStem(event.target.checked)} /> Wortstamm</label>
                    </div>
                    <button type="submit" className="btn btn-primary text-sm">{editingGroupEntry ? 'Speichern' : 'Hinzufügen'}</button>
                  </div>
                </form>

                <div className="space-y-2 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <h5 className="font-medium text-sm">Suche</h5>
                    {filter && (
                      <button type="button" onClick={() => setFilter('')} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">Filter löschen</button>
                    )}
                  </div>
                  <input
                    className="input text-sm"
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    placeholder="Nach Begriff, Korrektur oder Benutzer suchen"
                  />
                </div>

                <div className="space-y-2">
                  <h5 className="font-medium text-sm flex justify-between"><span>Gruppenwörterbuch</span><span className="text-xs text-gray-500 font-normal">{visibleEntries.length}{visibleEntries.length !== entries.length ? ` / ${entries.length}` : ''} Einträge</span></h5>
                  {entries.length === 0 ? (
                    <div className="text-sm text-gray-500 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">Noch keine Gruppeneinträge.</div>
                  ) : visibleEntries.length === 0 ? (
                    <div className="text-sm text-gray-500 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">Keine Gruppeneinträge für den aktuellen Suchbegriff.</div>
                  ) : (
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {visibleEntries.map(entry => (
                        <div key={entry.id} className="flex items-center justify-between gap-2 p-2 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="text-red-600 dark:text-red-400 line-through truncate">{entry.wrong}</span>
                              <span className="text-gray-400">→</span>
                              <span className="text-green-600 dark:text-green-400 font-medium truncate">{entry.correct}</span>
                            </div>
                            <div className="text-xs text-gray-500 mt-1 flex items-center gap-2 flex-wrap">
                              {entry.addedBy && <span>von {entry.addedBy}</span>}
                              {entry.useInPrompt && <span>🎤 Prompt</span>}
                              {entry.matchStem && <span>🌿 Wortstamm</span>}
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <button type="button" onClick={() => handleEditGroupEntry(entry)} className="text-xs text-blue-600 hover:text-blue-700" title="Bearbeiten">Bearbeiten</button>
                            <button type="button" onClick={() => handleDeleteEntry(entry.wrong)} className="text-gray-400 hover:text-red-600" title="Löschen">×</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {editingCandidate && (
                  <form onSubmit={handleSaveCandidateEdit} className="space-y-3 p-3 bg-blue-50 dark:bg-blue-900/10 rounded-lg border border-blue-100 dark:border-blue-900/30">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h5 className="font-medium text-sm">Eintrag von {editingCandidate.sourceUsername} bearbeiten</h5>
                        <div className="text-xs text-gray-500">Änderungen werden direkt im persönlichen Wörterbuch gespeichert.</div>
                      </div>
                      <button type="button" onClick={() => setEditingCandidate(null)} className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">Abbrechen</button>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input className="input text-sm" value={editingCandidate.wrong} onChange={event => setEditingCandidate(prev => prev ? { ...prev, wrong: event.target.value } : prev)} placeholder="Falsch erkannt" required />
                      <input className="input text-sm" value={editingCandidate.correct} onChange={event => setEditingCandidate(prev => prev ? { ...prev, correct: event.target.value } : prev)} placeholder="Korrekt" required />
                    </div>
                    <div className="flex items-center justify-between gap-3 flex-wrap">
                      <div className="flex gap-4 text-xs">
                        <label className="flex items-center gap-2"><input type="checkbox" checked={editingCandidate.useInPrompt} onChange={event => setEditingCandidate(prev => prev ? { ...prev, useInPrompt: event.target.checked } : prev)} /> Im Prompt</label>
                        <label className="flex items-center gap-2"><input type="checkbox" checked={editingCandidate.matchStem} onChange={event => setEditingCandidate(prev => prev ? { ...prev, matchStem: event.target.checked } : prev)} /> Wortstamm</label>
                      </div>
                      <button type="submit" className="btn btn-primary text-sm" disabled={savingCandidateEdit}>{savingCandidateEdit ? 'Speichere...' : 'Benutzereintrag speichern'}</button>
                    </div>
                  </form>
                )}

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <h5 className="font-medium text-sm">Einträge der Gruppenmitglieder übernehmen</h5>
                    <label className="text-xs flex items-center gap-2"><input type="checkbox" checked={overwriteExisting} onChange={event => setOverwriteExisting(event.target.checked)} /> Vorhandene überschreiben</label>
                  </div>
                  <div className="flex items-center justify-between gap-2 text-xs">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={selectableCandidateKeys.length > 0 && selectedCandidateKeys.size === selectableCandidateKeys.length} onChange={event => toggleAllCandidates(event.target.checked)} />
                      Alle auswählbaren markieren
                    </label>
                    <button type="button" onClick={handleImportSelected} className="btn btn-secondary text-xs" disabled={selectedCandidateKeys.size === 0}>Ausgewählte übernehmen ({selectedCandidateKeys.size})</button>
                  </div>
                  {candidates.length === 0 ? (
                    <div className="text-sm text-gray-500 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">Keine Individualeinträge bei Gruppenmitgliedern gefunden.</div>
                  ) : visibleCandidates.length === 0 ? (
                    <div className="text-sm text-gray-500 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">Keine Mitgliedereinträge für den aktuellen Suchbegriff.</div>
                  ) : (
                    <div className="max-h-64 overflow-y-auto border dark:border-gray-700 rounded-lg divide-y dark:divide-gray-700">
                      {visibleCandidates.map(candidate => {
                        const key = candidateKey(candidate);
                        const disabled = candidate.alreadyInGroup && !overwriteExisting;
                        return (
                          <div key={key} className={`flex items-center gap-2 p-2 text-sm ${disabled ? 'opacity-50' : ''}`}>
                            <input type="checkbox" disabled={disabled} checked={selectedCandidateKeys.has(key)} onChange={event => toggleCandidate(key, event.target.checked)} />
                            <span className="text-xs text-gray-500 w-24 truncate flex-shrink-0">{candidate.sourceUsername}</span>
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 min-w-0">
                                <span className="text-red-600 dark:text-red-400 line-through truncate min-w-0">{candidate.wrong}</span>
                                <span className="text-gray-400 flex-shrink-0">→</span>
                                <span className="text-green-600 dark:text-green-400 font-medium truncate min-w-0">{candidate.correct}</span>
                              </div>
                              <div className="text-xs text-gray-500 mt-1 flex items-center gap-2 flex-wrap">
                                {candidate.useInPrompt && <span>🎤 Prompt</span>}
                                {candidate.matchStem && <span>🌿 Wortstamm</span>}
                                {candidate.alreadyInGroup && <span className="text-amber-600">vorhanden{candidate.groupCorrect ? `: ${candidate.groupCorrect}` : ''}</span>}
                              </div>
                            </div>
                            <button type="button" onClick={() => handleEditCandidate(candidate)} className="text-xs text-blue-600 hover:text-blue-700 flex-shrink-0" title="Persönlichen Eintrag bearbeiten">Bearbeiten</button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        ) : (
          <div className="text-sm text-gray-500 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">Wählen Sie eine Gruppe aus.</div>
        )}
      </div>
    </>
      )}
    </div>
  );
}
