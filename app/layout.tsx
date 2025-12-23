import type { Metadata, Viewport } from 'next';
import './globals.css';
import { Inter } from 'next/font/google';
import ThemeToggle from '@/components/ThemeToggle';
import VoiceAgentButton from '@/components/VoiceAgentButton';

const inter = Inter({ subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  title: 'Schreibdienst',
  description: 'Medizinische Diktate: Audio → Text → formatiert',
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Schreibdienst',
  },
};

export const viewport: Viewport = {
  themeColor: '#2563eb',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <head>
        <link rel="apple-touch-icon" href="/icon-192.svg" />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <script dangerouslySetInnerHTML={{ __html: `
          if ('serviceWorker' in navigator) {
            window.addEventListener('load', () => {
              navigator.serviceWorker.register('/sw.js');
            });
          }
        ` }} />
      </head>
      <body className={inter.className}>
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
              <VoiceAgentButton />
              <ThemeToggle />
            </nav>
          </div>
        </header>
        <main className="max-w-2xl mx-auto px-3 py-4">{children}</main>
      </body>
    </html>
  );
}
