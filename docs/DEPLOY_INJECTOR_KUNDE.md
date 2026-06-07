# Schreibdienst Injector – Installationsanleitung für Kund:innen

## Voraussetzungen
- Windows
- Das Rollout-ZIP wurde vollständig entpackt

## Inhalt des Pakets
- `schreibdienst-injector-setup-{version}.exe` – Installer (Inno Setup)
- `host/schreibdienst-injector.exe` – Native Windows-EXE für die Live-Übertragung in die Ziel-App (nur für manuelle Installation)
- `README-DEPLOY.txt` – Kurz-Anleitung im Paket

## Installation (empfohlen – mit Installer)
1. `schreibdienst-injector-setup-{version}.exe` als Administrator ausführen.
2. Im Installationsassistenten den Zielordner wählen (Standard: `C:\Program Files\Schreibdienst Injector`).
3. **Autostart-Option wählen:**
   - *„Automatisch starten beim Windows-Anmelden“* – startet den Injector nur für den aktuellen Benutzer.
   - *„Automatisch starten für alle Benutzer“* – startet den Injector für alle Benutzer des Computers (Computer-Autostart).
4. Der Injector wird automatisch gestartet und läuft unsichtbar im Hintergrund.
5. Die PWA `Schreibdienst` neu öffnen oder neu laden.

## Manuelle Installation (ohne Installer)
1. Das ZIP vollständig entpacken.
2. Den Ordner `host\` an einen dauerhaft erreichbaren Ort kopieren (z. B. `C:\Program Files\Schreibdienst\Injector`).
3. Die PWA `Schreibdienst` neu öffnen oder die bestehende Seite neu laden.
4. Beim ersten Versuch, die Live-Übertragung zu aktivieren, prüft die PWA automatisch, ob der Injector erreichbar ist.
5. Wenn die PWA meldet, dass der Injector nicht installiert ist, die `schreibdienst-injector.exe` starten – sie läuft unsichtbar im Hintergrund.

## Funktionstest
1. Schreibdienst öffnen.
2. Live-Ziel-App-Übertragung aktivieren.
3. Eine andere Windows-Anwendung fokussieren.
4. Diktieren und prüfen, ob Text in die Ziel-App übertragen wird.

## Globale Hotkeys
Wenn der Injector läuft, stehen zusätzlich folgende Hotkeys zur Verfügung:
- `F9` – Aufnahme starten/stoppen
- `F10` – Aufnahme stoppen
- `F11` – Aktuellen Editor-Text an die fokussierte Ziel-App übertragen
- `Escape` – Aufnahme abbrechen

## Startoptionen
Der Injector läuft standardmäßig vollständig im Hintergrund (kein sichtbares Fenster, keine Logausgabe). Für Diagnosezwecke lässt sich das Konsolenfenster mit Logging manuell starten:
- `schreibdienst-injector.exe -show` – startet den Injector mit sichtbarem Konsolenfenster und ausführlichem Logging
- `schreibdienst-injector.exe -h` – zeigt die Hilfe mit allen Optionen an

## Autostart (empfohlen)
Der Installer bietet direkt die Option, den Injector in den Autostart einzutragen:
- **HKCU** (aktueller Benutzer): `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
- **HKLM** (alle Benutzer): `HKLM\Software\Microsoft\Windows\CurrentVersion\Run`

Bei manueller Installation:
1. `Win+R` → `shell:startup` öffnen.
2. Eine Verknüpfung auf `schreibdienst-injector.exe` in den geöffneten Ordner legen.
3. Optional: Startparameter in der Verknüpfung entfernen, damit der Injector weiterhin ohne Fenster startet.

## Wichtige Hinweise
- Die PWA kommuniziert mit dem Injector über einen lokalen WebSocket auf `ws://localhost:58765`. Es ist keine Chrome-Erweiterung oder zusätzliche Software nötig.
- Wenn die PWA meldet, dass der Injector nicht erreichbar ist, prüfen, ob die `schreibdienst-injector.exe` läuft (ggf. im Task-Manager unter „Schreibdienst Injector“).
- Wenn globale Hotkeys nicht reagieren, ist die Taste eventuell bereits durch eine andere Software belegt.
- Beim Wechsel der Ziel-App in den Vordergrund reicht ein Klick auf das gewünschte Fenster, danach wird der Text automatisch übertragen.
- Nach Updates der EXE die Datei ersetzen und die PWA neu laden.

## Deinstallation
Bei Installation mit dem Installer: Einfach in der Windows-Systemsteuerung unter „Apps & Features“ den „Schreibdienst Injector“ deinstallieren. Der Autostart-Eintrag wird automatisch entfernt.

Bei manueller Installation:
1. `schreibdienst-injector.exe` beenden (Task-Manager).
2. Den Installationsordner löschen.
3. Die Autostart-Verknüpfung (falls angelegt) aus dem Autostart-Ordner entfernen.

## Support-Hinweise
- Wenn keine Textübertragung möglich ist, prüfen, ob der Injector-Prozess läuft und ob `ws://localhost:58765` durch eine Firewall blockiert wird.
- Wenn Hotkeys nicht funktionieren, prüfen, ob sie von einer anderen Anwendung belegt sind.
- Für eine detaillierte Diagnose den Injector einmalig mit `schreibdienst-injector.exe -show` starten – die Logausgabe hilft bei der Fehlersuche.
