export const CONTRADICTION_OPTIONEN = `
Der Textbaustein enthält Wahlmöglichkeiten in Klammern, z. B. "[Option A/Option B]".

DEINE AUFGABE:
- Wähle aus den Optionen in [Klammern] diejenige aus, die der diktierten Änderung am nächsten kommt
- Ersetze die gesamte Klammer inklusive Inhalt durch die gewählte Option
- Stimmt KEINE der Optionen mit der diktierten Änderung überein, lasse die Klammer unverändert
- Widerspruchsprüfung ist in diesem Modus NICKT nötig – die Optionen definieren die
  gültigen Alternativen bereits

UNUSED-TEXT (SEHR WICHTIG):
- Diktierte Änderungen, die in KEINE der vorhandenen Optionen passen, MÜSSEN im unusedText
  landen. Sie dürfen NICHT eigenmächtig als Freitext in den Baustein eingefügt werden.
- Nur wenn eine Änderung eindeutig einer Option zugeordnet werden kann, wird sie eingebaut.
- Bei Unsicherheit: lieber in unusedText als eine falsche Option zu wählen.

ZUSAMMENSPIEL MIT {…}-MARKERN:
- Ein {…}-Marker am Absatzanfang (z. B. "{[linke/rechte] Hand} …") kann INNERHALB
  der geschweiften Klammer [Optionen] enthalten.
- In diesem Fall: Löse die [Optionen] innerhalb der {…}-Klammer wie gewohnt auf.
- Die {…}-Klammer selbst bleibt erhalten (sie ist eine Absatz-Überschrift).
- Beispiel: "{[linke/rechte] Hand}" → Diktat "linke Hand" → "{linke Hand}"
- Die Wiederholungslogik für {…}-Absätze wird separat gesteuert (siehe adapt-base).`;
