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
  const { getAuthHeader, getDbTokenHeader } = useAuth();
  const [groups, setGroups] = useState<DictionaryGroup[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [entries, setEntries] = useState<GroupEntry[]>([]);
  const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
  const [selectedCandidateKeys, setSelectedCandidateKeys] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDescription, setNewGroupDescription] = useState('');
  const [wrong, setWrong] = useState('');
  const [correct, setCorrect] = useState('');
  const [useInPrompt, setUseInPrompt] = useState(false);
  const [matchStem, setMatchStem] = useState(false);
  const [overwriteExisting, setOverwriteExisting] = useState(false);

  const selectedGroup = groups.find(group => group.id === selectedGroupId) || null;
  const selectedMemberNames = useMemo(() => new Set(members.map(member => member.username)), [members]);
  const visibleCandidates = candidates;
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
    } catch {
      setError('Fehler beim Laden der Gruppe');
    } finally {
      setDetailLoading(false);
    }
  };

  useEffect(() => {
    fetchOverview();
  }, []);

  useEffect(() => {
    if (selectedGroupId) {
      fetchGroupDetails(selectedGroupId);
    } else {
      setMembers([]);
      setEntries([]);
      setCandidates([]);
    }
  }, [selectedGroupId]);

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

    try {
      const response = await fetch('/api/dictionary-groups', {
        method: 'POST',
        headers: requestJsonHeaders(),
        body: JSON.stringify({ action: 'add-entry', groupId: selectedGroupId, wrong, correct, useInPrompt, matchStem }),
      });
      const data = await response.json();
      if (!response.ok || !data.success) {
        setError(data.error || 'Fehler beim Speichern');
        return;
      }
      setSuccess(`"${wrong}" in Gruppe übernommen`);
      setWrong('');
      setCorrect('');
      setUseInPrompt(false);
      setMatchStem(false);
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

  if (loading) {
    return <div className="text-sm text-gray-500 p-4">Lade Gruppenwörterbücher...</div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">{error}</div>}
      {success && <div className="text-sm text-green-600 bg-green-50 dark:bg-green-900/20 px-3 py-2 rounded-lg">{success}</div>}

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
                  <h5 className="font-medium text-sm">Gruppeneintrag hinzufügen</h5>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input className="input text-sm" value={wrong} onChange={event => setWrong(event.target.value)} placeholder="Falsch erkannt" required />
                    <input className="input text-sm" value={correct} onChange={event => setCorrect(event.target.value)} placeholder="Korrekt" required />
                  </div>
                  <div className="flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex gap-4 text-xs">
                      <label className="flex items-center gap-2"><input type="checkbox" checked={useInPrompt} onChange={event => setUseInPrompt(event.target.checked)} /> Im Prompt</label>
                      <label className="flex items-center gap-2"><input type="checkbox" checked={matchStem} onChange={event => setMatchStem(event.target.checked)} /> Wortstamm</label>
                    </div>
                    <button type="submit" className="btn btn-primary text-sm">Hinzufügen</button>
                  </div>
                </form>

                <div className="space-y-2">
                  <h5 className="font-medium text-sm flex justify-between"><span>Gruppenwörterbuch</span><span className="text-xs text-gray-500 font-normal">{entries.length} Einträge</span></h5>
                  {entries.length === 0 ? (
                    <div className="text-sm text-gray-500 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">Noch keine Gruppeneinträge.</div>
                  ) : (
                    <div className="max-h-48 overflow-y-auto space-y-1">
                      {entries.map(entry => (
                        <div key={entry.id} className="flex items-center justify-between gap-2 p-2 bg-gray-50 dark:bg-gray-800 rounded-lg text-sm">
                          <div className="min-w-0 flex-1 flex items-center gap-2">
                            <span className="text-red-600 dark:text-red-400 line-through truncate">{entry.wrong}</span>
                            <span className="text-gray-400">→</span>
                            <span className="text-green-600 dark:text-green-400 font-medium truncate">{entry.correct}</span>
                          </div>
                          <button type="button" onClick={() => handleDeleteEntry(entry.wrong)} className="text-gray-400 hover:text-red-600" title="Löschen">×</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

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
                  {visibleCandidates.length === 0 ? (
                    <div className="text-sm text-gray-500 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">Keine Individualeinträge bei Gruppenmitgliedern gefunden.</div>
                  ) : (
                    <div className="max-h-64 overflow-y-auto border dark:border-gray-700 rounded-lg divide-y dark:divide-gray-700">
                      {visibleCandidates.map(candidate => {
                        const key = candidateKey(candidate);
                        const disabled = candidate.alreadyInGroup && !overwriteExisting;
                        return (
                          <label key={key} className={`flex items-center gap-2 p-2 text-sm ${disabled ? 'opacity-50' : ''}`}>
                            <input type="checkbox" disabled={disabled} checked={selectedCandidateKeys.has(key)} onChange={event => toggleCandidate(key, event.target.checked)} />
                            <span className="text-xs text-gray-500 w-24 truncate flex-shrink-0">{candidate.sourceUsername}</span>
                            <span className="text-red-600 dark:text-red-400 line-through truncate min-w-0">{candidate.wrong}</span>
                            <span className="text-gray-400 flex-shrink-0">→</span>
                            <span className="text-green-600 dark:text-green-400 font-medium truncate min-w-0">{candidate.correct}</span>
                            {candidate.alreadyInGroup && <span className="text-xs text-amber-600 flex-shrink-0">vorhanden</span>}
                          </label>
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
    </div>
  );
}
