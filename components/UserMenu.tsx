"use client";
import { useAuth } from './AuthProvider';

export default function UserMenu() {
  const { isLoggedIn, username, logout } = useAuth();

  if (!isLoggedIn) return null;

  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500 hidden sm:inline">{username}</span>
      <button
        onClick={logout}
        className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
        title="Abmelden"
      >
        Abmelden
      </button>
    </div>
  );
}
