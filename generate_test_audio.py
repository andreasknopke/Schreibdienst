#!/usr/bin/env python3
"""
Generiert eine minimal gültige WAV-Datei zum Testen der Mistral API
"""

import struct
import sys

def generate_wav(filename='test-audio.wav', duration=3, sample_rate=16000):
    """Generiert eine WAV-Datei mit Stille"""
    
    num_channels = 1  # Mono
    bits_per_sample = 16
    num_samples = sample_rate * duration
    data_size = num_samples * num_channels * (bits_per_sample // 8)
    
    with open(filename, 'wb') as f:
        # RIFF header
        f.write(b'RIFF')
        f.write(struct.pack('<I', 36 + data_size))
        f.write(b'WAVE')
        
        # fmt subchunk
        f.write(b'fmt ')
        f.write(struct.pack('<I', 16))  # Subchunk size
        f.write(struct.pack('<H', 1))   # Audio format (PCM)
        f.write(struct.pack('<H', num_channels))
        f.write(struct.pack('<I', sample_rate))
        f.write(struct.pack('<I', sample_rate * num_channels * bits_per_sample // 8))
        f.write(struct.pack('<H', num_channels * bits_per_sample // 8))
        f.write(struct.pack('<H', bits_per_sample))
        
        # data subchunk
        f.write(b'data')
        f.write(struct.pack('<I', data_size))
        
        # Audio data (silence = zeros)
        f.write(b'\x00' * data_size)
    
    file_size = 44 + data_size
    print(f'✅ Generiert: {filename}')
    print(f'   Dauer: {duration}s')
    print(f'   Sample Rate: {sample_rate} Hz')
    print(f'   Channels: {num_channels} (Mono)')
    print(f'   Bits per Sample: {bits_per_sample}')
    print(f'   Dateigröße: {file_size} bytes ({file_size / 1024:.2f} KB)')
    print()
    print('⚠️  Hinweis: Dies ist eine stille Audio-Datei zum Testen des API-Formats.')
    print('   Mistral wird "keine Sprache" erkennen oder einen leeren Text zurückgeben.')

if __name__ == '__main__':
    generate_wav()
