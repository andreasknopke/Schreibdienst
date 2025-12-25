# Transkriptions-Provider Konfiguration

Diese App unterstützt flexible Transkriptions-Provider: **WhisperX** (lokal/remote) oder **ElevenLabs** (Cloud).

## Konfigurations-Optionen

### ✅ Option 1: WhisperX lokal (Empfohlen)

**Vorteile:**
- 100% lokal, keine Cloud
- Keine API-Kosten
- Beste Qualität mit large-v2
- DSGVO-konform

**Setup:**
```bash
# In .env.local
TRANSCRIPTION_PROVIDER=whisperx
WHISPER_SERVICE_URL=http://localhost:5000
```

```bash
# WhisperX starten
docker-compose up -d whisper

# Oder ohne Docker:
cd whisper-service
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python app.py
```

---

### 🌐 Option 2: WhisperX remote

**Vorteile:**
- Zentraler WhisperX-Server für mehrere Clients
- Leichtgewichtiges Frontend
- Gleiche Qualität wie lokal

**Setup:**
```bash
# In .env.local
TRANSCRIPTION_PROVIDER=whisperx
WHISPER_SERVICE_URL=https://your-whisper-server.com
```

**Server-Setup:**
```bash
# Auf deinem Server (z.B. Hetzner)
git clone <repo>
cd whisper-service
docker build -t whisperx .
docker run -d -p 5000:5000 --gpus all whisperx

# Oder mit docker-compose (siehe docker-compose.yml)
```

**Sicherheit für Remote-Setup:**
- Nutze HTTPS mit Reverse Proxy (nginx/Caddy)
- Aktiviere Basic Auth oder API-Keys
- Firewall: Nur bekannte IPs erlauben

Beispiel nginx Config:
```nginx
server {
    listen 443 ssl;
    server_name whisper.your-domain.com;
    
    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;
    
    location / {
        auth_basic "WhisperX";
        auth_basic_user_file /etc/nginx/.htpasswd;
        proxy_pass http://localhost:5000;
    }
}
```

---

### ☁️ Option 3: ElevenLabs Cloud

**Vorteile:**
- Keine eigene Infrastruktur nötig
- Sofort einsatzbereit
- Keine Hardware-Anforderungen

**Nachteile:**
- Kosten: ~$0.10 pro Minute
- Daten gehen an Drittanbieter
- Internet-Verbindung erforderlich

**Setup:**
```bash
# In .env.local
TRANSCRIPTION_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=your_elevenlabs_api_key
```

API-Key erhalten: https://elevenlabs.io/

---

### 🔄 Option 4: WhisperX mit ElevenLabs Fallback

**Vorteile:**
- Primär lokal (WhisperX)
- Fallback wenn WhisperX down ist
- Best of both worlds

**Setup:**
```bash
# In .env.local
TRANSCRIPTION_PROVIDER=whisperx
WHISPER_SERVICE_URL=http://localhost:5000
ELEVENLABS_API_KEY=your_key  # Wird nur bei Fehler verwendet
```

**Verhalten:**
1. Versucht WhisperX
2. Bei Fehler automatisch ElevenLabs
3. Logs zeigen welcher Provider genutzt wurde

---

## Provider-Wechsel

Einfach `.env.local` ändern und Next.js neu starten:

```bash
# .env.local bearbeiten
nano .env.local

# Next.js neu starten
npm run dev
```

Keine Code-Änderungen nötig!

---

## Kosten-Vergleich

### 100 Stunden Transkription pro Monat

| Provider | Setup-Kosten | Laufende Kosten | Gesamt |
|----------|--------------|-----------------|---------|
| WhisperX lokal | €0 (oder Hardware) | ~€10 Strom | **€10/Monat** |
| WhisperX remote | €18.50 (Hetzner CPX31) | €0 | **€18.50/Monat** |
| ElevenLabs | €0 | €600 (100h × €6/h) | **€600/Monat** |

---

## Performance-Vergleich

| Provider | Modell | Geschwindigkeit | Qualität | Offline? |
|----------|--------|----------------|----------|----------|
| WhisperX lokal (GPU) | large-v2 | 2-4x Echtzeit | ⭐⭐⭐⭐⭐ | ✅ |
| WhisperX lokal (CPU) | medium | 10-20x Echtzeit | ⭐⭐⭐⭐ | ✅ |
| WhisperX remote | large-v2 | 2-4x Echtzeit | ⭐⭐⭐⭐⭐ | ❌ |
| ElevenLabs | scribe_v1 | ~1x Echtzeit | ⭐⭐⭐⭐ | ❌ |

---

## Empfehlungen

### Für Entwicklung/Testing:
```bash
TRANSCRIPTION_PROVIDER=whisperx
WHISPER_SERVICE_URL=http://localhost:5000
WHISPER_MODEL=base  # Schnell zum Testen
```

### Für Produktion (kleine Praxis):
```bash
TRANSCRIPTION_PROVIDER=whisperx
WHISPER_SERVICE_URL=http://localhost:5000
WHISPER_MODEL=large-v2  # Beste Qualität
```

### Für Produktion (mehrere Standorte):
```bash
TRANSCRIPTION_PROVIDER=whisperx
WHISPER_SERVICE_URL=https://central-whisper-server.com
WHISPER_MODEL=large-v2
```

### Für Evaluierung/PoC:
```bash
TRANSCRIPTION_PROVIDER=elevenlabs
ELEVENLABS_API_KEY=your_key
# Schnell loslegen, später zu WhisperX wechseln
```

---

## Troubleshooting

### WhisperX nicht erreichbar

**Problem:** `Error: WhisperX API error (connection refused)`

**Lösung:**
```bash
# WhisperX Service-Status prüfen
curl http://localhost:5000/health

# Logs checken
docker-compose logs whisper

# Neu starten
docker-compose restart whisper
```

### ElevenLabs API-Fehler

**Problem:** `Error: ELEVENLABS_API_KEY not configured`

**Lösung:**
```bash
# API-Key in .env.local setzen
echo "ELEVENLABS_API_KEY=sk_..." >> .env.local

# Next.js neu starten
npm run dev
```

### Langsame Transkription

**WhisperX:**
- GPU verwenden (siehe [SETUP_LOCAL_GPU.md](SETUP_LOCAL_GPU.md))
- Kleineres Modell: `WHISPER_MODEL=medium`
- Batch-Size erhöhen

**ElevenLabs:**
- Bereits optimiert, ~1x Echtzeit

---

## Provider-Status anzeigen

Die API gibt den verwendeten Provider zurück:

```json
{
  "text": "Transkribierter Text...",
  "segments": [...],
  "language": "de",
  "provider": "whisperx"  // oder "elevenlabs"
}
```

Im Browser-Console sieht man:
```
Transcription successful with whisperx
```

---

## Migrations-Guide

### Von ElevenLabs zu WhisperX wechseln

1. **WhisperX installieren:**
   ```bash
   docker-compose up -d whisper
   ```

2. **.env.local anpassen:**
   ```bash
   TRANSCRIPTION_PROVIDER=whisperx
   WHISPER_SERVICE_URL=http://localhost:5000
   # ELEVENLABS_API_KEY als Fallback behalten
   ```

3. **Testen:**
   ```bash
   curl -X POST http://localhost:3000/api/transcribe \
     -F "file=@test-audio.webm"
   ```

4. **Produktiv schalten:**
   - Monitoring aktivieren
   - Backup-Strategie für WhisperX-Service
   - Optional: ElevenLabs-Fallback behalten

### Von WhisperX zu Remote wechseln

1. **Remote Server aufsetzen:**
   ```bash
   # Auf Server
   git clone <repo>
   cd whisper-service
   docker-compose up -d
   ```

2. **Lokal nur URL ändern:**
   ```bash
   TRANSCRIPTION_PROVIDER=whisperx
   WHISPER_SERVICE_URL=https://your-server.com
   ```

Fertig! Keine Code-Änderungen nötig.

---

## Weitere Infos

- WhisperX Setup: [SETUP_LOCAL_GPU.md](SETUP_LOCAL_GPU.md)
- Docker Setup: [README.md](README.md#setup)
- Railway Cloud: [RAILWAY.md](RAILWAY.md)
