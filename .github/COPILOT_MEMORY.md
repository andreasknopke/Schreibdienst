# Copilot Memory - Wichtige Regeln für dieses Projekt

## Git Workflow Regeln

1. **Vor jedem `git push` IMMER erst `git diff --stat HEAD` ausführen** und dem Benutzer zeigen, damit er die Änderungen überprüfen kann bevor gepusht wird.

2. **Nie blind `git add -A && git push` machen** - immer erst die Änderungen prüfen.

3. **Gezielt Dateien stagen** statt `git add -A` wenn möglich.

4. **Nach jeder Bearbeitung `git status` prüfen** um sicherzustellen, dass nur erwartete Dateien geändert sind.
