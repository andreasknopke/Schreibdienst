# Formatierungsregeln – Schreibdienst

Diese Datei listet **alle** Formatierungsvorschriften, die während der Diktatverarbeitung angewendet werden – **ausschließlich deterministisch (Code)**. Die LLM-Prompts enthalten **keine** Diktat-Befehl-Fallbacks mehr (Trennung per 2025/07). Ein Programmierer kann hier auf einen Blick sehen, welche Regeln existieren und wo sie implementiert sind.

> **Fundort der Regeln:** `formattings/` (deterministische Code-Regeln), `prompts/` (nur noch Zahlen, Einheiten, Fachbegriffe)

---

## 1. Diktat-Sprachbefehle (nur deterministisch)

Alle Befehle werden in `lib/textFormatting.ts` verarbeitet (geladen aus `formattings/`). Die LLM-Prompts enthalten KEINE Fallbacks mehr.

### 1.1 Absätze & Zeilenumbrüche

| Gesprochen | Ersetzung | Fundort |
|-----------|-----------|---------|
| `neuer Absatz` / `nächster Absatz` / `Absatz` | `\n\n` (Leerzeile) | `formattings/control-words.ts:16-18` |
| `neue Zeile` / `nächste Zeile` / `Zeilenumbruch` | `\n` | `formattings/control-words.ts:19-20` |

### 1.2 Aufzählungen

| Gesprochen | Ersetzung | Fundort |
|-----------|-----------|---------|
| `nächster Anstrich` / `Anstrich` | `\n- ` (Bullet) | `formattings/control-words.ts:32-33` |
| `nächster Punkt eingerückt` | `\n  - ` | `formattings/control-words.ts:28` |
| `eingerückt` / `rücke ein` / `einrücken` | `\n  ` (Einzug) | `formattings/control-words.ts:29-31` |
| `Punkt eins` / `Punkt zwei` … | `\n1. ` / `\n2. ` | `lib/textFormatting.ts:1174` |
| `Nächster Punkt` / `weiterer Punkt` | Nächste Zahl + `\nX. ` | `lib/textFormatting.ts:1231` |
| `erstens` / `zweitens` … | `\n1. ` … `\n10. ` | `lib/textFormatting.ts:1204` |
| `Aufzählung beginnen` / `… beenden` | `\n` | `lib/textFormatting.ts:1137-1146` |

### 1.3 Satzzeichen

| Gesprochen | Ersetzung | Fundort |
|-----------|-----------|---------|
| `Punkt` (eigenständig) | `.` | `formattings/control-words.ts:39-42`* |
| `Komma` / `Beistrich` | `,` | `formattings/online-commands.ts:53` (nur Online) |
| `Doppelpunkt` | `:` | `formattings/control-words.ts:56` |
| `Semikolon` / `Strichpunkt` | `;` | `formattings/control-words.ts:57` |
| `Fragezeichen` | `?` | `formattings/control-words.ts:58` |
| `Ausrufezeichen` | `!` | `formattings/control-words.ts:59` |

\* `Punkt` und `Komma` werden im Batch-Pfad z. T. dem LLM überlassen (zu mehrdeutig).

### 1.4 Klammern & Anführungszeichen

| Gesprochen | Ersetzung | Fundort |
|-----------|-----------|---------|
| `Klammer auf` / `klammern auf` | `(` | `formattings/control-words.ts:36-45` |
| `Klammer zu` / `klammern zu` | `)` | `formattings/control-words.ts:36-45` |
| `Anführungszeichen auf` / `oben` | `„` / `"` | `formattings/control-words.ts:62-65` |

### 1.5 Bruch & Uhrzeit

| Gesprochen | Ersetzung | Fundort |
|-----------|-----------|---------|
| `80 zu 100` → `80/100` | `/` | `formattings/control-words.ts:68` |
| `10 Uhr 15` → `10:15` | `:` | `formattings/control-words.ts:71-74` |

### 1.6 Löschbefehle

| Gesprochen | Ersetzung | Fundort |
|-----------|-----------|---------|
| `lösche das letzte Wort` / `letztes Wort löschen` | Wort entfernen | `formattings/delete-patterns.ts:12-16` |
| `lösche den letzten Satz` / `letzten Satz löschen` | Satz entfernen | `formattings/delete-patterns.ts:19-21` |
| `lösche den letzten Absatz` | Absatz entfernen | `formattings/delete-patterns.ts:24-25` |

---

## 2. Zahlen, Einheiten & Maße (nur LLM)

Ausschließlich per LLM-Prompt umgesetzt. Deterministisch werden nur bereits als Ziffern vorliegende Werte formatiert.

| Regel | Beispiel | Fundort |
|-------|----------|---------|
| Ausgeschriebene Zahlen → Ziffern | `acht` → `8` | `prompts/correct/system-prompt.ts:38` |
| Maßeinheiten abkürzen | `acht Millimeter` → `8 mm` | `system-prompt.ts:40` |
| Dezimalzahlen | `acht Komma sechs Prozent` → `8,6%` | `system-prompt.ts:41` |
| Größenangaben | `sechzehn mal zehn Millimeter` → `16 x 10 mm` | `system-prompt.ts:42` |
| Jahreszahlen | `neunzehnhunderteinundneunzig` → `1991` | `system-prompt.ts:43` |
| Medizinische Scores | `Fazekas zwei` → `Fazekas 2` | `system-prompt.ts:44` |
| Datumsangaben | `achtzehnter September` → `18.09.` | `system-prompt.ts:36` |
| Uhrzeit (gesprochen) | `drei uhr fünfzehn` → `3:15` | `system-prompt.ts:40-44` |

### Deterministische Ausnahme: Uhrzeit mit Ziffern

```typescript
// formattings/control-words.ts:71-74
"10 Uhr 15"   → "10:15"  ✅ (Ziffern vorhanden)
"drei Uhr fünfzehn" → bleibt stehen ⚠️ (nur vom LLM erkannt)
```

### Deterministische Ausnahme: Medizinische Abkürzungen

```typescript
// lib/textFormatting.ts:71-250
"zweimal täglich"    → "2x/d",  "dreimal täglich"    → "3x/d"
"zur Nacht"          → "z.N.",  "einmalig"           → "1x"
```

---

## 3. Medizinische Fachbegriffe (Wörterbuch + LLM)

### Deterministisch: Wörterbücher in `lib/dictionaryDb.ts` / `lib/standardDictionaryDb.ts`

Freie Einträge `wrong → correct` + phonetische Ähnlichkeitssuche (`lib/phoneticMatch.ts`).

### LLM: Bekannte Transkriptionsfehler (in allen `prompts/correct/*.ts`)

`Scholecystitis` → `Cholecystitis`, `labarchemisch` → `laborchemisch`, `Lekorräume` → `Liquorräume` u. a.

---

## 4. Feld-Steuerbefehle (deterministisch)

| Gesprochen | Wirkung | Fundort |
|-----------|---------|---------|
| `Methodik:` | Wechselt in Feld Methodik | `page.tsx` (Parsing) |
| `Befund:` | Wechselt in Feld Befund | `page.tsx` (Parsing) |
| `Beurteilung:` | Wechselt in Feld Beurteilung | `page.tsx` (Parsing) |

---

## 5. Rich-Text-Formatierung (nur Online/VAD-Pfad)

| Gesprochen | Wirkung | Fundort |
|-----------|---------|---------|
| `Auswahl fett/kursiv/unterstrichen` | Formatiert Auswahl | `page.tsx:495` |
| `Wort fett` / `Satz kursiv` | Letztes Wort / Satz | `page.tsx:504` |
| `fett beginnen` / `fett ende` | Inline-Toggle | `page.tsx:571` |

---

## 6. Verarbeitungsreihenfolge

```
Whisper-Output
    ↓
1. Füllwörter entfernen ("ähm", "äh")         ← textFormatting.ts
    ↓
2. Diktat-Sprachbefehle (Absätze, Klammern,
   Satzzeichen, Aufzählungen, Löschbefehle)   ← formattings/ + textFormatting.ts (deterministisch)
    ↓
3. fixConcatenatedPunkt ("stehenpunkt" → "stehen. ")  ← textFormatting.ts
    ↓
4. Wörterbuch-Korrekturen                    ← dictionaryDb.ts / phoneticMatch.ts
    ↓
5. LLM-Korrektur                             ← prompts/correct/*.ts
   - Zahlen in Ziffern
   - Medizinische Fachbegriffe
   - Grammatik & Rechtschreibung
   (KEINE Diktat-Befehl-Fallbacks mehr)
    ↓
6. stripIntroducedMarkdown (nur Baustein)    ← templates/adapt/route.ts
```

---

## 7. Regel-Dateien im Überblick

| Pfad | Enthält |
|------|---------|
| `formattings/control-words.ts` | Absätze, Klammern, Satzzeichen, Uhrzeit, Brüche |
| `formattings/delete-patterns.ts` | Löschbefehle für Wort/Satz/Absatz |
| `formattings/number-words.ts` | Zahlwort→Ziffer-Mapping für Aufzählungen |
| `formattings/online-commands.ts` | Befehlsmuster für Live/VAD-Pfad |
| `prompts/correct/system-prompt.ts` | Zahlen, Einheiten, Fachbegriffe (Einzelfeld) |
| `prompts/correct/chunk-system-prompt.ts` | Zahlen, Einheiten, Fachbegriffe (Chunks) |
| `prompts/correct/befund-system-prompt.ts` | Zahlen, Einheiten, Fachbegriffe (3 Felder) |
| `prompts/offline/recorrect-system-prompt.ts` | Basis-Korrektur (Offline) |
| `prompts/worker/dictation-processor-prompt.ts` | Zahlen, Daten, Fachbegriffe (Worker) |
| `prompts/worker/dictation-processor-chunk-prompt.ts` | Zahlen, Daten, Fachbegriffe (Worker-Chunks) |
