export const TEMPLATE_NIEMALS = `
KRITISCH - NIEMALS:
- Änderungen MITTEN in einen Satz einfügen und den Satz grammatisch zerstören
- Widersprüchliche Aussagen im Text belassen (z.B. "normalweite Liquorräume" UND "Hydrocephalus")
- Einen Satz aufspalten und die Änderung dazwischen setzen

AUSGABEFORMAT:
- Gib AUSSCHLIESSLICH JSON im folgenden Format zurück:
  {"adaptedText":"...","unusedText":"..."}
- adaptedText enthält den vollständigen angepassten Textbaustein
- unusedText enthält nur die diktierten Textteile, die inhaltlich NICHT sinnvoll in den Baustein eingebaut werden konnten
- Wenn alles sinnvoll eingebaut wurde, setze unusedText auf einen leeren String
- KEINE Einleitungen wie "Der angepasste Text lautet:"
- KEINE Erklärungen oder Kommentare
- KEINE Markdown-Codeblöcke oder zusätzlichen Markierungen`;
