"use client";
import { useState } from 'react';

function CommandChip({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-md border border-gray-200 bg-gray-100 px-2 py-0.5 font-mono text-[11px] text-gray-800 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 ${className}`}>
      {children}
    </span>
  );
}

function CommandRow({ command, result }: { command: React.ReactNode; result: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-start gap-2 text-xs">
      <div className="shrink-0">{command}</div>
      <span className="text-gray-600 dark:text-gray-300">→ {result}</span>
    </div>
  );
}

export default function HelpPanel() {
  const [expandedSection, setExpandedSection] = useState<string | null>(null);

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  return (
    <div className="space-y-4">
      {/* Sprachbefehle */}
      {(expandedSection === null || expandedSection === 'commands') && (
      <div className="border rounded-lg dark:border-gray-700">
        <button
          onClick={() => toggleSection('commands')}
          className="w-full flex items-center justify-between p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800 rounded-t-lg"
        >
          <span className="font-medium flex items-center gap-2">
            🗣️ Sprachbefehle
          </span>
          <span className="text-gray-400">{expandedSection === 'commands' ? '▼' : '▶'}</span>
        </button>
        
        {expandedSection === 'commands' && (
          <div className="p-4 pt-0 space-y-3 text-sm">
            <div>
              <h4 className="font-medium mb-2">Satzzeichen</h4>
              <div className="grid grid-cols-1 gap-1.5 text-xs">
                <CommandRow command={<CommandChip>"Punkt"</CommandChip>} result={<span>.</span>} />
                <CommandRow command={<CommandChip>"Komma"</CommandChip>} result={<span>,</span>} />
                <CommandRow command={<CommandChip>"Doppelpunkt"</CommandChip>} result={<span>:</span>} />
                <CommandRow command={<CommandChip>"Fragezeichen"</CommandChip>} result={<span>?</span>} />
              </div>
            </div>
            
            <div>
              <h4 className="font-medium mb-2">Formatierung</h4>
              <div className="grid grid-cols-1 gap-1.5 text-xs">
                <CommandRow command={<CommandChip>"neuer Absatz"</CommandChip>} result={<span>Absatzumbruch</span>} />
                <CommandRow command={<CommandChip>"neue Zeile"</CommandChip>} result={<span>Zeilenumbruch</span>} />
                <CommandRow command={<CommandChip className="font-bold">"Auswahl fett"</CommandChip>} result={<strong>markierten Text fett formatieren</strong>} />
                <CommandRow command={<CommandChip className="font-bold">"Wort fett"</CommandChip>} result={<strong>letztes Wort fett formatieren</strong>} />
                <CommandRow command={<CommandChip className="font-bold">"letztes Wort fett"</CommandChip>} result={<strong>letztes Wort fett formatieren</strong>} />
                <CommandRow command={<CommandChip className="font-bold">"Satz fett"</CommandChip>} result={<strong>letzten Satz fett formatieren</strong>} />
                <CommandRow command={<CommandChip className="font-bold">"letzter Satz fett"</CommandChip>} result={<strong>letzten Satz fett formatieren</strong>} />
                <CommandRow command={<CommandChip className="italic">"Auswahl kursiv"</CommandChip>} result={<em>markierten Text kursiv formatieren</em>} />
                <CommandRow command={<CommandChip className="italic">"Wort kursiv"</CommandChip>} result={<em>letztes Wort kursiv formatieren</em>} />
                <CommandRow command={<CommandChip className="italic">"letztes Wort kursiv"</CommandChip>} result={<em>letztes Wort kursiv formatieren</em>} />
                <CommandRow command={<CommandChip className="italic">"Satz kursiv"</CommandChip>} result={<em>letzten Satz kursiv formatieren</em>} />
                <CommandRow command={<CommandChip className="italic">"letzter Satz kursiv"</CommandChip>} result={<em>letzten Satz kursiv formatieren</em>} />
                <CommandRow command={<CommandChip className="underline decoration-2">"Auswahl unterstrichen"</CommandChip>} result={<span className="underline decoration-2">markierten Text unterstreichen</span>} />
                <CommandRow command={<CommandChip className="underline decoration-2">"Wort unterstrichen"</CommandChip>} result={<span className="underline decoration-2">letztes Wort unterstreichen</span>} />
                <CommandRow command={<CommandChip className="underline decoration-2">"letztes Wort unterstrichen"</CommandChip>} result={<span className="underline decoration-2">letztes Wort unterstreichen</span>} />
                <CommandRow command={<CommandChip className="underline decoration-2">"Satz unterstrichen"</CommandChip>} result={<span className="underline decoration-2">letzten Satz unterstreichen</span>} />
                <CommandRow command={<CommandChip className="underline decoration-2">"letzter Satz unterstrichen"</CommandChip>} result={<span className="underline decoration-2">letzten Satz unterstreichen</span>} />
                <CommandRow command={<span className="flex flex-wrap items-center gap-1"><CommandChip className="font-bold">"fett beginnen"</CommandChip><CommandChip className="font-bold">"fett ende"</CommandChip></span>} result={<strong>laufende Fett-Formatierung an/aus</strong>} />
                <CommandRow command={<span className="flex flex-wrap items-center gap-1"><CommandChip className="italic">"kursiv beginnen"</CommandChip><CommandChip className="italic">"kursiv ende"</CommandChip></span>} result={<em>laufende Kursiv-Formatierung an/aus</em>} />
                <CommandRow command={<span className="flex flex-wrap items-center gap-1"><CommandChip className="underline decoration-2">"unterstrichen beginnen"</CommandChip><CommandChip className="underline decoration-2">"unterstrichen ende"</CommandChip></span>} result={<span className="underline decoration-2">laufende Unterstreichung an/aus</span>} />
              </div>
            </div>

            <div>
              <h4 className="font-medium mb-2">Befund-Felder (im Befund-Modus)</h4>
              <div className="grid grid-cols-1 gap-1.5 text-xs">
                <CommandRow command={<CommandChip>"Methodik:"</CommandChip>} result={<span>wechselt zum Methodik-Feld</span>} />
                <CommandRow command={<CommandChip>"Befund:"</CommandChip>} result={<span>wechselt zum Befund-Feld</span>} />
                <CommandRow command={<CommandChip>"Zusammenfassung:"</CommandChip>} result={<span>wechselt zum Zusammenfassung-Feld</span>} />
              </div>
            </div>

            <div>
              <h4 className="font-medium mb-2">Korrekturen</h4>
              <div className="grid grid-cols-1 gap-1.5 text-xs">
                <CommandRow command={<CommandChip>🗑️ "lösche das letzte Wort"</CommandChip>} result={<span>letztes Wort entfernen</span>} />
                <CommandRow command={<CommandChip>🗑️ "wort löschen"</CommandChip>} result={<span>letztes Wort entfernen</span>} />
                <CommandRow command={<CommandChip>🗑️ "lösche den letzten Satz"</CommandChip>} result={<span>letzten Satz entfernen</span>} />
                <CommandRow command={<CommandChip>🗑️ "satz löschen"</CommandChip>} result={<span>letzten Satz entfernen</span>} />
              </div>
            </div>
          </div>
        )}
      </div>
      )}

      {/* Maus-Bedienung */}
      {(expandedSection === null || expandedSection === 'mouse') && (
      <div className="border rounded-lg dark:border-gray-700">
        <button
          onClick={() => toggleSection('mouse')}
          className="w-full flex items-center justify-between p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800 rounded-t-lg"
        >
          <span className="font-medium flex items-center gap-2">
            🖱️ Maus-Bedienung
          </span>
          <span className="text-gray-400">{expandedSection === 'mouse' ? '▼' : '▶'}</span>
        </button>
        
        {expandedSection === 'mouse' && (
          <div className="p-4 pt-0 space-y-2 text-sm">
            <div className="flex items-center gap-3">
              <span className="font-medium text-gray-500 w-24">Linksklick</span>
              <span>Aufnahme starten/stoppen (auf freier Fläche)</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-medium text-gray-500 w-24">Rechtsklick</span>
              <span>Oeffnet das normale Kontextmenue, ohne Text zurueckzusetzen</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="font-medium text-gray-500 w-24">Textfeld-Klick</span>
              <span>Aktiviert das Feld für das nächste Diktat</span>
            </div>
          </div>
        )}
      </div>
      )}
    </div>
  );
}
