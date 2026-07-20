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
  isShared?: boolean;
  addedBy?: string;
}

interface ComplexTemplate {
  id: number;
  name: string;
  templateIds: number[];
  folderId?: number | null;
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
  onEditTemplate?: (template: Template) => void;
  onDeleteTemplate?: (templateId: number, name: string, scope?: string) => void;
  onShareTemplate?: (template: Template) => void;
  onCopyTemplate?: (template: Template) => void;
  onDeleteComplexTemplate?: (templateId: number, name: string) => void;
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
  onEditTemplate,
  onDeleteTemplate,
  onShareTemplate,
  onCopyTemplate,
  onDeleteComplexTemplate,
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
  // Lokale folderId-Overrides nach Drag&Drop, damit die Ansicht sofort aktualisiert wird
  const [folderIdOverrides, setFolderIdOverrides] = useState<Record<number, number | null | undefined>>({});
  const [complexFolderIdOverrides, setComplexFolderIdOverrides] = useState<Record<number, number | null | undefined>>({});
  const [showNewMenu, setShowNewMenu] = useState(false);

  // Schliessen bei Klick ausserhalb
  useEffect(() => {
    if (!open) return;
    // Overrides beim Öffnen zurücksetzen (templates-Prop ist frisch vom Parent)
    setFolderIdOverrides({});
    setComplexFolderIdOverrides({});
    setShowNewMenu(false);
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

  // Nach Feld filtern + lokale folderId-Overrides anwenden
  const fieldTemplates = useMemo(
    () => templates
      .filter((t) => t.field === currentField)
      .map((t) => {
        const override = folderIdOverrides[t.id];
        if (override !== undefined) {
          return { ...t, folderId: override ?? null };
        }
        return t;
      }),
    [templates, currentField, folderIdOverrides],
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

  // Gruppen-Templates nach addedBy-User gruppiert (für Abteilung-Tab)
  const groupTemplatesByUser = useMemo(() => {
    const byUser = new Map<string, Template[]>();
    for (const t of fieldTemplates) {
      if (t.scope !== 'group') continue;
      const user = t.addedBy || 'Unbekannt';
      if (!byUser.has(user)) byUser.set(user, []);
      byUser.get(user)!.push(t);
    }
    // Sortieren: User alphabetisch, Templates alphabetisch
    const sorted = Array.from(byUser.entries())
      .sort((a, b) => a[0].localeCompare(b[0]));
    for (const [, items] of sorted) {
      items.sort((a, b) => a.name.localeCompare(b.name));
    }
    return sorted;
  }, [fieldTemplates]);

  // Filter für Abteilung-Tab + Search
  const groupTemplatesFiltered = useMemo(() => {
    if (!search.trim()) return groupTemplatesByUser;
    const q = search.toLowerCase();
    return groupTemplatesByUser
      .map(([user, items]) => [
        user,
        items.filter((t) => t.name.toLowerCase().includes(q) || t.content.toLowerCase().includes(q)),
      ] as [string, Template[]])
      .filter(([, items]) => items.length > 0);
  }, [groupTemplatesByUser, search]);

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

  // Neu-Menü schliessen bei Klick ausserhalb
  const newMenuRef = useRef<HTMLDivElement>(null);
  const newMenuBtnRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!showNewMenu) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        newMenuBtnRef.current && !newMenuBtnRef.current.contains(target) &&
        newMenuRef.current && !newMenuRef.current.contains(target)
      ) {
        setShowNewMenu(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showNewMenu]);

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
      const targetFolderId = folderId === -1 ? null : folderId;
      const isComplex = scope === 'complex';
      const url = isComplex ? '/api/templates/complex' : '/api/templates';
      const body = isComplex
        ? JSON.stringify({ id: templateId, folderId: targetFolderId })
        : JSON.stringify({ id: templateId, folderId: targetFolderId, scope });
      const res = await apiFetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body,
      });
      if (res.ok) {
        if (isComplex) {
          setComplexFolderIdOverrides((prev) => ({ ...prev, [templateId]: targetFolderId }));
        } else {
          setFolderIdOverrides((prev) => ({ ...prev, [templateId]: targetFolderId }));
        }
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

  // Persönliche Templates ohne Ordner (für "Ohne Ordner"-Sektion)
  const ungroupedPrivateTemplates = useMemo(
    () => fieldTemplates.filter((t) => t.scope !== 'group' && (t.folderId === undefined || t.folderId === null)),
    [fieldTemplates],
  );

  // Komplexbausteine ohne Ordner (mit lokalen Overrides)
  const ungroupedComplex = useMemo(
    () => complexTemplates
      .map((ct) => {
        const override = complexFolderIdOverrides[ct.id];
        if (override !== undefined) {
          return { ...ct, folderId: override ?? null };
        }
        return ct;
      })
      .filter((ct) => ct.folderId === undefined || ct.folderId === null),
    [complexTemplates, complexFolderIdOverrides],
  );

  // Komplexbausteine im aktuell ausgewählten Ordner (mit lokalen Overrides)
  const folderFilteredComplex = useMemo(() => {
    if (selectedFolderId === null) return null;
    const collectSubIds = (folders: FolderNode[], ids: Set<number>) => {
      for (const f of folders) { ids.add(f.id); collectSubIds(f.children, ids); }
    };
    const allIds = new Set<number>();
    collectSubIds(personalFolders, allIds);
    for (const gf of groupFolders) collectSubIds(gf.folders, allIds);

    if (!allIds.has(selectedFolderId)) return [];

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

    return complexTemplates
      .map((ct) => {
        const override = complexFolderIdOverrides[ct.id];
        if (override !== undefined) {
          return { ...ct, folderId: override ?? null };
        }
        return ct;
      })
      .filter((ct) => ct.folderId !== undefined && ct.folderId !== null && allSubIds.has(ct.folderId!));
  }, [selectedFolderId, personalFolders, groupFolders, complexTemplates, complexFolderIdOverrides]);

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
              { key: 'group' as const, label: '👥 Abteilung' },
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

          {/* ── Abteilung-Tab: geteilte Bausteine nach User ── */}
          {activeTab === 'group' ? (
            <div className="overflow-y-auto" style={{ maxHeight: '50vh' }}>
              {groupTemplatesFiltered.length === 0 && (
                <div className="px-3 py-4 text-xs text-gray-400 text-center">Keine geteilten Bausteine.</div>
              )}
              {groupTemplatesFiltered.map(([user, items]) => (
                <div key={user} className="border-t border-gray-100 dark:border-gray-800 first:border-t-0">
                  <div className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 dark:text-gray-400 font-medium">
                    <span className="shrink-0">📁</span>
                    <span className="truncate">{user}</span>
                  </div>
                  <div className="ml-2">
                  {items.map((tpl) => (
                    <SharedTemplateRow
                      key={tpl.id}
                      template={tpl}
                      onSelect={handleSelect}
                      onCopy={onCopyTemplate}
                    />
                  ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <>
            {/* Ansicht-Umschalter (nur für Alle/Eigene) */}
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
                      const { templateId, scope } = JSON.parse(raw);
                      handleDropOnFolder(-1, templateId, scope ?? 'private');
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
                {selectedFolderId === null && (
                  <>
                    {ungroupedPrivateTemplates.length > 0 && (
                      <div className="border-t border-gray-100 dark:border-gray-800 mt-1 pt-1">
                        <div className="px-2 py-0.5 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                          Ohne Ordner
                        </div>
                        {ungroupedPrivateTemplates.map((tpl) => (
                          <TemplateRow key={tpl.id} template={tpl} isSelected={selectedTemplate?.id === tpl.id && templateMode} onSelect={handleSelect} onEdit={onEditTemplate} onDelete={onDeleteTemplate} onShare={onShareTemplate} />
                        ))}
                      </div>
                    )}
                    {/* Komplexbausteine ohne Ordner */}
                    {ungroupedComplex.length > 0 && (
                      <div className="border-t border-gray-100 dark:border-gray-800 mt-1 pt-1">
                        <div className="px-2 py-0.5 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider">
                          🧩 Komplexbausteine
                        </div>
                        {ungroupedComplex.map((ct) => (
                          <ComplexTemplateRow
                            key={`complex-${ct.id}`}
                            complexTemplate={ct}
                            onSelect={() => {
                              onLoadComplexTemplate(ct.templateIds);
                              setOpen(false);
                              setSearch('');
                            }}
                            onDelete={onDeleteComplexTemplate}
                          />
                        ))}
                      </div>
                    )}
                  </>
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
                  {folderFilteredTemplates === null && folderFilteredComplex === null ? (
                    <div className="px-3 py-4 text-xs text-gray-400 text-center">Bitte Ordner auswählen.</div>
                  ) : (folderFilteredTemplates?.length ?? 0) === 0 && (folderFilteredComplex?.length ?? 0) === 0 ? (
                    <div className="px-3 py-4 text-xs text-gray-400 text-center">Keine Bausteine in diesem Ordner.</div>
                  ) : (
                    <>
                      {folderFilteredTemplates?.map((tpl) => (
                        <TemplateRow key={tpl.id} template={tpl} isSelected={selectedTemplate?.id === tpl.id && templateMode} onSelect={handleSelect} onEdit={onEditTemplate} onDelete={onDeleteTemplate} onShare={onShareTemplate} />
                      ))}
                      {folderFilteredComplex?.map((ct) => (
                        <ComplexTemplateRow
                          key={`complex-${ct.id}`}
                          complexTemplate={ct}
                          onSelect={() => {
                            onLoadComplexTemplate(ct.templateIds);
                            setOpen(false);
                            setSearch('');
                          }}
                          onDelete={onDeleteComplexTemplate}
                        />
                      ))}
                    </>
                  )}
                </div>
              ) : null}
            </div>
          ) : (
            /* ── Listen-Ansicht ── */
            <><div className="flex gap-0.5 px-3 pb-1.5">
            {[
              { key: 'all' as const, label: 'Alle' },
              { key: 'private' as const, label: '👤 Eigene' },
            ].map((tab) => {
              const count = tab.key === 'all' ? fieldTemplates.length
                : tab.key === 'private' ? fieldTemplates.filter((t) => t.scope !== 'group').length
                : 0;
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
                  <TemplateRow key={tpl.id} template={tpl} isSelected={selectedTemplate?.id === tpl.id && templateMode} onSelect={handleSelect} onEdit={onEditTemplate} onDelete={onDeleteTemplate} onShare={onShareTemplate} />
                ))}
              </div>
            ))}

            {groupedTemplates.ungrouped.length > 0 && (
              <div>
                {groupedTemplates.groups.length > 0 && (
                  <div className="sticky top-0 px-3 py-1.5 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider bg-gray-50 dark:bg-gray-800/50 border-b border-gray-100 dark:border-gray-800">Weitere</div>
                )}
                {groupedTemplates.ungrouped.map((tpl) => (
                  <TemplateRow key={tpl.id} template={tpl} isSelected={selectedTemplate?.id === tpl.id && templateMode} onSelect={handleSelect} onEdit={onEditTemplate} onDelete={onDeleteTemplate} onShare={onShareTemplate} />
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
          </>)}

          {/* Action-Footer */}
          <div className="border-t border-gray-100 dark:border-gray-800 px-1.5 py-1.5 flex flex-wrap gap-0.5 bg-gray-50/80 dark:bg-gray-800/40">
            <div className="relative">
              <button
                ref={newMenuBtnRef}
                onClick={() => setShowNewMenu((prev) => !prev)}
                className={`text-[11px] px-2 py-1 rounded-md transition-colors flex items-center gap-1 ${
                  showNewMenu
                    ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300'
                    : 'text-gray-600 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
                }`}
              >
                <span>➕</span>
                <span>Neu</span>
              </button>
              {showNewMenu && (
                <div
                  ref={newMenuRef}
                  className="absolute bottom-full left-0 mb-1 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-xl p-1 flex flex-col gap-0.5 min-w-[140px]"
                >
                  <button
                    onClick={() => handleAction(() => onManageTemplates('create'))}
                    className="w-full text-left px-2.5 py-1.5 text-xs rounded hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors"
                  >
                    <span>📋</span>
                    <span>Baustein</span>
                  </button>
                  <button
                    onClick={() => handleAction(onOpenComplexManager)}
                    className="w-full text-left px-2.5 py-1.5 text-xs rounded hover:bg-gray-100 dark:hover:bg-gray-700 flex items-center gap-2 transition-colors"
                  >
                    <span>🧩</span>
                    <span>Komplexbaustein</span>
                  </button>
                </div>
              )}
            </div>
            <ActionButton
              icon={showMultiBausteinMode ? '✓' : '⊞'}
              label="Multi"
              onClick={() => {
                onToggleMultiMode();
                setOpen(false);
              }}
              highlight={showMultiBausteinMode}
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
  onEdit,
  onDelete,
  onShare,
}: {
  template: Template;
  isSelected: boolean;
  onSelect: (tpl: Template) => void;
  onEdit?: (tpl: Template) => void;
  onDelete?: (id: number, name: string, scope?: string) => void;
  onShare?: (tpl: Template) => void;
}) {
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(
      'text/x-template',
      JSON.stringify({ templateId: template.id, scope: template.scope ?? 'private' }),
    );
    e.dataTransfer.effectAllowed = 'move';
  };

  const isPrivate = template.scope !== 'group';

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onClick={() => onSelect(template)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(template); }}
      onDragStart={handleDragStart}
      className={`w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/60 flex items-center gap-2 text-xs transition-colors cursor-grab active:cursor-grabbing group ${
        isSelected ? 'bg-blue-50 dark:bg-blue-900/20 ring-1 ring-blue-200 dark:ring-blue-800' : ''
      }`}
      title={`"${template.name}" einfügen — zum Verschieben in Ordner ziehen`}
    >
      <span className="shrink-0 text-sm">
        {template.scope === 'group' ? '👥' : '📋'}
      </span>
      <span className="truncate text-gray-800 dark:text-gray-200 flex-1">
        {template.name}
      </span>
      {template.scope === 'group' && (
        <span className="text-[10px] text-amber-500 dark:text-amber-400 shrink-0 bg-amber-50 dark:bg-amber-900/20 px-1 py-0.5 rounded">
          Abteilung
        </span>
      )}
      {/* Inline edit/delete/share for private templates */}
      {isPrivate && onEdit && (
        <button
          onClick={(e) => { e.stopPropagation(); onEdit(template); }}
          className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 text-[11px] px-0.5 transition-opacity shrink-0"
          title="Bearbeiten"
        >
          ✎
        </button>
      )}
      {isPrivate && onShare && (
        <button
          onClick={(e) => { e.stopPropagation(); onShare(template); }}
          className={`opacity-0 group-hover:opacity-100 text-[11px] px-0.5 transition-opacity shrink-0 ${
            template.isShared
              ? 'text-emerald-500 dark:text-emerald-400'
              : 'text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400'
          }`}
          title={template.isShared ? 'Nicht mehr teilen' : 'Mit Gruppe teilen'}
        >
          {template.isShared ? '👥' : '👤'}
        </button>
      )}
      {isPrivate && onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(`"${template.name}" wirklich löschen?`)) {
              onDelete(template.id, template.name, template.scope);
            }
          }}
          className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 dark:hover:text-red-400 text-[11px] px-0.5 transition-opacity shrink-0"
          title="Löschen"
        >
          ×
        </button>
      )}
    </div>
  );
}

/**
 * Zeile in der Ordner-Ansicht für einen Komplexbaustein (🧩).
 * Kann per Drag & Drop in Ordner gezogen werden.
 */
function ComplexTemplateRow({
  complexTemplate,
  onSelect,
  onDelete,
}: {
  complexTemplate: ComplexTemplate;
  onSelect: () => void;
  onDelete?: (id: number, name: string) => void;
}) {
  const handleDragStart = (e: React.DragEvent) => {
    e.dataTransfer.setData(
      'text/x-template',
      JSON.stringify({ templateId: complexTemplate.id, scope: 'complex' }),
    );
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      onClick={onSelect}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(); }}
      onDragStart={handleDragStart}
      className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/60 flex items-center gap-2 text-xs transition-colors cursor-grab active:cursor-grabbing group"
      title={`"${complexTemplate.name}" öffnen — zum Verschieben in Ordner ziehen`}
    >
      <span className="shrink-0 text-sm text-indigo-500">🧩</span>
      <span className="truncate text-gray-800 dark:text-gray-200 flex-1">
        {complexTemplate.name}
      </span>
      <span className="text-[10px] text-gray-400 shrink-0">
        {complexTemplate.templateIds.length}
      </span>
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(`Komplexbaustein "${complexTemplate.name}" wirklich löschen?`)) {
              onDelete(complexTemplate.id, complexTemplate.name);
            }
          }}
          className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 dark:hover:text-red-400 text-[11px] px-0.5 transition-opacity shrink-0"
          title="Löschen"
        >
          ×
        </button>
      )}
    </div>
  );
}

/**
 * Zeile für einen geteilten Baustein in der Abteilung-Ansicht.
 * Nur einfügen + Kopie-Button (kein Bearbeiten/Löschen/Teilen).
 */
function SharedTemplateRow({
  template,
  onSelect,
  onCopy,
}: {
  template: Template;
  onSelect: (tpl: Template) => void;
  onCopy?: (tpl: Template) => void;
}) {
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(template)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') onSelect(template); }}
      className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/60 flex items-center gap-2 text-xs transition-colors cursor-pointer group"
      title={`"${template.name}" einfügen`}
    >
      <span className="shrink-0 text-sm">�</span>
      <span className="truncate text-gray-800 dark:text-gray-200 flex-1">
        {template.name}
      </span>
      {onCopy && (
        <button
          onClick={(e) => { e.stopPropagation(); onCopy(template); }}
          className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-200 dark:hover:bg-emerald-800/40 shrink-0"
          title="Kopie in eigenen Bausteinen anlegen"
        >
          📋 Kopie
        </button>
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
