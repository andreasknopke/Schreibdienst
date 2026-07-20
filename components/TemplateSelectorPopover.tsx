'use client';

import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import FolderExplorer, { type FolderNode } from './FolderExplorer';

interface Template {
  id: number;
  name: string;
  content: string;
  field: 'methodik' | 'befund' | 'beurteilung';
  formatRanges?: any[];
  scope?: 'private' | 'group';
  groupName?: string;
  folderId?: number | null;
}

interface ComplexTemplate {
  id: number;
  name: string;
  templateIds: number[];
}

interface TemplateSelectorPopoverProps {
  templates: Template[];
  complexTemplates: ComplexTemplate[];
  selectedTemplate: Template | null;
  showMultiBausteinMode: boolean;
  templateMode: boolean;
  loadingTemplates: boolean;
  currentField: string;
  onSelectTemplate: (template: Template | null) => void;
  onManageTemplates: (mode: 'create' | 'manage') => void;
  onToggleMultiMode: () => void;
  onOpenComplexManager: () => void;
  onLoadComplexTemplate: (templateIds: number[]) => void;
  onExitTemplateMode: () => void;
  apiFetch?: (url: string, options?: RequestInit) => Promise<Response>;
  username?: string;
}

/**
 * Extrahiert eine Gruppen-Überschrift aus dem Baustein-Namen.
 * Alles vor "–", "-" oder ":" mit umgebenden Spaces wird als Gruppe verwendet.
 * Beispiel: "CCT – Standard" → "CCT",  "MRT Knie - Spezial" → "MRT Knie"
 */
function extractGroup(name: string): string | null {
  const match = name.match(/^(.+?)\s*[–\-:]\s/);
  return match ? match[1].trim() : null;
}

export default function TemplateSelectorPopover({
  templates,
  complexTemplates,
  selectedTemplate,
  showMultiBausteinMode,
  templateMode,
  loadingTemplates,
  currentField,
  onSelectTemplate,
  onManageTemplates,
  onToggleMultiMode,
  onOpenComplexManager,
  onLoadComplexTemplate,
  onExitTemplateMode,
  apiFetch,
  username: _username,
}: TemplateSelectorPopoverProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'private' | 'group'>('all');
  const [view, setView] = useState<'tree' | 'list'>('tree');
  const [selectedFolderId, setSelectedFolderId] = useState<number | null>(null);
  const [personalFolders, setPersonalFolders] = useState<FolderNode[]>([]);
  const [groupFolders, setGroupFolders] = useState<{ groupId: number; groupName: string; folders: FolderNode[] }[]>([]);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [moveVersion, setMoveVersion] = useState(0);

  // Schliessen bei Klick ausserhalb
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setOpen(false);
        setSearch('');
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Search fokussieren beim Öffnen
  useEffect(() => {
    if (open) {
      setTimeout(() => searchRef.current?.focus(), 50);
    }
  }, [open]);

  // Nach Feld filtern
  const fieldTemplates = useMemo(
    () => templates.filter((t) => t.field === currentField),
    [templates, currentField],
  );

  // Nach Tab + Search filtern
  const filteredTemplates = useMemo(() => {
    let list = fieldTemplates;
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
  }, [fieldTemplates, activeTab, search]);

  // Gruppieren
  const groupedTemplates = useMemo(() => {
    const groups = new Map<string, Template[]>();
    const ungrouped: Template[] = [];
    for (const t of filteredTemplates) {
      const group = extractGroup(t.name);
      if (group) {
        if (!groups.has(group)) groups.set(group, []);
        groups.get(group)!.push(t);
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

  // Komplexbausteine filtern
  const filteredComplex = useMemo(() => {
    if (!search.trim()) return complexTemplates;
    const q = search.toLowerCase();
    return complexTemplates.filter((ct) => ct.name.toLowerCase().includes(q));
  }, [complexTemplates, search]);

  const handleSelect = (tpl: Template) => {
    onSelectTemplate(tpl);
    setOpen(false);
    setSearch('');
  };

  const handleAction = (fn: () => void) => {
    fn();
    setOpen(false);
    setSearch('');
  };

  // ── Ordner-Struktur ──
  const loadFolders = useCallback(async () => {
    if (!apiFetch) return;
    try {
      const res = await apiFetch('/api/templates/folders', {});
      const data = await res.json();
      if (data.success && data.tree) {
        setPersonalFolders(buildFolderTree(data.tree.personal || []));
        setGroupFolders((data.tree.groups || []).map((g: any) => ({
          groupId: g.groupId,
          groupName: g.groupName,
          folders: buildFolderTree(g.folders || []),
        })));
      }
    } catch { /* silent */ }
  }, [apiFetch]);

  useEffect(() => { if (open && view === 'tree') loadFolders(); }, [open, view, loadFolders]);

  const handleCreateFolder = useCallback(async (name: string, parentId: number | null) => {
    if (!apiFetch) return;
    await apiFetch('/api/templates/folders', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, parentId }),
    });
    await loadFolders();
  }, [apiFetch, loadFolders]);

  const handleRenameFolder = useCallback(async (id: number, name: string) => {
    if (!apiFetch) return;
    await apiFetch('/api/templates/folders', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, name }),
    });
    await loadFolders();
  }, [apiFetch, loadFolders]);

  const handleDeleteFolder = useCallback(async (id: number) => {
    if (!apiFetch) return;
    await apiFetch('/api/templates/folders', {
      method: 'DELETE', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    await loadFolders();
  }, [apiFetch, loadFolders]);

  const handleDropOnFolder = useCallback(async (folderId: number, templateId: number, scope: string) => {
    if (!apiFetch) return;
    try {
      // folderId === -1 bedeutet "aus Ordner entfernen" (wieder Root)
      const targetFolderId = folderId === -1 ? null : folderId;
      const res = await apiFetch('/api/templates', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: templateId, folderId: targetFolderId, scope }),
      });
      if (res.ok) {
        setMoveVersion((v) => v + 1);
        await loadFolders();
      }
    } catch { /* silent */ }
  }, [apiFetch, loadFolders]);

  // Nach Ordner gefilterte Templates
  const folderFilteredTemplates = useMemo(() => {
    if (selectedFolderId === null) return null;
    const collectSubIds = (folders: FolderNode[], ids: Set<number>) => {
      for (const f of folders) { ids.add(f.id); collectSubIds(f.children, ids); }
    };
    const allIds = new Set<number>();
    collectSubIds(personalFolders, allIds);
    for (const gf of groupFolders) collectSubIds(gf.folders, allIds);

    if (!allIds.has(selectedFolderId)) return null;

    const allSubIds = new Set<number>();
    const findSubIds = (folders: FolderNode[]) => {
      for (const f of folders) {
        if (f.id === selectedFolderId || allSubIds.has(f.id)) {
          allSubIds.add(f.id);
          for (const c of f.children) collectSubIds([c], allSubIds);
        }
        findSubIds(f.children);
      }
    };
    findSubIds(personalFolders);
    for (const gf of groupFolders) findSubIds(gf.folders);

    return fieldTemplates.filter((t) => t.folderId !== undefined && allSubIds.has(t.folderId!));
  }, [selectedFolderId, personalFolders, groupFolders, fieldTemplates]);

  const hasTemplates = filteredTemplates.length > 0;
  const hasComplex = filteredComplex.length > 0 && !search;

  const triggerLabel =
    templateMode && selectedTemplate
      ? selectedTemplate.name.length > 18
        ? selectedTemplate.name.substring(0, 18) + '…'
        : selectedTemplate.name
      : '📝 Bausteine';

  return (
    <div className="relative" ref={popoverRef}>
      <div className="flex items-center gap-1">
        {/* Trigger Button */}
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className={`select h-9 text-sm w-44 flex items-center gap-1.5 px-2.5 ${
            templateMode
              ? 'border-orange-400 ring-1 ring-orange-300'
              : ''
          }`}
          disabled={loadingTemplates}
          title={
            templateMode && selectedTemplate
              ? `Aktiver Baustein: ${selectedTemplate.name}`
              : 'Baustein auswählen oder verwalten'
          }
        >
          <span className="truncate flex-1 text-left">
            {loadingTemplates
              ? 'Lade Bausteine...'
              : triggerLabel}
          </span>
          <span className="text-[10px] opacity-50 shrink-0">
            {open ? '▲' : '▼'}
          </span>
        </button>

        {/* Exit-Template-Mode Button */}
        {templateMode && selectedTemplate && (
          <button
            onClick={onExitTemplateMode}
            className="text-xs text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 px-1"
            title="Textbaustein-Modus beenden"
          >
            ✕
          </button>
        )}
      </div>

      {/* Popover Panel */}
      {open && (
        <div
          className="absolute left-0 top-full mt-1 z-50 w-80 rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 shadow-2xl backdrop-blur-sm overflow-hidden"
          style={{ maxHeight: '75vh' }}
        >
          {/* Search */}
          <div className="px-3 pt-2.5 pb-1.5">
            <input
              ref={searchRef}
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="🔍  Bausteine durchsuchen…"
              className="w-full px-2.5 py-1.5 text-xs border border-gray-200 dark:border-gray-700 rounded-lg bg-gray-50 dark:bg-gray-800 focus:outline-none focus:ring-1 focus:ring-blue-400 dark:focus:ring-blue-600"
            />
          </div>

          {/* Scope-Tabs */}
          <div className="flex gap-0.5 px-3 pb-1.5">
            {([
              { key: 'all' as const, label: 'Alle' },
              { key: 'private' as const, label: '👤 Eigene' },
              { key: 'group' as const, label: '👥 Gruppe' },
            ]).map((tab) => {
              // Nur anzeigen wenn es entsprechende Einträge gibt
              if (tab.key === 'group' && !templates.some((t) => t.scope === 'group'))
                return null;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`text-[11px] px-2.5 py-1 rounded-md font-medium transition-colors ${
                    activeTab === tab.key
                      ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
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
            >🗂️ Ordner</button>
            <button
              onClick={() => setView('list')}
              className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                view === 'list'
                  ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300 font-medium'
                  : 'text-gray-400 hover:text-gray-600 dark:hover:text-gray-300'
              }`}
            >📋 Liste</button>
          </div>

          {view === 'tree' ? (
            /* ── Ordner-Ansicht ── */
            <div className="overflow-y-auto" style={{ maxHeight: '50vh' }}>
              <div className="px-1 pb-1">
                {/* Username als Root für persönliche Bausteine */}
                <div
                  className={`flex items-center gap-1 px-2 py-1 rounded cursor-pointer text-xs transition-colors ${
                    selectedFolderId === null
                      ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                      : 'hover:bg-gray-100 dark:hover:bg-gray-800/60 text-gray-600 dark:text-gray-400'
                  }`}
                  onClick={() => setSelectedFolderId(null)}
                  title="Alle persönlichen Bausteine anzeigen — hierher ziehen zum Entfernen aus Ordnern"
                  onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
                  onDrop={(e) => {
                    e.preventDefault();
                    const raw = e.dataTransfer.getData('text/x-template');
                    if (!raw) return;
                    try {
                      const { templateId } = JSON.parse(raw);
                      // auf persönliche Root = folderId null (aus Ordner entfernen)
                      handleDropOnFolder(-1, templateId, 'private');
                    } catch {}
                  }}
                >
                  <span>👤</span>
                  <span className="font-medium truncate">{_username || 'Eigene'}</span>
                  <span className="ml-auto text-[10px] text-gray-400">
                    {fieldTemplates.filter((t) => t.scope !== 'group').length}
                  </span>
                </div>

                <FolderExplorer
                  folders={personalFolders}
                  onSelectFolder={setSelectedFolderId}
                  selectedFolderId={selectedFolderId}
                  onCreateFolder={handleCreateFolder}
                  onRenameFolder={handleRenameFolder}
                  onDeleteFolder={handleDeleteFolder}
                  onDropOnFolder={handleDropOnFolder}
                />

                {/* Ohne Ordner (nur wenn kein Ordner-Filter aktiv) */}
                {selectedFolderId === null && fieldTemplates.filter((t) => t.scope !== 'group' && (t.folderId === undefined || t.folderId === null)).length > 0 && (
                  <div className="border-t border-gray-100 dark:border-gray-800 mt-1 pt-1">
                    <div className="px-2 py-0.5 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                      Ohne Ordner
                    </div>
                    {fieldTemplates.filter((t) => t.scope !== 'group' && (t.folderId === undefined || t.folderId === null)).map((tpl) => (
                      <TemplateRow key={tpl.id} template={tpl} isSelected={selectedTemplate?.id === tpl.id && templateMode} onSelect={handleSelect} />
                    ))}
                  </div>
                )}

                {/* Gruppen-Ordner */}
                {groupFolders.map((gf) => (
                  <div key={gf.groupId} className="mt-2">
                    <div className="px-2 py-0.5 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">👥 {gf.groupName}</div>
                    <FolderExplorer
                      folders={gf.folders}
                      onSelectFolder={setSelectedFolderId}
                      selectedFolderId={selectedFolderId}
                      onCreateFolder={handleCreateFolder}
                      onRenameFolder={handleRenameFolder}
                      onDeleteFolder={handleDeleteFolder}
                      onDropOnFolder={handleDropOnFolder}
                    />
                  </div>
                ))}
              </div>

              {/* Templates im ausgewählten Ordner */}
              {selectedFolderId !== null ? (
                <div className="divide-y divide-gray-100 dark:divide-gray-800 border-t border-gray-100 dark:border-gray-800">
                  {folderFilteredTemplates === null ? (
                    <div className="px-3 py-4 text-xs text-gray-400 text-center">Bitte Ordner auswählen.</div>
                  ) : folderFilteredTemplates.length === 0 ? (
                    <div className="px-3 py-4 text-xs text-gray-400 text-center">Keine Bausteine in diesem Ordner.</div>
                  ) : folderFilteredTemplates.map((tpl) => (
                    <TemplateRow key={tpl.id} template={tpl} isSelected={selectedTemplate?.id === tpl.id && templateMode} onSelect={handleSelect} />
                  ))}
                </div>
              ) : null}
            </div>
          ) : (
            /* ── Listen-Ansicht ── */
            <><div className="flex gap-0.5 px-3 pb-1.5">
            {[
              { key: 'all' as const, label: 'Alle' },
              { key: 'private' as const, label: '👤 Eigene' },
              { key: 'group' as const, label: '👥 Gruppe' },
            ].map((tab) => {
              const count = tab.key === 'all' ? fieldTemplates.length
                : tab.key === 'private' ? fieldTemplates.filter((t) => t.scope !== 'group').length
                : fieldTemplates.filter((t) => t.scope === 'group').length;
              if (count === 0 && tab.key !== 'all') return null;
              return (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`text-[11px] px-2.5 py-1 rounded-md font-medium transition-colors ${
                    activeTab === tab.key
                      ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                      : 'text-gray-500 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="overflow-y-auto" style={{ maxHeight: '50vh' }}>
            {/* Komplexbausteine */}
            {hasComplex && (
              <div>
                <div className="sticky top-0 px-3 py-1.5 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800">
                  🗂️ Komplexbausteine
                </div>
                {filteredComplex.map((ct) => (
                  <button
                    key={`complex-${ct.id}`}
                    onClick={() => {
                      onLoadComplexTemplate(ct.templateIds);
                      setOpen(false);
                      setSearch('');
                    }}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/60 flex items-center gap-2 text-xs transition-colors"
                    title={`${ct.name} (${ct.templateIds.length} Bausteine)`}
                  >
                    <span className="text-indigo-500 shrink-0 text-sm">🧩</span>
                    <span className="truncate text-gray-800 dark:text-gray-200 font-medium">{ct.name}</span>
                    <span className="text-[10px] text-gray-400 shrink-0 ml-auto">{ct.templateIds.length}</span>
                  </button>
                ))}
              </div>
            )}

            {groupedTemplates.groups.map(([group, items]) => (
              <div key={group}>
                <div className="sticky top-0 px-3 py-1.5 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800">{group}</div>
                {items.map((tpl) => (
                  <TemplateRow key={tpl.id} template={tpl} isSelected={selectedTemplate?.id === tpl.id && templateMode} onSelect={handleSelect} />
                ))}
              </div>
            ))}

            {groupedTemplates.ungrouped.length > 0 && (
              <div>
                {groupedTemplates.groups.length > 0 && (
                  <div className="sticky top-0 px-3 py-1.5 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800">Weitere</div>
                )}
                {groupedTemplates.ungrouped.map((tpl) => (
                  <TemplateRow key={tpl.id} template={tpl} isSelected={selectedTemplate?.id === tpl.id && templateMode} onSelect={handleSelect} />
                ))}
              </div>
            )}

            {!hasTemplates && !hasComplex && (
              <div className="px-3 py-6 text-xs text-gray-400 dark:text-gray-500 text-center">
                {search ? 'Keine Bausteine gefunden.' : 'Keine Bausteine für dieses Feld.'}
              </div>
            )}
          </div></>
          )}

          {/* Action-Footer */}
          <div className="border-t border-gray-100 dark:border-gray-800 px-1.5 py-1.5 flex flex-wrap gap-0.5 bg-gray-50/80 dark:bg-gray-800/40">
            <ActionButton
              icon="📂"
              label="Verwalten"
              onClick={() => handleAction(() => onManageTemplates('manage'))}
            />
            <ActionButton
              icon="➕"
              label="Neu"
              onClick={() => handleAction(() => onManageTemplates('create'))}
            />
            <ActionButton
              icon={showMultiBausteinMode ? '✓' : '⊞'}
              label="Multi"
              onClick={() => {
                onToggleMultiMode();
                setOpen(false);
              }}
              highlight={showMultiBausteinMode}
            />
            <ActionButton
              icon="🧩"
              label="Komplex"
              onClick={() => handleAction(onOpenComplexManager)}
            />
          </div>
        </div>
      )}
    </div>
  );
}

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

function TemplateRow({
  template,
  isSelected,
  onSelect,
}: {
  template: Template;
  isSelected: boolean;
  onSelect: (tpl: Template) => void;
}) {
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(
      'text/x-template',
      JSON.stringify({ templateId: template.id, scope: template.scope ?? 'private' }),
    );
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onClick={() => onSelect(template)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(template); }}
      onDragStart={handleDragStart}
      className={`w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/60 flex items-center gap-2 text-xs transition-colors cursor-grab active:cursor-grabbing ${
        isSelected ? 'bg-blue-50 dark:bg-blue-900/20 ring-1 ring-blue-200 dark:ring-blue-800' : ''
      }`}
      title={`"${template.name}" einfügen — zum Verschieben in Ordner ziehen`}
    >
      <span className="shrink-0 text-sm">
        {template.scope === 'group' ? '👥' : '📋'}
      </span>
      <span className="truncate text-gray-800 dark:text-gray-200">
        {template.name}
      </span>
      {template.scope === 'group' && (
        <span className="text-[10px] text-amber-500 dark:text-amber-400 shrink-0 ml-auto bg-amber-50 dark:bg-amber-900/20 px-1 py-0.5 rounded">
          Gruppe
        </span>
      )}
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  highlight,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  highlight?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`text-[11px] px-2 py-1 rounded-md transition-colors flex items-center gap-1 ${
        highlight
          ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
          : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
      }`}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );
}
