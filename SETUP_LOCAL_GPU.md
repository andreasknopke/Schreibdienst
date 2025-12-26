# Lokales Setup mit NVIDIA GPU

**Transcription Provider:** WhisperX (lokal mit GPU-Beschleunigung)  
_Hinweis: Diese Anleitung gilt nur, wenn `TRANSCRIPTION_PROVIDER=whisperx` in .env.local gesetzt ist._

## Dein System
- ✅ 64GB RAM - Perfekt für große Modelle
- ✅ 12GB NVIDIA GPU (Pascal) - Ausreichend für large-v2
- ✅ Empfehlung: **large-v2** oder **large-v3**

## Performance-Erwartung

Mit deiner 12GB Pascal GPU (z.B. GTX 1080 Ti):

| Modell | VRAM | Geschwindigkeit | Qualität |
|--------|------|-----------------|----------|
| large-v2 | ~10GB | 2-4x Echtzeit | ⭐⭐⭐⭐⭐ Exzellent |
| large-v3 | ~10GB | 2-4x Echtzeit | ⭐⭐⭐⭐⭐ Noch besser |
| medium | ~5GB | 1-2x Echtzeit | ⭐⭐⭐⭐ Sehr gut |

**Beispiel:** 5 Minuten Audio = ~10-20 Minuten Transkription

## Schnellstart

### 1. NVIDIA Container Toolkit installieren

```bash
# Docker NVIDIA Support
distribution=$(. /etc/os-release;echo $ID$VERSION_ID)
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list | \
    sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
    sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
sudo systemctl restart docker
```

### 2. GPU-Test

```bash
# Prüfe ob Docker GPU erkennt
docker run --rm --gpus all nvidia/cuda:12.0.0-base-ubuntu22.04 nvidia-smi
```

Du solltest deine GPU sehen!

### 3. WhisperX mit GPU starten

```bash
# GPU ist bereits in docker-compose.yml aktiviert
docker-compose up -d

# Logs beobachten (erster Start dauert ~5 Minuten - lädt Modell)
docker-compose logs -f whisper
```

### 4. Testen

```bash
# Service-Status
curl http://localhost:5000/health

# Sollte zeigen:
# {"status":"healthy","device":"cuda","model":"large-v2","language":"de"}
```

### 5. App nutzen

```bash
# Next.js starten (in neuem Terminal)
npm install
npm run dev
```

App läuft auf http://localhost:3000

## Modell wechseln

In `docker-compose.yml`:

```yaml
environment:
  - WHISPER_MODEL=large-v3  # oder large-v2, medium
```

Dann neu starten:
```bash
docker-compose down
docker-compose up -d
```

## Troubleshooting

### GPU wird nicht erkannt

```bash
# Prüfe NVIDIA Driver
nvidia-smi

# Prüfe Docker GPU-Support
docker run --rm --gpus all nvidia/cuda:12.0.0-base-ubuntu22.04 nvidia-smi

# Logs checken
docker-compose logs whisper
```

### Out of Memory

Passiert normalerweise nicht mit 12GB, aber falls doch:

```yaml
environment:
  - WHISPER_MODEL=medium  # Kleineres Modell
```

### Langsam

```bash
# GPU-Auslastung checken (in separatem Terminal)
watch -n 1 nvidia-smi

# Sollte 80-100% GPU-Nutzung zeigen während Transkription
```

Falls GPU-Nutzung niedrig:
- Batch-Size in `whisper-service/app.py` erhöhen (Zeile 61: `batch_size=16` → `batch_size=32`)

## Performance-Optimierung

### Option 1: Batch-Size erhöhen

In `whisper-service/app.py`:

```python
result = model.transcribe(audio, batch_size=32, language=language)  # statt 16
```

### Option 2: Flash Attention (für neuere GPUs)

Falls du eine neuere GPU hättest (Ampere/Ada), könnte man Flash Attention aktivieren.
Pascal unterstützt das nicht, aber die Performance ist auch so gut.

### Option 3: Quantisierung

Bereits aktiviert mit `float16` für GPU (siehe `app.py` Zeile 18).

## Kosten

- ⚡ **Strom:** ~200-300W während Transkription
- 💰 **API-Kosten:** €0 (alles lokal!)
- 🔒 **Datenschutz:** 100% lokal, keine Cloud

## Vergleich zu Cloud

| Lösung | Kosten | Geschwindigkeit | Qualität | Datenschutz |
|--------|--------|----------------|----------|-------------|
| **Dein Setup** | Strom | 2-4x Echtzeit | ⭐⭐⭐⭐⭐ | ✅ 100% |
| ElevenLabs API | ~$0.10/min | ~1x Echtzeit | ⭐⭐⭐⭐ | ❌ Cloud |
| OpenAI Whisper API | ~$0.006/min | ~1x Echtzeit | ⭐⭐⭐⭐ | ❌ Cloud |

**Bei 100 Stunden/Monat:**
- Dein Setup: ~€10 Strom
- ElevenLabs: ~€600
- OpenAI: ~€36

## Empfehlung für Produktion

Mit deiner Hardware:

✅ **large-v2** - Beste Balance aus Geschwindigkeit und Qualität  
✅ **Alignment aktiviert** - Präzise Zeitstempel  
✅ **Batch-Size 16-32** - Nutzt deine GPU voll aus  
✅ **Deutsch-Modell** - Bereits konfiguriert  

Das Setup ist perfekt für medizinische Transkription! 🎉

## Wartung

```bash
# Container neu starten
docker-compose restart whisper

# Modell-Cache leeren (bei Problemen)
docker volume rm schreibdienst_whisper-models
docker-compose up -d

# Logs live anschauen
docker-compose logs -f whisper

# Container stoppen
docker-compose down
```

## Nächste Schritte

1. [X] NVIDIA Container Toolkit installieren
2. [ ] `docker-compose up -d` starten
3. [ ] Erste Transkription testen
4. [ ] Optional: Batch-Size optimieren
5. [ ] In Produktion nehmen!

Bei Fragen: Siehe [README.md](README.md) oder [WHISPERX.md](WHISPERX.md)
