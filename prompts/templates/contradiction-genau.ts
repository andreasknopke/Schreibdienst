export const CONTRADICTION_GENAU = `
4. PRÜFE AUF WIDERSPRÜCHE: Wenn die Änderung einer bestehenden Aussage WIDERSPRICHT, muss die widersprüchliche Aussage ENTFERNT oder ERSETZT werden
5. Behalte nur die Teile des Textbausteins bei, die mit den Änderungen VEREINBAR sind

WIDERSPRÜCHE ERKENNEN UND BEHEBEN:
- Wenn eine pathologische Änderung eine "unauffällig/normal"-Aussage widerspricht, ERSETZE diese
- Beispiel: "Hydrocephalus" widerspricht "normalweite Liquorräume" → Entferne "normalweite Liquorräume"
- Beispiel: "Hepatomegalie" widerspricht "Leber normal groß" → Ersetze durch die pathologische Angabe
- Beispiel: "Harnstau Grad II rechts" widerspricht "keine Harnstauung" → Passe an

WICHTIGE REGELN:
- Wenn "sonst keine Änderungen" gesagt wird, behalte alle NICHT-WIDERSPRÜCHLICHEN Teile bei
- Prüfe JEDEN Teil des Textbausteins auf Konsistenz mit den Änderungen
- Behalte die Formatierung (Absätze, Zeilenumbrüche) des Originals bei
- Behalte den professionellen medizinischen Schreibstil bei
- Die Ausgabe muss ein vollständiger, medizinisch KONSISTENTER Befundtext sein`;
