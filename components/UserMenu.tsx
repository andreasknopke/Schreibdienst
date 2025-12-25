"use client";
import { useState } from 'react';
import { useAuth } from './AuthProvider';
import UserManagement from './UserManagement';
import DictionaryManager from './DictionaryManager';

export default function UserMenu() {
  const { isLoggedIn, username, isAdmin, logout } = useAuth();
  const [showUserManagement, setShowUserManagement] = useState(false);
  const [showDictionary, setShowDictionary] = useState(false);

  if (!isLoggedIn) return null;

  return (
    <>
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500 hidden sm:inline">
          {username}
          {isAdmin && <span className="ml-1 text-blue-600">(Admin)</span>}
        </span>
        <button
          onClick={() => setShowDictionary(!showDictionary)}
          className="text-xs text-green-600 hover:text-green-700 px-2 py-1 rounded hover:bg-green-50 dark:hover:bg-green-900/20"
          title="Mein Wörterbuch"
        >
          Wörterbuch
        </button>
        {isAdmin && (
          <button
            onClick={() => setShowUserManagement(!showUserManagement)}
            className="text-xs text-blue-600 hover:text-blue-700 px-2 py-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20"
            title="Benutzerverwaltung"
          >
            Benutzer
          </button>
        )}
        <button
          onClick={logout}
          className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-2 py-1 rounded hover:bg-gray-100 dark:hover:bg-gray-800"
          title="Abmelden"
        >
          Abmelden
        </button>
      </div>

      {/* Dictionary Modal */}
      {showDictionary && (
        <div className="fixed inset-0 bg-black/50 flex items-start sm:items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-lg w-full my-8 flex flex-col max-h-[calc(100vh-4rem)]">
            <div className="flex items-center justify-between p-4 border-b dark:border-gray-700 flex-shrink-0">
              <h2 className="font-semibold flex items-center gap-2">
                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1 0-5H20"/>
                </svg>
                Mein Wörterbuch
              </h2>
              <button
                onClick={() => setShowDictionary(false)}
                className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                title="Schließen"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18"/>
                  <path d="M6 6l12 12"/>
                </svg>
              </button>
            </div>
            <div className="p-4 overflow-y-auto flex-1">
              <DictionaryManager />
            </div>
          </div>
        </div>
      )}
      
      {/* User Management Modal */}
      {showUserManagement && isAdmin && (
        <div className="fixed inset-0 bg-black/50 flex items-start sm:items-center justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-lg w-full my-8 flex flex-col max-h-[calc(100vh-4rem)]">
            <div className="flex items-center justify-between p-4 border-b dark:border-gray-700 flex-shrink-0">
              <h2 className="font-semibold">Benutzerverwaltung</h2>
              <button
                onClick={() => setShowUserManagement(false)}
                className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                title="Schließen"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M18 6L6 18"/>
                  <path d="M6 6l12 12"/>
                </svg>
              </button>
            </div>
            <div className="overflow-y-auto flex-1">
              <UserManagement />
            </div>
          </div>
        </div>
      )}
    </>
  );
}
