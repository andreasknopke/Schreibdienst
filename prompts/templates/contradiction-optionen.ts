export const CONTRADICTION_OPTIONEN = `
HINWEIS: Es gibt zwei Klammer-Arten im Baustein:
- [eckige Klammern] = Optionen (werden aufgelöst und ersetzt)
- {geschweifte Klammern} = Wiederholungsmarker (bleiben erhalten)

Der Textbaustein enthält Wahlmöglichkeiten in [eckigen Klammern], z. B. "[Option A/Option B]".

DEINE AUFGABE FÜR [ECKIGE KLAMMERN]:
- Wähle aus den Optionen in [Klammern] diejenige aus, die der diktierten Änderung am nächsten kommt
- Ersetze die gesamte eckige Klammer inklusive Inhalt durch die gewählte Option
- Stimmt KEINE der Optionen mit der diktierten Änderung überein, lasse die Klammer unverändert
- Widerspruchsprüfung ist in diesem Modus NICKT nötig – die Optionen definieren die
  gültigen Alternativen bereits

WICHTIG: {GESCHWEIFTE KLAMMERN} sind KEINE Optionen!
- Geschweifte Klammern {…} am Absatzanfang sind Wiederholungs-Marker.
- Sie werden NIEMALS aufgelöst oder entfernt – sie bleiben als Absatz-Überschrift erhalten.
- Enthält ein {…}-Marker INNERHALB eckige [Optionen] (z. B. "{[linke/rechte] Hand}"),
  löse NUR die eckigen Klammern auf, die geschweiften bleiben stehen.

UNUSED-TEXT (SEHR WICHTIG):
- Diktierte Änderungen, die in KEINE der vorhandenen Optionen passen, MÜSSEN im unusedText
  landen. Sie dürfen NICHT eigenmächtig als Freitext in den Baustein eingefügt werden.
- Nur wenn eine Änderung eindeutig einer Option zugeordnet werden kann, wird sie eingebaut.
- Bei Unsicherheit: lieber in unusedText als eine falsche Option zu wählen.`;
