# Ticket #80 — Coding-Dossier

> Dieses Verzeichnis enthaelt die vollstaendige Analyse des Ticketsystem-Workflows
> fuer Ticket #80. Es ist als Briefing fuer einen externen Coding-Agenten
> (z. B. OpenCode, VS Code Copilot) gedacht. Der Agent arbeitet direkt im Repo —
> die Analyse hier dient als Eingabe, nicht als Code-Vorlage.

## Eckdaten

- Titel: **Speechmike Steuerung**
- Typ: `bug`
- Dringlichkeit: `normal`
- System: Schreibdienst (`andreasknopke/Schreibdienst`)
- Workflow-Run: 105 (gestartet 2026-05-04 10:25:26)

## Inhalt

- [Triage Reviewer](./01_triage.md) — Status: `done`
- [Security & Redaction](./02_security.md) — Status: `done`
- [Final Approver (Dispatch-Decision)](./05_approval.md) — Status: `done`
- [Solution Architect (Planning)](./03_planning.md) — Status: `done`
- [Integration Reviewer](./04_integration.md) — Status: `done`
- [Final Approver (Dispatch-Decision)](./05_approval.md) — Status: `waiting_human`
- [Manifest (JSON)](./manifest.json)

## Original-Beschreibung (unredacted)

> Hinweis: Der `02_security.md`-Bericht enthaelt die redaktierte Variante,
> die fuer KI-Aufrufe verwendet wurde.

```
Speechmike steuerung (F9) funktioniert nicht, wenn cursor aktiv im Feld.

--- Automatisch übermittelte Informationen ---
{
  "system": "Schreibdienst",
  "url": "https://schreibdienst.coolify.kliniksued-rostock.de/",
  "origin": "https://schreibdienst.coolify.kliniksued-rostock.de",
  "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
  "platform": "Win32",
  "language": "de-DE",
  "screen": "1640x2048",
  "timestamp": "2026-05-04T10:25:26.826Z",
  "appVersion": "0.1.0",
  "reporterName": "Knopke",
  "userName": "Knopke",
  "hasDbToken": false
}
```