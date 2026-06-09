"use client";
import { useEffect, useState } from 'react';

function getPreferred(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light';
  const saved = localStorage.getItem('theme');
  if (saved === 'dark' || saved === 'light') return saved;
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState<'light' | 'dark'>(getPreferred());

  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'dark') root.classList.add('dark');
    else root.classList.remove('dark');
    localStorage.setItem('theme', theme);
  }, [theme]);

  return (
    <button
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-lg text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-white"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      aria-label="Theme umschalten"
      title={theme === 'dark' ? 'Helles Theme aktivieren' : 'Dunkles Theme aktivieren'}
    >
      <span aria-hidden="true">{theme === 'dark' ? '☾' : '☀︎'}</span>
    </button>
  );
}
