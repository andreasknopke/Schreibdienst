import { NextResponse } from 'next/server';
import { CONTROL_WORD_REPLACEMENTS } from '@/formattings/control-words';
import { DELETE_PATTERNS } from '@/formattings/delete-patterns';
import { ONLINE_COMMAND_PATTERNS } from '@/formattings/online-commands';

export const runtime = 'nodejs';

/** Extrahiert aus einem RegExp-Source die gesprochenen Befehle (z. B. aus \bklammer\s*auf\b → "Klammer auf") */
function extractCommandWords(pattern: RegExp): string[] {
  const src = pattern.source;
  const commands: string[] = [];

  // Extrahiere \bwort\s*anderes\b → "wort anderes"
  const wordPatterns = src.matchAll(/\\b([a-zäöüß-]+(?:\\s*[a-zäöüß-]+)*)/gi);
  for (const match of wordPatterns) {
    const cleaned = match[1]
      .replace(/\\s\*/g, ' ')   // \s* → Leerzeichen
      .replace(/\\s\+/g, ' ')   // \s+ → Leerzeichen
      .replace(/\\/g, '')
      .replace(/\s+/g, ' ')
      .replace(/\(.*?\)/g, '')  // (?:...) entfernen
      .replace(/\?.*$/, '')     // Quantifier entfernen
      .trim();
    if (cleaned && cleaned.length > 2 && !cleaned.startsWith('?')) {
      const variants = cleaned.split('|').map(v => v.trim()).filter(Boolean);
      for (const v of variants) {
        if (!commands.includes(v)) commands.push(v);
      }
    }
  }

  return commands;
}

function getReplacementDisplay(replacement: any): string {
  if (typeof replacement === 'string') {
    return replacement
      .replace(/\n/g, '¶ ')
      .replace(/¶ $/, '') || '(leer)';
  }
  if (typeof replacement === 'function') {
    return '(dynamisch, z. B. Zahleneinsetzung)';
  }
  return String(replacement);
}

export async function GET() {
  const rules: {
    category: string;
    icon: string;
    items: { command: string; replacement: string; file: string }[];
  }[] = [];

  // CONTROL_WORD_REPLACEMENTS
  const controlItems: { command: string; replacement: string; file: string }[] = [];
  for (const entry of CONTROL_WORD_REPLACEMENTS) {
    const commands = extractCommandWords(entry.pattern);
    for (const cmd of commands) {
      controlItems.push({
        command: cmd,
        replacement: getReplacementDisplay(entry.replacement),
        file: 'formattings/control-words.ts',
      });
    }
  }
  rules.push({ category: 'Absätze, Klammern & Satzzeichen', icon: '🔣', items: controlItems });

  // DELETE_PATTERNS
  const deleteItems: { command: string; replacement: string; file: string }[] = [];
  for (const entry of DELETE_PATTERNS) {
    const commands = extractCommandWords(entry.pattern);
    for (const cmd of commands) {
      deleteItems.push({
        command: cmd,
        replacement: entry.type === 'word' ? '🗑 Letztes Wort löschen'
          : entry.type === 'sentence' ? '🗑 Letzten Satz löschen'
          : '🗑 Letzten Absatz löschen',
        file: 'formattings/delete-patterns.ts',
      });
    }
  }
  rules.push({ category: 'Löschbefehle', icon: '🗑', items: deleteItems });

  // ONLINE_COMMAND_PATTERNS (only those not already covered above)
  const onlineItems: { command: string; replacement: string; file: string }[] = [];
  const knownTypes = new Set<string>();
  for (const entry of ONLINE_COMMAND_PATTERNS) {
    if (knownTypes.has(entry.type)) continue;
    knownTypes.add(entry.type);
    const commands = extractCommandWords(entry.pattern);
    for (const cmd of commands) {
      onlineItems.push({
        command: cmd,
        replacement: entry.type === 'comma' ? ','
          : entry.type === 'period' ? '.'
          : entry.type === 'dash' ? '-'
          : entry.type === 'lineBreak' ? '¶ Zeilenumbruch'
          : entry.type === 'paragraphBreak' ? '¶¶ Absatzumbruch'
          : entry.type === 'bulletPoint' ? '• Aufzählungspunkt'
          : `(${entry.type})`,
        file: 'formattings/online-commands.ts',
      });
    }
  }
  rules.push({ category: 'Live-Diktat-Befehle (Online/VAD)', icon: '⚡', items: onlineItems });

  return NextResponse.json({ rules });
}
