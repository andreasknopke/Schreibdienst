'use client';

import { useState, useCallback, type ReactNode } from 'react';

export interface FolderNode {
  id: number;
  parentId: number | null;
  name: string;
  children: FolderNode[];
}

interface FolderExplorerProps {
  /** Ordner-Struktur (verschachtelt) */
  folders: FolderNode[];
  /** Wird aufgerufen wenn ein Ordner angeklickt wird → filtert Templates */
  onSelectFolder: (folderId: number | null) => void;
  /** Aktuell ausgewählter Ordner (null = Alle) */
  selectedFolderId: number | null;
  /** Neuen Ordner anlegen */
  onCreateFolder: (name: string, parentId: number | null) => Promise<void>;
  /** Ordner umbenennen */
  onRenameFolder: (id: number, name: string) => Promise<void>;
  /** Ordner löschen */
  onDeleteFolder: (id: number) => Promise<void>;
  /** Optional: Extra Actions pro Ordner (z. B. Counter) */
  renderFolderExtra?: (folder: FolderNode) => ReactNode;
  /** Icon für Ordner (Standard: 📁) */
  folderIcon?: string;
  /** Icon für geöffneten Ordner (Standard: 📂) */
  folderOpenIcon?: string;
}

export default function FolderExplorer({
  folders,
  onSelectFolder,
  selectedFolderId,
  onCreateFolder,
  onRenameFolder,
  onDeleteFolder,
  renderFolderExtra,
  folderIcon = '📁',
  folderOpenIcon = '📂',
}: FolderExplorerProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [creating, setCreating] = useState<{ parentId: number | null } | null>(null);
  const [newName, setNewName] = useState('');
  const [renaming, setRenaming] = useState<number | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const toggle = useCallback((id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleCreate = useCallback(async (parentId: number | null) => {
    if (!newName.trim()) return;
    await onCreateFolder(newName.trim(), parentId);
    setNewName('');
    setCreating(null);
    // Parent aufklappen
    if (parentId !== null) {
      setExpanded((prev) => new Set(prev).add(parentId));
    }
  }, [newName, onCreateFolder]);

  const handleRename = useCallback(async (id: number) => {
    if (!renameValue.trim()) return;
    await onRenameFolder(id, renameValue.trim());
    setRenaming(null);
    setRenameValue('');
  }, [renameValue, onRenameFolder]);

  const renderFolder = (folder: FolderNode, depth: number): ReactNode => {
    const isExpanded = expanded.has(folder.id);
    const isSelected = selectedFolderId === folder.id;
    const hasChildren = folder.children.length > 0;

    return (
      <div key={folder.id}>
        <div
          className={`flex items-center gap-1 px-1 py-1 rounded cursor-pointer text-xs transition-colors ${
            isSelected
              ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200'
              : 'hover:bg-gray-100 dark:hover:bg-gray-800/60 text-gray-700 dark:text-gray-300'
          }`}
          style={{ paddingLeft: `${depth * 14 + 4}px` }}
        >
          {/* Expand/Collapse */}
          <button
            onClick={() => toggle(folder.id)}
            className="w-3.5 text-center text-[10px] text-gray-400 shrink-0"
          >
            {hasChildren ? (isExpanded ? '▼' : '▶') : ''}
          </button>

          {/* Ordner-Icon */}
          <span className="shrink-0">{isExpanded ? folderOpenIcon : folderIcon}</span>

          {/* Ordner-Name (oder Rename-Input) */}
          {renaming === folder.id ? (
            <input
              type="text"
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleRename(folder.id);
                if (e.key === 'Escape') setRenaming(null);
              }}
              onBlur={() => handleRename(folder.id)}
              className="flex-1 min-w-0 px-1 py-0 text-[11px] border border-blue-400 rounded bg-white dark:bg-gray-800 outline-none"
              autoFocus
              onClick={(e) => e.stopPropagation()}
            />
          ) : (
            <button
              onClick={() => onSelectFolder(folder.id)}
              className="flex-1 min-w-0 text-left truncate"
              title={folder.name}
            >
              {folder.name}
            </button>
          )}

          {renderFolderExtra?.(folder)}

          {/* Actions */}
          <div className="flex items-center gap-0.5 opacity-0 hover:opacity-100 transition-opacity shrink-0">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setCreating({ parentId: folder.id });
              }}
              className="px-0.5 text-gray-400 hover:text-green-600 text-[10px]"
              title="Unterordner anlegen"
            >+</button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                setRenameValue(folder.name);
                setRenaming(folder.id);
              }}
              className="px-0.5 text-gray-400 hover:text-blue-600 text-[10px]"
              title="Umbenennen"
            >✎</button>
            <button
              onClick={async (e) => {
                e.stopPropagation();
                if (window.confirm(`Ordner "${folder.name}" wirklich löschen?`)) {
                  await onDeleteFolder(folder.id);
                  if (selectedFolderId === folder.id) onSelectFolder(null);
                }
              }}
              className="px-0.5 text-gray-400 hover:text-red-600 text-[10px]"
              title="Löschen"
            >×</button>
          </div>
        </div>

        {/* Children */}
        {isExpanded && hasChildren && (
          <div>
            {folder.children.map((child) => renderFolder(child, depth + 1))}
            {/* Neuer Ordner innerhalb */}
            {creating?.parentId === folder.id && (
              <div
                className="flex items-center gap-1 px-1 py-1"
                style={{ paddingLeft: `${(depth + 1) * 14 + 4}px` }}
              >
                <span className="w-3.5 shrink-0" />
                <span className="shrink-0">{folderIcon}</span>
                <input
                  type="text"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleCreate(folder.id);
                    if (e.key === 'Escape') { setCreating(null); setNewName(''); }
                  }}
                  onBlur={() => handleCreate(folder.id)}
                  className="flex-1 min-w-0 px-1 py-0 text-[11px] border border-blue-400 rounded bg-white dark:bg-gray-800 outline-none"
                  placeholder="Ordnername..."
                  autoFocus
                />
              </div>
            )}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="select-none">
      {/* "Alle" = kein Filter */}
      <div
        className={`flex items-center gap-1 px-1 py-1 rounded cursor-pointer text-xs transition-colors ${
          selectedFolderId === null
            ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200'
            : 'hover:bg-gray-100 dark:hover:bg-gray-800/60 text-gray-700 dark:text-gray-300'
        }`}
        onClick={() => onSelectFolder(null)}
      >
        <span className="w-3.5 shrink-0" />
        <span className="shrink-0">📁</span>
        <span className="font-medium">Alle</span>
      </div>

      {/* Ordner-Baum */}
      {folders.map((f) => renderFolder(f, 0))}

      {/* Neuer Ordner auf oberster Ebene */}
      {creating?.parentId === null && (
        <div className="flex items-center gap-1 px-1 py-1">
          <span className="w-3.5 shrink-0" />
          <span className="shrink-0">{folderIcon}</span>
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleCreate(null);
              if (e.key === 'Escape') { setCreating(null); setNewName(''); }
            }}
            onBlur={() => handleCreate(null)}
            className="flex-1 min-w-0 px-1 py-0 text-[11px] border border-blue-400 rounded bg-white dark:bg-gray-800 outline-none"
            placeholder="Ordnername..."
            autoFocus
          />
        </div>
      )}

      {/* "+ Neuer Ordner" Button (nur wenn nicht bereits am Erstellen) */}
      {creating === null && (
        <button
          onClick={() => setCreating({ parentId: null })}
          className="w-full mt-0.5 px-1 py-0.5 text-[10px] text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 text-left transition-colors"
        >
          + Neuer Ordner
        </button>
      )}
    </div>
  );
}
