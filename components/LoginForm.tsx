"use client";
import { useState } from 'react';
import { useAuth } from './AuthProvider';

export default function LoginForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!username.trim()) {
      setError('Bitte Benutzername eingeben');
      return;
    }
    
    if (!password) {
      setError('Bitte Passwort eingeben');
      return;
    }

    const success = login(username, password);
    if (!success) {
      setError('Falsches Passwort');
    }
  };

  return (
    <div className="min-h-[60vh] flex items-center justify-center">
      <div className="card w-full max-w-sm">
        <div className="card-body space-y-4">
          <div className="text-center">
            <div className="mx-auto h-12 w-12 rounded-xl bg-blue-600 flex items-center justify-center mb-3">
              <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="white">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
              </svg>
            </div>
            <h2 className="text-lg font-semibold">Anmeldung</h2>
            <p className="text-sm text-gray-500">Schreibdienst</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Benutzername</label>
              <input
                type="text"
                className="input text-sm"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Ihr Name"
                autoComplete="username"
                autoFocus
              />
            </div>
            
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Passwort</label>
              <input
                type="password"
                className="input text-sm"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                autoComplete="current-password"
              />
            </div>

            {error && (
              <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">
                {error}
              </div>
            )}

            <button type="submit" className="btn btn-primary w-full">
              Anmelden
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
