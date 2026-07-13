"use client";
import { useState, useEffect } from 'react';
import { useAuth } from './AuthProvider';


interface User {
  username: string;
  isAdmin: boolean;
  canViewAllDictations: boolean;
  defaultMode: 'befund' | 'arztbrief';
  department: string;
  createdAt: string;
  createdBy: string;
}

function hasBadgeFlag(value: unknown): boolean {
  return value === true || value === 1 || value === '1' || value === 'true';
}

export default function UserManagement() {
  const { isAdmin, getAuthHeader, getDbTokenHeader } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Form state
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [newCanViewAll, setNewCanViewAll] = useState(false);
  const [newDepartment, setNewDepartment] = useState('');
  const [creating, setCreating] = useState(false);

  // Edit state
  const [editingUser, setEditingUser] = useState<string | null>(null);
  const [editNewUsername, setEditNewUsername] = useState('');
  const [editNewPassword, setEditNewPassword] = useState('');
  const [editDepartment, setEditDepartment] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);

  const fetchUsers = async () => {
    try {
      setError('');
      const response = await fetch('/api/users', {
        headers: { 
          'Authorization': getAuthHeader(),
          ...getDbTokenHeader()
        }
      });
      const data = await response.json();
      if (!response.ok) {
        setError(data.error || 'Fehler beim Laden der Benutzer');
        setUsers([]);
        return;
      }
      if (data.users) {
        setUsers(data.users);
      } else {
        setUsers([]);
      }
    } catch {
      setError('Fehler beim Laden der Benutzer');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      fetchUsers();
    }
  }, [isAdmin]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');

    setCreating(true);

    try {
      const response = await fetch('/api/users', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': getAuthHeader(),
          ...getDbTokenHeader()
        },
        body: JSON.stringify({
          username: newUsername,
          password: newPassword,
          isAdmin: newIsAdmin,
          canViewAllDictations: newCanViewAll || newIsAdmin,
          department: newDepartment
        })
      });

      const data = await response.json();

      if (data.success) {
        setSuccess(`Benutzer "${newUsername}" wurde erstellt`);
        setNewUsername('');
        setNewPassword('');
        setNewIsAdmin(false);
        setNewCanViewAll(false);
        setNewDepartment('');
        fetchUsers();
      } else {
        setError(data.error || 'Fehler beim Erstellen');
      }
    } catch {
      setError('Verbindungsfehler');
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async (username: string) => {
    if (!confirm(`Benutzer "${username}" wirklich löschen?`)) return;

    setError('');
    setSuccess('');

    try {
      const response = await fetch('/api/users', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': getAuthHeader(),
          ...getDbTokenHeader()
        },
        body: JSON.stringify({ username })
      });

      const data = await response.json();

      if (data.success) {
        setSuccess(`Benutzer "${username}" wurde gelöscht`);
        fetchUsers();
      } else {
        setError(data.error || 'Fehler beim Löschen');
      }
    } catch {
      setError('Verbindungsfehler');
    }
  };

  const handleModeChange = async (username: string, newMode: 'befund' | 'arztbrief') => {
    setError('');
    setSuccess('');

    try {
      const response = await fetch('/api/users', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': getAuthHeader(),
          ...getDbTokenHeader()
        },
        body: JSON.stringify({ 
          username, 
          permissions: { defaultMode: newMode } 
        })
      });

      const data = await response.json();

      if (data.success) {
        setSuccess(`Modus für "${username}" auf ${newMode === 'befund' ? 'Befund' : 'Arztbrief'} geändert`);
        fetchUsers();
        setTimeout(() => setSuccess(''), 3000);
      } else {
        setError(data.error || 'Fehler beim Ändern');
      }
    } catch {
      setError('Verbindungsfehler');
    }
  };

  const handleRename = async (oldUsername: string) => {
    setError('');
    setSuccess('');
    setSavingEdit(true);

    try {
      const response = await fetch('/api/users', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': getAuthHeader(),
          ...getDbTokenHeader()
        },
        body: JSON.stringify({ username: oldUsername, newUsername: editNewUsername })
      });

      const data = await response.json();

      if (data.success) {
        setSuccess(`Benutzer "${oldUsername}" → "${editNewUsername}" umbenannt`);
        setEditingUser(null);
        setEditNewUsername('');
        setEditNewPassword('');
        fetchUsers();
        setTimeout(() => setSuccess(''), 4000);
      } else {
        setError(data.error || 'Fehler beim Umbenennen');
      }
    } catch {
      setError('Verbindungsfehler');
    } finally {
      setSavingEdit(false);
    }
  };

  const handlePasswordReset = async (username: string) => {
    if (!editNewPassword || editNewPassword.length < 4) {
      setError('Passwort muss mindestens 4 Zeichen haben');
      return;
    }

    setError('');
    setSuccess('');
    setSavingEdit(true);

    try {
      const response = await fetch('/api/users', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': getAuthHeader(),
          ...getDbTokenHeader()
        },
        body: JSON.stringify({ username, newPassword: editNewPassword })
      });

      const data = await response.json();

      if (data.success) {
        setSuccess(`Passwort für "${username}" wurde zurückgesetzt`);
        setEditingUser(null);
        setEditNewUsername('');
        setEditNewPassword('');
        setTimeout(() => setSuccess(''), 3000);
      } else {
        setError(data.error || 'Fehler beim Passwort-Reset');
      }
    } catch {
      setError('Verbindungsfehler');
    } finally {
      setSavingEdit(false);
    }
  };

  const startEditing = (user: User) => {
    setEditingUser(user.username);
    setEditNewUsername(user.username);
    setEditNewPassword('');
    setEditDepartment(user.department || '');
    setError('');
    setSuccess('');
  };

  const cancelEditing = () => {
    setEditingUser(null);
    setEditNewUsername('');
    setEditNewPassword('');
    setEditDepartment('');
  };

  const handleDepartmentChange = async (username: string) => {
    setError('');
    setSuccess('');
    setSavingEdit(true);

    try {
      const response = await fetch('/api/users', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': getAuthHeader(),
          ...getDbTokenHeader()
        },
        body: JSON.stringify({
          username,
          permissions: { department: editDepartment }
        })
      });

      const data = await response.json();

      if (data.success) {
        setSuccess(`Abteilung für "${username}" aktualisiert`);
        fetchUsers();
        setTimeout(() => setSuccess(''), 3000);
      } else {
        setError(data.error || 'Fehler beim Speichern der Abteilung');
      }
    } catch {
      setError('Verbindungsfehler');
    } finally {
      setSavingEdit(false);
    }
  };

  if (!isAdmin) {
    return null;
  }

  return (
    <div className="card">
      <div className="card-body space-y-4">
        <h3 className="text-lg font-semibold flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
            <circle cx="9" cy="7" r="4"/>
            <path d="M22 21v-2a4 4 0 0 0-3-3.87"/>
            <path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
          Benutzerverwaltung
        </h3>

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

        {/* Create User Form */}
        <form onSubmit={handleCreate} className="space-y-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <h4 className="font-medium text-sm">Neuen Benutzer anlegen</h4>
          <div className="grid grid-cols-2 gap-2">
            <input
              type="text"
              className="input text-sm"
              placeholder="Benutzername"
              value={newUsername}
              onChange={(e) => setNewUsername(e.target.value)}
              required
            />
            <input
              type="password"
              className="input text-sm"
              placeholder="Passwort (min. 4 Zeichen)"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              required
              minLength={4}
            />
          </div>
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={newIsAdmin}
                  onChange={(e) => {
                    setNewIsAdmin(e.target.checked);
                    if (e.target.checked) setNewCanViewAll(true);
                  }}
                  className="rounded"
                />
                Administrator
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={newCanViewAll || newIsAdmin}
                  onChange={(e) => setNewCanViewAll(e.target.checked)}
                  disabled={newIsAdmin}
                  className="rounded"
                />
                Alle Diktate sehen
              </label>
              <input
                type="text"
                className="input text-sm max-w-[200px]"
                placeholder="Fachabteilung"
                value={newDepartment}
                onChange={(e) => setNewDepartment(e.target.value)}
              />
            </div>
            <button type="submit" className="btn btn-primary text-sm" disabled={creating}>
              {creating ? 'Erstelle...' : 'Erstellen'}
            </button>
          </div>
        </form>

        {/* Users List */}
        <div className="space-y-2">
          <h4 className="font-medium text-sm">Benutzer</h4>
          
          {/* Root user (always shown) */}
          <div className="flex items-center justify-between p-2 bg-blue-50 dark:bg-blue-900/20 rounded-lg">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-medium">root</span>
              <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded">Admin</span>
              <span className="text-xs bg-purple-600 text-white px-2 py-0.5 rounded">Alle Diktate</span>
              <span className="text-xs bg-green-600 text-white px-2 py-0.5 rounded">Befund</span>
              <span className="text-xs text-gray-500">(System)</span>
            </div>
          </div>

          {loading ? (
            <div className="text-sm text-gray-500">Lade...</div>
          ) : users.length === 0 ? (
            <div className="text-sm text-gray-500">Keine weiteren Benutzer</div>
          ) : (
            users.map((user) => (
              <div key={user.username}>
                <div className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-800 rounded-lg">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{user.username}</span>
                    {hasBadgeFlag(user.isAdmin) && (
                      <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded">Admin</span>
                    )}
                    {hasBadgeFlag(user.canViewAllDictations) && (
                      <span className="text-xs bg-purple-600 text-white px-2 py-0.5 rounded">Alle Diktate</span>
                    )}
                    <select
                      value={user.defaultMode}
                      onChange={(e) => handleModeChange(user.username, e.target.value as 'befund' | 'arztbrief')}
                      className="text-xs px-2 py-0.5 rounded border dark:bg-gray-700 dark:border-gray-600"
                      title="Standard-Modus"
                    >
                      <option value="befund">Befund</option>
                      <option value="arztbrief">Arztbrief</option>
                    </select>
                    <span className="text-xs text-gray-500">
                      von {user.createdBy}
                    </span>
                    {user.department && (
                      <span className="text-xs px-1.5 py-0.5 bg-gray-200 dark:bg-gray-600 text-gray-600 dark:text-gray-300 rounded">
                        {user.department}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => startEditing(user)}
                      className="text-blue-600 hover:text-blue-700 p-1"
                      title="Bearbeiten"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(user.username)}
                      className="text-red-600 hover:text-red-700 p-1"
                      title="Löschen"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 6h18"/>
                        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                      </svg>
                    </button>
                  </div>
                </div>

                {/* Inline-Edit-Form */}
                {editingUser === user.username && (
                  <div className="mt-1 ml-2 p-3 border-l-2 border-blue-400 bg-blue-50/50 dark:bg-blue-900/10 rounded-r-lg space-y-3 text-sm">
                    <div className="flex items-center justify-between">
                      <h5 className="font-medium">"{user.username}" bearbeiten</h5>
                      <button onClick={cancelEditing} className="text-xs text-gray-500 hover:text-gray-700">Abbrechen</button>
                    </div>

                    <div>
                      <label className="text-xs text-gray-500 block mb-1">Neuer Benutzername</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          className="input text-sm flex-1"
                          value={editNewUsername}
                          onChange={(e) => setEditNewUsername(e.target.value)}
                          placeholder="Neuer Benutzername"
                          minLength={2}
                        />
                        <button
                          onClick={() => handleRename(user.username)}
                          className="btn btn-primary text-xs"
                          disabled={savingEdit || !editNewUsername.trim() || editNewUsername.trim() === user.username}
                        >
                          {savingEdit ? '...' : 'Umbenennen'}
                        </button>
                      </div>
                      <div className="text-xs text-gray-400 mt-0.5">
                        Wörterbuch, Diktate und Vorlagen bleiben erhalten.
                      </div>
                    </div>

                    <div className="border-t dark:border-gray-600 pt-3">
                      <label className="text-xs text-gray-500 block mb-1">Neues Passwort (zum Zurücksetzen)</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="password"
                          className="input text-sm flex-1"
                          value={editNewPassword}
                          onChange={(e) => setEditNewPassword(e.target.value)}
                          placeholder="Min. 4 Zeichen"
                          minLength={4}
                        />
                        <button
                          onClick={() => handlePasswordReset(user.username)}
                          className="btn btn-secondary text-xs"
                          disabled={savingEdit || !editNewPassword || editNewPassword.length < 4}
                        >
                          {savingEdit ? '...' : 'Passwort setzen'}
                        </button>
                      </div>
                    </div>

                    <div className="border-t dark:border-gray-600 pt-3">
                      <label className="text-xs text-gray-500 block mb-1">Fachabteilung</label>
                      <div className="flex items-center gap-2">
                        <input
                          type="text"
                          className="input text-sm flex-1"
                          value={editDepartment}
                          onChange={(e) => setEditDepartment(e.target.value)}
                          placeholder="z. B. Radiologie"
                        />
                        <button
                          onClick={() => handleDepartmentChange(user.username)}
                          className="btn btn-primary text-xs"
                          disabled={savingEdit || editDepartment === (user.department || '')}
                        >
                          {savingEdit ? '...' : 'Speichern'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
