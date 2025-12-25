# WhisperX Integration

## Schnellstart

### Option 1: Docker Compose (Empfohlen)

```bash
docker-compose up -d
```

Fertig! App läuft auf http://localhost:3000

### Option 2: Separate Services

**Terminal 1 - WhisperX:**
```bash
cd whisper-service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

**Terminal 2 - Next.js:**
```bash
npm install
WHISPER_SERVICE_URL=http://localhost:5000 npm run dev
```

## Konfiguration

### Modell wechseln

In `docker-compose.yml`:
```yaml
environment:
  - WHISPER_MODEL=medium  # oder: tiny, base, small, large-v2, large-v3
```

### GPU aktivieren

1. NVIDIA Container Toolkit installieren
2. In `docker-compose.yml` GPU-Deployment auskommentieren
3. `docker-compose up -d` neu starten

## API-Nutzung

### Direkt (WhisperX Service)

```bash
# Health Check
curl http://localhost:5000/health

# Transkription
curl -X POST http://localhost:5000/transcribe \
  -F "file=@audio.webm" \
  -F "language=de"
```

### Über Next.js API

```bash
# Next.js leitet an konfigurierten Provider weiter
curl -X POST http://localhost:3000/api/transcribe \
  -F "file=@audio.webm"
```

## Provider wechseln

In `.env.local`:

```bash
# WhisperX lokal verwenden
TRANSCRIPTION_PROVIDER=whisperx
WHISPER_SERVICE_URL=http://localhost:5000

# Oder ElevenLabs verwenden
TRANSCRIPTION_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=your_key

# Oder remote WhisperX
TRANSCRIPTION_PROVIDER=whisperx
WHISPER_SERVICE_URL=https://your-server.com
```

## Troubleshooting

**Service startet nicht:**
```bash
docker-compose logs whisper
```

**Langsam:**
- Kleineres Modell: `WHISPER_MODEL=medium`
- GPU aktivieren (siehe oben)

**Out of Memory:**
- Kleineres Modell verwenden
- Oder: `WHISPER_MODEL=tiny` für Tests

## Vorteile gegenüber ElevenLabs

✅ Vollständig lokal - keine Daten verlassen den Server  
✅ Keine API-Kosten  
✅ Keine Internetverbindung nötig  
✅ Bessere Zeitstempel durch Alignment  
✅ Anpassbar an medizinische Terminologie  

## Performance-Vergleich

| Setup | Geschwindigkeit | Kosten | Datenschutz |
|-------|----------------|--------|-------------|
| ElevenLabs | Schnell | $$$ pro Minute | Cloud |
| WhisperX (CPU small) | 5-10x Echtzeit | Keine | Lokal |
| WhisperX (GPU large-v2) | 1-2x Echtzeit | Keine | Lokal |

Für medizinische Anwendungen wird **GPU + large-v2** empfohlen.
