#!/bin/bash

# Push alle Änderungen zu Git

echo "📦 Füge Dateien hinzu..."
git add -A

echo "✍️  Erstelle Commit..."
git commit -m "Add Mistral Transcribe API test scripts and update model to voxtral-small-latest

- Added test-mistral-simple.js: Standalone test script using native Node modules
- Added test-mistral-transcribe.js: Full test script with node-fetch (optional)
- Added generate-test-audio.js: Generate silent WAV file for testing
- Added generate_test_audio.py: Python version of WAV generator
- Added create-test-audio.sh: Create test audio with text-to-speech
- Added TEST-MISTRAL-README.md: Comprehensive testing documentation
- Added test-audio.wav: Test audio file
- Updated voxtral model from 'mini' to 'small' in both transcribe routes
  - app/api/transcribe/route.ts: voxtral-small-latest
  - app/api/offline-dictations/worker/route.ts: voxtral-small-latest"

echo "🚀 Pushe zu GitHub..."
git push

echo "✅ Erfolgreich gepusht!"
