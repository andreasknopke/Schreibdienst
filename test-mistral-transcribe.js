#!/usr/bin/env node

/**
 * Test-Skript für Mistral Transcribe API
 * 
 * Verwendung:
 * 1. Stelle sicher dass MISTRAL_API_KEY in .env gesetzt ist
 * 2. Führe aus: node test-mistral-transcribe.js <audio-file>
 */

const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const fetch = (...args) => import('node-fetch').then(({default: fetch}) => fetch(...args));

// Lade .env falls vorhanden
if (fs.existsSync('.env')) {
  const dotenv = require('dotenv');
  dotenv.config();
}

async function testMistralTranscribe(audioFilePath) {
  const apiKey = process.env.MISTRAL_API_KEY;
  
  if (!apiKey) {
    console.error('❌ MISTRAL_API_KEY nicht gefunden in Umgebungsvariablen');
    console.log('Bitte setze MISTRAL_API_KEY in .env oder als Umgebungsvariable');
    process.exit(1);
  }

  console.log('🔑 API Key gefunden:', apiKey.substring(0, 10) + '...');
  
  if (!audioFilePath) {
    console.error('❌ Keine Audio-Datei angegeben');
    console.log('Verwendung: node test-mistral-transcribe.js <audio-file>');
    process.exit(1);
  }

  if (!fs.existsSync(audioFilePath)) {
    console.error('❌ Audio-Datei nicht gefunden:', audioFilePath);
    process.exit(1);
  }

  const stats = fs.statSync(audioFilePath);
  const fileSizeMB = (stats.size / 1024 / 1024).toFixed(2);
  console.log(`📁 Audio-Datei: ${audioFilePath}`);
  console.log(`📊 Größe: ${fileSizeMB} MB`);
  
  // Lese Datei
  const audioBuffer = fs.readFileSync(audioFilePath);
  const ext = path.extname(audioFilePath).toLowerCase();
  
  // Bestimme MIME-Type basierend auf Dateiendung
  const mimeTypes = {
    '.wav': 'audio/wav',
    '.mp3': 'audio/mpeg',
    '.m4a': 'audio/m4a',
    '.webm': 'audio/webm',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac'
  };
  const mimeType = mimeTypes[ext] || 'audio/wav';
  
  console.log(`🎵 MIME-Type: ${mimeType}`);
  console.log('');
  
  console.log('═══════════════════════════════════════════════════════');
  console.log('TEST 1: Basis-Request mit minimal Parametern');
  console.log('═══════════════════════════════════════════════════════');
  
  try {
    const formData = new FormData();
    formData.append('file', audioBuffer, {
      filename: 'audio' + ext,
      contentType: mimeType
    });
    formData.append('model', 'voxtral-mini-latest');
    
    console.log('🚀 Sende Request an Mistral API...');
    console.log('Endpoint: https://api.mistral.ai/v1/audio/transcriptions');
    console.log('Model: voxtral-mini-latest');
    console.log('File: audio' + ext);
    console.log('');
    
    const startTime = Date.now();
    
    const res = await fetch('https://api.mistral.ai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        ...formData.getHeaders()
      },
      body: formData,
    });
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`⏱️  Dauer: ${duration}s`);
    console.log(`📡 Status: ${res.status} ${res.statusText}`);
    console.log('');
    
    // Zeige Response Headers
    console.log('📋 Response Headers:');
    for (const [key, value] of res.headers.entries()) {
      console.log(`  ${key}: ${value}`);
    }
    console.log('');

    if (!res.ok) {
      const text = await res.text();
      console.error('❌ API-Fehler:');
      console.error(text);
      console.log('');
      
      // Versuche JSON zu parsen für detailliertere Fehlerinfo
      try {
        const errorJson = JSON.parse(text);
        console.log('Fehler-Details:');
        console.log(JSON.stringify(errorJson, null, 2));
      } catch (e) {
        // Nicht JSON, einfach Text ausgeben
      }
    } else {
      const data = await res.json();
      console.log('✅ Erfolgreiche Transkription!');
      console.log('');
      console.log('📝 Response:');
      console.log(JSON.stringify(data, null, 2));
      console.log('');
      console.log('📄 Text:');
      console.log(data.text);
      console.log('');
      console.log(`📊 Text-Länge: ${(data.text || '').length} Zeichen`);
    }
  } catch (error) {
    console.error('❌ Fehler beim Test 1:', error.message);
    console.error(error);
  }
  
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('TEST 2: Mit allen Parametern (language + timestamps)');
  console.log('═══════════════════════════════════════════════════════');
  
  try {
    const formData = new FormData();
    formData.append('file', audioBuffer, {
      filename: 'audio' + ext,
      contentType: mimeType
    });
    formData.append('model', 'voxtral-mini-latest');
    formData.append('language', 'de');
    formData.append('timestamp_granularities[]', 'word');
    
    console.log('🚀 Sende Request an Mistral API...');
    console.log('Model: voxtral-mini-latest');
    console.log('Language: de');
    console.log('Timestamp granularities: word');
    console.log('File: audio' + ext);
    console.log('');
    
    const startTime = Date.now();
    
    const res = await fetch('https://api.mistral.ai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        ...formData.getHeaders()
      },
      body: formData,
    });
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`⏱️  Dauer: ${duration}s`);
    console.log(`📡 Status: ${res.status} ${res.statusText}`);
    console.log('');

    if (!res.ok) {
      const text = await res.text();
      console.error('❌ API-Fehler:');
      console.error(text);
      console.log('');
      
      try {
        const errorJson = JSON.parse(text);
        console.log('Fehler-Details:');
        console.log(JSON.stringify(errorJson, null, 2));
      } catch (e) {
        // Nicht JSON
      }
    } else {
      const data = await res.json();
      console.log('✅ Erfolgreiche Transkription!');
      console.log('');
      console.log('📝 Response:');
      console.log(JSON.stringify(data, null, 2));
      console.log('');
      console.log('📄 Text:');
      console.log(data.text);
      console.log('');
      console.log(`📊 Text-Länge: ${(data.text || '').length} Zeichen`);
      
      if (data.words) {
        console.log(`🕐 Timestamps: ${data.words.length} Wörter mit Zeitstempeln`);
      }
    }
  } catch (error) {
    console.error('❌ Fehler beim Test 2:', error.message);
    console.error(error);
  }
  
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('TEST 3: Als WAV konvertiert (wie im Code)');
  console.log('═══════════════════════════════════════════════════════');
  
  try {
    // Versuche ffmpeg zu nutzen für Konvertierung
    const { execSync } = require('child_process');
    const tmpWavPath = '/tmp/test-audio.wav';
    
    try {
      console.log('🔄 Konvertiere zu WAV mit ffmpeg...');
      execSync(`ffmpeg -i "${audioFilePath}" -ar 16000 -ac 1 -c:a pcm_s16le "${tmpWavPath}" -y 2>&1`, {
        stdio: 'pipe'
      });
      console.log('✅ Konvertierung erfolgreich');
      console.log('');
    } catch (ffmpegError) {
      console.log('⚠️  ffmpeg nicht verfügbar, überspringe WAV-Konvertierung');
      console.log('');
      return;
    }
    
    const wavBuffer = fs.readFileSync(tmpWavPath);
    const wavSizeMB = (wavBuffer.length / 1024 / 1024).toFixed(2);
    console.log(`📊 WAV-Größe: ${wavSizeMB} MB`);
    console.log('');
    
    const formData = new FormData();
    formData.append('file', wavBuffer, {
      filename: 'audio.wav',
      contentType: 'audio/wav'
    });
    formData.append('model', 'voxtral-mini-latest');
    formData.append('language', 'de');
    formData.append('timestamp_granularities[]', 'word');
    
    console.log('🚀 Sende WAV-Request an Mistral API...');
    
    const startTime = Date.now();
    
    const res = await fetch('https://api.mistral.ai/v1/audio/transcriptions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        ...formData.getHeaders()
      },
      body: formData,
    });
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`⏱️  Dauer: ${duration}s`);
    console.log(`📡 Status: ${res.status} ${res.statusText}`);
    console.log('');

    if (!res.ok) {
      const text = await res.text();
      console.error('❌ API-Fehler:');
      console.error(text);
    } else {
      const data = await res.json();
      console.log('✅ Erfolgreiche Transkription mit WAV!');
      console.log('');
      console.log('📄 Text:');
      console.log(data.text);
      console.log('');
      console.log(`📊 Text-Länge: ${(data.text || '').length} Zeichen`);
    }
    
    // Cleanup
    fs.unlinkSync(tmpWavPath);
    
  } catch (error) {
    console.error('❌ Fehler beim Test 3:', error.message);
  }
  
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('✅ Alle Tests abgeschlossen');
  console.log('═══════════════════════════════════════════════════════');
}

// Hauptprogramm
const audioFile = process.argv[2];
testMistralTranscribe(audioFile).catch(err => {
  console.error('Unerwarteter Fehler:', err);
  process.exit(1);
});
