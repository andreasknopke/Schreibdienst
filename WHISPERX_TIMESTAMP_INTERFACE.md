# WhisperX Zeitstempel-Interface für Schreibdienst

## Übersicht

Diese Anleitung beschreibt das erwartete Datenformat für die Zeitstempel-Übergabe vom WhisperX-Server an das Schreibdienst-Frontend. Bei einem Neuaufbau des WhisperX-Servers muss dieses Format eingehalten werden.

---

## Erwartetes Antwort-Format

Der WhisperX-Server muss eine JSON-Antwort mit folgender Struktur liefern:

```json
{
  "text": "Der vollständige transkribierte Text als String",
  "segments": [...],
  "language": "de",
  "mode": "precision",
  "duration": 2.45
}
```

---

## Segment-Struktur (KRITISCH)

Das `segments`-Array muss folgende Struktur haben:

```json
{
  "segments": [
    {
      "start": 0.0,
      "end": 2.5,
      "text": "Das ist der erste Satz.",
      "words": [
        { "word": "Das", "start": 0.0, "end": 0.3 },
        { "word": "ist", "start": 0.35, "end": 0.5 },
        { "word": "der", "start": 0.55, "end": 0.7 },
        { "word": "erste", "start": 0.75, "end": 1.1 },
        { "word": "Satz.", "start": 1.15, "end": 1.5 }
      ]
    },
    {
      "start": 2.6,
      "end": 5.0,
      "text": "Zweiter Satz hier.",
      "words": [...]
    }
  ]
}
```

### Pflichtfelder pro Segment:
| Feld | Typ | Beschreibung |
|------|-----|--------------|
| `start` | `float` | Startzeit in Sekunden |
| `end` | `float` | Endzeit in Sekunden |
| `text` | `string` | Text des Segments |
| `words` | `array` | Array mit Wort-Zeitstempeln (für Mitlesen-Feature) |

### Pflichtfelder pro Word:
| Feld | Typ | Beschreibung |
|------|-----|--------------|
| `word` | `string` | Das einzelne Wort (inkl. Satzzeichen) |
| `start` | `float` | Startzeit in Sekunden |
| `end` | `float` | Endzeit in Sekunden |

---

## Gradio-Interface Varianten

Der Worker unterstützt mehrere Rückgabe-Formate vom Gradio-Interface:

### Variante 1: Direkter JSON-String
```python
return [transcription_text, json.dumps(segments)]
```

### Variante 2: Object mit value-Property
```python
return [{"value": transcription_text}, {"value": json.dumps(segments)}]
```

### Variante 3: File-Referenz (wird heruntergeladen)
```python
# Gradio speichert segments als JSON-Datei
# Worker lädt diese via fileUrl herunter
return [transcription_text, gr.File("segments.json")]
```

---

## Code-Stellen im Schreibdienst

### 1. Worker extrahiert Segmente
**Datei:** `app/api/offline-dictations/worker/route.ts`
**Zeilen:** 375-454

```typescript
// Case 1: Direct JSON string
if (typeof item === 'string' && item.startsWith('[') && item.includes('"start"')) {
  const parsed = JSON.parse(item);
  if (Array.isArray(parsed) && parsed.length > 0 && parsed[0].start !== undefined) {
    segments = parsed;
  }
}

// Case 2: Object with 'value' property containing JSON
if (item && typeof item === 'object' && item.value) {
  // ...parse item.value as JSON
}

// Case 3: File reference - download JSON file
if (item && typeof item === 'object' && (item.path || item.url)) {
  // ...fetch from fileUrl
}
```

### 2. Segmente werden in DB gespeichert
**Datei:** `app/api/offline-dictations/worker/route.ts`
**Zeile:** 97

```typescript
await completeDictationWithRequest(request, dictationId, {
  rawTranscript: rawTranscript,
  segments: segments, // Word-level timestamps für "Mitlesen"
  correctedText: correctedText,
  changeScore: changeScore,
});
```

### 3. Frontend rendert Zeitstempel
**Datei:** `components/DictationQueue.tsx`
**Zeilen:** 1030-1083

```typescript
// Word-level highlighting
segment.words.map((word, wordIdx) => {
  if (word.start === undefined || word.end === undefined) {
    return <span>{word.word} </span>; // Fallback ohne Highlighting
  }
  const isCurrentWord = audioCurrentTime >= word.start && audioCurrentTime < word.end;
  return <span className={isCurrentWord ? 'highlighted' : ''}>{word.word} </span>;
})
```

---

## Fallback-Verhalten

Das Frontend hat 3 Fallback-Stufen:

1. **Word-Level Highlighting** (optimal): `segment.words` mit `start`/`end` pro Wort
2. **Segment-Level Highlighting**: Nur `segment.start`/`segment.end` vorhanden
3. **Kein Highlighting**: Keine Zeitstempel → Nur Text-Anzeige

---

## WhisperX Python-Seite

**Datei:** `whisper-service/app.py`

### Alignment aktivieren für Wort-Zeitstempel:
```python
# Zeile 272-283
if do_align and model_a is not None:
    result = whisperx.align(
        segments, 
        model_a, 
        metadata, 
        audio, 
        DEVICE,
        return_char_alignments=False
    )
    segments = result["segments"]  # Jetzt mit words[] Array
```

### Rückgabe-Format:
```python
# Zeile 296-301
return jsonify({
    'text': full_text.strip(),
    'segments': segments,  # MUSS words[] enthalten
    'language': detected_language,
    'mode': 'turbo' if is_turbo else 'precision',
    'duration': transcription_time
})
```

---

## Checkliste für Neuaufbau

- [ ] Segments-Array wird zurückgegeben
- [ ] Jedes Segment hat `start`, `end`, `text`
- [ ] Jedes Segment hat `words` Array
- [ ] Jedes Word hat `word`, `start`, `end`
- [ ] Alignment ist aktiviert (`do_align=True`)
- [ ] Gradio-Interface gibt Segments in einem der 3 Formate zurück
- [ ] Zeitstempel sind in Sekunden (float), nicht Millisekunden

---

## Test

Nach Neuaufbau testen mit:
1. Offline-Diktat aufnehmen
2. Warten bis verarbeitet
3. Auf Diktat klicken → "Mitlesen" sollte Wörter gelb highlighten während Audio spielt

---

# Initial Prompt Interface für Schreibdienst

## Übersicht

Der `initial_prompt` ist ein Whisper-Feature, das die Erkennung von Fachbegriffen verbessert. Schreibdienst nutzt dies, um medizinische Terminologie aus dem Benutzer-Wörterbuch an WhisperX zu übergeben.

---

## Datenfluss

```
Benutzer-Wörterbuch (DB)
        ↓
    [useInPrompt=true Filter]
        ↓
    Komma-separierte Liste
        ↓
    WhisperX initial_prompt Parameter
        ↓
    Bessere Erkennung von Fachbegriffen
```

---

## Wörterbuch-Eintrag Struktur

**Datei:** `lib/dictionaryDb.ts`

```typescript
interface DictionaryEntry {
  wrong: string;           // Falsch erkanntes Wort
  correct: string;         // Korrekte Schreibweise
  useInPrompt?: boolean;   // ← WICHTIG: Nur wenn true, wird es im initial_prompt verwendet
  matchStem?: boolean;     // Stammwort-Matching
}
```

---

## Initial Prompt Generierung (TypeScript)

### Schritt 1: Wörterbuch laden und filtern
**Datei:** `app/api/offline-dictations/worker/route.ts` (Zeilen 137-156)

```typescript
// Lade Wörterbuch für initial_prompt bei WhisperX
// Nur Einträge mit useInPrompt=true werden verwendet
let initialPrompt: string | undefined;
if (username && provider !== 'elevenlabs') {
  const dictionary = await loadDictionaryWithRequest(request, username);
  
  // Extrahiere einzigartige korrekte Wörter nur von Einträgen mit useInPrompt=true
  const correctWords = new Set<string>();
  for (const entry of dictionary.entries) {
    if (entry.correct && entry.useInPrompt) {
      correctWords.add(entry.correct);
    }
  }
  
  if (correctWords.size > 0) {
    initialPrompt = Array.from(correctWords).join(', ');
    console.log(`[Worker] Using ${correctWords.size} dictionary words as initial_prompt`);
  }
}
```

### Schritt 2: An Gradio-API übergeben
**Datei:** `app/api/offline-dictations/worker/route.ts` (Zeilen 296-307)

```typescript
const processRes = await fetch(`${whisperUrl}/gradio_api/call/start_process`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Cookie': sessionCookie },
  body: JSON.stringify({
    data: [
      { path: filePath, ... },    // Audio-Datei
      languageCode,                // "German"
      whisperModel,                // Modell-Name
      "cuda",                      // Device
      initialPrompt || ""          // ← INITIAL PROMPT (5. Parameter)
    ]
  }),
});
```

### Schritt 3: An FastAPI übergeben (Fallback)
**Datei:** `app/api/offline-dictations/worker/route.ts` (Zeilen 466-469)

```typescript
const formData = new FormData();
formData.append('file', normalizedFile, `audio.${fastApiExt}`);
formData.append('language', 'de');
formData.append('align', 'true');
formData.append('initial_prompt', initialPrompt);  // ← Als Form-Field
```

---

## WhisperX Python-Seite

**Datei:** `whisper-service/app.py`

### Format-Prompt (immer enthalten)
```python
# Zeile 37
FORMAT_PROMPT = "Klammern (so wie diese) und Satzzeichen wie Punkt, Komma, Doppelpunkt und Semikolon sind wichtig."
```

### Prompt zusammenbauen
```python
# Zeilen 201-207
user_prompt = request.form.get('initial_prompt', '')

# Format-Prompt + User-Prompt kombinieren
if user_prompt:
    initial_prompt = f"{FORMAT_PROMPT} {user_prompt}"
else:
    initial_prompt = FORMAT_PROMPT
```

### An Whisper übergeben
```python
# Turbo-Modus (Zeile 242)
segments_gen, info = fw_model.transcribe(
    audio,
    language=language,
    initial_prompt=initial_prompt,  # ← Hier
    beam_size=1,
    ...
)

# Precision-Modus (Zeile 266)
result = model.transcribe(
    audio, 
    batch_size=batch_size, 
    language=language, 
    initial_prompt=initial_prompt   # ← Hier
)
```

---

## Gradio-Interface Erwartung

Das Gradio-Interface muss den initial_prompt als **5. Parameter** im `data`-Array akzeptieren:

```python
# Gradio Interface Definition (Beispiel)
def start_process(audio_file, language, model, device, initial_prompt):
    # initial_prompt enthält komma-separierte Fachbegriffe
    # z.B. "Hepatomegalie, Splenomegalie, Cholezystolithiasis, Appendizitis"
    ...
```

### Parameter-Reihenfolge:
| Index | Parameter | Beispiel |
|-------|-----------|----------|
| 0 | Audio-Datei | `{path: "/tmp/audio.wav", ...}` |
| 1 | Sprache | `"German"` |
| 2 | Modell | `"primeline/whisper-large-v3-turbo-german"` |
| 3 | Device | `"cuda"` |
| 4 | Initial Prompt | `"Hepatomegalie, Splenomegalie, ..."` |

---

## Halluzinations-Erkennung

Whisper kann bei langen initial_prompts "halluzinieren" (Prompt-Wörter wiederholen statt Audio transkribieren).

**Datei:** `app/api/offline-dictations/worker/route.ts` (Zeilen 166-184)

```typescript
// Detect if Whisper is hallucinating/repeating the initial_prompt
if (initialPrompt && result.text) {
  const promptWords = initialPrompt.split(',').map(w => w.trim().toLowerCase());
  const transcriptionWords = result.text.toLowerCase().split(/\s+/);
  
  // Zähle wie viele Prompt-Wörter in Transkription vorkommen
  let matchCount = 0;
  for (const pw of promptWords) {
    if (transcriptionWords.some(tw => tw.includes(pw))) matchCount++;
  }
  
  // Wenn >50% der Prompt-Wörter in Transkription → wahrscheinlich Halluzination
  if (matchCount / promptWords.length > 0.5) {
    console.warn(`[Worker] Detected Whisper hallucination. Retrying without initial_prompt...`);
    return transcribeWithWhisperX(request, audioBlob, undefined); // Retry ohne Prompt
  }
}
```

---

## Checkliste für Neuaufbau

- [ ] Gradio akzeptiert initial_prompt als 5. Parameter
- [ ] FastAPI akzeptiert `initial_prompt` als Form-Field
- [ ] Prompt wird mit FORMAT_PROMPT kombiniert
- [ ] Prompt wird an `model.transcribe()` übergeben
- [ ] Leerer Prompt funktioniert (nur FORMAT_PROMPT wird verwendet)

---

## Beispiel initial_prompt

```
Klammern (so wie diese) und Satzzeichen wie Punkt, Komma, Doppelpunkt und Semikolon sind wichtig. Hepatomegalie, Splenomegalie, Cholezystolithiasis, Appendizitis, Koloskopie, Gastroskopie, Ösophagogastroduodenoskopie
```

Dieser Prompt hilft Whisper, medizinische Fachbegriffe korrekt zu erkennen, die sonst als ähnlich klingende Alltagswörter transkribiert würden.
