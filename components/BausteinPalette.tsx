'use client';

import { useState, useMemo } from 'react';

interface BausteinTemplate {
  id: number;
  name: string;
  content: string;
  scope?: 'private' | 'group';
}

interface BausteinPaletteProps {
  templates: BausteinTemplate[];
  onAddBaustein: (template: BausteinTemplate) => void;
  onClose: () => void;
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
}: BausteinPaletteProps) {
  const [search, setSearch] = useState('');
  const [activeTab, setActiveTab] = useState<'all' | 'private' | 'group'>('all');

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

      {/* Scope-Tabs */}
      <div className="flex gap-0.5 px-3 pb-1.5">
        <TabButton
          label="Alle"
          active={activeTab === 'all'}
          onClick={() => setActiveTab('all')}
        />
        <TabButton
          label="👤 Eigene"
          active={activeTab === 'private'}
          onClick={() => setActiveTab('private')}
        />
        {hasGroupTemplates && (
          <TabButton
            label="👥 Gruppe"
            active={activeTab === 'group'}
            onClick={() => setActiveTab('group')}
          />
        )}
      </div>

      {/* Template-Liste */}
      <div className="divide-y divide-gray-100 dark:divide-gray-800">
        {grouped.groups.length === 0 && grouped.ungrouped.length === 0 && (
          <div className="px-3 py-4 text-xs text-gray-400 dark:text-gray-500 text-center">
            {search
              ? 'Keine Bausteine gefunden.'
              : 'Keine Bausteine für dieses Feld.'}
          </div>
        )}

        {grouped.groups.map(([group, items]) => (
          <div key={group}>
            <div className="px-3 py-1 text-[10px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider bg-gray-50 dark:bg-gray-800/50">
              {group}
            </div>
            {items.map((tpl) => (
              <PaletteRow
                key={tpl.id}
                template={tpl}
                onAdd={onAddBaustein}
              />
            ))}
          </div>
        ))}

        {grouped.ungrouped.length > 0 && (
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
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
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
}: {
  template: BausteinTemplate;
  onAdd: (t: BausteinTemplate) => void;
}) {
  return (
    <button
      onClick={() => onAdd(template)}
      className="w-full text-left px-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/60 transition-colors flex items-start gap-2"
      title={`"${template.name}" einfügen`}
    >
      <span className="text-sm leading-none mt-0.5 shrink-0">
        {template.scope === 'group' ? '👥' : '📋'}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-medium text-gray-800 dark:text-gray-200 truncate">
            {template.name}
          </span>
          {template.scope === 'group' && (
            <span className="text-[9px] text-amber-500 dark:text-amber-400 shrink-0 bg-amber-50 dark:bg-amber-900/20 px-1 py-0.5 rounded">
              Gruppe
            </span>
          )}
        </div>
        <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5 line-clamp-2 leading-relaxed">
          {template.content.substring(0, 120)}
          {template.content.length > 120 ? '…' : ''}
        </div>
      </div>
    </button>
  );
}
