"use client";
import { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { AuthProvider, useAuth } from '@/components/AuthProvider';
import ThemeToggle from '@/components/ThemeToggle';
import VoiceAgentButton from '@/components/VoiceAgentButton';
import UserMenu from '@/components/UserMenu';
import LoginForm from '@/components/LoginForm';

function LayoutContent({ children }: { children: ReactNode }) {
  const { isLoggedIn, canViewAllDictations } = useAuth();
  const pathname = usePathname();
  
  // Sekretariat auf Offline-Seite bekommt volle Breite
  const isFullWidth = pathname === '/offline' && canViewAllDictations;

  if (!isLoggedIn) {
    return (
      <>
        <header className="border-b bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:bg-zinc-900/80 sticky top-0 z-40">
          <div className="max-w-2xl mx-auto px-3 py-2 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-lg bg-[rgb(var(--primary-600))] flex items-center justify-center">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="white">
                  <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                  <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
                </svg>
              </div>
              <h1 className="text-base font-semibold">Schreibdienst</h1>
            </div>
            <nav className="flex items-center gap-2 text-sm text-gray-600">
              <ThemeToggle />
            </nav>
          </div>
        </header>
        <main className="max-w-2xl mx-auto px-3 py-4">
          <LoginForm />
        </main>
      </>
    );
  }

  return (
    <>
      <header className="border-b bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60 dark:bg-zinc-900/80 sticky top-0 z-40">
        <div className={`${isFullWidth ? 'w-full' : 'max-w-2xl'} mx-auto px-3 py-2 flex items-center justify-between`}>
          <div className="flex items-center gap-2">
            <div className="h-7 w-7 rounded-lg bg-[rgb(var(--primary-600))] flex items-center justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="white">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z"/>
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
              </svg>
            </div>
            <h1 className="text-base font-semibold">Schreibdienst</h1>
          </div>
          <nav className="flex items-center gap-2 text-sm text-gray-600">
            <UserMenu />
            <VoiceAgentButton />
            <ThemeToggle />
          </nav>
        </div>
        {/* Mode Navigation Tabs */}
        <div className={`${isFullWidth ? 'w-full' : 'max-w-2xl'} mx-auto px-3 pb-2`}>
          <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-lg p-1">
            <Link
              href="/"
              className={`flex-1 py-1.5 px-3 text-center text-sm font-medium rounded-md transition-all ${
                pathname === '/'
                  ? 'bg-white dark:bg-gray-700 shadow-sm text-blue-600 dark:text-blue-400'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              }`}
            >
              🎤 Live-Diktat
            </Link>
            <Link
              href="/offline"
              className={`flex-1 py-1.5 px-3 text-center text-sm font-medium rounded-md transition-all ${
                pathname === '/offline'
                  ? 'bg-white dark:bg-gray-700 shadow-sm text-blue-600 dark:text-blue-400'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              }`}
            >
              📁 Offline-Diktat
            </Link>
          </div>
        </div>
      </header>
      <main className={`${isFullWidth ? 'w-full' : 'max-w-2xl'} mx-auto px-3 py-4`}>{children}</main>
    </>
  );
}

export default function ClientLayout({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <LayoutContent>{children}</LayoutContent>
    </AuthProvider>
  );
}
