"use client";
import { useState } from 'react';

export default function HelpPanel() {
  const [expandedSection, setExpandedSection] = useState<string | null>('hotkeys');

  const toggleSection = (section: string) => {
    setExpandedSection(expandedSection === section ? null : section);
  };

  return (
    <div className="space-y-4">
      {/* SpeechMike Hotkeys */}
      <div className="border rounded-lg dark:border-gray-700">
        <button
          onClick={() => toggleSection('hotkeys')}
          className="w-full flex items-center justify-between p-3 text-left hover:bg-gray-50 dark:hover:bg-gray-800 rounded-t-lg"
        >
          <span className="font-medium flex items-center gap-2">
            🎙️ Diktiermikrofon / Hotkeys
          </span>
          <span className="text-gray-400">{expandedSection === 'hotkeys' ? '▼' : '▶'}</span>
        </button>
        
        {expandedSection === 'hotkeys' && (
          <div className="p-4 pt-0 space-y-4 text-sm">
            <p className="text-gray-600 dark:text-gray-400">
              Diese Anwendung unterstützt Philips SpeechMike und andere Diktiermikrofone im <strong>Keyboard-Emulation-Modus</strong>.
            </p>
            
            <div className="bg-blue-50 dark:bg-blue-900/20 p-3 rounded-lg">
              <h4 className="font-medium text-blue-700 dark:text-blue-300 mb-2">📋 Einrichtung</h4>
              <ol className="list-decimal list-inside space-y-1 text-blue-600 dark:text-blue-400">
                <li>Öffnen Sie die Philips SpeechControl Software</li>
                <li>Wählen Sie den <strong>Keyboard Mode</strong></li>
                <li>Weisen Sie den Tasten folgende Funktionen zu:</li>
              </ol>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-100 dark:bg-gray-800">
                  <tr>
                    <th className="px-3 py-2 text-left">Taste</th>
                    <th className="px-3 py-2 text-left">Keyboard</th>
                    <th className="px-3 py-2 text-left">Funktion</th>
                  </tr>
                </thead>
                <tbody className="divide-y dark:divide-gray-700">
                  <tr>
                    <td className="px-3 py-2">Record/Play</td>
                    <td className="px-3 py-2"><kbd className="px-2 py-0.5 bg-gray-200 dark:bg-gray-700 rounded">F9</kbd></td>
                    <td className="px-3 py-2">Aufnahme starten/stoppen (Toggle)</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2">Stop</td>
                    <td className="px-3 py-2"><kbd className="px-2 py-0.5 bg-gray-200 dark:bg-gray-700 rounded">F10</kbd></td>
                    <td className="px-3 py-2">Aufnahme stoppen</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2">EOL/Neu</td>
                    <td className="px-3 py-2"><kbd className="px-2 py-0.5 bg-gray-200 dark:bg-gray-700 rounded">F11</kbd></td>
                    <td className="px-3 py-2">Alle Felder zurücksetzen (Neu)</td>
                  </tr>
                  <tr>
                    <td className="px-3 py-2">Abbruch</td>
                    <td className="px-3 py-2"><kbd className="px-2 py-0.5 bg-gray-200 dark:bg-gray-700 rounded">Esc</kbd></td>
                    <td className="px-3 py-2">Aufnahme abbrechen</td>
                  </tr>
                </tbody>
              </table>
            </div>

            <div className="bg-amber-50 dark:bg-amber-900/20 p-3 rounded-lg">
              <h4 className="font-medium text-amber-700 dark:text-amber-300 mb-1">⚠️ Hinweis</h4>
              <p className="text-amber-600 dark:text-amber-400 text-xs">
                Hotkeys sind deaktiviert, wenn der Cursor in einem Textfeld steht (z.B. beim Bearbeiten).
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Sprachbefehle */}
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

      {/* Maus-Bedienung */}
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
    </div>
  );
}
