# Ticket #74 — Coding-Dossier

> Dieses Verzeichnis enthaelt die vollstaendige Analyse des Ticketsystem-Workflows
> fuer Ticket #74. Es ist als Briefing fuer einen externen Coding-Agenten
> (z. B. OpenCode, VS Code Copilot) gedacht. Der Agent arbeitet direkt im Repo —
> die Analyse hier dient als Eingabe, nicht als Code-Vorlage.

## Eckdaten

- Titel: **0 Symbole hinter Benutzern ohne Badge**
- Typ: `bug`
- Dringlichkeit: `normal`
- System: Schreibdienst (`andreasknopke/Schreibdienst`)
- Workflow-Run: 97 (gestartet 2026-05-02 17:32:49)

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
In der Benutzerverwaltung von root zeigen manche User 0 oder 00 hinter den Namen, nur wenn alle drei badges angezeigt werden, dann nicht (z.B. bei root = drei badges admin, Alle Diktate,  Befund 
es sollen keine extra nullen angezeigt werden

--- Automatisch übermittelte Informationen ---
{
  "system": "Schreibdienst",
  "url": "https://schreibdienst.coolify.kliniksued-rostock.de/",
  "origin": "https://schreibdienst.coolify.kliniksued-rostock.de",
  "userAgent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36",
  "platform": "Win32",
  "language": "de-DE",
  "screen": "2560x1080",
  "timestamp": "2026-05-02T17:32:49.732Z",
  "appVersion": "0.1.0",
  "reporterName": "root",
  "userName": "root",
  "hasDbToken": false
}
```