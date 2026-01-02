#!/usr/bin/env node

/**
 * Generiert eine minimal gültige WAV-Datei mit 1 Sekunde Stille
 * zum Testen der Mistral API
 */

const fs = require('fs');

function generateWavFile(filename, durationSeconds = 1) {
  const sampleRate = 16000; // 16 kHz
  const numChannels = 1; // Mono
  const bitsPerSample = 16;
  const numSamples = sampleRate * durationSeconds;
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  
  // WAV Header erstellen
  const buffer = Buffer.alloc(44 + dataSize);
  let offset = 0;
  
  // RIFF chunk
  buffer.write('RIFF', offset); offset += 4;
  buffer.writeUInt32LE(36 + dataSize, offset); offset += 4;
  buffer.write('WAVE', offset); offset += 4;
  
  // fmt sub-chunk
  buffer.write('fmt ', offset); offset += 4;
  buffer.writeUInt32LE(16, offset); offset += 4; // Subchunk1Size
  buffer.writeUInt16LE(1, offset); offset += 2; // AudioFormat (1 = PCM)
  buffer.writeUInt16LE(numChannels, offset); offset += 2; // NumChannels
  buffer.writeUInt32LE(sampleRate, offset); offset += 4; // SampleRate
  buffer.writeUInt32LE(sampleRate * numChannels * bitsPerSample / 8, offset); offset += 4; // ByteRate
  buffer.writeUInt16LE(numChannels * bitsPerSample / 8, offset); offset += 2; // BlockAlign
  buffer.writeUInt16LE(bitsPerSample, offset); offset += 2; // BitsPerSample
  
  // data sub-chunk
  buffer.write('data', offset); offset += 4;
  buffer.writeUInt32LE(dataSize, offset); offset += 4;
  
  // Audio-Daten (Stille = 0)
  // Für einen einfachen Test lassen wir es bei Stille
  // (alle Samples sind bereits 0 durch Buffer.alloc)
  
  fs.writeFileSync(filename, buffer);
  console.log(`✅ Generiert: ${filename}`);
  console.log(`   Dauer: ${durationSeconds}s`);
  console.log(`   Sample Rate: ${sampleRate} Hz`);
  console.log(`   Channels: ${numChannels} (Mono)`);
  console.log(`   Bits per Sample: ${bitsPerSample}`);
  console.log(`   Dateigröße: ${buffer.length} bytes (${(buffer.length / 1024).toFixed(2)} KB)`);
}

// Generiere test-audio.wav
generateWavFile('test-audio.wav', 3);

console.log('');
console.log('⚠️  Hinweis: Dies ist eine stille Audio-Datei zum Testen des API-Formats.');
console.log('   Mistral wird "keine Sprache" erkennen oder einen leeren Text zurückgeben.');
console.log('   Für echte Tests solltest du eine Audio-Datei mit gesprochenem Text verwenden.');
