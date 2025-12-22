import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Schreibdienst',
  description: 'Medizinische Diktate: Audio → Text → formatiert',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="de">
      <body>
        <header className="border-b">
          <div className="container py-4 flex items-center justify-between">
            <h1 className="text-xl font-semibold">Schreibdienst</h1>
            <nav className="text-sm text-gray-600">Audio zu Text für Medizin</nav>
          </div>
        </header>
        <main className="container py-6">{children}</main>
      </body>
    </html>
  );
}
