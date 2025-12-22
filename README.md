# Schreibdienst

Medizinische Diktate als Web-App: Audio (Mikrofon oder Datei) → Transkription via ElevenLabs → Korrektur & Formatierung als Arztbrief/Befundbericht.

## Features
- Aufnahme im Browser (MediaRecorder) oder Datei-Upload
- Transkription über ElevenLabs Scribe API (deutsch)
- Einfache Korrektur & medizinische Formatierung (ohne externes LLM)
- Export als .docx, Kopieren in die Zwischenablage
- Optionale Conversational-Agent-Vorschau (ElevenLabs ConvAI)

## Voraussetzungen
- Node.js ≥ 18
- ElevenLabs API Key (`ELEVENLABS_API_KEY`)

## Setup
1. Abhängigkeiten installieren
```bash
npm install
```
2. Umgebungsvariablen anlegen
```bash
cp .env.local.example .env.local
# Trage deinen ELEVENLABS_API_KEY ein
```
3. Entwicklung starten
```bash
npm run dev
```
App läuft lokal unter http://localhost:3000

## Env Variablen
- `ELEVENLABS_API_KEY`: Server-seitig für /api/transcribe
- `NEXT_PUBLIC_ENABLE_AGENT`: `1` aktiviert den Demo-Button für den Agenten
- `NEXT_PUBLIC_ELEVENLABS_AGENT_ID`: Agent-ID für ConvAI (optional)

## API Routen
- `POST /api/transcribe` – erwartet `multipart/form-data` mit Feld `file`
- `POST /api/format` – erwartet JSON `{ text: string, mode: "arztbrief"|"befund" }`
- `GET  /api/health` – einfacher Healthcheck

## Datenschutz
Beim Transkribieren werden Audiodaten an ElevenLabs gesendet. Stelle sicher, dass dies mit eurer Datenschutzrichtlinie vereinbar ist und hole ggf. Einwilligungen ein.

## Hinweise
- Die Formatierung nutzt heuristische Regeln (siehe `lib/formatMedical.ts`). Für strengere Korrektur kann später ein LLM eingebunden werden.
- Conversational-Agent ist optional und standardmäßig deaktiviert.