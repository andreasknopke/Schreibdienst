'use client';

import { useState, useEffect } from 'react';

interface FolderSelectProps {
  /** Aktuelle Ordner-ID (null = kein Ordner) */
  value: number | null;
  /** Wird aufgerufen wenn der User einen Ordner auswählt */
  onChange: (folderId: number | null) => void;
  /** API-Fetch für Ordner laden */
  apiFetch: (url: string, options?: RequestInit) => Promise<Response>;
  /** Optional: Nur Ordner für bestimmten Scope anzeigen */
  scope?: 'personal' | 'group';
  groupId?: number;
  /** Kompakte Darstellung (für Inline in Zeilen) */
  compact?: boolean;
}

interface FolderOption {
  id: number;
  name: string;
  parentId: number | null;
  depth: number;
}

function flattenFolders(folders: any[], depth: number = 0): FolderOption[] {
  const result: FolderOption[] = [];
  for (const f of folders) {
    result.push({ id: f.id, name: f.name, parentId: f.parentId, depth });
    if (f.children) result.push(...flattenFolders(f.children, depth + 1));
  }
  return result;
}

export default function FolderSelect({ value, onChange, apiFetch, compact }: FolderSelectProps) {
  const [folders, setFolders] = useState<FolderOption[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setLoading(true);
    apiFetch('/api/templates/folders', {})
      .then((res) => res.json())
      .then((data) => {
        if (data.success && data.tree) {
          const all: FolderOption[] = [];
          // Persönliche Ordner
          all.push(...flattenFolders(data.tree.personal || []));
          // Gruppen-Ordner
          for (const g of data.tree.groups || []) {
            all.push(...flattenFolders(g.folders || []));
          }
          setFolders(all);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [apiFetch]);

  const selected = folders.find((f) => f.id === value);

  return (
    <select
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value ? Number(e.target.value) : null)}
      className={compact
        ? 'text-[10px] px-1 py-0.5 border rounded dark:bg-gray-700 dark:border-gray-600 max-w-[120px]'
        : 'px-2 py-1.5 text-sm border rounded dark:bg-gray-700 dark:border-gray-600'
      }
      disabled={loading}
    >
      <option value="">— Kein Ordner —</option>
      {folders.map((f) => (
        <option key={f.id} value={f.id}>
          {'  '.repeat(f.depth)}{f.name}
        </option>
      ))}
    </select>
  );
}
