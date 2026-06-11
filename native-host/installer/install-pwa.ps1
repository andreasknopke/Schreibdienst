<#
.SYNOPSIS
    Installiert die Schreibdienst-PWA lokal per Chrome-Richtlinie.
    Benötigt lokale Administratorrechte. Wirkt für alle Benutzer dieses Rechners.

.DESCRIPTION
    Setzt die Chrome-Richtlinie "WebAppInstallForceList" in der lokalen
    Registry (HKLM). Nach dem nächsten Chrome-Neustart wird die PWA
    automatisch installiert – erscheint im Startmenü und auf dem Desktop.

    Funktioniert auch für Microsoft Edge (anderer Registry-Pfad).
#>

[CmdletBinding()]
param(
    [Parameter()]
    [ValidateSet('Chrome', 'Edge')]
    [string]$Browser = 'Chrome',

    [Parameter()]
    [string]$Url = 'https://schreibdienst.coolify.kliniksued-rostock.de/',

    [Parameter()]
    [switch]$Remove
)

$browserPaths = @{
    Chrome = 'HKLM:\Software\Policies\Google\Chrome'
    Edge   = 'HKLM:\Software\Policies\Microsoft\Edge'
}

$policyRoot = $browserPaths[$Browser]

if (-not (Test-Path $policyRoot)) {
    New-Item -Path $policyRoot -Force | Out-Null
}

$policyPath = "$policyRoot\WebAppInstallForceList"

if ($Remove) {
    if (Test-Path $policyPath) {
        Remove-Item -Path $policyPath -Recurse -Force
        Write-Host "✅ PWA-Richtlinie entfernt ($Browser)" -ForegroundColor Green
    } else {
        Write-Host "ℹ️  Keine PWA-Richtlinie vorhanden ($Browser)" -ForegroundColor Yellow
    }
    return
}

$entry = @{
    url                      = $Url
    default_launch_container = 'window'
    create_desktop_shortcut  = $true
    fallback_app_name        = 'Schreibdienst'
} | ConvertTo-Json -Compress

if (-not (Test-Path $policyPath)) {
    New-Item -Path $policyPath -Force | Out-Null
}

Set-ItemProperty -Path $policyPath -Name '1' -Value $entry -Type String

Write-Host "✅ PWA-Richtlinie gesetzt ($Browser)" -ForegroundColor Green
Write-Host "   URL: $Url" -ForegroundColor Gray
Write-Host ""
Write-Host "➡️  Chrome neu starten, damit die PWA installiert wird." -ForegroundColor Cyan
