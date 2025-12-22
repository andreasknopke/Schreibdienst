import type { Metadata } from 'next';
import './globals.css';
import { Inter } from 'next/font/google';

const inter = Inter({ subsets: ['latin'], display: 'swap' });

export const metadata: Metadata = {
  title: 'Schreibdienst',
  description: 'Medizinische Diktate: Audio → Text → formatiert',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body className={inter.className}>
        <header className="border-b bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60 sticky top-0 z-40">
          <div className="container py-4 flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-8 w-8 rounded-lg bg-[rgb(var(--primary-600))]"></div>
              <h1 className="text-xl font-semibold">Schreibdienst</h1>
            </div>
            <nav className="text-sm text-gray-600">Audio zu Text für Medizin</nav>
          </div>
        </header>
        <main className="container py-6">{children}</main>
        <footer className="border-t">
          <div className="container py-6 text-xs text-gray-500">© {new Date().getFullYear()} Schreibdienst</div>
        </footer>
      </body>
    </html>
  );
}
