# Schritt-für-Schritt-Umsetzungsplan

Jeder Schritt ist so bemessen, dass er nach Fertigstellung **direkt getestet**
werden kann – entweder im UI oder via Build-Kontrolle.

---

## Schritt 1: Datenmodell `EditorBlock` einführen

**Ziel**: Einen neuen Typ `EditorBlock` definieren und die Single-Template-
States durch eine Block-Liste ersetzen, **ohne das Verhalten zu ändern**.

### Was passiert

1. In `app/page.tsx` (oder einer neuen Datei `lib/editorBlocks.ts`) den Typ
   `EditorBlock` definieren:
   ```typescript
   interface EditorBlock {
     id: string;                // UUID, stabil für Key/Ref
     type: 'baustein' | 'freitext';
     templateId?: number;       // Verweis auf das Template (bei Baustein)
     field: BefundField;
     originalContent: string;   // Inhalt bei Anlage (für LLM-Adaption)
     currentText: string;       // aktueller Text im Editor
     formatRanges: RichTextFormatRange[];
   }
   ```

2. State einführen: `editorBlocks: EditorBlock[]` – **pro Feld** getrennt,
   z. B. `editorBlocksByField: Record<BefundField, EditorBlock[]>`.

3. Die **bisherigen Feld-States** (`transcript`, `methodik`, `beurteilung`)
   bleiben zunächst parallel bestehen. Beim Start wird aus `transcript` etc.
   ein initialer `EditorBlock` vom Typ `freitext` erzeugt.

4. `activeTemplateContext` bleibt zunächst erhalten – wird erst in Schritt 5
   durch `activeBlockId` ersetzt.

### Test

- App startet ohne Fehler.
- Alle bestehenden Funktionen (Diktat, Template einfügen) funktionieren
  unverändert.

---

## Schritt 2: Seitenleiste "Bausteine" links neben dem Editor

**Ziel**: Eine schmale Leiste links im Editor, die alle Blöcke des aktuellen
Feldes auflistet.

### Was passiert

1. Neue Komponente `EditorBlockSidebar.tsx` bauen:
   - Zeigt für jeden Block einen Eintrag mit Namen/Typ
   - Buttons: `+ Baustein hinzufügen` (öffnet Template-Auswahl)
   - Buttons: Block löschen (Papierkorb-Icon)
   - Buttons (später): Drag-Handle zum Verschieben

2. Die Sidebar in `RichTextDictationEditor.tsx` oder `page.tsx` einbinden,
   links neben dem Lexical-Editor.

3. Ein Baustein wird in der Sidebar als `📋 Baustein: <Template-Name>`
   angezeigt, ein Freitext-Block als `✏️ Freitext`.

### Test

- Nach Laden eines Feldes sieht man links die Block-Liste.
- Bei einem frischen Befund gibt es genau einen `✏️ Freitext`-Block.
- Der `+ Baustein hinzufügen`-Knopf ist sichtbar.

---

## Schritt 3: Block-Visualisierung im Editor (aktiv/inaktiv)

**Ziel**: Im Lexical-Editor werden Blöcke visuell getrennt dargestellt. Der
aktive Block ist hell, inaktive Blöcke sind ausgegraut.

### Was passiert

1. Im Editor werden die Blöcke hintereinander gerendert, getrennt durch eine
   dünne Trennlinie oder einen Abstandshalter.

2. **Aktiver Block**:
   - Normale Darstellung (schwarzer Text)
   - Diktat landet hier

3. **Inaktive Blöcke**:
   - `opacity: 0.35` + `user-select: none`
   - Grau überlagert (CSS-Klasse `.editor-block--inactive`)
   - Text **nicht** editierbar (contentEditable deaktiviert)
   - Dient nur als Lesekontext

4. Der aktive Block wird durch eine State-Variable gesteuert:
   `activeBlockId: string | null`

### Technische Umsetzung

- In `RichTextDictationEditor.tsx` die Lexical-`EditorState` so aufbereiten,
  dass jeder Block als eigener `<div>` mit der entsprechenden CSS-Klasse
  gerendert wird.
- Alternativ: Zwei Lexical-Editoren nebeneinander (einer pro Block?), aber
  ein Editor mit visueller Trennung ist UI-technisch sauberer.

### Test

- Zwei Blöcke im Editor sichtbar: einer aktiv (hell), einer inaktiv (grau).
- Klick in den inaktiven Block macht nichts (kein Cursor).
- Klick in den aktiven Block setzt den Cursor normal.

---

## Schritt 4: "Baustein einfügen" erzeugt neuen Block

**Ziel**: Statt den Baustein in den vorhandenen Text zu mergen (bisheriges
Verhalten), wird ein **neuer Block** vom Typ `baustein` ans Ende der
Block-Liste angehängt. Der neue Block wird automatisch **aktiv**.

### Was passiert

1. `handleTemplateSelection` / `insertTemplateIntoField` anpassen:
   - Statt `setFieldTextWithFormats(field, mergedText, ...)` → einen neuen
     `EditorBlock` ans Ende von `editorBlocksByField[field]` anhängen.
   - `activeBlockId` auf die ID des neuen Blocks setzen.

2. Der neue Block erscheint sofort im Editor (Schritt 3) und in der Sidebar
   (Schritt 2).

3. Der vorher aktive Block wird inaktiv (grau).

### Änderungen in `page.tsx`

- `insertTemplateIntoField` wird zu einer Funktion, die einen Block erzeugt
  statt Text zu mischen.
- Der bestehende Feldtext bleibt unverändert – er wird nicht gelöscht.

### Test

1. Feld hat Freitext (z. B. "Patient klagt über Schmerzen").
2. Benutzer wählt Baustein "Kniebefund" aus.
3. → Neuer Block `📋 Kniebefund` erscheint unter dem Freitext.
4. → Neuer Block ist aktiv (hell).
5. → Alter Freitext-Block ist inaktiv (grau).

---

## Schritt 5: Diktat geht nur in den aktiven Block

**Ziel**: Beim Diktieren im Baustein-Modus wird nur der **aktive Block**
an `/api/templates/adapt` übergeben. Inaktive Blöcke werden ignoriert.

### Was passiert

1. `activeTemplateContext` wird durch `activeBlockId` ersetzt.

2. Die Dictation-Pipeline (in `page.tsx`, Zeilen um 2975–3020) prüft:
   - Gibt es einen aktiven Block?
   - Vom aktiven Block: `type` ist `baustein`?
   - Wenn ja: `activeBlock.originalContent` als Template-Basis + Diktat an
     `/api/templates/adapt`
   - Wenn `freitext`: Diktat direkt als neuen Text in `currentText`
     schreiben (kein LLM-Aufruf nötig)

3. Die bisherigen Callbacks (`applyTemplateChangesRef`, `templateAudioBufferRef`
   etc.) werden auf Block-Ebene umgestellt.

4. `template.fields`-Filter: Aktuell wird nur nach `template.field === currentField`
   gefiltert. Das bleibt gleich – Bausteine werden immer passend zum aktuellen
   Feld ausgewählt.

### Test

1. Block A (aktiv): Baustein "Kniebefund" – Diktat "zeigt eine Schwellung"
   → LLM merged: "Kniebefund: zeigt eine Schwellung"
2. Block B (inaktiv): Baustein "Röntgen" – bleibt unverändert
3. Block C (inaktiv): Freitext "Patient ist wach" – bleibt unverändert

---

## Schritt 6: Block-Wechsel per Sidebar-Klick

**Ziel**: Klick auf einen inaktiven Block in der Sidebar macht diesen zum
aktiven Block (und den bisher aktiven inaktiv).

### Was passiert

1. In `EditorBlockSidebar.tsx`: Klick auf einen Block-Eintrag setzt
   `activeBlockId`.

2. Der Editor rendert neu: Der gewählte Block wird hell, der vorherige grau.

3. Der Cursor springt in den neu aktiven Block.

### Test

1. Block A aktiv, Block B inaktiv.
2. Klick auf Block B in der Sidebar.
3. → Block A wird grau, Block B wird hell.
4. → Diktat geht jetzt in Block B.

---

## Schritt 7: Initialen Freitext-Block beim Feldwechsel erzeugen

**Ziel**: Wechselt der Benutzer das Feld (z. B. von Befund zu Methodik), wird
für das neue Feld automatisch ein initialer `EditorBlock` (Typ `freitext`)
angelegt, falls noch keiner existiert.

### Was passiert

1. Beim Feldwechsel: Prüfen, ob `editorBlocksByField[newField]` existiert.
   - Wenn nein: aus dem aktuellen Feldtext (`transcript`/`methodik`/`beurteilung`)
     einen `freitext`-Block erzeugen.
   - Wenn ja: Block-Liste aus dem State laden.

2. Der erste Block wird automatisch aktiv.

### Test

- Wechsel von Befund zu Methodik → ein leerer `✏️ Freitext`-Block erscheint.
- Wechsel zurück zu Befund → vorherige Blöcke sind noch da.

---

## Schritt 8 (optional): Block löschen

**Ziel**: Blöcke können über die Sidebar gelöscht werden (Papierkorb-Icon).

### Was passiert

1. In `EditorBlockSidebar.tsx` bei jedem Block einen 🗑-Button.
2. Klick: Block aus `editorBlocksByField[field]` entfernen.
3. Wenn der gelöschte Block der aktive war: den letzten verbleibenden Block
   aktiv setzen, oder einen neuen Freitext-Block anlegen.
4. Vor dem Löschen kurze Bestätigung (Confirm-Dialog).

### Test

- Block löschen → verschwindet aus Editor und Sidebar.
- Letzten Block löschen → neuer Freitext-Block wird angelegt.
- Aktiven Block löschen → erster anderer Block wird aktiv.

---

## Schritt 9 (optional): Block-Reihenfolge ändern (Drag & Drop)

**Ziel**: Blöcke per Drag & Drop in der Sidebar sortieren.

### Was passiert

1. In `EditorBlockSidebar.tsx`: Drag-Handle (≡) an jedem Block.
2. `onDragEnd` aktualisiert die Reihenfolge in `editorBlocksByField[field]`.
3. Editor rendert Blöcke in der neuen Reihenfolge.

### Test

- Block per Drag nach oben/unten ziehen.
- Reihenfolge im Editor entspricht der Sidebar.

---

## Zusammenfassung der Abhängigkeiten

```
Schritt 1: Datenmodell (fundamental)
  └── Schritt 2: Seitenleiste (UI)
  │     └── Schritt 3: Block-Visualisierung (Editor)
  │           └── Schritt 4: Baustein einfügen → neuer Block
  │                 └── Schritt 5: Diktat in aktiven Block
  │                       └── Schritt 6: Block-Wechsel
  │                             └── Schritt 7: Feldwechsel
  │                                   ├── Schritt 8: Block löschen
  │                                   └── Schritt 9: Drag & Drop
```

Die Schritte 1–7 sind die **Phase 1** (Must-Have), Schritte 8–9 sind
**Phase 2** (Nice-to-Have).
