# Feature: Mehrere Bausteine gleichzeitig bearbeiten

> Inhaltliche Beschreibung und schrittweiser Umsetzungsplan.
> Jeder Schritt baut auf dem vorherigen auf und ist nach Fertigstellung testbar.

## Kurzbeschreibung

Aktuell kann man pro Feld (Methodik/Befund/Beurteilung) **einen** Textbaustein
einarbeiten. Das neue Feature erlaubt es, **mehrere Bausteine gleichzeitig im
selben Feld** zu haben. Nur der zuletzt angewählte Baustein ist "aktiv" –
Diktat geht nur in diesen hinein. Die anderen Blöcke sind ausgegraut (visuelles
Feedback) und werden nicht an die LLM-Adaption geschickt.

## Abgrenzung

- Die Felder (Methodik/Befund/Beurteilung) bleiben als Container erhalten.
- Innerhalb eines Feldes gibt es dann eine Liste von **Blöcken**.
- Jeder Block ist entweder ein **Baustein** (aus Templates geladen) oder
  **Freitext** (bereits vorhandener Feldtext, der nicht aus einem Baustein
  stammt).
- Blöcke können später in der Reihenfolge verschoben werden (nice-to-have,
  nicht in Phase 1).
