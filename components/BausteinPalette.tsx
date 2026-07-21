'use client';

import { useState, useMemo, useCallback, useEffect } from 'react';
import FolderExplorer, { type FolderNode } from './FolderExplorer';

interface BausteinTemplate {
  id: number;
  name: string;
  content: string;
  scope?: 'private' | 'group';
  folderId?: number | null;
}

interface BausteinPaletteProps {
  templates: BausteinTemplate[];
  onAddBaustein: (template: BausteinTemplate) => void;
  onClose: () => void;
  /** Auth-Headers für API-Aufrufe (Ordner CRUD) */
  apiFetch?: (url: string, options?: RequestInit) => Promise<Response>;
  /** Benutzername für Ordner-Erstellung */
  username?: string;
  /** Startansicht: 'list' (standard für Komplexbausteine) oder 'tree' */
  defaultView?: 'list' | 'tree';
  /** Reihenfolge der templates beibehalten (keine alphabetische Gruppierung) */
  preserveOrder?: boolean;
  /** Wird aufgerufen wenn ein Gruppen-Baustein als Kopie übernommen werden soll */
  onCopyTemplate?: (template: BausteinTemplate) => void;
}

/** Extrahiert eine Gruppen-Überschrift, z. B. "CCT" aus "CCT – Standard" */
function extractGroup(name: string): string | null {
  const match = name.match(/^(.+?)\s*[–\-:]\s/);
  return match ? match[1].trim() : null;
}

export default function BausteinPalette({
  templates,
  onAddBaustein,
  onClose,
  apiFetch,
  username,
  defaultView = 'list',
  preserveOrder = false,
  onCopyTemplate,
}: BausteinPaletteProps) {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'private' | 'group'>('private');
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [personalFolders, setPersonalFolders] = useState<FolderNode[]>([]);
  const [groupFolders, setGroupFolders] = useState<{ groupId: number; groupName: string; folders: FolderNode[] }[]>([]);
  const [view, setView] = useState<'list' | 'tree'>(defaultView);

  // Ordner-Struktur laden
  const loadFolders = useCallback(async () => {
    if (!apiFetch) return;
    try {
      const res = await apiFetch('/api/templates/folders', {});
      const data = await res.json();
      if (data.success && data.tree) {
        // Persönliche Ordner als Baum aufbauen
        const personalRoots = buildFolderTree(data.tree.personal || []);
        setPersonalFolders(personalRoots);

        // Gruppen-Ordner
        const groupData = (data.tree.groups || []).map((g: any) => ({
          groupId: g.groupId,
          groupName: g.groupName,
          folders: buildFolderTree(g.folders || []),
        }));
        setGroupFolders(groupData);
      }
    } catch { /* silent */ }
  }, [apiFetch]);

  useEffect(() => {
    if (view === 'tree') loadFolders();
  }, [view, loadFolders]);

  const handleCreateFolder = useCallback(async (name: string, parentId: number | null) => {
    if (!apiFetch) return;
    await apiFetch('/api/templates/folders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parentId }),
    });
    await loadFolders();
  }, [apiFetch, loadFolders]);

  const handleRenameFolder = useCallback(async (id: number, name: string) => {
    if (!apiFetch) return;
    await apiFetch('/api/templates/folders', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name }),
    });
    await loadFolders();
  }, [apiFetch, loadFolders]);

  const handleDeleteFolder = useCallback(async (id: number) => {
    if (!apiFetch) return;
    await apiFetch('/api/templates/folders', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    await loadFolders();
  }, [apiFetch, loadFolders]);

  // Flache Ordner-Liste für PaletteRow-Verschieben
  const flatFolders = useMemo(() => {
    const flatten = (nodes: FolderNode[], depth: number): { id: number; name: string; depth: number }[] => {
      const result: { id: number; name: string; depth: number }[] = [];
      for (const n of nodes) {
        result.push({ id: n.id, name: n.name, depth });
        result.push(...flatten(n.children, depth + 1));
      }
      return result;
    };
    const all: { id: number; name: string; depth: number }[] = [];
    all.push(...flatten(personalFolders, 0));
    for (const gf of groupFolders) {
      all.push(...flatten(gf.folders, 0));
    }
    return all;
  }, [personalFolders, groupFolders]);

  const handleMoveToFolder = useCallback(async (templateId: number, folderId: number | null) => {
    if (!apiFetch) return;
    try {
      await apiFetch('/api/templates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: templateId, folderId }),
      });
      await loadFolders();
    } catch { /* silent */ }
  }, [apiFetch, loadFolders]);

  // Templates nach ausgewähltem Ordner filtern
  const filteredTemplatesFromFolder = useMemo(() => {
    if (selectedFolderId === null) return null; // null = "Alle" → kein Filter

    // Templates aus diesem Ordner und allen Unterordnern
    const collectSubfolderIds = (folders: FolderNode[], ids: Set<number>) => {
      for (const f of folders) {
        ids.add(f.id);
        collectSubfolderIds(f.children, ids);
      }
    };

    // Aus persönlichen Ordnern
    const relevantIds = new Set<number>();
    collectSubfolderIds(personalFolders, relevantIds);

    // Aus Gruppen-Ordnern (alle sichtbaren)
    for (const gf of groupFolders) {
      collectSubfolderIds(gf.folders, relevantIds);
    }

    if (!relevantIds.has(selectedFolderId)) return null;

    // Alle Subfolder-Ids sammeln
    const allSubIds = new Set<number>();
    const findSubIds = (folders: FolderNode[]) => {
      for (const f of folders) {
        if (f.id === selectedFolderId || allSubIds.has(f.id)) {
          allSubIds.add(f.id);
          for (const child of f.children) {
            collectSubfolderIds([child], allSubIds);
          }
        }
        findSubIds(f.children);
      }
    };
    findSubIds(personalFolders);
    for (const gf of groupFolders) findSubIds(gf.folders);

    return templates.filter((t) => t.folderId !== undefined && allSubIds.has(t.folderId!));
  }, [selectedFolderId, personalFolders, groupFolders, templates]);

  const hasGroupTemplates = templates.some((t) => t.scope === 'group');

  const filteredTemplates = useMemo(() => {
    let list = templates;
    if (activeTab === 'private') list = list.filter((t) => t.scope !== 'group');
    if (activeTab === 'group') list = list.filter((t) => t.scope === 'group');
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) =>
          t.name.toLowerCase().includes(q) ||
          t.content.toLowerCase().includes(q),
      );
    }
    return list;
  }, [templates, activeTab, search]);

  // Gruppieren nach Namens-Präfix
  const grouped = useMemo(() => {
    const groups = new Map<string, BausteinTemplate[]>();
    const ungrouped: BausteinTemplate[] = [];
    for (const t of filteredTemplates) {
      const g = extractGroup(t.name);
      if (g) {
        if (!groups.has(g)) groups.set(g, []);
        groups.get(g)!.push(t);
      } else {
        ungrouped.push(t);
      }
    }
    const sortedGroups = Array.from(groups.entries()).sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
    for (const [, items] of sortedGroups) {
      items.sort((a, b) => a.name.localeCompare(b.name));
    }
    ungrouped.sort((a, b) => a.name.localeCompare(b.name));
    return { groups: sortedGroups, ungrouped };
  }, [filteredTemplates]);

  return (
    <div
      className="
        overflow-y-auto rounded-r-xl border
        border-gray-200 dark:border-gray-700
        bg-white/95 dark:bg-gray-900/95
        shadow-2xl backdrop-blur-sm
        pointer-events-auto
        w-64
      "
      style={{ maxHeight: '80vh' }}
    >
      {/* Header */}
      <div className="px-3 py-2.5 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-800 dark:text-gray-200">
          Verfügbare Bausteine
        </h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-base leading-none"
          title="Schliessen"
        >
          ✕
        </button>
      </div>

      {/* Search */}
      <div className="px-3 pt-2 pb-1">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="🔍  Suchen…"
          className="w-full px-2 py-1 text-[11px] border border-gray-200 dark:border-gray-700 rounded-md bg-gray-50 dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-400"
        />
      </div>

      {/* Ansicht-Umschalter */}
      <div className="flex items-center gap-1 px-3 pb-1">
        <button
          onClick={() => setView('tree')}
          className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
            view === 'tree'
              ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium'
              : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
          }`}
        >
          🗂️ Ordner
        </button>
        <button
          onClick={() => setView('list')}
          className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
            view === 'list'
              ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium'
              : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
          }`}
        >
          📋 Liste
        </button>
      </div>

      {view === 'tree' ? (
        /* ── Ordner-Ansicht ── */
        <div className="divide-y divide-gray-100 dark:divide-gray-800">
              {/* Persönliche Ordner — mit Username als Root */}
              <div>
                {/* Username als Root-Eintrag */}
                <div
                  className={`flex items-center gap-1 px-2 py-1 rounded cursor-pointer text-xs transition-colors mx-1 mt-0.5 ${
                    selectedFolderId === null
                      ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-800/60 text-gray-700 dark:text-gray-300'
                  }`}
                  onClick={() => setSelectedFolderId(null)}
                  title="Alle persönlichen Bausteine anzeigen"
                >
                  <span className="shrink-0">👤</span>
                  <span className="font-medium truncate">{username || 'Eigene'}</span>
                  <span className="ml-auto text-[10px] text-gray-400">
                    {templates.filter((t) => t.scope !== 'group').length}
                  </span>
                </div>

                {/* Ordner-Struktur darunter */}
                <FolderExplorer
                  folders={personalFolders}
                  onSelectFolder={setSelectedFolderId}
                  selectedFolderId={selectedFolderId}
                  onCreateFolder={handleCreateFolder}
                  onRenameFolder={handleRenameFolder}
                  onDeleteFolder={handleDeleteFolder}
                />

                {/* Bausteine ohne Ordner (nur wenn kein Ordner-Filter aktiv) */}
                {selectedFolderId === null && templates.filter((t) => t.scope !== 'group' && (t.folderId === undefined || t.folderId === null)).length > 0 && (
                  <div className="border-t border-gray-100 dark:border-gray-800 mt-1 pt-1">
                    <div className="px-2 py-0.5 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                      Ohne Ordner
                    </div>
                    {templates.filter((t) => t.scope !== 'group' && (t.folderId === undefined || t.folderId === null)).map((tpl) => (
                      <PaletteRow key={tpl.id} template={tpl} onAdd={onAddBaustein} folders={flatFolders} onMoveToFolder={handleMoveToFolder} onCopyTemplate={onCopyTemplate} />
                    ))}
                  </div>
                )}
              </div>

              {/* Ausgewählter Ordner: Templates anzeigen */}
              {selectedFolderId !== null && (
                <div className="divide-y divide-gray-100 dark:divide-gray-800 border-t border-gray-100 dark:border-gray-800">
                  {filteredTemplatesFromFolder === null ? (
                    <div className="px-3 py-4 text-xs text-gray-400 text-center">Bitte Ordner auswählen.</div>
                  ) : filteredTemplatesFromFolder.length === 0 ? (
                    <div className="px-3 py-4 text-xs text-gray-400 text-center">Keine Bausteine in diesem Ordner.</div>
                  ) : filteredTemplatesFromFolder.map((tpl) => (
                    <PaletteRow key={tpl.id} template={tpl} onAdd={onAddBaustein} folders={flatFolders} onMoveToFolder={handleMoveToFolder} onCopyTemplate={onCopyTemplate} />
                  ))}
                </div>
              )}
            </div>
          ) : (
        /* ── Listen-Ansicht (bisherige Ansicht) ── */
        <>
          {/* Scope-Tabs */}
          <div className="flex gap-0.5 px-3 pb-1.5">
            <TabButton
              label="👤 Eigene"
              active={activeTab === 'private'}
              onClick={() => setActiveTab('private')}
            />
            {hasGroupTemplates && (
              <TabButton
                label="🏢 Abteilung"
                active={activeTab === 'group'}
                onClick={() => setActiveTab('group')}
              />
            )}
          </div>

          {/* Template-Liste */}
          <div className="divide-y divide-gray-100 dark:divide-gray-800">
            {filteredTemplates.length === 0 && (
              <div className="px-3 py-4 text-xs text-gray-400 dark:text-gray-500 text-center">
                {search ? 'Keine Bausteine gefunden.' : 'Keine Bausteine für dieses Feld.'}
              </div>
            )}

            {preserveOrder ? (
              /* Komplexbaustein-Modus: Reihenfolge beibehalten, keine Gruppierung */
              filteredTemplates.map((tpl) => (
                <PaletteRow
                  key={tpl.id}
                  template={tpl}
                  onAdd={onAddBaustein}
                  folders={flatFolders}
                  onMoveToFolder={handleMoveToFolder}
                  onCopyTemplate={onCopyTemplate}
                />
              ))
            ) : (
              /* Normaler Modus: alphabetische Gruppierung */
              grouped.groups.length > 0 && grouped.groups.map(([group, items]) => (
                <div key={group}>
                  <div className="px-3 py-1 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider bg-gray-50 dark:bg-gray-800/50">
                    {group}
                  </div>
                  {items.map((tpl) => (
                    <PaletteRow
                      key={tpl.id}
                      template={tpl}
                      onAdd={onAddBaustein}
                      folders={flatFolders}
                      onMoveToFolder={handleMoveToFolder}
                      onCopyTemplate={onCopyTemplate}
                    />
                  ))}
                </div>
              ))
            )}

            {!preserveOrder && grouped.ungrouped.length > 0 && (
              <div>
                {grouped.groups.length > 0 && (
                  <div className="px-3 py-1 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider bg-gray-50 dark:bg-gray-800/50">
                    Weitere
                  </div>
                )}
                {grouped.ungrouped.map((tpl) => (
                  <PaletteRow
                    key={tpl.id}
                    template={tpl}
                    onAdd={onAddBaustein}
                    folders={flatFolders}
                    onMoveToFolder={handleMoveToFolder}
                    onCopyTemplate={onCopyTemplate}
                  />
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Sub-components ──────────────────────────────────────────────────────────

/**
 * Baut aus einer flachen Liste von Folder-Objekten eine verschachtelte Baum-Struktur auf.
 */
function buildFolderTree(flatList: { id: number; parentId: number | null; name: string; sortOrder: number; children?: any[] }[]): FolderNode[] {
  const map = new Map<number, FolderNode>();
  const roots: FolderNode[] = [];

  for (const item of flatList) {
    map.set(item.id, { id: item.id, parentId: item.parentId, name: item.name, children: [] });
  }

  for (const item of flatList) {
    const node = map.get(item.id)!;
    if (item.parentId !== null && map.has(item.parentId)) {
      map.get(item.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-[11px] px-2 py-0.5 rounded font-medium transition-colors ${
        active
          ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
          : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
      }`}
    >
      {label}
    </button>
  );
}

function PaletteRow({
  template,
  onAdd,
  folders,
  onMoveToFolder,
  onCopyTemplate,
}: {
  template: BausteinTemplate;
  onAdd: (t: BausteinTemplate) => void;
  folders?: { id: number; name: string; depth: number }[];
  onMoveToFolder?: (templateId: number, folderId: number | null) => void;
  onCopyTemplate?: (template: BausteinTemplate) => void;
}) {
  const [showMove, setShowMove] = useState(false);

  return (
    <div className="relative group">
      <button
        onClick={() => onAdd(template)}
        className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors flex items-start gap-2"
        title={`"${template.name}" einfügen`}
      >
        <span className="text-sm leading-none mt-0.5 shrink-0">
          '📋'
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">
              {template.name}
            </span>
            {template.scope === 'group' && (
              <span className="text-[9px] text-amber-500 dark:text-amber-400 shrink-0 bg-amber-50 dark:bg-amber-900/20 px-1 py-0.5 rounded">
                Abteilung
              </span>
            )}
            {folders && onMoveToFolder && (
              <button
                onClick={(e) => { e.stopPropagation(); setShowMove(!showMove); }}
                className="opacity-0 group-hover:opacity-100 px-0.5 text-gray-400 hover:text-blue-600 text-[10px] transition-opacity shrink-0"
                title="In Ordner verschieben"
              >
                📁
              </button>
            )}
          </div>
          <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 line-clamp-2 leading-relaxed">
            {template.content.substring(0, 120)}
            {template.content.length > 120 ? '…' : ''}
          </div>
        </div>
      </button>
      {template.scope === 'group' && onCopyTemplate && (
        <button
          onClick={(e) => { e.stopPropagation(); onCopyTemplate(template); }}
          className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-800/40"
          title="Kopie in eigenen Bausteinen anlegen"
        >
          📋 Kopie
        </button>
      )}
      {showMove && folders && onMoveToFolder && (
        <div className="absolute right-2 top-full z-10 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded shadow-lg p-1">
          <select
            className="text-[10px] px-1 py-0.5 border rounded dark:bg-gray-700"
            value=""
            onChange={(e) => {
              const val = e.target.value;
              if (val !== '') {
                onMoveToFolder(template.id, Number(val));
              }
              setShowMove(false);
            }}
            autoFocus
            onBlur={() => setShowMove(false)}
          >
            <option value="">— Ordner wählen —</option>
            {folders.map((f) => (
              <option key={f.id} value={f.id}>
                {'  '.repeat(f.depth)}{f.name}
              </option>
            ))}
          </select>
        </div>
      )}
    </div>
  );
}
