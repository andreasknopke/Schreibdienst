; Schreibdienst Injector – Inno Setup Installer
; Erstellt einen Windows-Installer mit optionalem Autostart-Eintrag.
;
; Voraussetzung: Inno Setup 6+ (https://jrsoftware.org/isinfo.php)
; Build mit: ISCC.exe "schreibdienst-injector-setup.iss"

#define MyAppName "Schreibdienst Injector"
#define MyAppVersion "0.1.6"
#define MyAppPublisher "Schreibdienst"
#define MyAppURL "https://schreibdienst.app"
#define MyAppExeName "schreibdienst-injector.exe"

[Setup]
AppId={{B8F4C3A2-1D5E-4F7A-9C6B-3E2D1F0A8C4B}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
AppUpdatesURL={#MyAppURL}
DefaultDirName={autopf}\{#MyAppName}
DefaultGroupName={#MyAppName}
DisableProgramGroupPage=yes
OutputDir=.
OutputBaseFilename=schreibdienst-injector-setup-{#MyAppVersion}
Compression=lzma
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=admin
; Kein Konsolenfenster – die App läuft als Hintergrunddienst
DisableFinishedPage=no

[Languages]
Name: "german"; MessagesFile: "compiler:Languages\German.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "autostart"; Description: "&Automatisch starten beim Windows-Anmelden (aktueller Benutzer)"; GroupDescription: "Autostart:"; Flags: checkedonce
Name: "autostart_all"; Description: "&Automatisch starten für alle Benutzer (Computer-Autostart)"; GroupDescription: "Autostart:"; Flags: checkedonce exclusive

[Files]
Source: "..\build3\Release\{#MyAppExeName}"; DestDir: "{app}"; Flags: ignoreversion
; Optional: Konfigurationsdateien oder DLLs hier ergänzen

[Icons]
Name: "{group}\{#MyAppName}"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\{cm:UninstallProgram,{#MyAppName}}"; Filename: "{uninstallexe}"

[Run]
; Nach der Installation direkt die Optionen abfragen
Filename: "{app}\{#MyAppExeName}"; Description: "{cm:LaunchProgram,{#MyAppName}}"; Flags: nowait postinstall skipifsilent

[Registry]
; Autostart für aktuellen Benutzer (HKCU)
; Wird nur gesetzt, wenn die Task "autostart" ausgewählt ist
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
    ValueType: string; ValueName: "SchreibdienstInjector"; \
    ValueData: """{app}\{#MyAppExeName}"""; \
    Tasks: autostart; Flags: uninsdeletevalue

; Autostart für alle Benutzer (HKLM) – benötigt Admin-Rechte
Root: HKLM; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
    ValueType: string; ValueName: "SchreibdienstInjector"; \
    ValueData: """{app}\{#MyAppExeName}"""; \
    Tasks: autostart_all; Flags: uninsdeletevalue

[UninstallRun]
; Injector beenden vor Deinstallation (falls er läuft)
Filename: "taskkill"; Parameters: "/f /im {#MyAppExeName}"; Flags: runhidden

[Code]
// Hilfsfunktion: Prüfen, ob der Injector bereits läuft, und ggf. beenden
function InitializeSetup: Boolean;
var
  ResultCode: Integer;
begin
  // Versuchen, einen laufenden Injector sanft zu beenden
  Exec('taskkill', '/im {#MyAppExeName} /f', '', SW_HIDE, ewWaitUntilTerminated, ResultCode);
  Result := True;
end;
