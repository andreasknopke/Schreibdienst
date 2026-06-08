$exePath = "D:\GitHub\schreibdienst\native-host\build\Release\schreibdienst-injector.exe"
$bytes = [System.IO.File]::ReadAllBytes($exePath)
$ascii = [System.Text.Encoding]::ASCII.GetString($bytes)
$utf16 = [System.Text.Encoding]::Unicode.GetString($bytes)
"Hidden-Window Klassenname (UTF-16) vorhanden: $($utf16.Contains('SchreibdienstHiddenWnd'))"
"Schreibt WM_APP_DO_SENDINPUT-Handler: $($utf16.Contains('WM_APP'))"
"Shift-F9 (ASCII): $($ascii.Contains('Shift+F9'))"
"Shift-F10 (ASCII): $($ascii.Contains('Shift+F10'))"
"EXE Groesse: $([Math]::Round((Get-Item $exePath).Length / 1KB, 1)) KB"
"EXE Datum: $((Get-Item $exePath).LastWriteTime)"
