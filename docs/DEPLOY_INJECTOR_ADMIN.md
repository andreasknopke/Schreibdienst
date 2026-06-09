# Schreibdienst Injector – Admin-README

Diese Anleitung richtet sich an Administrator:innen, die den Schreibdienst Injector auf mehreren Windows-Rechnern ausrollen wollen.

## Ziel
- unbeaufsichtigte Installation per Kommandozeile
- optionaler Autostart für Benutzer oder für alle Benutzer
- einfache Verteilung per RMM, Intune, GPO, SCCM oder Script

## Voraussetzungen
- Windows
- lokale Administrator-Rechte für Installation nach `C:\Program Files`
- `schreibdienst-injector-setup-{version}.exe` liegt lokal oder auf einer Freigabe vor

## Empfohlene Silent-Installation

### Standard
```powershell
.\schreibdienst-injector-setup-{version}.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP-
```

### Mit Autostart für aktuellen Benutzer
```powershell
.\schreibdienst-injector-setup-{version}.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /TASKS="autostart"
```

### Mit Autostart für alle Benutzer
```powershell
.\schreibdienst-injector-setup-{version}.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /TASKS="autostart_all"
```

### Mit festem Zielverzeichnis
```powershell
.\schreibdienst-injector-setup-{version}.exe /VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /DIR="C:\Program Files\Schreibdienst Injector"
```

## Wichtige Installer-Schalter
- `/VERYSILENT`: keine sichtbare Benutzeroberfläche
- `/SUPPRESSMSGBOXES`: unterdrückt Rückfragen soweit möglich
- `/NORESTART`: verhindert automatische Neustarts
- `/SP-`: deaktiviert den initialen "This will install..."-Dialog
- `/TASKS="autostart"`: HKCU-Autostart für den ausführenden Benutzer
- `/TASKS="autostart_all"`: HKLM-Autostart für alle Benutzer
- `/DIR="..."`: setzt das Installationsverzeichnis explizit

## Verhalten nach der Installation
- Der Installer trägt optional den Autostart ein.
- Bei Silent-Installationen startet der Injector nicht automatisch sofort interaktiv für den aktuell angemeldeten Benutzer.
- Für Massenrollout ist das meist gewünscht: der Injector startet dann beim nächsten Windows-Login automatisch.
- Wenn ein sofortiger Start nötig ist, kann die EXE nach dem Setup separat aufgerufen werden.

### Sofortiger Start nach der Installation
```powershell
Start-Process "C:\Program Files\Schreibdienst Injector\schreibdienst-injector.exe"
```

## Unbeaufsichtigte Deinstallation
```powershell
"C:\Program Files\Schreibdienst Injector\unins000.exe" /VERYSILENT /SUPPRESSMSGBOXES /NORESTART
```

## Beispiel: Rollout per PowerShell
```powershell
$installer = "\\server\share\schreibdienst-injector-setup-0.1.8.exe"

Start-Process -FilePath $installer -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /TASKS="autostart_all"' -Verb RunAs -Wait
```

## Beispiel: Update-Rollout
Das Setup beendet eine laufende Injector-Instanz vor der Installation automatisch. Ein typischer Update-Lauf sieht daher genauso aus wie eine Neuinstallation.

```powershell
Start-Process -FilePath ".\schreibdienst-injector-setup-{version}.exe" -ArgumentList '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /TASKS="autostart_all"' -Verb RunAs -Wait
```

## Verifikation nach Rollout
1. Prüfen, ob `schreibdienst-injector.exe` installiert wurde.
2. Prüfen, ob der Prozess läuft oder beim nächsten Login startet.
3. Schreibdienst öffnen.
4. Live-Ziel-App-Übertragung aktivieren.
5. Testweise Diktat starten und Sichtbarkeit von Tray-Icon/Overlay prüfen.

## Typische Pfade
- Installationsordner: `C:\Program Files\Schreibdienst Injector`
- EXE: `C:\Program Files\Schreibdienst Injector\schreibdienst-injector.exe`
- Uninstaller: `C:\Program Files\Schreibdienst Injector\unins000.exe`

## Hinweise für GitHub und Dokumentation
- Diese Admin-README liegt im Repository und ist damit automatisch Teil jedes Commits.
- Dadurch ist sie direkt auf GitHub im Code-Tab versioniert und nachvollziehbar.
- Ein GitHub-Wiki wäre zusätzlich möglich, ist aber ein separater Pflegepfad und nicht automatisch an denselben Commit gebunden.
- Wenn der Text beim Commit "verankert" sein soll, ist eine Datei unter `docs/` die robustere Lösung als das Wiki.