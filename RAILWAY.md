# Railway Deployment Guide

## ⚠️ Wichtige Einschränkungen

Railway eignet sich **bedingt** für WhisperX-Deployment:

### Ressourcen-Anforderungen

| Modell | RAM | Disk | Railway Plan |
|--------|-----|------|--------------|
| tiny | ~2 GB | ~500 MB | ✅ Hobby ($5) |
| base | ~3 GB | ~500 MB | ✅ Hobby |
| small | ~4 GB | ~1 GB | ⚠️ Pro ($20+) |
| medium | ~6 GB | ~2 GB | ❌ Zu groß |
| large-v2 | ~12 GB | ~3 GB | ❌ Zu groß |

**Empfehlung für Railway:** Nutze `tiny` oder `base` Modell.

**Für Produktion:** Nutze einen dedizierten Server (Hetzner, AWS EC2, etc.) mit GPU.

## Deployment-Optionen

### Option 1: Monolith (Nur Next.js, ohne WhisperX)

Am einfachsten: Verzichte auf WhisperX und nutze ElevenLabs API.

```bash
# 1. Repository verbinden
railway link

# 2. Umgebungsvariablen setzen
railway variables set ELEVENLABS_API_KEY=your_key

# 3. Deploy
railway up
```

### Option 2: Multi-Service (Next.js + WhisperX)

Railway unterstützt mehrere Services pro Projekt.

#### Schritt 1: Projekt erstellen

```bash
# Railway CLI installieren
npm i -g @railway/cli

# Projekt erstellen
railway init

# Mit GitHub verbinden
railway link
```

#### Schritt 2: Services konfigurieren

In Railway Dashboard:
1. **Service 1: Next.js App**
   - Root directory: `/`
   - Build command: `npm install && npm run build`
   - Start command: `npm start`
   - Environment:
     ```
     WHISPER_SERVICE_URL=${{whisper.RAILWAY_PRIVATE_DOMAIN}}
     NODE_ENV=production
     ```

2. **Service 2: WhisperX**
   - Root directory: `/whisper-service`
   - Dockerfile: `whisper-service/Dockerfile`
   - Environment:
     ```
     WHISPER_MODEL=tiny
     PORT=5000
     ```
   - Memory: Mindestens 4 GB

#### Schritt 3: Networking

Services kommunizieren über private URLs:
- WhisperX: `whisper.railway.internal:5000`
- Next.js nutzt: `http://${{whisper.RAILWAY_PRIVATE_DOMAIN}}`

### Option 3: Externe WhisperX-Instanz

**Beste Lösung für Produktion:**

1. **WhisperX auf separatem Server** (z.B. Hetzner Cloud mit GPU)
2. **Next.js auf Railway**
3. Verbindung über HTTPS

## Kosten-Schätzung

### Railway (pro Monat)

| Setup | Plan | Kosten |
|-------|------|--------|
| Nur Next.js | Hobby | $5 |
| Next.js + WhisperX (tiny) | Hobby/Pro | $10-20 |
| Next.js + WhisperX (base) | Pro | $20-50 |

### Alternative: Hetzner Cloud

| Server | Specs | Kosten/Monat |
|--------|-------|--------------|
| CPX21 | 3 vCPU, 4 GB RAM | €9.50 |
| CPX31 | 4 vCPU, 8 GB RAM | €18.50 |
| CCX33 | 8 vCPU, 32 GB RAM + GPU | €89 |

## Railway-spezifische Konfiguration

### Whisper Service optimieren

Erstelle `whisper-service/railway.Dockerfile`:

```dockerfile
FROM python:3.10-slim

# Nur essenzielle Dependencies
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .

# Kleinere Torch-Version für Railway
RUN pip install --no-cache-dir torch==2.1.0+cpu torchaudio==2.1.0+cpu -f https://download.pytorch.org/whl/torch_stable.html
RUN pip install --no-cache-dir flask flask-cors whisperx

COPY app.py .

# Modell beim Build downloaden (spart Startup-Zeit)
ENV WHISPER_MODEL=tiny
RUN python -c "import whisperx; whisperx.load_model('tiny', 'cpu')"

EXPOSE 5000
CMD ["python", "app.py"]
```

### Next.js Build optimieren

In `package.json`:

```json
{
  "scripts": {
    "build": "next build",
    "start": "next start -p ${PORT:-3000}"
  }
}
```

## Deployment Checkliste

- [ ] Railway CLI installiert
- [ ] Projekt erstellt und verbunden
- [ ] Umgebungsvariablen gesetzt
- [ ] `WHISPER_MODEL=tiny` für Railway
- [ ] Services konfiguriert
- [ ] Private Networking aktiviert
- [ ] Health Checks eingerichtet
- [ ] Logs überprüft

## Monitoring

```bash
# Logs anschauen
railway logs

# Service-spezifische Logs
railway logs --service whisper
railway logs --service app
```

## Empfehlung

Für medizinische Anwendungen mit hohen Anforderungen:

### Entwicklung/Testing
✅ Railway mit `tiny` Modell

### Produktion
❌ **Nicht Railway** - Nutze stattdessen:
1. **Hetzner Cloud** (CPX31 oder GPU-Server)
2. **AWS EC2** (g4dn.xlarge mit GPU)
3. **Eigener Server** mit Docker Compose

**Grund:** WhisperX mit `large-v2` ist zu ressourcenintensiv für Railway und liefert deutlich bessere Ergebnisse für medizinische Transkription.

## Alternative: Hybrid-Ansatz

**Beste Balance aus Kosten und Qualität:**

```
Railway (Next.js)  →  Eigener Hetzner Server (WhisperX)
     $5/Monat              $18.50/Monat + bessere Qualität
```

So kannst du Railway für das Frontend nutzen und WhisperX auf dedizierter Hardware laufen lassen.
