# Solution Architect (Planning)

- Ticket: #dec46f55-3c07-484d-b972-3f18bb801592 — Baustein Titel problem
- Stage: `planning`
- Status: `done`
- Bearbeiter: Architect-Bot (ai)
- Provider/Modell: `deepseek` / `deepseek-v4-pro`
- Gestartet: 2026-06-30 07:47:07
- Beendet: 2026-06-30 07:49:44
- Dauer: 353 ms

## Bericht

> System: Schreibdienst (ID 2) · Repo: andreasknopke/Schreibdienst

**Zusammenfassung:** Fix focus jump from template title input to rich text editor in GroupTemplateManager. Prevent the editor from stealing focus on state updates when the user is typing in the title field.

**Aufgabe:**
In components/GroupTemplateManager.tsx, locate the title input (placeholder 'Name (z.B. CCT)') and the TemplateRichTextEditor. Diagnose why typing in the title causes focus to move to the editor. Likely cause: a re-render triggers the rich text editor’s auto-focus behavior or the input loses focus because it is re-created. Implement a fix: if the title input uses a controlled state with onChange, ensure no unnecessary re-renders of the editor. Optionally, store a ref to the title input and restore focus after any asynchronous state updates that might cause the editor to mount/update. Consider adding an onFocus callback to track focus state and prevent the editor from programmatically focusing while the title is focused. Ensure that the fix does not break the editor's normal focus behavior when the user intentionally clicks into it.

**Change-Kind:** `extend`

**Allowed Files:**
- `components/GroupTemplateManager.tsx`

**Schritte:**
1. **Locate the title input and rich text editor instances**
   - Find the JSX for the input with placeholder 'Name (z.B. CCT)' and the <TemplateRichTextEditor> component. Note any props passed to the editor (e.g., autoFocus, onFocus, value). Identify the state variable used for the title and its setter.
   - Dateien: components/GroupTemplateManager.tsx
2. **Identify cause of focus jump**
   - Check if the rich text editor has an autoFocus prop or an internal useEffect that focuses on mount/update. Check if the title input is remounted on state change (e.g., due to conditional rendering or missing keys). Look for any onTitleChange handler that triggers state updates that cause the editor to re-render and steal focus.
   - Dateien: components/GroupTemplateManager.tsx
3. **Implement focus stability fix**
   - If the editor auto-focuses on mount, pass a prop like `autoFocus={false}` or conditionally enable it. If the editor focuses on every update due to a useEffect, add a guard that only focuses if the user has not interacted with the title input recently. Use a ref to the title input and a state flag to track which field was last focused. In the editor's onFocus, set the flag; in the title input's onFocus, set the flag. Then in the effect that might steal focus, check the flag. If the editor does not expose props for this, use a wrapper or modify the title change handler to prevent unnecessary re-renders of the editor (e.g., debounce state updates). Alternatively, after the title state update, schedule a focus return to the title input using requestAnimationFrame if the editor received focus unintendedly.
   - Dateien: components/GroupTemplateManager.tsx
4. **Test and verify**
   - Simulate typing in the title field; ensure the cursor remains there and the editor does not steal focus unintentionally. Verify that clicking into the editor still functions normally.
   - Dateien: components/GroupTemplateManager.tsx

**Constraints:**
- Nur GroupTemplateManager.tsx aendern (keine anderen Komponenten wie TemplateRichTextEditor.tsx, da deren Aenderungen unbeabsichtigte Seiteneffekte verursachen koennten).
- Keine neuen Props an Komponenten ausserhalb hinzufuegen, es sei denn, sie werden in GroupTemplateManager selbst genutzt und sind optional.
- Der Title-Input (Name-Feld) muss ein Controlled Component bleiben (keine Umstellung auf Uncontrolled).
- Keine Aenderung der Export-Signatur von GroupTemplateManager.

**Symbols to preserve:**
- `components/GroupTemplateManager.tsx` :: `GroupTemplateManager`

**Risiken:**
- Annahme: Der Rich-Text-Editor hat ein internes Focus-Verhalten (z.B. autoFocus-Prop oder useEffect), das bei jedem Re-Render fokussiert. Ohne Einsicht in TemplateRichTextEditor.tsx koennten Aenderungen dort noetig sein, falls Props nicht ausreichen. Risiko: Fix koennte das Editor-Fokusverhalten bei normaler Nutzung beeintraechtigen.
- Falls der Fokus-Sprung durch einen asynchronen State-Update ausgeloest wird, der den Input re-mounted, koennte ein key-Attribut oder ein anderer Stabilitaetsansatz noetig sein.

**Aufwand:** S

**Verifizierte Fakten (Architect-Tools):**
- GroupTemplateManager has an entry form with input placeholder 'Name (z.B. CCT)' and a TemplateRichTextEditor, but no label 'Baustein Titel'.

_Basierend auf 6 Tool-Call(s)._

**Verbotene Annahmen (per Tool als nicht-existent verifiziert):**
- No exact string 'Baustein Titel' found in GroupTemplateManager.tsx

## Architect-Tool-Trace

**Verifizierte Fakten:**
- GroupTemplateManager has an entry form with input placeholder 'Name (z.B. CCT)' and a TemplateRichTextEditor, but no label 'Baustein Titel'.

**Verbotene Annahmen** (per Tool geprueft, NICHT vorhanden — nicht im Plan verwenden):
- No exact string 'Baustein Titel' found in GroupTemplateManager.tsx

**Tool-Calls (6):**

### #1 — `grep`
_Suche nach dem Component, der die Eingabefelder 'Baustein Titel' und 'Baustein Textfeld' enthaelt. Vermutlich in TemplateRichTextEditor oder TemplatesManager. Pruefe per grep._

Args:
```json
{
  "pattern": "Baustein Titel",
  "glob": "components/**/*.tsx"
}
```
Result (gekuerzt):
```
components/BugReportForm.tsx:1: [code-search] setStatus('error'); setResultMessage('Bitte füllen Sie Titel und Beschreibung aus.'); return;
components/BugReportForm.tsx:1: [code-search] <label className="block space-y-1.5"> <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Titel *</span> <input
components/GroupAdminView.tsx:1: [code-search] Mitglieder <span className="text-gray-400">({members.length})</span> </h4> <p className="text-[11px] text-gray-400 mb-2"> Mitglieder teilen sich die Gruppen-Wörterbücher und Gruppen-Bausteine. </p> <div className="flex flex-wrap gap-1.5"> {…
components/GroupTemplateManager.tsx:1: [code-search] {/* Entry-Formular */} <form onSubmit={handleAddEntry} className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-2"> <h4 className="text-xs font-medium">{editingEntryName ? 'Baustein bearbeiten' : 'Neuen Baustein hinzufügen'}</h4> <div …
components/TemplatesManager.tsx:1: [code-search] if (data.success) { setSuccess('Textbaustein hinzugefügt'); setName('');
components/TemplatesManager.tsx:1: [code-search] {template.scope === 'group' && ( <span className="text-xs px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 rounded" title={template.groupName ? `Gruppe: ${template.groupName}` : 'Abteilungs-Baustein…
components/UserMenu.tsx:1: [code-search] )} {groupDictTab === 'groups' ? 'Gruppen' : groupDictTab === 'dictionary' ? 'Gruppen-Wörterbücher' : 'Gruppen-Bausteine'} </h2>
components/UserMe
```

### #2 — `read_file`
_Das grep lieferte Treffer in GroupTemplateManager und TemplatesManager. Ich lese GroupTemplateManager, um die Eingabefelder für 'Baustein Titel' und 'Baustein Textfeld' zu identifizieren._

Args:
```json
{
  "path": "components/GroupTemplateManager.tsx",
  "start_line": 1,
  "end_line": 200
}
```
Result (gekuerzt):
```
# components/GroupTemplateManager.tsx (Zeilen 1-200)
    1: 'use client';
    2: import { useEffect, useMemo, useState } from 'react';
    3: import { useAuth } from './AuthProvider';
    4: import TemplateRichTextEditor from './TemplateRichTextEditor';
    5: import { normalizeRichTextRanges, type RichTextFormatRange } from '@/lib/richTextFormatting';
    6: 
    7: interface TemplateGroup {
    8:   id: number;
    9:   name: string;
   10:   description: string;
   11:   memberCount: number;
   12:   entryCount: number;
   13: }
   14: 
   15: interface GroupEntry {
   16:   id: number;
   17:   name: string;
   18:   content: string;
   19:   field: 'methodik' | 'befund' | 'beurteilung';
   20:   formatRanges?: any[];
   21:   addedBy?: string;
   22: }
   23: 
   24: interface ImportCandidate {
   25:   sourceUsername: string;
   26:   name: string;
   27:   content: string;
   28:   field: 'methodik' | 'befund' | 'beurteilung';
   29:   formatRanges?: any[];
   30:   alreadyInGroup: boolean;
   31:   groupName?: string;
   32: }
   33: 
   34: const TEMPLATES_CHANGED_EVENT = 'templates-changed';
   35: 
   36: function notifyTemplatesChanged() {
   37:   window.dispatchEvent(new CustomEvent(TEMPLATES_CHANGED_EVENT));
   38: }
   39: 
   40: export default function GroupTemplateManager() {
   41:   const { getAuthHeader, getDbTokenHeader } = useAuth();
   42:   const [groups, setGroups] = useState<TemplateGroup[]>([]);
   43:   const [selectedGroupId, setSelectedGroupId]
```

### #3 — `read_file`
_Reading further in GroupTemplateManager.tsx to see the form rendering for 'Baustein Titel' and 'Baustein Textfeld'._

Args:
```json
{
  "path": "components/GroupTemplateManager.tsx",
  "start_line": 200,
  "end_line": 400
}
```
Result (gekuerzt):
```
# components/GroupTemplateManager.tsx (Zeilen 200-353)
  200:       if (!res.ok || !data.success) { setError(data.error || 'Fehler'); return; }
  201:       setSuccess(`${data.imported} Bausteine importiert, ${data.skipped} übersprungen`);
  202:       await fetchGroupDetails(selectedGroupId);
  203:       await fetchOverview();
  204:       notifyTemplatesChanged();
  205:     } catch { setError('Verbindungsfehler'); }
  206:   };
  207: 
  208:   const fieldLabels: Record<string, string> = { methodik: 'Methodik', befund: 'Befund', beurteilung: 'Beurteilung' };
  209: 
  210:   if (loading) return <div className="text-center py-4 text-sm text-gray-500">Lade Gruppen...</div>;
  211: 
  212:   return (
  213:     <div className="space-y-4">
  214:       {/* Fehler + Erfolg */}
  215:       {error && <div className="p-2 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded">{error}</div>}
  216:       {success && <div className="p-2 text-sm text-green-600 bg-green-50 dark:bg-green-900/20 rounded">{success}</div>}
  217: 
  218:       <div className="flex gap-4">
  219:         {/* ─── Linke Spalte: Gruppenliste ─────────────── */}
  220:         <div className="w-56 shrink-0 space-y-3">
  221:           <div className="space-y-1 max-h-[400px] overflow-y-auto">
  222:             {groups.map(g => (
  223:               <button key={g.id} onClick={() => setSelectedGroupId(g.id)}
  224:                 className={`w-full text-left px-2 py-1.5 text-xs rounded transition-colors 
```

### #4 — `read_file`
_I need to find the component that renders the 'Baustein Titel' and 'Baustein Textfeld' inputs to identify the focus issue. The current GroupTemplateManager uses entryName and entryContent but doesn't label them as 'Baustein Titel'. I'll continue reading GroupTemplateManager to see if it renders external editor and also check TemplatesManager.tsx._

Args:
```json
{
  "path": "components/GroupTemplateManager.tsx",
  "start_line": 260,
  "end_line": 400
}
```
Result (gekuerzt):
```
# components/GroupTemplateManager.tsx (Zeilen 260-353)
  260:                     className="px-2 py-1 text-xs border rounded dark:bg-gray-700 dark:border-gray-600">
  261:                     <option value="methodik">Methodik</option>
  262:                     <option value="befund">Befund</option>
  263:                     <option value="beurteilung">Beurteilung</option>
  264:                   </select>
  265:                 </div>
  266:                 <TemplateRichTextEditor
  267:                   value={entryContent} formats={entryFormats}
  268:                   onChange={(v, f) => { setEntryContent(v); setEntryFormats(f); }}
  269:                   className="textarea w-full px-2 py-1 text-xs border rounded dark:bg-gray-700 dark:border-gray-600 min-h-[60px]"
  270:                 />
  271:                 <div className="flex gap-2">
  272:                   <button type="submit" disabled={!entryName.trim() || !entryContent.trim()}
  273:                     className="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50">
  274:                     {editingEntryName ? 'Speichern' : 'Hinzufügen'}
  275:                   </button>
  276:                   {editingEntryName && (
  277:                     <button type="button" onClick={resetEntryForm} className="px-3 py-1 text-xs bg-gray-300 dark:bg-gray-600 rounded hover:bg-gray-400">
  278:                       Abbrechen
  279:                     </button>
  280:         
```

### #5 — `grep`
_Need to locate the exact component that contains input fields labeled 'Baustein Titel' and 'Baustein Textfeld' to diagnose focus issue. Grep for 'Baustein' globally will help find the UI that uses those terms._

Args:
```json
{
  "pattern": "Baustein",
  "glob": "**/*.tsx"
}
```
Result (gekuerzt):
```
app/page.tsx:1: [code-search] // Bearbeitungen) erhalten bleiben und die neuen Sprachbefehle nur ergänzt werden. // Fällt der Feldinhalt weg, dient der ursprüngliche Baustein als Basis. const currentFieldText = getTextForBefundField(template.field).trim();
app/page.tsx:1: [code-search] {/* Neuen Baustein anlegen Dialog */} {showNewTemplateDialog && (
components/GroupAdminView.tsx:1: [code-search] Mitglieder <span className="text-gray-400">({members.length})</span> </h4> <p className="text-[11px] text-gray-400 mb-2"> Mitglieder teilen sich die Gruppen-Wörterbücher und Gruppen-Bausteine. </p> <div className="flex flex-wrap gap-1.5"> {…
components/GroupTemplateManager.tsx:1: [code-search] {/* Entry-Formular */} <form onSubmit={handleAddEntry} className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-2"> <h4 className="text-xs font-medium">{editingEntryName ? 'Baustein bearbeiten' : 'Neuen Baustein hinzufügen'}</h4> <div …
components/TemplatesManager.tsx:1: [code-search] if (data.success) { setSuccess('Textbaustein hinzugefügt'); setName('');
components/TemplatesManager.tsx:1: [code-search] {template.scope === 'group' && ( <span className="text-xs px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 rounded" title={template.groupName ? `Gruppe: ${template.groupName}` : 'Abteilungs-Baustein…
components/UserMenu.tsx:1: [code-search] )} {groupDictTab === 'groups' ? 'Gruppen' : groupDictTab === 'dictionary' ? 'Gruppen-Wörterbücher' : 'Gruppen
```

### #6 — `grep`
_Need to locate the exact component that contains input fields labeled 'Baustein Titel' and 'Baustein Textfeld' to identify focus issue. grep for 'Baustein Titel' across repo._

Args:
```json
{
  "pattern": "Baustein Titel"
}
```
Result (gekuerzt):
```
app/page.tsx:1: [code-search] // Bearbeitungen) erhalten bleiben und die neuen Sprachbefehle nur ergänzt werden. // Fällt der Feldinhalt weg, dient der ursprüngliche Baustein als Basis. const currentFieldText = getTextForBefundField(template.field).trim();
app/page.tsx:1: [code-search] {/* Neuen Baustein anlegen Dialog */} {showNewTemplateDialog && (
app/page.tsx:1: [code-search] className="text-[11px] px-2 py-0.5 w-36 border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 placeholder-gray-400 dark:placeholder-gray-500 focus:border-purple-400 focus:ring-1 focus…
app/page.tsx:1: [code-search] onChange={(e) => setTargetWindowPattern(e.target.value)} title="Teil des Fenstertitels der Ziel-App (z. B. 'Radiologie'). Der Injector findet das Fenster auch nach Fokusverlust wieder." />
components/BugReportForm.tsx:1: [code-search] setStatus('error'); setResultMessage('Bitte füllen Sie Titel und Beschreibung aus.'); return;
components/BugReportForm.tsx:1: [code-search] <label className="block space-y-1.5"> <span className="text-sm font-medium text-gray-700 dark:text-gray-200">Titel *</span> <input
components/GroupAdminView.tsx:1: [code-search] Mitglieder <span className="text-gray-400">({members.length})</span> </h4> <p className="text-[11px] text-gray-400 mb-2"> Mitglieder teilen sich die Gruppen-Wörterbücher und Gruppen-Bausteine. </p> <div className="flex flex-wrap gap-1.5"> {…
components/GroupTemplateManager.tsx:1: [code-searc
```

_Tokens: prompt=33767, completion=3154_

## Vollstaendiges Output-Payload

```json
{
  "summary": "Fix focus jump from template title input to rich text editor in GroupTemplateManager. Prevent the editor from stealing focus on state updates when the user is typing in the title field.",
  "task": "In components/GroupTemplateManager.tsx, locate the title input (placeholder 'Name (z.B. CCT)') and the TemplateRichTextEditor. Diagnose why typing in the title causes focus to move to the editor. Likely cause: a re-render triggers the rich text editor’s auto-focus behavior or the input loses focus because it is re-created. Implement a fix: if the title input uses a controlled state with onChange, ensure no unnecessary re-renders of the editor. Optionally, store a ref to the title input and restore focus after any asynchronous state updates that might cause the editor to mount/update. Consider adding an onFocus callback to track focus state and prevent the editor from programmatically focusing while the title is focused. Ensure that the fix does not break the editor's normal focus behavior when the user intentionally clicks into it.",
  "affected_areas": [
    "components/GroupTemplateManager.tsx"
  ],
  "allowed_files": [
    "components/GroupTemplateManager.tsx"
  ],
  "change_kind": "extend",
  "steps": [
    {
      "title": "Locate the title input and rich text editor instances",
      "details": "Find the JSX for the input with placeholder 'Name (z.B. CCT)' and the <TemplateRichTextEditor> component. Note any props passed to the editor (e.g., autoFocus, onFocus, value). Identify the state variable used for the title and its setter.",
      "files": [
        "components/GroupTemplateManager.tsx"
      ]
    },
    {
      "title": "Identify cause of focus jump",
      "details": "Check if the rich text editor has an autoFocus prop or an internal useEffect that focuses on mount/update. Check if the title input is remounted on state change (e.g., due to conditional rendering or missing keys). Look for any onTitleChange handler that triggers state updates that cause the editor to re-render and steal focus.",
      "files": [
        "components/GroupTemplateManager.tsx"
      ]
    },
    {
      "title": "Implement focus stability fix",
      "details": "If the editor auto-focuses on mount, pass a prop like `autoFocus={false}` or conditionally enable it. If the editor focuses on every update due to a useEffect, add a guard that only focuses if the user has not interacted with the title input recently. Use a ref to the title input and a state flag to track which field was last focused. In the editor's onFocus, set the flag; in the title input's onFocus, set the flag. Then in the effect that might steal focus, check the flag. If the editor does not expose props for this, use a wrapper or modify the title change handler to prevent unnecessary re-renders of the editor (e.g., debounce state updates). Alternatively, after the title state update, schedule a focus return to the title input using requestAnimationFrame if the editor received focus unintendedly.",
      "files": [
        "components/GroupTemplateManager.tsx"
      ]
    },
    {
      "title": "Test and verify",
      "details": "Simulate typing in the title field; ensure the cursor remains there and the editor does not steal focus unintentionally. Verify that clicking into the editor still functions normally.",
      "files": [
        "components/GroupTemplateManager.tsx"
      ]
    }
  ],
  "symbols_to_preserve": [
    {
      "path": "components/GroupTemplateManager.tsx",
      "symbol": "GroupTemplateManager"
    }
  ],
  "constraints": [
    "Nur GroupTemplateManager.tsx aendern (keine anderen Komponenten wie TemplateRichTextEditor.tsx, da deren Aenderungen unbeabsichtigte Seiteneffekte verursachen koennten).",
    "Keine neuen Props an Komponenten ausserhalb hinzufuegen, es sei denn, sie werden in GroupTemplateManager selbst genutzt und sind optional.",
    "Der Title-Input (Name-Feld) muss ein Controlled Component bleiben (keine Umstellung auf Uncontrolled).",
    "Keine Aenderung der Export-Signatur von GroupTemplateManager."
  ],
  "risks": [
    "Annahme: Der Rich-Text-Editor hat ein internes Focus-Verhalten (z.B. autoFocus-Prop oder useEffect), das bei jedem Re-Render fokussiert. Ohne Einsicht in TemplateRichTextEditor.tsx koennten Aenderungen dort noetig sein, falls Props nicht ausreichen. Risiko: Fix koennte das Editor-Fokusverhalten bei normaler Nutzung beeintraechtigen.",
    "Falls der Fokus-Sprung durch einen asynchronen State-Update ausgeloest wird, der den Input re-mounted, koennte ein key-Attribut oder ein anderer Stabilitaetsansatz noetig sein."
  ],
  "estimated_effort": "S",
  "open_questions": [],
  "architect_explore": {
    "findings": [
      "GroupTemplateManager has an entry form with input placeholder 'Name (z.B. CCT)' and a TemplateRichTextEditor, but no label 'Baustein Titel'."
    ],
    "non_existent": [
      "No exact string 'Baustein Titel' found in GroupTemplateManager.tsx"
    ],
    "consistency_violations": [],
    "tree_validation_warnings": [],
    "evidence_probe": {
      "required": false,
      "found": false,
      "terms": [],
      "paths": [],
      "findings": [],
      "trace": []
    },
    "evidence_violations": [],
    "tool_calls": [
      {
        "iteration": 1,
        "thought": "Suche nach dem Component, der die Eingabefelder 'Baustein Titel' und 'Baustein Textfeld' enthaelt. Vermutlich in TemplateRichTextEditor oder TemplatesManager. Pruefe per grep.",
        "tool": "grep",
        "args": {
          "pattern": "Baustein Titel",
          "glob": "components/**/*.tsx"
        },
        "result": "components/BugReportForm.tsx:1: [code-search] setStatus('error'); setResultMessage('Bitte füllen Sie Titel und Beschreibung aus.'); return;\ncomponents/BugReportForm.tsx:1: [code-search] <label className=\"block space-y-1.5\"> <span className=\"text-sm font-medium text-gray-700 dark:text-gray-200\">Titel *</span> <input\ncomponents/GroupAdminView.tsx:1: [code-search] Mitglieder <span className=\"text-gray-400\">({members.length})</span> </h4> <p className=\"text-[11px] text-gray-400 mb-2\"> Mitglieder teilen sich die Gruppen-Wörterbücher und Gruppen-Bausteine. </p> <div className=\"flex flex-wrap gap-1.5\"> {…\ncomponents/GroupTemplateManager.tsx:1: [code-search] {/* Entry-Formular */} <form onSubmit={handleAddEntry} className=\"p-3 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-2\"> <h4 className=\"text-xs font-medium\">{editingEntryName ? 'Baustein bearbeiten' : 'Neuen Baustein hinzufügen'}</h4> <div …\ncomponents/TemplatesManager.tsx:1: [code-search] if (data.success) { setSuccess('Textbaustein hinzugefügt'); setName('');\ncomponents/TemplatesManager.tsx:1: [code-search] {template.scope === 'group' && ( <span className=\"text-xs px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 rounded\" title={template.groupName ? `Gruppe: ${template.groupName}` : 'Abteilungs-Baustein…\ncomponents/UserMenu.tsx:1: [code-search] )} {groupDictTab === 'groups' ? 'Gruppen' : groupDictTab === 'dictionary' ? 'Gruppen-Wörterbücher' : 'Gruppen-Bausteine'} </h2>\ncomponents/UserMenu.tsx:1: [code-search] }`}> Bausteine </button>",
        "error": null
      },
      {
        "iteration": 2,
        "thought": "Das grep lieferte Treffer in GroupTemplateManager und TemplatesManager. Ich lese GroupTemplateManager, um die Eingabefelder für 'Baustein Titel' und 'Baustein Textfeld' zu identifizieren.",
        "tool": "read_file",
        "args": {
          "path": "components/GroupTemplateManager.tsx",
          "start_line": 1,
          "end_line": 200
        },
        "result": "# components/GroupTemplateManager.tsx (Zeilen 1-200)\n    1: 'use client';\n    2: import { useEffect, useMemo, useState } from 'react';\n    3: import { useAuth } from './AuthProvider';\n    4: import TemplateRichTextEditor from './TemplateRichTextEditor';\n    5: import { normalizeRichTextRanges, type RichTextFormatRange } from '@/lib/richTextFormatting';\n    6: \n    7: interface TemplateGroup {\n    8:   id: number;\n    9:   name: string;\n   10:   description: string;\n   11:   memberCount: number;\n   12:   entryCount: number;\n   13: }\n   14: \n   15: interface GroupEntry {\n   16:   id: number;\n   17:   name: string;\n   18:   content: string;\n   19:   field: 'methodik' | 'befund' | 'beurteilung';\n   20:   formatRanges?: any[];\n   21:   addedBy?: string;\n   22: }\n   23: \n   24: interface ImportCandidate {\n   25:   sourceUsername: string;\n   26:   name: string;\n   27:   content: string;\n   28:   field: 'methodik' | 'befund' | 'beurteilung';\n   29:   formatRanges?: any[];\n   30:   alreadyInGroup: boolean;\n   31:   groupName?: string;\n   32: }\n   33: \n   34: const TEMPLATES_CHANGED_EVENT = 'templates-changed';\n   35: \n   36: function notifyTemplatesChanged() {\n   37:   window.dispatchEvent(new CustomEvent(TEMPLATES_CHANGED_EVENT));\n   38: }\n   39: \n   40: export default function GroupTemplateManager() {\n   41:   const { getAuthHeader, getDbTokenHeader } = useAuth();\n   42:   const [groups, setGroups] = useState<TemplateGroup[]>([]);\n   43:   const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null);\n   44:   const [entries, setEntries] = useState<GroupEntry[]>([]);\n   45:   const [candidates, setCandidates] = useState<ImportCandidate[]>([]);\n   46:   const [selectedCandidateKeys, setSelectedCandidateKeys] = useState<Set<string>>(new Set());\n   47:   const [loading, setLoading] = useState(true);\n   48:   const [detailLoading, setDetailLoading] = useState(false);\n   49:   const [error, setError] = useState('');\n   50:   const [success, setSuccess] = useState('');\n   51: \n   52:   // Entry form\n   53:   const [entryName, setEntryName] = useState('');\n   54:   const [entryContent, setEntryContent] = useState('');\n   55:   const [entryFormats, setEntryFormats] = useState<RichTextFormatRange[]>([]);\n   56:   const [entryField, setEntryField] = useState<'methodik' | 'befund' | 'beurteilung'>('befund');\n   57:   const [editingEntryName, setEditingEntryName] = useState<string | null>(null);\n   58:   const [overwriteExisting, setOverwriteExisting] = useState(false);\n   59: \n   60:   const [filter, setFilter] = useState('');\n   61: \n   62:   const selectedGroup = groups.find(g => g.id === selectedGroupId) || null;\n   63:   const normalizedFilter = filter.trim().toLowerCase();\n   64: \n   65:   const visibleEntries = useMemo(\n   66:     () => entries.filter(e => !normalizedFilter || [e.name, e.content, e.field, e.addedBy].some(v => v?.toLowerCase().includes(normalizedFilter))),\n   67:     [entries, normalizedFilter]\n   68:   );\n   69: \n   70:   const visibleCandidates = useMemo(\n   71:     () => candidates.filter(c => !normalizedFilter || [c.sourceUsername, c.name].some(v => v?.toLowerCase().includes(normalizedFilter))),\n   72:     [candidates, normalizedFilter]\n   73:   );\n   74: \n   75:   const headers = () => ({\n   76:     'Authorization': getAuthHeader(),\n   77:     ...getDbTokenHeader(),\n   78:   });\n   79:   const jsonHeaders = () => ({ 'Content-Type': 'application/json', ...headers() });\n   80: \n   81:   const fetchOverview = async () => {\n   82:     try {\n   83:       setError('');\n   84:       const res = await fetch('/api/template-groups', { headers: headers() });\n   85:       const data = await res.json();\n   86:       if (!res.ok) { setError(data.error || 'Fehler'); return; }\n   87:       setGroups(data.groups || []);\n   88:       if (!selectedGroupId && data.groups?.length) setSelectedGroupId(data.groups[0].id);\n   89:     } catch { setError('Fehler beim Laden'); }\n   90:     finally { setLoading(false); }\n   91:   };",
        "error": null
      },
      {
        "iteration": 3,
        "thought": "Reading further in GroupTemplateManager.tsx to see the form rendering for 'Baustein Titel' and 'Baustein Textfeld'.",
        "tool": "read_file",
        "args": {
          "path": "components/GroupTemplateManager.tsx",
          "start_line": 200,
          "end_line": 400
        },
        "result": "# components/GroupTemplateManager.tsx (Zeilen 200-353)\n  200:       if (!res.ok || !data.success) { setError(data.error || 'Fehler'); return; }\n  201:       setSuccess(`${data.imported} Bausteine importiert, ${data.skipped} übersprungen`);\n  202:       await fetchGroupDetails(selectedGroupId);\n  203:       await fetchOverview();\n  204:       notifyTemplatesChanged();\n  205:     } catch { setError('Verbindungsfehler'); }\n  206:   };\n  207: \n  208:   const fieldLabels: Record<string, string> = { methodik: 'Methodik', befund: 'Befund', beurteilung: 'Beurteilung' };\n  209: \n  210:   if (loading) return <div className=\"text-center py-4 text-sm text-gray-500\">Lade Gruppen...</div>;\n  211: \n  212:   return (\n  213:     <div className=\"space-y-4\">\n  214:       {/* Fehler + Erfolg */}\n  215:       {error && <div className=\"p-2 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded\">{error}</div>}\n  216:       {success && <div className=\"p-2 text-sm text-green-600 bg-green-50 dark:bg-green-900/20 rounded\">{success}</div>}\n  217: \n  218:       <div className=\"flex gap-4\">\n  219:         {/* ─── Linke Spalte: Gruppenliste ─────────────── */}\n  220:         <div className=\"w-56 shrink-0 space-y-3\">\n  221:           <div className=\"space-y-1 max-h-[400px] overflow-y-auto\">\n  222:             {groups.map(g => (\n  223:               <button key={g.id} onClick={() => setSelectedGroupId(g.id)}\n  224:                 className={`w-full text-left px-2 py-1.5 text-xs rounded transition-colors ${\n  225:                   selectedGroupId === g.id ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 font-medium' : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300'\n  226:                 }`}>\n  227:                 <div className=\"truncate font-medium\">{g.name}</div>\n  228:                 <div className=\"text-[10px] opacity-60\">{g.memberCount} Mitglieder · {g.entryCount} Bausteine</div>\n  229:               </button>\n  230:             ))}\n  231:             {groups.length === 0 && <p className=\"text-xs text-gray-400 italic px-2\">Keine Gruppen</p>}\n  232:           </div>\n  233:         </div>\n  234: \n  235:         {/* ─── Rechte Spalte: Detailansicht ─────────────────── */}\n  236:         <div className=\"flex-1 min-w-0\">\n  237:           {!selectedGroup ? (\n  238:             <p className=\"text-sm text-gray-500 italic\">Bitte Gruppe auswählen</p>\n  239:           ) : detailLoading ? (\n  240:             <p className=\"text-sm text-gray-500\">Lade...</p>\n  241:           ) : (\n  242:             <div className=\"space-y-4\">\n  243:               {/* Gruppen-Header */}\n  244:               <div>\n  245:                 <h3 className=\"font-semibold text-sm\">{selectedGroup.name}</h3>\n  246:                 {selectedGroup.description && <p className=\"text-xs text-gray-500\">{selectedGroup.description}</p>}\n  247:               </div>\n  248: \n  249:               {/* Filter */}\n  250:               <input type=\"text\" value={filter} onChange={e => setFilter(e.target.value)}\n  251:                 placeholder=\"Filtern...\" className=\"w-full px-2 py-1 text-xs border rounded dark:bg-gray-700 dark:border-gray-600\" />\n  252: \n  253:               {/* Entry-Formular */}\n  254:               <form onSubmit={handleAddEntry} className=\"p-3 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-2\">\n  255:                 <h4 className=\"text-xs font-medium\">{editingEntryName ? 'Baustein bearbeiten' : 'Neuen Baustein hinzufügen'}</h4>\n  256:                 <div className=\"flex gap-2\">\n  257:                   <input type=\"text\" value={entryName} onChange={e => setEntryName(e.target.value)}\n  258:                     placeholder=\"Name (z.B. CCT)\" className=\"flex-1 px-2 py-1 text-xs border rounded dark:bg-gray-700 dark:border-gray-600\" required />\n  259:                   <select value={entryField} onChange={e => setEntryField(e.target.value as any)}\n  260:                     className=\"px-2 py-1 text-xs border rounded dark:bg-gray-700 dark",
        "error": null
      },
      {
        "iteration": 4,
        "thought": "I need to find the component that renders the 'Baustein Titel' and 'Baustein Textfeld' inputs to identify the focus issue. The current GroupTemplateManager uses entryName and entryContent but doesn't label them as 'Baustein Titel'. I'll continue reading GroupTemplateManager to see if it renders external editor and also check TemplatesManager.tsx.",
        "tool": "read_file",
        "args": {
          "path": "components/GroupTemplateManager.tsx",
          "start_line": 260,
          "end_line": 400
        },
        "result": "# components/GroupTemplateManager.tsx (Zeilen 260-353)\n  260:                     className=\"px-2 py-1 text-xs border rounded dark:bg-gray-700 dark:border-gray-600\">\n  261:                     <option value=\"methodik\">Methodik</option>\n  262:                     <option value=\"befund\">Befund</option>\n  263:                     <option value=\"beurteilung\">Beurteilung</option>\n  264:                   </select>\n  265:                 </div>\n  266:                 <TemplateRichTextEditor\n  267:                   value={entryContent} formats={entryFormats}\n  268:                   onChange={(v, f) => { setEntryContent(v); setEntryFormats(f); }}\n  269:                   className=\"textarea w-full px-2 py-1 text-xs border rounded dark:bg-gray-700 dark:border-gray-600 min-h-[60px]\"\n  270:                 />\n  271:                 <div className=\"flex gap-2\">\n  272:                   <button type=\"submit\" disabled={!entryName.trim() || !entryContent.trim()}\n  273:                     className=\"px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50\">\n  274:                     {editingEntryName ? 'Speichern' : 'Hinzufügen'}\n  275:                   </button>\n  276:                   {editingEntryName && (\n  277:                     <button type=\"button\" onClick={resetEntryForm} className=\"px-3 py-1 text-xs bg-gray-300 dark:bg-gray-600 rounded hover:bg-gray-400\">\n  278:                       Abbrechen\n  279:                     </button>\n  280:                   )}\n  281:                 </div>\n  282:               </form>\n  283: \n  284:               {/* Einträge */}\n  285:               <div className=\"space-y-1 max-h-[250px] overflow-y-auto\">\n  286:                 {visibleEntries.map(e => (\n  287:                   <div key={e.id} className=\"flex items-start justify-between gap-2 p-2 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded text-xs\">\n  288:                     <div className=\"flex-1 min-w-0\">\n  289:                       <div className=\"flex items-center gap-1\">\n  290:                         <span className=\"font-medium\">{e.name}</span>\n  291:                         <span className=\"px-1 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded\">{fieldLabels[e.field]}</span>\n  292:                       </div>\n  293:                       <p className=\"text-gray-500 truncate mt-0.5\">{e.content}</p>\n  294:                       {e.addedBy && <p className=\"text-[10px] text-gray-400 mt-0.5\">von {e.addedBy}</p>}\n  295:                     </div>\n  296:                     <div className=\"flex gap-1 shrink-0\">\n  297:                       <button onClick={() => handleEditEntry(e)} className=\"p-1 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded\" title=\"Bearbeiten\">\n  298:                         <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"12\" height=\"12\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" strokeWidth=\"2\"><path d=\"M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z\"/></svg>\n  299:                       </button>\n  300:                       <button onClick={() => handleDeleteEntry(e.name)} className=\"p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded\" title=\"Löschen\">\n  301:                         <svg xmlns=\"http://www.w3.org/2000/svg\" width=\"12\" height=\"12\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" strokeWidth=\"2\"><path d=\"M3 6h18\"/><path d=\"M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6\"/><path d=\"M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2\"/></svg>\n  302:                       </button>\n  303:                     </div>\n  304:                   </div>\n  305:                 ))}\n  306:                 {visibleEntries.length === 0 && <p className=\"text-xs text-gray-400 italic\">Keine Einträge</p>}\n  307:               </div>\n  308: \n  309:               {/* Import-Kandidaten */}\n  310:               {candidates.length > 0 && (\n  311:                 <div className=\"space-y-2 border-t pt-3\">\n  312:                   <d",
        "error": null
      },
      {
        "iteration": 5,
        "thought": "Need to locate the exact component that contains input fields labeled 'Baustein Titel' and 'Baustein Textfeld' to diagnose focus issue. Grep for 'Baustein' globally will help find the UI that uses those terms.",
        "tool": "grep",
        "args": {
          "pattern": "Baustein",
          "glob": "**/*.tsx"
        },
        "result": "app/page.tsx:1: [code-search] // Bearbeitungen) erhalten bleiben und die neuen Sprachbefehle nur ergänzt werden. // Fällt der Feldinhalt weg, dient der ursprüngliche Baustein als Basis. const currentFieldText = getTextForBefundField(template.field).trim();\napp/page.tsx:1: [code-search] {/* Neuen Baustein anlegen Dialog */} {showNewTemplateDialog && (\ncomponents/GroupAdminView.tsx:1: [code-search] Mitglieder <span className=\"text-gray-400\">({members.length})</span> </h4> <p className=\"text-[11px] text-gray-400 mb-2\"> Mitglieder teilen sich die Gruppen-Wörterbücher und Gruppen-Bausteine. </p> <div className=\"flex flex-wrap gap-1.5\"> {…\ncomponents/GroupTemplateManager.tsx:1: [code-search] {/* Entry-Formular */} <form onSubmit={handleAddEntry} className=\"p-3 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-2\"> <h4 className=\"text-xs font-medium\">{editingEntryName ? 'Baustein bearbeiten' : 'Neuen Baustein hinzufügen'}</h4> <div …\ncomponents/TemplatesManager.tsx:1: [code-search] if (data.success) { setSuccess('Textbaustein hinzugefügt'); setName('');\ncomponents/TemplatesManager.tsx:1: [code-search] {template.scope === 'group' && ( <span className=\"text-xs px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 rounded\" title={template.groupName ? `Gruppe: ${template.groupName}` : 'Abteilungs-Baustein…\ncomponents/UserMenu.tsx:1: [code-search] )} {groupDictTab === 'groups' ? 'Gruppen' : groupDictTab === 'dictionary' ? 'Gruppen-Wörterbücher' : 'Gruppen-Bausteine'} </h2>\ncomponents/UserMenu.tsx:1: [code-search] }`}> Bausteine </button>\napp/page.tsx:2013: setError(data.error || 'Fehler beim Anlegen des Bausteins');\napp/page.tsx:2016: setError('Fehler beim Anlegen des Bausteins');\ncomponents/ConfigPanel.tsx:568: <span>Textbausteine (templates): {migrationStatus.templates ? 'OK' : 'Nicht erstellt'}</span>\ncomponents/GroupAdminView.tsx:216: Mitglieder teilen sich die Gruppen-Wörterbücher und Gruppen-Bausteine.\ncomponents/GroupTemplateManager.tsx:201: setSuccess(`${data.imported} Bausteine importiert, ${data.skipped} übersprungen`);\ncomponents/GroupTemplateManager.tsx:228: <div className=\"text-[10px] opacity-60\">{g.memberCount} Mitglieder · {g.entryCount} Bausteine</div>\ncomponents/GroupTemplateManager.tsx:255: <h4 className=\"text-xs font-medium\">{editingEntryName ? 'Baustein bearbeiten' : 'Neuen Baustein hinzufügen'}</h4>\ncomponents/GroupTemplateManager.tsx:313: <h4 className=\"text-xs font-medium text-gray-500\">Benutzer-Bausteine importieren</h4>\napp/page.tsx:1762: // Template-Modus: Textbaustein mit diktierten Änderungen kombinieren\napp/page.tsx:1781: // Aufnahme einmal eingefroren, daher muss der aktuelle Baustein-Zustand über Refs\napp/page.tsx:1790: // Markiert, dass nach dem Leeren der VAD-Commit-Queue in den Baustein eingearbeitet werden soll.\napp/page.tsx:1819: // Fällt der Feldinhalt weg, dient der ursprüngliche Baustein als Basis.\napp/page.tsx:1872: // Den aktiven Baustein-Kontext auf den bereits ausgefüllten Stand aktualisieren,\napp/page.tsx:2892: // Auto-Einarbeiten-Modus: Das Feld zeigt weiterhin den unveränderten Baustein.\napp/page.tsx:2894: // über die LLM-Anpassung an die richtige Stelle im Baustein eingearbeitet.\napp/page.tsx:2922: // jetzt einmalig den gesammelten Text in den Baustein einarbeiten.",
        "error": null
      },
      {
        "iteration": 6,
        "thought": "Need to locate the exact component that contains input fields labeled 'Baustein Titel' and 'Baustein Textfeld' to identify focus issue. grep for 'Baustein Titel' across repo.",
        "tool": "grep",
        "args": {
          "pattern": "Baustein Titel"
        },
        "result": "app/page.tsx:1: [code-search] // Bearbeitungen) erhalten bleiben und die neuen Sprachbefehle nur ergänzt werden. // Fällt der Feldinhalt weg, dient der ursprüngliche Baustein als Basis. const currentFieldText = getTextForBefundField(template.field).trim();\napp/page.tsx:1: [code-search] {/* Neuen Baustein anlegen Dialog */} {showNewTemplateDialog && (\napp/page.tsx:1: [code-search] className=\"text-[11px] px-2 py-0.5 w-36 border border-gray-200 dark:border-gray-700 rounded bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-400 placeholder-gray-400 dark:placeholder-gray-500 focus:border-purple-400 focus:ring-1 focus…\napp/page.tsx:1: [code-search] onChange={(e) => setTargetWindowPattern(e.target.value)} title=\"Teil des Fenstertitels der Ziel-App (z. B. 'Radiologie'). Der Injector findet das Fenster auch nach Fokusverlust wieder.\" />\ncomponents/BugReportForm.tsx:1: [code-search] setStatus('error'); setResultMessage('Bitte füllen Sie Titel und Beschreibung aus.'); return;\ncomponents/BugReportForm.tsx:1: [code-search] <label className=\"block space-y-1.5\"> <span className=\"text-sm font-medium text-gray-700 dark:text-gray-200\">Titel *</span> <input\ncomponents/GroupAdminView.tsx:1: [code-search] Mitglieder <span className=\"text-gray-400\">({members.length})</span> </h4> <p className=\"text-[11px] text-gray-400 mb-2\"> Mitglieder teilen sich die Gruppen-Wörterbücher und Gruppen-Bausteine. </p> <div className=\"flex flex-wrap gap-1.5\"> {…\ncomponents/GroupTemplateManager.tsx:1: [code-search] {/* Entry-Formular */} <form onSubmit={handleAddEntry} className=\"p-3 bg-gray-50 dark:bg-gray-800 rounded-lg space-y-2\"> <h4 className=\"text-xs font-medium\">{editingEntryName ? 'Baustein bearbeiten' : 'Neuen Baustein hinzufügen'}</h4> <div …\ncomponents/TemplatesManager.tsx:1: [code-search] if (data.success) { setSuccess('Textbaustein hinzugefügt'); setName('');\ncomponents/TemplatesManager.tsx:1: [code-search] {template.scope === 'group' && ( <span className=\"text-xs px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 rounded\" title={template.groupName ? `Gruppe: ${template.groupName}` : 'Abteilungs-Baustein…\ncomponents/UserMenu.tsx:1: [code-search] )} {groupDictTab === 'groups' ? 'Gruppen' : groupDictTab === 'dictionary' ? 'Gruppen-Wörterbücher' : 'Gruppen-Bausteine'} </h2>\ncomponents/UserMenu.tsx:1: [code-search] }`}> Bausteine </button>\napp/api/feedback/route.ts:1: [code-search] const normalizedDescription = (description || '').trim(); if (!normalizedType || !normalizedTitle || !normalizedDescription) { return NextResponse.json({ error: 'Typ, Titel und Beschreibung sind erforderlich.' }, { status: 400 }); } const t…\napp/api/templates/adapt/route.ts:1: [code-search] - adaptedText enthält den vollständigen angepassten Textbaustein - unusedText enthält nur die diktierten Textteile, die inhaltlich NICHT sinnvoll in den Baustein eingebaut werden konnten - Wenn alles sinnvoll eingebaut wurde, setze unusedTe…\napp/api/templates/adapt/route.ts:1: [code-search] // Entfernt Markdown-Auszeichnungen aus dem LLM-Ergebnis, die im Original-Baustein // nicht vorkamen. So bleibt das Layout des Bausteins erhalten, falls das Modell\napp/api/templates/route.ts:1: [code-search] if (result.success) { return NextResponse.json({ success: true, message: 'Textbaustein hinzugefügt', id: result.id }); }\napp/api/templates/route.ts:1: [code-search] if (result.success) { return NextResponse.json({ success: true, message: 'Textbaustein aktualisiert' }); }\nlib/injectClient.ts:1: [code-search] export interface TargetWindowConfig { /** Teil-String, der im Fenstertitel der Ziel-App vorkommen muss (z. B. \"Radiologie\") */ windowTitle?: string;\nlib/injectClient.ts:1: [code-search] * Der Host merkt sich das Fenster, in das zuletzt erfolgreich Text injected wurde. * Mit dieser Funktion kann zusätzlich ein Fenster-Titel-Pattern oder Klassenname * hinterlegt werden, um das Ziel-Fenster auch nach einem Neustart oder Fenst…\nlib/templatesDb.ts:1: [code-search]",
        "error": null
      }
    ],
    "tokens": {
      "prompt": 33767,
      "completion": 3154
    }
  },
  "markdown": "> System: Schreibdienst (ID 2) · Repo: andreasknopke/Schreibdienst\n\n**Zusammenfassung:** Fix focus jump from template title input to rich text editor in GroupTemplateManager. Prevent the editor from stealing focus on state updates when the user is typing in the title field.\n\n**Aufgabe:**\nIn components/GroupTemplateManager.tsx, locate the title input (placeholder 'Name (z.B. CCT)') and the TemplateRichTextEditor. Diagnose why typing in the title causes focus to move to the editor. Likely cause: a re-render triggers the rich text editor’s auto-focus behavior or the input loses focus because it is re-created. Implement a fix: if the title input uses a controlled state with onChange, ensure no unnecessary re-renders of the editor. Optionally, store a ref to the title input and restore focus after any asynchronous state updates that might cause the editor to mount/update. Consider adding an onFocus callback to track focus state and prevent the editor from programmatically focusing while the title is focused. Ensure that the fix does not break the editor's normal focus behavior when the user intentionally clicks into it.\n\n**Change-Kind:** `extend`\n\n**Allowed Files:**\n- `components/GroupTemplateManager.tsx`\n\n**Schritte:**\n1. **Locate the title input and rich text editor instances**\n   - Find the JSX for the input with placeholder 'Name (z.B. CCT)' and the <TemplateRichTextEditor> component. Note any props passed to the editor (e.g., autoFocus, onFocus, value). Identify the state variable used for the title and its setter.\n   - Dateien: components/GroupTemplateManager.tsx\n2. **Identify cause of focus jump**\n   - Check if the rich text editor has an autoFocus prop or an internal useEffect that focuses on mount/update. Check if the title input is remounted on state change (e.g., due to conditional rendering or missing keys). Look for any onTitleChange handler that triggers state updates that cause the editor to re-render and steal focus.\n   - Dateien: components/GroupTemplateManager.tsx\n3. **Implement focus stability fix**\n   - If the editor auto-focuses on mount, pass a prop like `autoFocus={false}` or conditionally enable it. If the editor focuses on every update due to a useEffect, add a guard that only focuses if the user has not interacted with the title input recently. Use a ref to the title input and a state flag to track which field was last focused. In the editor's onFocus, set the flag; in the title input's onFocus, set the flag. Then in the effect that might steal focus, check the flag. If the editor does not expose props for this, use a wrapper or modify the title change handler to prevent unnecessary re-renders of the editor (e.g., debounce state updates). Alternatively, after the title state update, schedule a focus return to the title input using requestAnimationFrame if the editor received focus unintendedly.\n   - Dateien: components/GroupTemplateManager.tsx\n4. **Test and verify**\n   - Simulate typing in the title field; ensure the cursor remains there and the editor does not steal focus unintentionally. Verify that clicking into the editor still functions normally.\n   - Dateien: components/GroupTemplateManager.tsx\n\n**Constraints:**\n- Nur GroupTemplateManager.tsx aendern (keine anderen Komponenten wie TemplateRichTextEditor.tsx, da deren Aenderungen unbeabsichtigte Seiteneffekte verursachen koennten).\n- Keine neuen Props an Komponenten ausserhalb hinzufuegen, es sei denn, sie werden in GroupTemplateManager selbst genutzt und sind optional.\n- Der Title-Input (Name-Feld) muss ein Controlled Component bleiben (keine Umstellung auf Uncontrolled).\n- Keine Aenderung der Export-Signatur von GroupTemplateManager.\n\n**Symbols to preserve:**\n- `components/GroupTemplateManager.tsx` :: `GroupTemplateManager`\n\n**Risiken:**\n- Annahme: Der Rich-Text-Editor hat ein internes Focus-Verhalten (z.B. autoFocus-Prop oder useEffect), das bei jedem Re-Render fokussiert. Ohne Einsicht in TemplateRichTextEditor.tsx koennten Aenderungen dort noetig sein, falls Props nicht ausreichen. Risiko: Fix koennte das Editor-Fokusverhalten bei normaler Nutzung beeintraechtigen.\n- Falls der Fokus-Sprung durch einen asynchronen State-Update ausgeloest wird, der den Input re-mounted, koennte ein key-Attribut oder ein anderer Stabilitaetsansatz noetig sein.\n\n**Aufwand:** S\n\n**Verifizierte Fakten (Architect-Tools):**\n- GroupTemplateManager has an entry form with input placeholder 'Name (z.B. CCT)' and a TemplateRichTextEditor, but no label 'Baustein Titel'.\n\n_Basierend auf 6 Tool-Call(s)._\n\n**Verbotene Annahmen (per Tool als nicht-existent verifiziert):**\n- No exact string 'Baustein Titel' found in GroupTemplateManager.tsx",
  "_artifacts": [
    {
      "kind": "implementation_plan",
      "filename": "implementation_plan.md",
      "content": "**Zusammenfassung:** Fix focus jump from template title input to rich text editor in GroupTemplateManager. Prevent the editor from stealing focus on state updates when the user is typing in the title field.\n\n**Aufgabe:**\nIn components/GroupTemplateManager.tsx, locate the title input (placeholder 'Name (z.B. CCT)') and the TemplateRichTextEditor. Diagnose why typing in the title causes focus to move to the editor. Likely cause: a re-render triggers the rich text editor’s auto-focus behavior or the input loses focus because it is re-created. Implement a fix: if the title input uses a controlled state with onChange, ensure no unnecessary re-renders of the editor. Optionally, store a ref to the title input and restore focus after any asynchronous state updates that might cause the editor to mount/update. Consider adding an onFocus callback to track focus state and prevent the editor from programmatically focusing while the title is focused. Ensure that the fix does not break the editor's normal focus behavior when the user intentionally clicks into it.\n\n**Change-Kind:** `extend`\n\n**Allowed Files:**\n- `components/GroupTemplateManager.tsx`\n\n**Schritte:**\n1. **Locate the title input and rich text editor instances**\n   - Find the JSX for the input with placeholder 'Name (z.B. CCT)' and the <TemplateRichTextEditor> component. Note any props passed to the editor (e.g., autoFocus, onFocus, value). Identify the state variable used for the title and its setter.\n   - Dateien: components/GroupTemplateManager.tsx\n2. **Identify cause of focus jump**\n   - Check if the rich text editor has an autoFocus prop or an internal useEffect that focuses on mount/update. Check if the title input is remounted on state change (e.g., due to conditional rendering or missing keys). Look for any onTitleChange handler that triggers state updates that cause the editor to re-render and steal focus.\n   - Dateien: components/GroupTemplateManager.tsx\n3. **Implement focus stability fix**\n   - If the editor auto-focuses on mount, pass a prop like `autoFocus={false}` or conditionally enable it. If the editor focuses on every update due to a useEffect, add a guard that only focuses if the user has not interacted with the title input recently. Use a ref to the title input and a state flag to track which field was last focused. In the editor's onFocus, set the flag; in the title input's onFocus, set the flag. Then in the effect that might steal focus, check the flag. If the editor does not expose props for this, use a wrapper or modify the title change handler to prevent unnecessary re-renders of the editor (e.g., debounce state updates). Alternatively, after the title state update, schedule a focus return to the title input using requestAnimationFrame if the editor received focus unintendedly.\n   - Dateien: components/GroupTemplateManager.tsx\n4. **Test and verify**\n   - Simulate typing in the title field; ensure the cursor remains there and the editor does not steal focus unintentionally. Verify that clicking into the editor still functions normally.\n   - Dateien: components/GroupTemplateManager.tsx\n\n**Constraints:**\n- Nur GroupTemplateManager.tsx aendern (keine anderen Komponenten wie TemplateRichTextEditor.tsx, da deren Aenderungen unbeabsichtigte Seiteneffekte verursachen koennten).\n- Keine neuen Props an Komponenten ausserhalb hinzufuegen, es sei denn, sie werden in GroupTemplateManager selbst genutzt und sind optional.\n- Der Title-Input (Name-Feld) muss ein Controlled Component bleiben (keine Umstellung auf Uncontrolled).\n- Keine Aenderung der Export-Signatur von GroupTemplateManager.\n\n**Symbols to preserve:**\n- `components/GroupTemplateManager.tsx` :: `GroupTemplateManager`\n\n**Risiken:**\n- Annahme: Der Rich-Text-Editor hat ein internes Focus-Verhalten (z.B. autoFocus-Prop oder useEffect), das bei jedem Re-Render fokussiert. Ohne Einsicht in TemplateRichTextEditor.tsx koennten Aenderungen dort noetig sein, falls Props nicht ausreichen. Risiko: Fix koennte das Editor-Fokusverhalten bei normaler Nutzung beeintraechtigen.\n- Falls der Fokus-Sprung durch einen asynchronen State-Update ausgeloest wird, der den Input re-mounted, koennte ein key-Attribut oder ein anderer Stabilitaetsansatz noetig sein.\n\n**Aufwand:** S\n\n**Verifizierte Fakten (Architect-Tools):**\n- GroupTemplateManager has an entry form with input placeholder 'Name (z.B. CCT)' and a TemplateRichTextEditor, but no label 'Baustein Titel'.\n\n_Basierend auf 6 Tool-Call(s)._\n\n**Verbotene Annahmen (per Tool als nicht-existent verifiziert):**\n- No exact string 'Baustein Titel' found in GroupTemplateManager.tsx"
    }
  ],
  "_extra_info_used": "Antworten des menschlichen Approvers auf offene Fragen aus Stage \"security\":\n1. Is it permissible to include the specific internal domain/URL in the technical documentation for the architect?\n\nAntwort:\nja"
}
```
