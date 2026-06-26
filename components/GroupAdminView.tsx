'use client';
import { useEffect, useState } from 'react';
import { useAuth } from './AuthProvider';

interface Group {
  id: number;
  name: string;
  description: string;
  memberCount: number;
  entryCount: number;
}

interface User {
  username: string;
  isAdmin: boolean;
}

export default function GroupAdminView() {
  const { getAuthHeader, getDbTokenHeader } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [users, setUsers] = useState<User[]>([]);
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);
  const [members, setMembers] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [newGroupName, setNewGroupName] = useState('');
  const [newGroupDesc, setNewGroupDesc] = useState('');

  const headers = () => ({
    'Authorization': getAuthHeader(),
    ...getDbTokenHeader(),
  });
  const jsonHeaders = () => ({ 'Content-Type': 'application/json', ...headers() });

  const fetchGroups = async () => {
    try {
      setError('');
      const res = await fetch('/api/dictionary-groups', {
        headers: headers(),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error || 'Fehler'); return; }
      setGroups(data.groups || []);
      setUsers(data.users || []);
      if (!selectedGroupId && data.groups?.length > 0) {
        setSelectedGroupId(data.groups[0].id);
      }
    } catch {
      setError('Fehler beim Laden');
    } finally {
      setLoading(false);
    }
  };

  const fetchMembers = async (groupId: number) => {
    try {
      const res = await fetch(`/api/dictionary-groups?groupId=${groupId}`, {
        headers: headers(),
      });
      const data = await res.json();
      if (!res.ok) return;
      setMembers((data.members || []).map((m: any) => m.username));
    } catch { /* ignore */ }
  };

  useEffect(() => { fetchGroups(); }, []);
  useEffect(() => {
    if (selectedGroupId) fetchMembers(selectedGroupId);
    else setMembers([]);
  }, [selectedGroupId]);

  const handleCreateGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(''); setSuccess('');
    try {
      const res = await fetch('/api/dictionary-groups', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({ name: newGroupName, description: newGroupDesc }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { setError(data.error || 'Fehler'); return; }
      setSuccess(`Gruppe "${newGroupName}" angelegt`);
      setNewGroupName(''); setNewGroupDesc('');
      setSelectedGroupId(data.id);
      await fetchGroups();
    } catch {
      setError('Verbindungsfehler');
    }
  };

  const handleDeleteGroup = async () => {
    if (!selectedGroupId) return;
    const group = groups.find(g => g.id === selectedGroupId);
    if (!group || !confirm(`Gruppe "${group.name}" wirklich löschen?`)) return;
    try {
      setError(''); setSuccess('');
      const res = await fetch('/api/dictionary-groups', {
        method: 'DELETE',
        headers: jsonHeaders(),
        body: JSON.stringify({ groupId: selectedGroupId }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { setError(data.error || 'Fehler'); return; }
      setSuccess(`Gruppe "${group.name}" gelöscht`);
      setSelectedGroupId(null);
      await fetchGroups();
    } catch {
      setError('Verbindungsfehler');
    }
  };

  const handleMemberToggle = async (username: string, checked: boolean) => {
    if (!selectedGroupId) return;
    const next = checked ? [...members, username] : members.filter(u => u !== username);
    try {
      setError('');
      // Nutze dictionary-groups API mit dem action-Parameter für set-members
      const res = await fetch('/api/dictionary-groups', {
        method: 'PATCH',
        headers: jsonHeaders(),
        body: JSON.stringify({
          action: 'set-members',
          groupId: selectedGroupId,
          usernames: next,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) { setError(data.error || 'Fehler'); return; }
      setMembers(next);
      await fetchGroups();
    } catch {
      setError('Verbindungsfehler');
    }
  };

  const selectedGroup = groups.find(g => g.id === selectedGroupId);

  if (loading) {
    return <div className="text-center py-4 text-sm text-gray-500">Lade Gruppen...</div>;
  }

  return (
    <div className="space-y-4">
      {error && <div className="p-2 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded">{error}</div>}
      {success && <div className="p-2 text-sm text-green-600 bg-green-50 dark:bg-green-900/20 rounded">{success}</div>}

      <div className="flex gap-4">
        {/* Linke Spalte: Gruppenliste + Neu */}
        <div className="w-56 shrink-0 space-y-3">
          <form onSubmit={handleCreateGroup} className="space-y-2">
            <input
              type="text" value={newGroupName} onChange={e => setNewGroupName(e.target.value)}
              placeholder="Neue Gruppe..."
              className="w-full px-2 py-1 text-xs border rounded dark:bg-gray-700 dark:border-gray-600"
            />
            <input
              type="text" value={newGroupDesc} onChange={e => setNewGroupDesc(e.target.value)}
              placeholder="Beschreibung"
              className="w-full px-2 py-1 text-xs border rounded dark:bg-gray-700 dark:border-gray-600"
            />
            <button type="submit" disabled={!newGroupName.trim()}
              className="w-full px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50">
              + Gruppe anlegen
            </button>
          </form>

          <div className="space-y-1 max-h-[400px] overflow-y-auto">
            {groups.map(g => (
              <button
                key={g.id}
                onClick={() => setSelectedGroupId(g.id)}
                className={`w-full text-left px-2 py-1.5 text-xs rounded transition-colors ${
                  selectedGroupId === g.id
                    ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'
                }`}
              >
                <div className="truncate font-medium">{g.name}</div>
                <div className="text-[10px] opacity-60">{g.memberCount} Mitglieder · {g.entryCount} Einträge</div>
              </button>
            ))}
            {groups.length === 0 && <p className="text-xs text-gray-400 italic px-2">Keine Gruppen</p>}
          </div>
        </div>

        {/* Rechte Spalte: Detailansicht */}
        <div className="flex-1 min-w-0">
          {!selectedGroup ? (
            <p className="text-sm text-gray-500 italic">Bitte Gruppe auswählen oder anlegen</p>
          ) : (
            <div className="space-y-4">
              {/* Gruppen-Header */}
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-sm">{selectedGroup.name}</h3>
                  {selectedGroup.description && (
                    <p className="text-xs text-gray-500">{selectedGroup.description}</p>
                  )}
                </div>
                <button
                  onClick={handleDeleteGroup}
                  className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20"
                >
                  Löschen
                </button>
              </div>

              {/* Mitglieder */}
              <div>
                <h4 className="text-xs font-medium text-gray-500 mb-2">
                  Mitglieder <span className="text-gray-400">({members.length})</span>
                </h4>
                <p className="text-[11px] text-gray-400 mb-2">
                  Mitglieder teilen sich die Gruppen-Wörterbücher und Gruppen-Bausteine.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {users.map(u => {
                    const isMember = members.includes(u.username);
                    return (
                      <button
                        key={u.username}
                        onClick={() => handleMemberToggle(u.username, !isMember)}
                        className={`text-xs px-2 py-0.5 rounded border transition-colors ${
                          isMember
                            ? 'bg-blue-50 border-blue-200 text-blue-700 dark:bg-blue-900/20 dark:border-blue-800 dark:text-blue-300'
                            : 'border-gray-200 text-gray-500 hover:border-gray-300 dark:border-gray-700 dark:text-gray-400'
                        }`}
                      >
                        {u.username} {isMember ? '✓' : ''}
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
