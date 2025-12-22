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
      className="btn btn-ghost"
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      aria-label="Theme umschalten"
      title="Theme umschalten"
    >
      {theme === 'dark' ? '☾ Dark' : '☀︎ Light'}
    </button>
  );
}
