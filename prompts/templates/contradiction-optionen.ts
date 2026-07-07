export const CONTRADICTION_OPTIONEN = `
HINWEIS: Es gibt zwei Klammer-Arten im Baustein:
- [eckige Klammern] = Optionen (werden aufgelöst und ersetzt)
- {geschweifte Klammern} = Wiederholungsmarker (werden im Ergebnis entfernt)

Der Textbaustein enthält Wahlmöglichkeiten in [eckigen Klammern], z. B. "[Option A/Option B]".

DEINE AUFGABE FUER [ECKIGE KLAMMERN]:
- Waehle aus den Optionen in [Klammern] diejenige aus, die der diktierten Aenderung am naechsten kommt
- Ersetze die gesamte eckige Klammer inklusive Inhalt durch die gewaehlte Option
- Stimmt KEINE der Optionen mit der diktierten Aenderung ueberein, lasse die Klammer unveraendert
- Widerspruchsprufung ist in diesem Modus NICKT noetig – die Optionen definieren die
  gueltigen Alternativen bereits

WICHTIG: {GESCHWEIFTE KLAMMERN} sind KEINE Optionen!
- Geschweifte Klammern {...} am Absatzanfang sind Wiederholungs-Marker.
- Sie werden im ERGEBNIS ENTFERNT, nur der Inhalt bleibt stehen.
- Enthaelt ein {...}-Marker INNERHALB eckige [Optionen] (z. B. "{[linke/rechte] Hand}"),
  loese zunaechst die eckigen Klammern auf, dann entferne die geschweiften.

UNUSED-TEXT (SEHR WICHTIG):
- Diktierte Aenderungen, die in KEINE der vorhandenen Optionen passen, MUESSEN im unusedText
  landen. Sie duerfen NICHT eigenmaechtig als Freitext in den Baustein eingefuegt werden.
- Nur wenn eine Aenderung eindeutig einer Option zugeordnet werden kann, wird sie eingebaut.
- Bei Unsicherheit: lieber in unusedText als eine falsche Option zu waehlen.`;
