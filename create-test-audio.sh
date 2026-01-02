#!/bin/bash

# Erstelle eine Test-Audio-Datei mit Text-to-Speech
# Verwendet verschiedene Methoden je nach Verfügbarkeit

echo "🎤 Erstelle Test-Audio-Datei..."

# Test-Text in Deutsch
TEXT="Guten Tag. Dies ist ein Test der Mistral Transkriptions-API. Der Patient zeigt keine Auffälligkeiten im Hirnparenchym. Die Liquorräume sind nicht erweitert."

# Methode 1: espeak (einfach aber verfügbar)
if command -v espeak &> /dev/null; then
    echo "📢 Verwende espeak..."
    espeak -v de "$TEXT" --stdout > test-audio.wav 2>/dev/null
    echo "✅ test-audio.wav erstellt mit espeak"
    exit 0
fi

# Methode 2: festival
if command -v festival &> /dev/null; then
    echo "📢 Verwende festival..."
    echo "$TEXT" | festival --tts --language german > test-audio.wav 2>/dev/null
    echo "✅ test-audio.wav erstellt mit festival"
    exit 0
fi

# Methode 3: ffmpeg mit Silence (als Fallback)
if command -v ffmpeg &> /dev/null; then
    echo "📢 Verwende ffmpeg (stille Audio als Fallback)..."
    ffmpeg -f lavfi -i anullsrc=r=16000:cl=mono -t 3 -c:a pcm_s16le test-audio.wav -y 2>/dev/null
    echo "⚠️  test-audio.wav erstellt (stille Audio, nur für Format-Test)"
    exit 0
fi

echo "❌ Keine Text-to-Speech Software gefunden (espeak, festival) und kein ffmpeg"
echo "Bitte installiere espeak: apt-get install espeak"
exit 1
