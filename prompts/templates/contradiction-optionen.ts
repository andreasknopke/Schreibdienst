export const CONTRADICTION_OPTIONEN = `
Der Textbaustein enthält Wahlmöglichkeiten in [eckigen Klammern], z. B. "[Option A/Option B]".

DEINE AUFGABE FUER [ECKIGE KLAMMERN] (STRENG NACH PRIORITAET):
1. Pruefe, ob die diktierte Aenderung EXAKT mit einer der Optionen uebereinstimmt
   (auch synonymisch, z.B. "rechte Seite" = "rechts").
2. Nur bei exakter Uebereinstimmung: Ersetze die gesamte eckige Klammer
   inklusive Inhalt durch diese Option.
3. Stimmt KEINE Option exakt ueberein: Lasse die Klammer UNVERAENDERT.
   Waehle NICHT die "am naechsten liegende" Option als Kompromiss.
- Widerspruchsprufung ist in diesem Modus NICHT noetig – die Optionen definieren die
  gueltigen Alternativen bereits

UNUSED-TEXT (SEHR WICHTIG):
- Diktierte Aenderungen, die in KEINE der vorhandenen Optionen passen, MUESSEN im unusedText
  landen. Sie duerfen NICHT eigenmaechtig als Freitext in den Baustein eingefuegt werden.
- Nur wenn eine Aenderung eindeutig einer Option zugeordnet werden kann, wird sie eingebaut.
- Bei Unsicherheit: lieber in unusedText als eine falsche Option zu waehlen.`;
