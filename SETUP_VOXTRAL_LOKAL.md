# Voxtral Lokal – Mistral STT auf eigener GPU

Mistral's Voxtral ist ein Open-Weight Speech-to-Text-Modell, das lokal auf NVIDIA GPUs läuft.  
Es wird über **vLLM** als OpenAI-kompatibler Server bereitgestellt.

**Links:**
- Modell: https://huggingface.co/mistralai/Voxtral-Mini-3B-2507
- Realtime-Modell: https://huggingface.co/mistralai/Voxtral-Mini-4B-Realtime-2602
- Docs: https://docs.mistral.ai/capabilities/audio_transcription/
- Blog: https://mistral.ai/news/voxtral-transcribe-2

---

## Verfügbare Modelle

| Modell | Parameter | VRAM (fp16) | Geschwindigkeit | Sprachen |
|--------|-----------|-------------|-----------------|----------|
| `mistralai/Voxtral-Mini-3B-2507` | 3B | ~6-8 GB | Schnell | 9 (inkl. DE) |
| `mistralai/Voxtral-Mini-4B-Realtime-2602` | 4B | ~8-10 GB | Echtzeit-Streaming | 9 (inkl. DE) |
| `mistralai/Voxtral-Small-24B-2507` | 24B | ~48 GB | Langsamer, höchste Qualität | 9 (inkl. DE) |

**Empfehlung:** `Voxtral-Mini-3B-2507` für Batch-Transkription, `Voxtral-Mini-4B-Realtime-2602` für Live-Diktat.

### GPU-Anforderungen

| GPU | VRAM | Mini 3B | Mini 4B Realtime | Small 24B |
|-----|------|---------|------------------|-----------|
| RTX 3060 | 12 GB | ✅ | ✅ | ❌ |
| RTX 3090 / 4090 | 24 GB | ✅ | ✅ | ❌ |
| V100 | 32 GB | ✅ | ✅ | ❌ |
| A100 | 40/80 GB | ✅ | ✅ | ✅ (40GB) |

---

## Installation

### Voraussetzungen

- **NVIDIA GPU** mit mindestens 12 GB VRAM
- **NVIDIA Treiber** ≥ 525 (für CUDA 12.x)
- **Python** ≥ 3.10
- **HuggingFace Account** (Modelle erfordern Lizenzzustimmung auf HuggingFace)

### Schritt 1: NVIDIA Treiber prüfen

```bash
nvidia-smi
# Sollte GPU-Name und Treiber-Version zeigen
```

### Schritt 2: Python-Umgebung erstellen

```bash
python3 -m venv ~/voxtral-env
source ~/voxtral-env/bin/activate
```

### Schritt 3: vLLM und Mistral-Audio installieren

```bash
pip install vllm "mistral-common[audio]"
```

> **Hinweis:** Die Installation dauert einige Minuten und lädt PyTorch, CUDA-Binaries etc.

### Schritt 4: HuggingFace Login

Die Voxtral-Modelle erfordern eine Lizenzzustimmung auf HuggingFace:

1. Öffne https://huggingface.co/mistralai/Voxtral-Mini-3B-2507
2. Klicke auf "Agree and access repository"
3. Erstelle ein Token unter https://huggingface.co/settings/tokens

```bash
pip install huggingface_hub
huggingface-cli login
# Token eingeben
```

### Schritt 5: vLLM Server starten

```bash
vllm serve mistralai/Voxtral-Mini-3B-2507 \
  --host 0.0.0.0 \
  --port 8000 \
  --tokenizer-mode mistral \
  --config-format mistral \
  --load-format mistral \
  --max-model-len 8192 \
  --enforce-eager \
  --dtype half \
  --gpu-memory-utilization 0.9
```

Der erste Start dauert **5-15 Minuten** (Modell-Download ~6 GB).

### Schritt 6: Testen

```bash
# Health-Check
curl http://localhost:8000/health

# Transkription testen
curl http://localhost:8000/v1/audio/transcriptions \
  -F file=@test-audio.wav \
  -F model=mistralai/Voxtral-Mini-3B-2507 \
  -F language=de \
  -F response_format=verbose_json
```

Erwartete Antwort:
```json
{
  "text": "Der transkribierte Text...",
  "segments": [
    {"text": "Der transkribierte", "start": 0.0, "end": 1.5},
    {"text": "Text...", "start": 1.5, "end": 2.8}
  ],
  "language": "de"
}
```

---

## In Schreibdienst einbinden

### .env.local konfigurieren

```bash
# Voxtral Lokal Server
VOXTRAL_LOCAL_URL=http://localhost:8000

# Optional: anderes Modell (wenn nicht Voxtral-Mini-3B-2507)
# VOXTRAL_LOCAL_MODEL=mistralai/Voxtral-Mini-4B-Realtime-2602
```

### Provider auswählen

In der Schreibdienst-UI unter **Einstellungen → Transkriptions-Provider**:
- Wähle **"Voxtral Lokal (vLLM/GPU)"**

Oder per API:
```bash
curl -X POST http://localhost:3000/api/config \
  -H "Content-Type: application/json" \
  -H "Authorization: Basic $(echo -n root:passwort | base64)" \
  -d '{"onlineService": "voxtral_local"}'
```

---

## Windows 11 mit WSL2

### 1. WSL2 einrichten

```powershell
# PowerShell als Administrator
wsl --install
# Neustart, dann Ubuntu starten
```

### 2. NVIDIA Treiber (Windows-seitig)

- Aktuellen Game-Ready oder Studio-Treiber installieren: https://www.nvidia.com/Download/index.aspx
- **Kein CUDA Toolkit in WSL2 nötig** — der Windows-Treiber stellt CUDA automatisch bereit

### 3. GPU in WSL2 prüfen

```bash
nvidia-smi
# Sollte deine GPU zeigen (z.B. "Tesla V100-PCIE-32GB")
```

### 4. Installation in WSL2

```bash
# Python venv
sudo apt update && sudo apt install python3-venv python3-pip -y
python3 -m venv ~/voxtral-env
source ~/voxtral-env/bin/activate

# vLLM installieren
pip install vllm "mistral-common[audio]"

# HuggingFace Login
pip install huggingface_hub
huggingface-cli login

# Server starten
vllm serve mistralai/Voxtral-Mini-3B-2507 \
  --host 0.0.0.0 --port 8000 \
  --tokenizer-mode mistral --config-format mistral --load-format mistral \
  --max-model-len 8192 --enforce-eager --dtype half \
  --gpu-memory-utilization 0.9
```

Der Server ist dann von Windows unter `http://localhost:8000` erreichbar.

### 5. Realtime-Modell unter WSL2 (für Live-Diktat)

```bash
source ~/voxtral-env/bin/activate

vllm serve mistralai/Voxtral-Mini-4B-Realtime-2602 \
  --host 0.0.0.0 --port 8000 \
  --tokenizer-mode mistral --config-format mistral --load-format mistral \
  --max-model-len 8192 --enforce-eager --dtype half \
  --gpu-memory-utilization 0.9
```

WebSocket ist dann unter `ws://localhost:8000/v1/realtime` erreichbar (WSL2 leitet Ports automatisch weiter).

---

## GPU-spezifische Flags

| GPU-Generation | `--dtype` | `--enforce-eager` | Anmerkung |
|---------------|-----------|-------------------|-----------|
| Pascal (GTX 1080, V100) | `half` | Ja | Kein Flash Attention 2 |
| Ampere (RTX 3090, A100) | `auto` | Optional | Flash Attention 2 verfügbar |
| Ada (RTX 4090) | `auto` | Nein | Beste Performance |

### V100-Optimierung

```bash
vllm serve mistralai/Voxtral-Mini-3B-2507 \
  --host 0.0.0.0 --port 8000 \
  --tokenizer-mode mistral --config-format mistral --load-format mistral \
  --max-model-len 8192 \
  --enforce-eager \
  --dtype half \
  --gpu-memory-utilization 0.9 \
  --max-num-seqs 4
```

### RTX 4090 Optimierung

```bash
vllm serve mistralai/Voxtral-Mini-3B-2507 \
  --host 0.0.0.0 --port 8000 \
  --tokenizer-mode mistral --config-format mistral --load-format mistral \
  --max-model-len 8192 \
  --dtype auto \
  --gpu-memory-utilization 0.9 \
  --max-num-seqs 8
```

---

## Als Systemdienst (Linux)

Damit der vLLM-Server beim Systemstart automatisch läuft.

### Batch-Modell (3B) als Dienst

```bash
sudo tee /etc/systemd/system/voxtral.service << 'EOF'
[Unit]
Description=Voxtral vLLM Transcription Server (Batch)
After=network.target

[Service]
Type=simple
User=$USER
WorkingDirectory=/home/$USER
Environment="PATH=/home/$USER/voxtral-env/bin:/usr/local/bin:/usr/bin"
ExecStart=/home/$USER/voxtral-env/bin/vllm serve mistralai/Voxtral-Mini-3B-2507 \
  --host 0.0.0.0 --port 8000 \
  --tokenizer-mode mistral --config-format mistral --load-format mistral \
  --max-model-len 8192 --enforce-eager --dtype half \
  --gpu-memory-utilization 0.9
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
```

### Realtime-Modell (4B) als Dienst

```bash
sudo tee /etc/systemd/system/voxtral-realtime.service << 'EOF'
[Unit]
Description=Voxtral vLLM Realtime Transcription Server (WebSocket)
After=network.target
Conflicts=voxtral.service

[Service]
Type=simple
User=$USER
WorkingDirectory=/home/$USER
Environment="PATH=/home/$USER/voxtral-env/bin:/usr/local/bin:/usr/bin"
ExecStart=/home/$USER/voxtral-env/bin/vllm serve mistralai/Voxtral-Mini-4B-Realtime-2602 \
  --host 0.0.0.0 --port 8000 \
  --tokenizer-mode mistral --config-format mistral --load-format mistral \
  --max-model-len 8192 --enforce-eager --dtype half \
  --gpu-memory-utilization 0.9
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
```

> **Hinweis:** `Conflicts=voxtral.service` stellt sicher, dass nicht beide gleichzeitig laufen (gleicher Port, gleiche GPU).

### Dienst aktivieren

```bash
# $USER durch tatsächlichen Benutzernamen ersetzen, dann:
sudo systemctl daemon-reload

# Für Live-Diktat (Realtime):
sudo systemctl enable voxtral-realtime
sudo systemctl start voxtral-realtime

# ODER für Batch-Transkription:
sudo systemctl enable voxtral
sudo systemctl start voxtral

# Zwischen Modi wechseln:
sudo systemctl stop voxtral-realtime && sudo systemctl start voxtral
sudo systemctl stop voxtral && sudo systemctl start voxtral-realtime

# Logs anschauen
journalctl -u voxtral-realtime -f
```

---

## Docker-Alternative

### Batch-Modell (3B)

```bash
docker run --gpus all -p 8000:8000 \
  -v ~/.cache/huggingface:/root/.cache/huggingface \
  -e HUGGING_FACE_HUB_TOKEN=hf_xxx \
  vllm/vllm-openai:latest \
  --model mistralai/Voxtral-Mini-3B-2507 \
  --host 0.0.0.0 --port 8000 \
  --tokenizer-mode mistral --config-format mistral --load-format mistral \
  --max-model-len 8192 --enforce-eager --dtype half \
  --gpu-memory-utilization 0.9
```

### Realtime-Modell (4B) — für Live-Diktat

```bash
docker run --gpus all -p 8000:8000 \
  -v ~/.cache/huggingface:/root/.cache/huggingface \
  -e HUGGING_FACE_HUB_TOKEN=hf_xxx \
  vllm/vllm-openai:latest \
  --model mistralai/Voxtral-Mini-4B-Realtime-2602 \
  --host 0.0.0.0 --port 8000 \
  --tokenizer-mode mistral --config-format mistral --load-format mistral \
  --max-model-len 8192 --enforce-eager --dtype half \
  --gpu-memory-utilization 0.9
```

> Der WebSocket-Endpoint ist automatisch unter `ws://localhost:8000/v1/realtime` erreichbar.

---

## Realtime-Modus (Live-Diktat via WebSocket)

Für Echtzeit-Transkription während des Diktierens nutzt Schreibdienst das **Realtime-Modell** über eine WebSocket-Verbindung. Text erscheint dabei live während des Sprechens.

### Batch vs. Realtime — wann welches Modell?

| | Batch (3B) | Realtime (4B) |
|---|---|---|
| **Modell** | `Voxtral-Mini-3B-2507` | `Voxtral-Mini-4B-Realtime-2602` |
| **API** | HTTP `POST /v1/audio/transcriptions` | WebSocket `ws://…/v1/realtime` |
| **Anwendung** | Offline-Diktat (Aufnahme → Datei → Server) | Online-Diktat (Mikrofon → Live-Text) |
| **VRAM** | ~6-8 GB | ~8-10 GB |
| **Latenz** | Sekunden (gesamte Datei) | Millisekunden (streaming) |

> **Wichtig:** Beide Modelle können **nicht gleichzeitig** auf einer GPU laufen (gleicher Port). Starte das Modell, das zu deinem Haupt-Anwendungsfall passt. Für reines Live-Diktat → Realtime. Für nachträgliche Transkription langer Aufnahmen → Batch.

### Schritt 1: Realtime-Modell starten

```bash
source ~/voxtral-env/bin/activate

vllm serve mistralai/Voxtral-Mini-4B-Realtime-2602 \
  --host 0.0.0.0 \
  --port 8000 \
  --tokenizer-mode mistral \
  --config-format mistral \
  --load-format mistral \
  --max-model-len 8192 \
  --enforce-eager \
  --dtype half \
  --gpu-memory-utilization 0.9
```

Erster Start dauert **5-10 Minuten** (Download ~8 GB).

### Schritt 2: WebSocket-Endpoint testen

```bash
# Health-Check (HTTP)
curl http://localhost:8000/health

# WebSocket Endpoint prüfen (sollte 101 Upgrade zurückgeben)
curl -i -N \
  -H "Connection: Upgrade" \
  -H "Upgrade: websocket" \
  -H "Sec-WebSocket-Version: 13" \
  -H "Sec-WebSocket-Key: dGVzdA==" \
  http://localhost:8000/v1/realtime
```

### Schritt 3: In Schreibdienst nutzen

Keine zusätzliche Konfiguration nötig — der WebSocket-Endpoint wird automatisch aus `VOXTRAL_LOCAL_URL` abgeleitet:

```
VOXTRAL_LOCAL_URL=http://localhost:8000
→ WebSocket: ws://localhost:8000/v1/realtime
```

Wähle in der UI den Provider **"Voxtral Lokal (vLLM/GPU)"** und diktiere im Online-Modus.

### Funktionsweise (Protokoll-Details)

Der Browser öffnet eine WebSocket-Verbindung und sendet Audio in Echtzeit:

```
Client                              vLLM Server
  │                                      │
  │── session.update ──────────────────→ │  (PCM16 16kHz, context_bias)
  │←──────────────── session.updated ──  │
  │                                      │
  │── input_audio_buffer.append ───────→ │  (base64-kodierte PCM16 Chunks)
  │── input_audio_buffer.append ───────→ │  (alle ~250ms ein Chunk)
  │←──────────────── transcription.delta │  (partieller Text)
  │── input_audio_buffer.append ───────→ │
  │←──────────────── transcription.done  │  (finaler Satz)
  │── input_audio_buffer.append ───────→ │
  │   ...                                │
  │── input_audio_buffer.commit ───────→ │  (Aufnahme beendet)
  │←──────────────── transcription.done  │  (letzter Satz)
  │                                      │
```

**Audio-Format:** PCM16, 16 kHz, Mono, base64-kodiert  
**Wörterbuch:** Fachwörter aus dem Schreibdienst-Wörterbuch werden als `context_bias` in der `session.update`-Nachricht übergeben  
**Diktat-Logik:** Sprachbefehle wie "Punkt" werden client-seitig erkannt und in Satzzeichen umgewandelt

### V100-Optimierung für Realtime

Das 4B Realtime-Modell passt gut auf die V100 (32 GB):

```bash
vllm serve mistralai/Voxtral-Mini-4B-Realtime-2602 \
  --host 0.0.0.0 --port 8000 \
  --tokenizer-mode mistral --config-format mistral --load-format mistral \
  --max-model-len 8192 --enforce-eager --dtype half \
  --gpu-memory-utilization 0.9 --max-num-seqs 4
```

---

## Troubleshooting

### "CUDA out of memory"

```bash
# Kleinere max-model-len verwenden
--max-model-len 4096

# Oder weniger parallele Anfragen
--max-num-seqs 1
```

### "Model not found" / 403

- HuggingFace Login prüfen: `huggingface-cli whoami`
- Lizenz auf der Modell-Seite akzeptiert?
- Token hat Read-Berechtigung?

### Server startet, aber GPU wird nicht genutzt

```bash
# CUDA verfügbar?
python3 -c "import torch; print(torch.cuda.is_available(), torch.cuda.get_device_name(0))"
```

### Langsame Transkription

- `nvidia-smi` prüfen: GPU-Auslastung sollte bei >80% liegen
- `--max-num-seqs` erhöhen für mehr Parallelität
- Bei V100: `--enforce-eager` ist Pflicht (kein Flash Attention)

### vLLM startet nicht unter WSL2

```bash
# Prüfe ob NVIDIA Container runtime verfügbar ist
docker run --rm --gpus all nvidia/cuda:12.0.0-base-ubuntu22.04 nvidia-smi

# Falls nicht: Docker Desktop Settings prüfen
# ✅ "Use the WSL 2 based engine"
# ✅ Resources → WSL Integration → Ubuntu aktivieren
```

### WebSocket verbindet nicht (Realtime-Modus)

- **Falsches Modell?** Der `/v1/realtime` Endpoint existiert nur wenn das Realtime-Modell (`Voxtral-Mini-4B-Realtime-2602`) geladen ist, nicht beim Batch-Modell
- **Port blockiert?** `lsof -i :8000` prüfen
- **Firewall?** WSL2 leitet Ports normalerweise automatisch weiter. Falls nicht: `netsh interface portproxy add v4tov4 listenport=8000 listenaddress=0.0.0.0 connectport=8000 connectaddress=$(wsl hostname -I | awk '{print $1}')` in PowerShell
- **Browser-Konsole prüfen:** `F12` → Console → nach `[Voxtral]` Meldungen suchen

### Kein Text beim Live-Diktat

- **Mikrofon-Berechtigung?** Browser muss Mikrofon-Zugriff erlauben (HTTPS oder localhost)
- **vLLM Logs prüfen:** `journalctl -u voxtral-realtime -f` — kommen WebSocket-Verbindungen an?
- **Audio-Format:** Schreibdienst sendet PCM16 16kHz Mono — das Realtime-Modell erwartet genau dieses Format

---

## Vergleich: Voxtral Lokal vs. Cloud

| | Voxtral Lokal (vLLM) | Mistral Cloud API | WhisperX Lokal |
|---|---|---|---|
| **Kosten** | Nur Strom (~€10/Monat) | ~$0.02/min | Nur Strom |
| **Datenschutz** | ✅ 100% lokal | ❌ Cloud | ✅ 100% lokal |
| **Qualität (DE)** | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐⭐ | ⭐⭐⭐⭐ |
| **Geschwindigkeit** | GPU-abhängig | Schnell | GPU-abhängig |
| **Timestamps** | ✅ Segmente | ✅ Segmente | ✅ Wort-Level |
| **context_bias** | ✅ (Realtime session) | ✅ | ❌ (initial_prompt) |
| **Live-Diktat** | ✅ WebSocket Realtime | ❌ (nur Batch) | ✅ (Fast Whisper) |
| **Min. GPU** | 12 GB VRAM | Keine | 6 GB VRAM |
| **Setup** | Mittel | Einfach (API Key) | Einfach (Docker) |

---

## Env-Variablen Übersicht

| Variable | Default | Beschreibung |
|----------|---------|-------------|
| `VOXTRAL_LOCAL_URL` | `http://localhost:8000` | URL des vLLM-Servers (HTTP + WS) |
| `VOXTRAL_LOCAL_MODEL` | `mistralai/Voxtral-Mini-3B-2507` | HuggingFace Modell-ID (Batch) |

> **WebSocket-URL:** Wird automatisch aus `VOXTRAL_LOCAL_URL` abgeleitet:  
> `http://localhost:8000` → `ws://localhost:8000/v1/realtime`  
> `https://voxtral.example.com` → `wss://voxtral.example.com/v1/realtime`
