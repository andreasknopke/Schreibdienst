#!/usr/bin/env node

/**
 * Vereinfachtes Test-Skript für Mistral Transcribe API
 * Verwendet nur native Node.js Module (kein npm install nötig)
 * 
 * Verwendung:
 * node test-mistral-simple.js <audio-file>
 */

const fs = require('fs');
const path = require('path');
const https = require('https');

// Lade .env falls vorhanden
function loadEnv() {
  try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      const envContent = fs.readFileSync(envPath, 'utf-8');
      envContent.split('\n').forEach(line => {
        const match = line.match(/^([^=:#]+)=(.*)$/);
        if (match) {
          const key = match[1].trim();
          const value = match[2].trim().replace(/^["']|["']$/g, '');
          if (!process.env[key]) {
            process.env[key] = value;
          }
        }
      });
    }
  } catch (err) {
    console.log('Info: Keine .env gefunden oder Fehler beim Laden');
  }
}

function makeMultipartData(boundary, fields, file) {
  const parts = [];
  
  // Füge alle Felder hinzu
  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="${name}"\r\n\r\n` +
      `${value}\r\n`
    );
  }
  
  // Füge Datei hinzu
  const fileHeader = 
    `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
    `Content-Type: ${file.contentType}\r\n\r\n`;
  
  const fileFooter = `\r\n--${boundary}--\r\n`;
  
  // Kombiniere alles
  const headerBuffer = Buffer.from(fileHeader, 'utf-8');
  const footerBuffer = Buffer.from(fileFooter, 'utf-8');
  const partsBuffer = Buffer.from(parts.join(''), 'utf-8');
  
  return Buffer.concat([partsBuffer, headerBuffer, file.data, footerBuffer]);
}

function httpsRequest(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', chunk => {
        data += chunk;
      });
      
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: res.headers,
          data: data
        });
      });
    });
    
    req.on('error', reject);
    
    if (body) {
      req.write(body);
    }
    
    req.end();
  });
}

async function testMistralTranscribe(audioFilePath) {
  loadEnv();
  
  const apiKey = process.env.MISTRAL_API_KEY;
  
  if (!apiKey) {
    console.error('❌ MISTRAL_API_KEY nicht gefunden in Umgebungsvariablen');
    console.log('Bitte setze MISTRAL_API_KEY in .env oder als Umgebungsvariable');
    process.exit(1);
  }

  console.log('🔑 API Key gefunden:', apiKey.substring(0, 10) + '...');
  
  if (!audioFilePath) {
    console.error('❌ Keine Audio-Datei angegeben');
    console.log('Verwendung: node test-mistral-simple.js <audio-file>');
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
  const basename = path.basename(audioFilePath);
  
  // Bestimme MIME-Type
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
  
  // Test 1: Basis-Request
  console.log('═══════════════════════════════════════════════════════');
  console.log('TEST 1: Basis-Request');
  console.log('═══════════════════════════════════════════════════════');
  
  try {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    
    const body = makeMultipartData(
      boundary,
      {
        'model': 'voxtral-mini-latest'
      },
      {
        filename: basename,
        contentType: mimeType,
        data: audioBuffer
      }
    );
    
    console.log('🚀 Sende Request...');
    console.log('Model: voxtral-mini-latest');
    console.log(`Body Size: ${(body.length / 1024).toFixed(2)} KB`);
    console.log('');
    
    const startTime = Date.now();
    
    const response = await httpsRequest({
      hostname: 'api.mistral.ai',
      path: '/v1/audio/transcriptions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    }, body);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`⏱️  Dauer: ${duration}s`);
    console.log(`📡 Status: ${response.status} ${response.statusText}`);
    console.log('');
    
    console.log('📋 Response Headers:');
    for (const [key, value] of Object.entries(response.headers)) {
      console.log(`  ${key}: ${value}`);
    }
    console.log('');
    
    if (response.status !== 200) {
      console.error('❌ API-Fehler:');
      console.error(response.data);
      console.log('');
      
      try {
        const errorJson = JSON.parse(response.data);
        console.log('Fehler-Details:');
        console.log(JSON.stringify(errorJson, null, 2));
      } catch (e) {
        // Nicht JSON
      }
    } else {
      const data = JSON.parse(response.data);
      console.log('✅ Erfolgreiche Transkription!');
      console.log('');
      console.log('📝 Response:');
      console.log(JSON.stringify(data, null, 2));
      console.log('');
      console.log('📄 Text:');
      console.log(data.text || '(leer)');
      console.log('');
      console.log(`📊 Text-Länge: ${(data.text || '').length} Zeichen`);
    }
  } catch (error) {
    console.error('❌ Fehler:', error.message);
    console.error(error);
  }
  
  console.log('');
  
  // Test 2: Mit allen Parametern
  console.log('═══════════════════════════════════════════════════════');
  console.log('TEST 2: Mit language + timestamp_granularities');
  console.log('═══════════════════════════════════════════════════════');
  
  try {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    
    const body = makeMultipartData(
      boundary,
      {
        'model': 'voxtral-mini-latest',
        'language': 'de',
        'timestamp_granularities[]': 'word'
      },
      {
        filename: basename,
        contentType: mimeType,
        data: audioBuffer
      }
    );
    
    console.log('🚀 Sende Request...');
    console.log('Model: voxtral-mini-latest');
    console.log('Language: de');
    console.log('Timestamp granularities: word');
    console.log('');
    
    const startTime = Date.now();
    
    const response = await httpsRequest({
      hostname: 'api.mistral.ai',
      path: '/v1/audio/transcriptions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    }, body);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`⏱️  Dauer: ${duration}s`);
    console.log(`📡 Status: ${response.status} ${response.statusText}`);
    console.log('');
    
    if (response.status !== 200) {
      console.error('❌ API-Fehler:');
      console.error(response.data);
      console.log('');
      
      try {
        const errorJson = JSON.parse(response.data);
        console.log('Fehler-Details:');
        console.log(JSON.stringify(errorJson, null, 2));
      } catch (e) {
        // Nicht JSON
      }
    } else {
      const data = JSON.parse(response.data);
      console.log('✅ Erfolgreiche Transkription!');
      console.log('');
      console.log('📝 Response:');
      console.log(JSON.stringify(data, null, 2));
      console.log('');
      console.log('📄 Text:');
      console.log(data.text || '(leer)');
      console.log('');
      console.log(`📊 Text-Länge: ${(data.text || '').length} Zeichen`);
      
      if (data.words) {
        console.log(`🕐 Timestamps: ${data.words.length} Wörter`);
      }
      if (data.segments) {
        console.log(`📊 Segments: ${data.segments.length} Segmente`);
        data.segments.slice(0, 3).forEach((seg, i) => {
          console.log(`  [${i}] ${seg.start?.toFixed(2)}s-${seg.end?.toFixed(2)}s: "${seg.text?.substring(0, 80)}"`);
        });
      }
    }
  } catch (error) {
    console.error('❌ Fehler:', error.message);
    console.error(error);
  }
  
  console.log('');
  
  // Test 3: Mit context_bias für medizinische Fachbegriffe
  console.log('═══════════════════════════════════════════════════════');
  console.log('TEST 3: Mit context_bias (Medizinische Fachbegriffe)');
  console.log('═══════════════════════════════════════════════════════');
  
  try {
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substring(2);
    
    const medTerms = ["Liquorräume", "Mittellinie", "Mittellinienverschiebung", "parenchymatös", "Hirnparenchym", "periventrikulär"];
    
    const parts = [];
    // model
    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="model"\r\n\r\n` +
      `voxtral-mini-latest\r\n`
    );
    // language
    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="language"\r\n\r\n` +
      `de\r\n`
    );
    // timestamp_granularities (segment)
    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="timestamp_granularities[]"\r\n\r\n` +
      `segment\r\n`
    );
    // timestamp_granularities (word)
    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="timestamp_granularities[]"\r\n\r\n` +
      `word\r\n`
    );
    // context_bias
    parts.push(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="context_bias"\r\n\r\n` +
      `${JSON.stringify(medTerms)}\r\n`
    );
    // file
    const fileHeader = 
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${basename}"\r\n` +
      `Content-Type: ${mimeType}\r\n\r\n`;
    const fileFooter = `\r\n--${boundary}--\r\n`;
    
    const partsBuffer = Buffer.from(parts.join(''), 'utf-8');
    const headerBuffer = Buffer.from(fileHeader, 'utf-8');
    const footerBuffer = Buffer.from(fileFooter, 'utf-8');
    const body = Buffer.concat([partsBuffer, headerBuffer, audioBuffer, footerBuffer]);
    
    console.log('🚀 Sende Request...');
    console.log('Model: voxtral-mini-latest');
    console.log('Language: de');
    console.log('Timestamp granularities: segment + word');
    console.log(`Context bias: ${medTerms.join(', ')}`);
    console.log('');
    
    const startTime = Date.now();
    
    const response = await httpsRequest({
      hostname: 'api.mistral.ai',
      path: '/v1/audio/transcriptions',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': body.length
      }
    }, body);
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`⏱️  Dauer: ${duration}s`);
    console.log(`📡 Status: ${response.status} ${response.statusText}`);
    console.log('');
    
    if (response.status !== 200) {
      console.error('❌ API-Fehler:');
      console.error(response.data);
      try {
        const errorJson = JSON.parse(response.data);
        console.log('Fehler-Details:');
        console.log(JSON.stringify(errorJson, null, 2));
      } catch (e) {}
    } else {
      const data = JSON.parse(response.data);
      console.log('✅ Erfolgreiche Transkription mit context_bias!');
      console.log('');
      console.log('📄 Text:');
      console.log(data.text || '(leer)');
      console.log('');
      console.log(`📊 Text-Länge: ${(data.text || '').length} Zeichen`);
      if (data.segments) {
        console.log(`📊 Segments: ${data.segments.length} Segmente`);
      }
      if (data.usage) {
        console.log(`📊 Usage: ${JSON.stringify(data.usage)}`);
      }
    }
  } catch (error) {
    console.error('❌ Fehler:', error.message);
    console.error(error);
  }
  
  console.log('');
  console.log('═══════════════════════════════════════════════════════');
  console.log('✅ Tests abgeschlossen');
  console.log('═══════════════════════════════════════════════════════');
}

// Hauptprogramm
const audioFile = process.argv[2];
testMistralTranscribe(audioFile).catch(err => {
  console.error('Unerwarteter Fehler:', err);
  process.exit(1);
});
