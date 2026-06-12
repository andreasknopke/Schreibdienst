"use client";
import { useState } from 'react';

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
              <div className="grid grid-cols-2 gap-1 text-xs">
                <div><code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">"Punkt"</code> → .</div>
                <div><code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">"Komma"</code> → ,</div>
                <div><code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">"Doppelpunkt"</code> → :</div>
                <div><code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">"Fragezeichen"</code> → ?</div>
              </div>
            </div>
            
            <div>
              <h4 className="font-medium mb-2">Formatierung</h4>
              <div className="grid grid-cols-1 gap-1 text-xs">
                <div><code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">"neuer Absatz"</code> → Absatzumbruch</div>
                <div><code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">"neue Zeile"</code> → Zeilenumbruch</div>
              </div>
            </div>

            <div>
              <h4 className="font-medium mb-2">Befund-Felder (im Befund-Modus)</h4>
              <div className="grid grid-cols-1 gap-1 text-xs">
                <div><code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">"Methodik:"</code> → Wechselt zum Methodik-Feld</div>
                <div><code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">"Befund:"</code> → Wechselt zum Befund-Feld</div>
                <div><code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">"Zusammenfassung:"</code> → Wechselt zum Zusammenfassung-Feld</div>
              </div>
            </div>

            <div>
              <h4 className="font-medium mb-2">Korrekturen</h4>
              <div className="grid grid-cols-1 gap-1 text-xs">
                <div><code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">"lösche das letzte Wort"</code></div>
                <div><code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">"lösche den letzten Satz"</code></div>
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
