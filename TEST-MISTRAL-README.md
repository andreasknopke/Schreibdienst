# Mistral Transcribe API Test

Test-Skript um die Mistral Transcribe API zu debuggen und zu testen.

## Voraussetzungen

1. **Node.js** mit `node-fetch` und `form-data`:
   ```bash
   npm install node-fetch@2 form-data dotenv
   ```

2. **MISTRAL_API_KEY** in `.env` Datei oder als Umgebungsvariable:
   ```bash
   export MISTRAL_API_KEY="dein-api-key"
   ```

3. **Audio-Datei** zum Testen (siehe unten)

## Test-Audio erstellen

### Option 1: Mit espeak (empfohlen)
```bash
# espeak installieren
apt-get install espeak

# Test-Audio erstellen
bash create-test-audio.sh
```

### Option 2: Eigene Audio-Datei verwenden
Beliebige Audio-Datei im Format WAV, MP3, M4A, WebM, etc.

## Test-Skript ausführen

```bash
node test-mistral-transcribe.js <audio-datei>
```

Beispiel:
```bash
# Mit generierter Test-Audio
node test-mistral-transcribe.js test-audio.wav

# Mit eigener Audio-Datei
node test-mistral-transcribe.js meine-aufnahme.m4a
```

## Was das Skript testet

Das Skript führt 3 verschiedene Tests durch:

### Test 1: Basis-Request
- Minimal Parameter (nur model + file)
- Zeigt grundlegende API-Antwort

### Test 2: Vollständiger Request
- Mit allen Parametern (language, timestamps)
- Zeigt ob Timestamp-Funktion funktioniert

### Test 3: WAV-Konvertierung
- Konvertiert Audio zu WAV mit ffmpeg
- Testet ob Format-Probleme die Ursache sind

## Ausgabe verstehen

Das Skript gibt detaillierte Informationen aus:
- ✅ = Erfolgreich
- ❌ = Fehler
- ⚠️ = Warnung
- 🔑 = API Key Info
- 📁 = Datei-Info
- 🚀 = Request gesendet
- 📡 = Response Status
- 📝 = Response Daten
- ⏱️ = Dauer

### Typische Fehler

**401 Unauthorized:**
```
❌ API-Fehler:
{"error":"Unauthorized"}
```
→ API Key falsch oder nicht gesetzt

**400 Bad Request:**
```
❌ API-Fehler:
{"error":"Invalid audio format"}
```
→ Audio-Format wird nicht unterstützt

**413 Payload Too Large:**
```
❌ API-Fehler:
{"error":"File too large"}
```
→ Audio-Datei zu groß (Max 25MB)

**500 Internal Server Error:**
```
❌ API-Fehler:
{"error":"Internal server error"}
```
→ Problem auf Mistral-Seite

## Bekannte Probleme

1. **M4A Format**: Mistral API hat manchmal Probleme mit M4A. Lösung: Konvertierung zu WAV
2. **Große Dateien**: API limitiert auf 25MB
3. **Timestamp-Granularität**: Parameter `timestamp_granularities[]` könnte Probleme verursachen

## Debugging

Wenn Tests fehlschlagen:

1. **API Key prüfen:**
   ```bash
   echo $MISTRAL_API_KEY
   ```

2. **Audio-Datei prüfen:**
   ```bash
   file test-audio.wav
   ffprobe test-audio.wav
   ```

3. **Direkt mit curl testen:**
   ```bash
   curl -X POST https://api.mistral.ai/v1/audio/transcriptions \
     -H "Authorization: Bearer $MISTRAL_API_KEY" \
     -F file=@test-audio.wav \
     -F model=voxtral-mini-latest
   ```

4. **Node-Abhängigkeiten prüfen:**
   ```bash
   npm list node-fetch form-data
   ```

## Nächste Schritte

Nach erfolgreichen Tests:
1. Integration in [app/api/transcribe/route.ts](app/api/transcribe/route.ts) anpassen
2. Provider-Auswahl in Runtime-Config testen
3. Frontend-Integration prüfen
