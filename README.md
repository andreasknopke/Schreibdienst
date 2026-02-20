# Schreibdienst

Medizinische Diktate als Web-App: Audio (Mikrofon oder Datei) → Transkription via **WhisperX** (serverseitig) → Korrektur & Formatierung als Arztbrief/Befundbericht.

## Features
- Aufnahme im Browser (MediaRecorder) oder Datei-Upload
- **Serverseitige Transkription mit WhisperX** (OpenAI Whisper + bessere Alignment)
- Einfache Korrektur & medizinische Formatierung (ohne externes LLM)
- Export als .docx, Kopieren in die Zwischenablage
- Optionale Conversational-Agent-Vorschau (ElevenLabs ConvAI)
- Benutzerverwaltung mit persönlichen Wörterbüchern

## Architektur

Das System besteht aus zwei Services:
1. **Next.js App** (Port 3000): Frontend + API-Routes
2. **WhisperX Service** (Port 5000): Python-basierte Speech-to-Text

## Voraussetzungen

### Lokale Entwicklung
- Node.js ≥ 18
- Python 3.10+
- FFmpeg (für Audio-Verarbeitung)
- Optional: NVIDIA GPU mit CUDA für schnellere Transkription

### Docker (empfohlen)
- Docker & Docker Compose
- Optional: NVIDIA Docker für GPU-Support

## Setup

### Variante 1: Docker Compose (empfohlen)

```bash
# Services starten
docker-compose up -d

# Logs anschauen
docker-compose logs -f

# Services stoppen
docker-compose down
```

Die App läuft auf http://localhost:3000, WhisperX auf http://localhost:5000

### Variante 2: Lokale Entwicklung

#### WhisperX Service starten

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

#### Next.js App starten

```bash
# In neuem Terminal
cd /workspaces/Schreibdienst

# Dependencies installieren
npm install

# Umgebungsvariablen konfigurieren
cp .env.example .env.local
# Bearbeite .env.local:
# WHISPER_SERVICE_URL=http://localhost:5000

# Dev-Server starten
npm run dev
```

App läuft auf http://localhost:3000

### Externe Repositories für lokale STT-Services

Für lokale Transkriptions-Backends außerhalb dieses Repositories:

1. **WhisperX (HTML API / HTTP API)**
  - Repository: https://github.com/andreasknopke/WhisperX
  - Zweck in Schreibdienst: serverseitige Transkription über `WHISPER_SERVICE_URL`
2. **Fast-Whisper / Whisper-Live (WebSocket API)**
  - Repository: https://github.com/andreasknopke/Whisper-Live
  - Zweck in Schreibdienst: Echtzeit-Transkription über `FAST_WHISPER_WS_URL`

### Empfohlene Installation (Best Practice)

#### Schritt 1: WhisperX (HTTP) zuerst installieren

WhisperX ist der robusteste Standardpfad für Batch-/Final-Transkription.

```bash
cd /workspaces
git clone https://github.com/andreasknopke/WhisperX.git
cd WhisperX

# Empfohlen: gemäß Repo-README mit Docker starten
# (alternativ venv + python app.py, je nach Repo-Doku)
```

Danach in Schreibdienst konfigurieren:

```bash
TRANSCRIPTION_PROVIDER=whisperx
WHISPER_SERVICE_URL=http://localhost:5000
```

#### Schritt 2: Fast-Whisper/Whisper-Live (WebSocket) ergänzen

Fast-Whisper eignet sich für sehr niedrige Latenz im Live-Modus.

```bash
cd /workspaces
git clone https://github.com/andreasknopke/Whisper-Live.git
cd Whisper-Live

# Empfohlen: gemäß Repo-README starten (Docker oder Python-Startscript)
```

Danach in Schreibdienst konfigurieren:

```bash
TRANSCRIPTION_PROVIDER=fast_whisper
FAST_WHISPER_WS_URL=ws://localhost:5001
```

### Betriebsempfehlung

- **Produktion / Stabilität:** `TRANSCRIPTION_PROVIDER=whisperx`
- **Echtzeit-Test / niedrige Latenz:** `TRANSCRIPTION_PROVIDER=fast_whisper`
- Für robuste Entwicklungsumgebung beide Services lokal verfügbar halten.

### Installation verifizieren

Nach dem Start der Services:

```bash
# WhisperX (HTTP API)
curl http://localhost:5000/health

# Schreibdienst Health
curl http://localhost:3000/api/health
```

Für Fast-Whisper (WebSocket) zusätzlich im Browser-Frontend testen:

- Provider auf `fast_whisper` stellen
- Live-Diktat starten
- Prüfen, ob während der Aufnahme Teiltranskripte erscheinen

### Port-/Service-Matrix (Quick Troubleshooting)

| Dienst | Standard-Port | Protokoll | Variable | Quick-Check | Typischer Fehler | Häufige Ursache |
|-------|---------------|-----------|----------|-------------|------------------|-----------------|
| Schreibdienst (Next.js) | 3000 | HTTP | - | `curl http://localhost:3000/api/health` | `ECONNREFUSED localhost:3000` | App nicht gestartet (`npm run dev`) |
| WhisperX (HTTP API) | 5000 | HTTP | `WHISPER_SERVICE_URL` | `curl http://localhost:5000/health` | `WhisperX API error / connection refused` | WhisperX läuft nicht oder falsche URL/Port |
| Fast-Whisper / Whisper-Live | 5001 | WS/WSS | `FAST_WHISPER_WS_URL` | Live-Diktat mit `fast_whisper` starten | `WebSocket connection failed` / keine Live-Transkripte | WS-Server nicht gestartet, falsches `ws://`/`wss://`, Zertifikat/Proxy |

#### Entscheidungshilfe: `whisperx` vs `fast_whisper`

| Ziel | Empfohlener Provider | Warum |
|------|----------------------|-------|
| Stabiler Produktionsbetrieb | `whisperx` | Robuster Standardpfad für serverseitige Verarbeitung |
| Sehr niedrige Live-Latenz | `fast_whisper` | WebSocket-Realtime mit schneller Teiltranskription |
| Beste Fallback-Resilienz | `whisperx` (+ optional ElevenLabs Key) | Fallback-Strategie in der API bereits vorgesehen |
| Einfaches Troubleshooting | `whisperx` | HTTP-Healthcheck (`/health`) leicht prüfbar |
| HTTPS-Deployment mit Browser-Client | `fast_whisper` mit `wss://` | Vermeidet Mixed-Content/WS-Blockaden |

#### Presets für `.env.local`

**Preset A – Produktion stabil (WhisperX):**

```bash
TRANSCRIPTION_PROVIDER=whisperx
WHISPER_SERVICE_URL=http://localhost:5000
# Optionaler Fallback bei WhisperX-Ausfall:
# ELEVENLABS_API_KEY=your_api_key
```

**Preset B – Realtime Entwicklung (Fast-Whisper):**

```bash
TRANSCRIPTION_PROVIDER=fast_whisper
FAST_WHISPER_WS_URL=ws://localhost:5001
# Für HTTPS-Umgebungen typischerweise:
# FAST_WHISPER_WS_URL=wss://your-fast-whisper-domain
```

**Preset C – Hybrid/Fallback (WhisperX + ElevenLabs):**

```bash
TRANSCRIPTION_PROVIDER=whisperx
WHISPER_SERVICE_URL=http://localhost:5000
ELEVENLABS_API_KEY=your_api_key
```

Verhalten: Zuerst WhisperX, bei Nichterreichbarkeit Fallback auf ElevenLabs.

#### Schnellhilfe bei häufigen Fehlern

```bash
# Port belegt / Prozess prüfen
lsof -i :3000 -i :5000 -i :5001

# Erreichbarkeit per HTTP
curl -v http://localhost:3000/api/health
curl -v http://localhost:5000/health
```

Wenn die App via HTTPS läuft, für Fast-Whisper in der Regel `wss://` verwenden (nicht `ws://`).

## Umgebungsvariablen

### Next.js App (.env.local)

```bash
# Transkriptions-Provider (whisperx, elevenlabs, mistral oder fast_whisper)
TRANSCRIPTION_PROVIDER=whisperx

# WhisperX Service URL (lokal oder remote)
WHISPER_SERVICE_URL=http://localhost:5000

# Fast Whisper WebSocket URL (optional, für Echtzeit-Transkription)
FAST_WHISPER_WS_URL=ws://localhost:5001

# ElevenLabs API Key (optional, als Fallback oder Primary)
ELEVENLABS_API_KEY=your_api_key

# Optional: Voice Agent
NEXT_PUBLIC_ENABLE_AGENT=1
NEXT_PUBLIC_ELEVENLABS_AGENT_ID=your_agent_id
```

### Provider-Optionen

#### Option 1: WhisperX (lokal) - Empfohlen
```bash
TRANSCRIPTION_PROVIDER=whisperx
WHISPER_SERVICE_URL=http://localhost:5000
```

#### Option 2: WhisperX (remote Server)
```bash
TRANSCRIPTION_PROVIDER=whisperx
WHISPER_SERVICE_URL=https://your-whisper-server.com
```

#### Option 3: ElevenLabs (Cloud)
```bash
TRANSCRIPTION_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=your_api_key
```

#### Option 4: WhisperX mit ElevenLabs Fallback
```bash
TRANSCRIPTION_PROVIDER=whisperx
WHISPER_SERVICE_URL=http://localhost:5000
ELEVENLABS_API_KEY=your_api_key  # Wird verwendet wenn WhisperX nicht erreichbar
```

#### Option 5: Fast Whisper (WebSocket Server)
```bash
TRANSCRIPTION_PROVIDER=fast_whisper
FAST_WHISPER_WS_URL=ws://localhost:5001
```

### WhisperX Service

```bash
# Whisper Modell (tiny, base, small, medium, large-v2, large-v3)
WHISPER_MODEL=large-v2

# Service Port
PORT=5000
```

## API Routen

### Next.js
- `POST /api/transcribe` – Audio-Transkription (leitet zu WhisperX weiter)
- `POST /api/format` – Text-Formatierung als Arztbrief/Befund
- `POST /api/correct` – Rechtschreibkorrektur mit Wörterbuch
- `GET /api/dictionary` – Wörterbuch-Management
- `GET /api/users` – Benutzerverwaltung
- `GET /api/health` – Health Check

### WhisperX Service
- `GET /health` – Service Status
- `POST /transcribe` – Audio-Transkription mit WhisperX

## Modell-Auswahl

| Modell | Größe | VRAM | Geschwindigkeit | Genauigkeit | Empfehlung |
|--------|-------|------|-----------------|-------------|------------|
| tiny | 39M | ~1 GB | Sehr schnell | Niedrig | Schnelle Tests |
| base | 74M | ~1 GB | Schnell | Mittel | Entwicklung |
| small | 244M | ~2 GB | Mittel | Gut | Produktion (CPU) |
| medium | 769M | ~5 GB | Langsam | Sehr gut | Produktion (GPU) |
| large-v2 | 1550M | ~10 GB | Sehr langsam | Exzellent | Medizinische Transkription |

**Empfehlung**: `large-v2` mit GPU für beste Ergebnisse bei medizinischen Diktaten.

## Performance

### CPU (Intel i7/AMD Ryzen)
- small: ~5-10x Echtzeit
- medium: ~10-20x Echtzeit
- large-v2: ~20-40x Echtzeit

### GPU (NVIDIA RTX 3090/4090)
- small: <1x Echtzeit
- medium: ~1-2x Echtzeit
- large-v2: ~2-5x Echtzeit

## GPU-Support aktivieren

### Docker Compose

Kommentiere in `docker-compose.yml` folgende Zeilen aus:

```yaml
deploy:
  resources:
    reservations:
      devices:
        - driver: nvidia
          count: 1
          capabilities: [gpu]
```

Stelle sicher, dass NVIDIA Container Toolkit installiert ist:

```bash
# Installation
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -s -L https://nvidia.github.io/nvidia-docker/gpgkey | sudo apt-key add -
curl -s -L https://nvidia.github.io/nvidia-docker/$distribution/nvidia-docker.list | sudo tee /etc/apt/sources.list.d/nvidia-docker.list

sudo apt-get update && sudo apt-get install -y nvidia-container-toolkit
sudo systemctl restart docker
```

## Datenschutz

⚠️ **Wichtig**: Die Audio-Verarbeitung erfolgt **vollständig lokal** auf deinem Server. Es werden keine Daten an Drittanbieter gesendet (außer optional ElevenLabs für den Voice Agent).

- WhisperX läuft komplett lokal
- Transkriptionen verlassen nicht deinen Server
- Benutzerdaten und Wörterbücher werden lokal gespeichert

## Produktions-Deployment

### Sicherheit

1. **HTTPS verwenden**: Reverse Proxy mit nginx/Caddy
2. **Authentifizierung**: Basic Auth oder OAuth vor den Services
3. **Firewall**: Nur Port 443 nach außen öffnen
4. **Updates**: Regelmäßig Docker Images aktualisieren

### Empfohlenes Setup

```
Internet → nginx (Port 443, HTTPS) → Next.js App (Port 3000)
                                    → WhisperX (Port 5000, nur intern)
```

## Entwicklung

Eine detaillierte Entwicklerdokumentation für den Einstieg und die Weiterentwicklung findest du unter:

- [docs/ENTWICKLERDOKU.md](docs/ENTWICKLERDOKU.md)
- [docs/API_REFERENZ.md](docs/API_REFERENZ.md)
- [docs/Schreibdienst.postman_collection.json](docs/Schreibdienst.postman_collection.json)
- [docs/Schreibdienst.insomnia.json](docs/Schreibdienst.insomnia.json)

### Projekt-Struktur

```
/workspaces/Schreibdienst/
├── app/                    # Next.js App Router
│   ├── api/               # API Routes
│   └── page.tsx          # Frontend
├── components/            # React Components
├── lib/                  # Helper Functions
├── whisper-service/      # WhisperX Python Service
│   ├── app.py           # Flask API
│   ├── requirements.txt
│   └── Dockerfile
├── cache/                # Lokale Datenspeicherung
└── docker-compose.yml    # Multi-Service Setup
```

## Hinweise

- Die Formatierung nutzt heuristische Regeln (siehe [lib/formatMedical.ts](lib/formatMedical.ts))
- Conversational-Agent ist optional und standardmäßig deaktiviert
- Beim ersten Start lädt WhisperX das Modell (~3GB für large-v2), dies dauert einige Minuten

## Troubleshooting

### WhisperX lädt nicht
```bash
# Logs prüfen
docker-compose logs whisper

# Manuell testen
curl http://localhost:5000/health
```

### Langsame Transkription
- Kleineres Modell verwenden (medium statt large-v2)
- GPU aktivieren
- Batch-Size in app.py anpassen

### Out of Memory
- Kleineres Modell wählen
- GPU mit mehr VRAM nutzen
- Swap erhöhen (nur für CPU)