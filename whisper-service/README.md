# WhisperX Speech-to-Text Service

Serverseitige Spracherkennung mit WhisperX für deutsche medizinische Transkription.

## Features

- **WhisperX**: Verbesserte Whisper-Version mit besseren Zeitstempeln
- **Alignment**: Präzise Wort-Level-Zeitstempel
- **GPU-Support**: Automatische CUDA-Erkennung
- **Deutsch-optimiert**: Vorkonfiguriert für deutsche Sprache

## Setup

### Lokale Entwicklung

```bash
cd whisper-service

# Virtual Environment erstellen
python3 -m venv venv
source venv/bin/activate

# Dependencies installieren
pip install -r requirements.txt

# Service starten
python app.py
```

### Docker

```bash
# Image bauen
docker build -t whisper-service .

# Container starten (CPU)
docker run -p 5000:5000 whisper-service

# Container starten (GPU)
docker run --gpus all -p 5000:5000 whisper-service
```

### Docker Compose

```bash
docker-compose up -d
```

## API Endpoints

### Health Check

```bash
GET /health
```

### Transkription

```bash
POST /transcribe

Content-Type: multipart/form-data
- file: Audio-Datei (erforderlich)
- language: Sprache (optional, Standard: "de")
- align: Alignment aktivieren (optional, Standard: "true")
```

Beispiel:

```bash
curl -X POST http://localhost:5000/transcribe \
  -F "file=@audio.webm" \
  -F "language=de"
```

Response:

```json
{
  "text": "Der vollständige transkribierte Text",
  "segments": [
    {
      "start": 0.0,
      "end": 2.5,
      "text": "Der vollständige"
    }
  ],
  "language": "de"
}
```

## Umgebungsvariablen

- `WHISPER_MODEL`: Modell-Name (Standard: "large-v2")
  - Optionen: tiny, base, small, medium, large-v1, large-v2, large-v3
- `PORT`: Service-Port (Standard: 5000)

## Performance

- **CPU**: ~5-10x Echtzeit mit medium-Modell
- **GPU**: ~0.5-1x Echtzeit mit large-v2-Modell

## Modell-Größen

| Modell | Parameter | VRAM (GPU) | Geschwindigkeit | Genauigkeit |
|--------|-----------|------------|-----------------|-------------|
| tiny   | 39M       | ~1 GB      | Sehr schnell    | Niedrig     |
| base   | 74M       | ~1 GB      | Schnell         | Mittel      |
| small  | 244M      | ~2 GB      | Mittel          | Gut         |
| medium | 769M      | ~5 GB      | Langsam         | Sehr gut    |
| large-v2 | 1550M   | ~10 GB     | Sehr langsam    | Exzellent   |

Für medizinische Transkription wird **large-v2** empfohlen.
