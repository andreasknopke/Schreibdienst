"use client";
import { useState, useEffect } from 'react';
import { useAuth } from './AuthProvider';

interface User {
  username: string;
  isAdmin: boolean;
  canViewAllDictations: boolean;
  createdAt: string;
  createdBy: string;
}

export default function UserManagement() {
  const { isAdmin, getAuthHeader } = useAuth();
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Form state
  const [newUsername, setNewUsername] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newIsAdmin, setNewIsAdmin] = useState(false);
  const [newCanViewAll, setNewCanViewAll] = useState(false);
  const [creating, setCreating] = useState(false);

  const fetchUsers = async () => {
    try {
      const response = await fetch('/api/users', {
        headers: { 'Authorization': getAuthHeader() }
      });
      const data = await response.json();
      if (data.users) {
        setUsers(data.users);
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
          'Authorization': getAuthHeader()
        },
        body: JSON.stringify({
          username: newUsername,
          password: newPassword,
          isAdmin: newIsAdmin,
          canViewAllDictations: newCanViewAll || newIsAdmin
        })
      });

      const data = await response.json();

      if (data.success) {
        setSuccess(`Benutzer "${newUsername}" wurde erstellt`);
        setNewUsername('');
        setNewPassword('');
        setNewIsAdmin(false);
        setNewCanViewAll(false);
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
          'Authorization': getAuthHeader()
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
              <span className="text-xs text-gray-500">(System)</span>
            </div>
          </div>

          {loading ? (
            <div className="text-sm text-gray-500">Lade...</div>
          ) : users.length === 0 ? (
            <div className="text-sm text-gray-500">Keine weiteren Benutzer</div>
          ) : (
            users.map((user) => (
              <div key={user.username} className="flex items-center justify-between p-2 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{user.username}</span>
                  {user.isAdmin && (
                    <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded">Admin</span>
                  )}
                  {user.canViewAllDictations && (
                    <span className="text-xs bg-purple-600 text-white px-2 py-0.5 rounded">Alle Diktate</span>
                  )}
                  <span className="text-xs text-gray-500">
                    von {user.createdBy}
                  </span>
                </div>
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
            ))
          )}
        </div>
      </div>
    </div>
  );
}
