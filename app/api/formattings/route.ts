import { NextResponse } from 'next/server';
import { CONTROL_WORD_REPLACEMENTS } from '@/formattings/control-words';
import { DELETE_PATTERNS } from '@/formattings/delete-patterns';
import { ONLINE_COMMAND_PATTERNS } from '@/formattings/online-commands';
import { ABBREVIATIONS, AbbreviationEntry } from '@/formattings/abbreviations';

export const runtime = 'nodejs';

function getReplacementDisplay(replacement: any): string {
  if (typeof replacement === 'string') {
    return replacement
      .replace(/\n/g, '¶ ')
      .replace(/¶ $/, '')
      .replace(/¶$/, '') || '(leer)';
  }
  if (typeof replacement === 'function') {
    return '(dynamisch)';
  }
  return String(replacement);
}

function makeId(...parts: string[]): string {
  return parts[0].toLowerCase().replace(/\s+/g, '-').replace(/[^a-zäöüß0-9-]/g, '');
}

export async function GET() {
  const rules: {
    category: string;
    icon: string;
    items: { id: string; commands: string; replacement: string }[];
  }[] = [];

  // CONTROL_WORD_REPLACEMENTS
  const controlItems: { id: string; commands: string; replacement: string }[] = [];
  for (const entry of CONTROL_WORD_REPLACEMENTS) {
    controlItems.push({
      id: makeId(...entry.commands),
      commands: entry.commands.join(', '),
      replacement: getReplacementDisplay(entry.replacement),
    });
  }
  rules.push({ category: 'Absätze, Klammern & Satzzeichen', icon: '🔣', items: controlItems });

  // DELETE_PATTERNS
  const deleteItems: { id: string; commands: string; replacement: string }[] = [];
  for (const entry of DELETE_PATTERNS) {
    deleteItems.push({
      id: makeId(...entry.commands),
      commands: entry.commands.join(', '),
      replacement: entry.type === 'word' ? '🗑 Letztes Wort löschen'
        : entry.type === 'sentence' ? '🗑 Letzten Satz löschen'
        : '🗑 Letzten Absatz löschen',
    });
  }
  rules.push({ category: 'Löschbefehle', icon: '🗑', items: deleteItems });

  // ONLINE_COMMAND_PATTERNS
  const onlineItems: { id: string; commands: string; replacement: string }[] = [];
  const seenCommands = new Set<string>();
  for (const entry of ONLINE_COMMAND_PATTERNS) {
    const cmdKey = entry.commands.join('|');
    if (seenCommands.has(cmdKey)) continue;
    seenCommands.add(cmdKey);
    onlineItems.push({
      id: makeId(...entry.commands),
      commands: entry.commands.join(', '),
      replacement: entry.type === 'comma' ? ','
        : entry.type === 'period' ? '.'
        : entry.type === 'dash' ? '-'
        : entry.type === 'lineBreak' ? '¶ Zeilenumbruch'
        : entry.type === 'paragraphBreak' ? '¶¶ Absatzumbruch'
        : entry.type === 'bulletPoint' ? '• Aufzählungspunkt'
        : entry.type === 'deleteWord' ? '🗑 Letztes Wort löschen'
        : entry.type === 'deleteSentence' ? '🗑 Letzten Satz löschen'
        : entry.type === 'deleteParagraph' ? '🗑 Letzten Absatz löschen'
        : `(${entry.type})`,
    });
  }
  rules.push({ category: 'Live-Diktat-Befehle (Online/VAD)', icon: '⚡', items: onlineItems });

  // ABBREVIATIONS – nach Kategorie gruppiert
  const abbrCategories: { category: string; icon: string; items: { id: string; commands: string; replacement: string }[] }[] = [];
  const abbrCatOrder = ['Einheiten', 'Medikation', 'Laborwerte', 'Diagnostik', 'Allgemein'] as AbbreviationEntry['category'][];
  const abbrCatIcons: Record<string, string> = { Einheiten: '📏', Medikation: '💊', Laborwerte: '🧪', Diagnostik: '🩺', Allgemein: '📋' };
  for (const cat of abbrCatOrder) {
    const items = ABBREVIATIONS.filter(a => a.category === cat)
      .map(a => ({ id: a.id, commands: a.commands.join(', '), replacement: a.replacement }));
    if (items.length > 0) {
      abbrCategories.push({ category: cat, icon: abbrCatIcons[cat] || '📋', items });
    }
  }

  return NextResponse.json({ rules, abbreviations: abbrCategories });
}
