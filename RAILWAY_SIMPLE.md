# Railway Deployment - Nur Next.js (ohne WhisperX)

Diese Konfiguration deployt nur die Next.js App auf Railway und nutzt ElevenLabs API für Transkription.

## Setup

1. **Railway CLI installieren**
```bash
npm i -g @railway/cli
```

2. **Projekt verbinden**
```bash
railway login
railway link
```

3. **Umgebungsvariablen setzen**
```bash
railway variables set ELEVENLABS_API_KEY=your_api_key_here
railway variables set NODE_ENV=production
```

4. **Deployen**
```bash
railway up
```

## Alternative: GitHub Integration

1. Gehe zu [railway.app](https://railway.app)
2. "New Project" → "Deploy from GitHub repo"
3. Repository auswählen
4. Environment Variables setzen:
   - `ELEVENLABS_API_KEY`
   - `NODE_ENV=production`
5. Deploy starten

## Kosten

- **Free Trial**: $5 Guthaben
- **Hobby Plan**: $5/Monat
- **Pro Plan**: $20/Monat

Für diese App reicht der Hobby Plan.

## Hinweise

- Railway verwendet automatisch den PORT aus der Umgebung
- HTTPS wird automatisch konfiguriert
- Domain: `your-app.railway.app`
- Custom Domain möglich

## Mit WhisperX?

Siehe [RAILWAY.md](RAILWAY.md) für Details, aber:
- ⚠️ WhisperX ist zu ressourcenintensiv für Railway
- Empfehlung: Nutze ElevenLabs API oder separaten Server
