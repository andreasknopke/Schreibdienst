# Schreibdienst Injector – Headless CLI Deployment

Fuer Kliniknetze, GPO-Rollout und SCCM/Intune-Deployment ohne GUI-Installer.

## Inhalt

- `schreibdienst-injector.exe` – Der Injector (ausgefuehrt im Hintergrund)
- `install-cli.bat` – Batch-Installer
- `install-cli.ps1` – PowerShell-Installer (empfohlen)
- `uninstall-cli.bat` – Batch-Deinstaller
- `uninstall-cli.ps1` – PowerShell-Deinstaller (empfohlen)

## Installation

### PowerShell (empfohlen)

```powershell
# Standardinstallation
.\install-cli.ps1

# Still (fuer SCCM/GPO)
.\install-cli.ps1 -Silent

# Benutzerdefiniertes Zielverzeichnis
.\install-cli.ps1 -InstallPath "C:\Tools\Schreibdienst"

# Ohne Autostart (Service managed)
.\install-cli.ps1 -NoAutostart
```

### Batch

```cmd
:: Standardinstallation
install-cli.bat

:: Still
install-cli.bat /S

:: Benutzerdefiniertes Zielverzeichnis
install-cli.bat /D=C:\Tools\Schreibdienst

:: Ohne Autostart
install-cli.bat /S /NOAUTOSTART
```

## Deinstallation

```powershell
.\uninstall-cli.ps1
```
```cmd
uninstall-cli.bat
```

## GPO-Deployment

Fuer Computer-GPO als Startskript:

1. ZIP entpacken
2. `install-cli.ps1 -Silent` als **Startskript (Computer)** in der GPO hinterlegen
3. Fuer Update: Erst `uninstall-cli.ps1`, dann neue Version `install-cli.ps1 -Silent`

## SCCM / Intune

- **Install:** `powershell.exe -ExecutionPolicy Bypass -File install-cli.ps1 -Silent`
- **Uninstall:** `powershell.exe -ExecutionPolicy Bypass -File uninstall-cli.ps1`
- Detection: `HKLM\Software\Microsoft\Windows\CurrentVersion\Run` Wert `SchreibdienstInjector` existiert

## Voraussetzungen

- Windows 10/11 x64
- Administrator-Rechte
- Port 58765 im Netzwerk freigegeben (falls Frontend auf anderem Rechner laeuft)
