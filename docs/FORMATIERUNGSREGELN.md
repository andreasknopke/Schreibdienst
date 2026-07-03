# Formatierungsregeln – Schreibdienst

Diese Datei listet **alle** Formatierungsvorschriften, die während der Diktatverarbeitung angewendet werden – sowohl **deterministisch (Code)** als auch **per LLM-Prompt**. Ein Programmierer kann hier auf einen Blick sehen, welche Regeln existieren und wo sie implementiert sind.

---

## 1. Diktat-Sprachbefehle (deterministisch + LLM)

Diese Befehle werden **primär deterministisch** in `lib/textFormatting.ts` verarbeitet (schnell, billig). Das LLM in `prompts/correct/` und `prompts/worker/` kennt sie als **Fallback**.

### 1.1 Absätze & Zeilenumbrüche

| Gesprochen | Ersetzung | Deterministisch | LLM-Prompt |
|-----------|-----------|-----------------|------------|
| `neuer Absatz` / `nächster Absatz` / `Absatz` | `\n\n` (Leerzeile) | ✅ `textFormatting.ts:547` | ✅ Alle Prompts |
| `neue Zeile` / `nächste Zeile` / `Zeilenumbruch` | `\n` | ✅ `textFormatting.ts:553` | ✅ Alle Prompts |

### 1.2 Aufzählungen

| Gesprochen | Ersetzung | Deterministisch | LLM-Prompt |
|-----------|-----------|-----------------|------------|
| `nächster Anstrich` / `Anstrich` | `\n- ` (Bullet) | ✅ `textFormatting.ts:566` | ❌ |
| `nächster Punkt eingerückt` | `\n  - ` | ✅ `textFormatting.ts:556` | ❌ |
| `eingerückt` / `rücke ein` / `einrücken` | `\n  ` (Einzug) | ✅ `textFormatting.ts:557` | ❌ |
| `Punkt eins` / `Punkt zwei` … | `\n1. ` / `\n2. ` | ✅ `textFormatting.ts:1174` | ❌ |
| `Nächster Punkt` / `weiterer Punkt` | Nächste Zahl + `\nX. ` | ✅ `textFormatting.ts:1231` | ❌ |
| `erstens` / `zweitens` … `zehntens` | `\n1. ` … `\n10. ` | ✅ `textFormatting.ts:1204` | ❌ |
| `Aufzählung beginnen` / `Liste beginnen` | `\n` | ✅ `textFormatting.ts:1137` | ❌ |
| `Aufzählung beenden` / `Liste beenden` | `\n` | ✅ `textFormatting.ts:1146` | ❌ |

### 1.3 Satzzeichen

| Gesprochen | Ersetzung | Deterministisch | LLM-Prompt |
|-----------|-----------|-----------------|------------|
| `Punkt` (als eigenständiges Wort) | `.` | ✅ `textFormatting.ts:620` (⚠️ nur wenn eindeutig) | ✅ Alle Prompts |
| `Komma` / `Beistrich` | `,` | ✅ `textFormatting.ts:744` (nur Online-Pfad) | ✅ Alle Prompts |
| `Doppelpunkt` | `:` | ✅ `textFormatting.ts:615` | ✅ Alle Prompts |
| `Semikolon` / `Strichpunkt` | `;` | ✅ `textFormatting.ts:616` | ✅ Alle Prompts |
| `Fragezeichen` | `?` | ✅ `textFormatting.ts:617` | ✅ Alle Prompts |
| `Ausrufezeichen` | `!` | ✅ `textFormatting.ts:618` | ✅ Alle Prompts |

### 1.4 Klammern & Anführungszeichen

| Gesprochen | Ersetzung | Deterministisch | LLM-Prompt |
|-----------|-----------|-----------------|------------|
| `Klammer auf` / `klammern auf` / `Xlammer zu` | `(` | ✅ `textFormatting.ts:599` | ✅ Alle Prompts |
| `Klammer zu` / `klammern zu` / `Xklammer auf` | `)` | ✅ `textFormatting.ts:605` | ✅ Alle Prompts |
| `Anführungszeichen auf` / `oben` | `„` / `"` | ✅ `textFormatting.ts:644` | ✅ Alle Prompts |
| `Anführungszeichen zu` / `unten` | `"` | ✅ `textFormatting.ts:645` | ✅ Alle Prompts |

### 1.5 Striche & Schrägstriche

| Gesprochen | Ersetzung | Deterministisch | LLM-Prompt |
|-----------|-----------|-----------------|------------|
| `Bindestrich` / `Minus` | `-` | ✅ `textFormatting.ts:744` (nur Online) | ✅ Alle Prompts |
| `Schrägstrich` | `/` | ❌ | ✅ Alle Prompts |
| `80 zu 100` → `80/100` (Bruch) | `/` | ✅ `textFormatting.ts:650` | ❌ |

### 1.6 Löschbefehle

| Gesprochen | Ersetzung | Deterministisch | LLM-Prompt |
|-----------|-----------|-----------------|------------|
| `lösche das letzte Wort` / `letztes Wort löschen` | Entfernt letztes Wort | ✅ `textFormatting.ts:676` | ✅ Alle Prompts |
| `lösche den letzten Satz` / `letzten Satz löschen` | Entfernt letzten Satz | ✅ `textFormatting.ts:680` | ✅ Alle Prompts |
| `lösche den letzten Absatz` | Entfernt letzten Absatz | ✅ `textFormatting.ts:683` | ❌ |

---

## 2. Zahlen, Einheiten & Maße (nur LLM)

Diese Regeln werden **ausschließlich per LLM-Prompt** umgesetzt. Die deterministische Verarbeitung (`textFormatting.ts`) wandelt **nur bereits als Ziffern vorliegende Zahlen** in Formate um (z. B. `10 Uhr 15` → `10:15`).

| Regel | Beispiel | LLM-Prompt Fundort |
|-------|----------|-------------------|
| Ausgeschriebene Zahlen → Ziffern | `acht` → `8`, `zwölf` → `12` | `system-prompt.ts:38`, `chunk-system-prompt.ts:31`, `befund-system-prompt.ts:36` |
| Maßeinheiten abkürzen | `acht Millimeter` → `8 mm` | `system-prompt.ts:40`, `chunk-system-prompt.ts:33` |
| Dezimalzahlen | `acht Komma sechs Prozent` → `8,6%` | `system-prompt.ts:41`, `chunk-system-prompt.ts:34` |
| Größenangaben | `sechzehn mal zehn Millimeter` → `16 x 10 mm` | `system-prompt.ts:42`, `chunk-system-prompt.ts:35` |
| Jahreszahlen | `neunzehnhunderteinundneunzig` → `1991` | `system-prompt.ts:43`, `chunk-system-prompt.ts:36` |
| Medizinische Scores | `Fazekas zwei` → `Fazekas 2`, `G2-Score sechs` → `G2-Score 6` | `system-prompt.ts:44`, `chunk-system-prompt.ts:37`, `befund-system-prompt.ts:45` |
| Datumsangaben (gesprochen) | `achtzehnter September zweitausendfünfundzwanzig` → `18.09.2025` | `system-prompt.ts:36`, `chunk-system-prompt.ts:51` |

### Deterministische Ausnahme: Uhrzeit

Nur wenn **bereits Ziffern** vorhanden sind:

```typescript
// textFormatting.ts:661-664
"10 Uhr 15"   → "10:15"  ✅ (Ziffern vorhanden)
"10. 15 Uhr"  → "10:15"  ✅
"drei Uhr fünfzehn" → bleibt stehen ⚠️ (wird nur vom LLM erkannt)
```

### Deterministische Ausnahme: Medizinische Abkürzungen

```typescript
// textFormatting.ts:71-250 (medizinische Abkürzungslisten)
"zweimal täglich"    → "2x/d"
"dreimal täglich"    → "3x/d"
"viermal täglich"    → "4x/d"
"zur Nacht"          → "z.N."
"einmalig"           → "1x"
```

---

## 3. Medizinische Fachbegriffe (deterministisch + LLM)

### 3.1 Deterministisch: Wörterbuch-Korrekturen

In `lib/dictionaryDb.ts` (persönliche Wörterbücher) und `lib/standardDictionaryDb.ts` (Standard-Wörterbuch):

| Eintrag | Beispiel |
|---------|----------|
| Benutzer-Wörterbuch | Freie Einträge `wrong → correct` |
| Phonetische Korrektur | `lib/phoneticMatch.ts` – phonetische Ähnlichkeitserkennung |

### 3.2 LLM-Prompt: Bekannte Transkriptionsfehler

In allen `prompts/correct/*.ts` und `prompts/worker/*.ts`:

| Falsch | Richtig |
|--------|---------|
| `Scholecystitis` | `Cholecystitis` |
| `Scholangitis` | `Cholangitis` |
| `labarchemisch` | `laborchemisch` |
| `Sektiocesaris` | `Sectio caesarea` |
| `Schole-Docholithiasis` | `Choledocholithiasis` |
| `Scholistase` / `Scholastase` | `Cholestase` |
| `Lekorräume` | `Liquorräume` |
| `Kolezistektomie` | `Cholezystektomie` |
| `Spinalcanal` | `Spinalkanal` |

---

## 4. Feld-Steuerbefehle (deterministisch)

| Gesprochen | Ersetzung | Fundort |
|-----------|-----------|---------|
| `Methodik:` | Wechselt in Feld „Methodik" | `page.tsx` (Parsing) |
| `Befund:` | Wechselt in Feld „Befund" | `page.tsx` (Parsing) |
| `Beurteilung:` | Wechselt in Feld „Beurteilung" | `page.tsx` (Parsing) |

---

## 5. Rich-Text-Formatierung (nur Online/VAD-Pfad)

| Gesprochen | Ersetzung | Fundort |
|-----------|-----------|---------|
| `Auswahl fett` | Markiert Auswahl als fett | `page.tsx:495` |
| `Auswahl kursiv` | Markiert Auswahl als kursiv | `page.tsx:495` |
| `Auswahl unterstrichen` | Markiert Auswahl als unterstrichen | `page.tsx:495` |
| `Wort fett` / `letztes Wort fett` | Letztes Wort fett | `page.tsx:504` |
| `Satz unterstrichen` / `letzter Satz kursiv` | Letzten Satz formatieren | `page.tsx:504` |
| `fett beginnen` / `fett ende` | Inline fett umschalten | `page.tsx:571` |
| `kursiv beginnen` / `kursiv stopp` | Inline kursiv umschalten | `page.tsx:571` |
| `unterstrichen anfang` / `unterstrichen ende` | Inline unterstrichen umschalten | `page.tsx:571` |

---

## 6. Verarbeitungsreihenfolge

Die Regeln werden in dieser Reihenfolge angewandt:

```
Whisper-Output
    ↓
1. Füllwörter entfernen („ähm", „äh")      ← textFormatting.ts
    ↓
2. Diktat-Sprachbefehle (Absätze, Klammern, Satzzeichen, Aufzählungen, Löschbefehle)
                                           ← textFormatting.ts (deterministisch)
    ↓
3. fixConcatenatedPunkt („stehenpunkt" → „stehen. ")
                                           ← textFormatting.ts
    ↓
4. Wörterbuch-Korrekturen (phonetisch, Standard, persönlich)
                                           ← dictionaryDb.ts / phoneticMatch.ts
    ↓
5. LLM-Korrektur                          ← prompts/correct/*.ts
   - Zahlen in Ziffern
   - Medizinische Fachbegriffe
   - Grammatik & Rechtschreibung
   - Fallback für Diktatbefehle
    ↓
6. stripIntroducedMarkdown (nur Baustein-Modus)
                                           ← templates/adapt/route.ts
```

---

## 7. Prompt-Dateien, die diese Regeln enthalten

| Datei | Enthält Regeln für |
|-------|-------------------|
| `prompts/correct/system-prompt.ts` | Zahlen, Einheiten, Fachbegriffe, Diktatbefehle (Einzelfeld) |
| `prompts/correct/chunk-system-prompt.ts` | Zahlen, Einheiten, Fachbegriffe, Diktatbefehle (Chunks) |
| `prompts/correct/befund-system-prompt.ts` | Zahlen, Einheiten, Fachbegriffe, Diktatbefehle (3 Felder) |
| `prompts/offline/recorrect-system-prompt.ts` | Diktatbefehle (Offline) |
| `prompts/worker/dictation-processor-prompt.ts` | Zahlen, Daten, Fachbegriffe, Diktatbefehle (Worker) |
| `prompts/worker/dictation-processor-chunk-prompt.ts` | Zahlen, Daten, Fachbegriffe, Diktatbefehle (Worker-Chunks) |
