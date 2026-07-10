export const CONTRADICTION_OPTIONEN = `
Der Textbaustein enthält Wahlmöglichkeiten in [eckigen Klammern], z. B. "[Option A/Option B]".

DEINE AUFGABE FUER [ECKIGE KLAMMERN]:
- Waehle aus den Optionen in [Klammern] diejenige aus, die der diktierten Aenderung am naechsten kommt
- Ersetze die gesamte eckige Klammer inklusive Inhalt durch die gewaehlte Option
- Stimmt KEINE der Optionen mit der diktierten Aenderung ueberein, lasse die Klammer unveraendert
- Widerspruchsprufung ist in diesem Modus NICKT noetig – die Optionen definieren die
  gueltigen Alternativen bereits

UNUSED-TEXT (SEHR WICHTIG):
- Diktierte Aenderungen, die in KEINE der vorhandenen Optionen passen, MUESSEN im unusedText
  landen. Sie duerfen NICHT eigenmaechtig als Freitext in den Baustein eingefuegt werden.
- Nur wenn eine Aenderung eindeutig einer Option zugeordnet werden kann, wird sie eingebaut.
- Bei Unsicherheit: lieber in unusedText als eine falsche Option zu waehlen.`;
