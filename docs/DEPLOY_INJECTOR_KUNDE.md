# Schreibdienst Injector – Installationsanleitung für Kund:innen

## Voraussetzungen
- Windows
- Google Chrome installiert
- Das Rollout-ZIP wurde vollständig entpackt

## Inhalt des Pakets
- `extension/` – Chrome-Erweiterung
- `host/` – Native Windows-EXE
- `scripts/` – Installations- und Deinstallationsskripte
- `README-DEPLOY.txt` – Kurz-Anleitung im Paket

## Installation
1. Das ZIP vollständig entpacken.
2. In den entpackten Ordner wechseln.
3. `scripts/install-schreibdienst-injector.cmd` per Doppelklick starten.
4. Falls Windows nachfragt, PowerShell-Ausführung zulassen.
5. Google Chrome öffnen.
6. In Chrome `chrome://extensions` aufrufen.
7. Den **Entwicklermodus** aktivieren.
8. **Entpackte Erweiterung laden** wählen.
9. Den Ordner `extension` aus dem entpackten Paket auswählen.
10. Schreibdienst/PWA neu öffnen oder bestehende Seite neu laden.

## Funktionstest
1. Schreibdienst öffnen.
2. Live-Ziel-App-Übertragung aktivieren.
3. Eine andere Windows-Anwendung fokussieren.
4. Diktieren und prüfen, ob Text in die Ziel-App übertragen wird.

## Globale Hotkeys
Wenn der Injector korrekt installiert ist, stehen zusätzlich folgende Hotkeys zur Verfügung:
- `F9` – Aufnahme starten/stoppen
- `F10` – Aufnahme stoppen
- `F11` – Neu / Felder zurücksetzen
- `Escape` – Aufnahme abbrechen

## Wichtige Hinweise
- Wenn globale Hotkeys nicht reagieren, ist die Taste eventuell bereits durch eine andere Software belegt.
- Nach Updates der EXE oder der Erweiterung Chrome einmal neu starten oder die Erweiterung neu laden.
- Wenn die PWA bereits geöffnet war, die Seite nach der Installation neu laden.
- Wenn die Textübertragung funktioniert, aber Hotkeys nicht, zuerst die Chrome-Erweiterung neu laden.

## Deinstallation
1. `scripts/uninstall-schreibdienst-injector.cmd` ausführen.
2. Die Chrome-Erweiterung in `chrome://extensions` entfernen.

## Support-Hinweise
- Wenn keine Textübertragung möglich ist, Installation erneut mit `install-schreibdienst-injector.cmd` ausführen.
- Wenn Hotkeys nicht funktionieren, prüfen, ob die Erweiterung aktiv ist und Chrome nach der Installation neu gestartet wurde.
- Wenn eine andere Anwendung dieselben Hotkeys global verwendet, können diese nicht gleichzeitig registriert werden.
