#!/usr/bin/env python3
"""
WhisperX Speech-to-Text Service
Serverseitige Spracherkennung mit WhisperX

Optimiert für minimale Latenz:
- Turbo-Modus: Natives Faster-Whisper ohne Alignment (Online-Streaming)
- Präzisions-Modus: Volles WhisperX mit Alignment (Offline/Mitlesen)
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import whisperx
import torch
import gc
import tempfile
import os
import time
from pathlib import Path
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# WhisperX Modell-Konfiguration
DEVICE = "cuda" if torch.cuda.is_available() else "cpu"
# Verwende int8 für TitanX Pascal und andere ältere GPUs (Pascal-Architektur)
# int8 ist stabiler und schneller auf Pascal-GPUs als float16
COMPUTE_TYPE = "int8"
MODEL_NAME = os.environ.get("WHISPER_MODEL", "large-v2")
LANGUAGE = "de"

# Format-Hinweis für bessere Transkription (immer im initial_prompt enthalten)
FORMAT_PROMPT = "Klammern (so wie diese) und Satzzeichen wie Punkt, Komma, Doppelpunkt und Semikolon sind wichtig."

# Globaler Cache für Modelle (einmal laden, immer nutzen)
MODEL_CACHE = {
    "whisperx": None,       # WhisperX Batch-Modell
    "faster_whisper": None, # Natives Faster-Whisper für Turbo-Modus
    "align_model": None,    # Alignment-Modell
    "align_metadata": None, # Alignment-Metadaten
    "is_warmed_up": False   # Warmup-Status
}

def print_vram_usage(step_name):
    """Überwacht VRAM-Nutzung für Debugging."""
    if torch.cuda.is_available():
        allocated = torch.cuda.memory_allocated() / 1024**2
        reserved = torch.cuda.memory_reserved() / 1024**2
        logger.info(f"[{step_name}] VRAM: {allocated:.2f} MB allocated, {reserved:.2f} MB reserved")

def load_models():
    """Lädt alle Modelle beim Start für minimale Latenz."""
    global MODEL_CACHE
    
    print_vram_usage("BEFORE_LOAD")
    
    # WhisperX Modell laden (für Präzisions-Modus)
    logger.info(f"Loading WhisperX model {MODEL_NAME} on {DEVICE}...")
    MODEL_CACHE["whisperx"] = whisperx.load_model(
        MODEL_NAME, DEVICE, 
        compute_type=COMPUTE_TYPE, 
        language=LANGUAGE
    )
    logger.info("WhisperX model loaded successfully")
    
    # Natives Faster-Whisper Modell extrahieren (für Turbo-Modus)
    # WhisperX wrappt intern ein faster-whisper Modell
    if hasattr(MODEL_CACHE["whisperx"], 'model'):
        MODEL_CACHE["faster_whisper"] = MODEL_CACHE["whisperx"].model
        logger.info("Faster-Whisper core extracted for turbo mode")
    else:
        MODEL_CACHE["faster_whisper"] = MODEL_CACHE["whisperx"]
        logger.info("Using WhisperX model directly for turbo mode")
    
    print_vram_usage("AFTER_WHISPER")
    
    # Alignment-Modell (optional, für Präzisions-Modus)
    try:
        MODEL_CACHE["align_model"], MODEL_CACHE["align_metadata"] = whisperx.load_align_model(
            language_code=LANGUAGE, device=DEVICE
        )
        logger.info("Alignment model loaded and cached")
    except Exception as e:
        logger.warning(f"Could not load alignment model: {e}")
        MODEL_CACHE["align_model"] = None
        MODEL_CACHE["align_metadata"] = None
    
    print_vram_usage("AFTER_ALIGN")
    MODEL_CACHE["is_warmed_up"] = True

# Modelle beim Start laden
load_models()

# Aliase für Kompatibilität
model = MODEL_CACHE["whisperx"]
model_a = MODEL_CACHE["align_model"]
metadata = MODEL_CACHE["align_metadata"]


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'device': DEVICE,
        'model': MODEL_NAME,
        'language': LANGUAGE,
        'warmed_up': MODEL_CACHE.get("is_warmed_up", False),
        'turbo_available': MODEL_CACHE.get("faster_whisper") is not None,
        'align_available': MODEL_CACHE.get("align_model") is not None
    })


@app.route('/warmup', methods=['POST'])
def warmup():
    """
    Warmup-Endpoint für Frontend-Initialisierung.
    Führt eine Mini-Transkription durch, um alle CUDA-Kernel vorzuladen.
    """
    try:
        start_time = time.time()
        
        if not MODEL_CACHE.get("is_warmed_up"):
            load_models()
        
        # Generiere 1 Sekunde Stille für Warmup
        import numpy as np
        silent_audio = np.zeros(16000, dtype=np.float32)  # 1s @ 16kHz
        
        # Warmup mit Turbo-Modus (schnellster Pfad)
        fw_model = MODEL_CACHE.get("faster_whisper")
        if fw_model:
            logger.info("Warming up Faster-Whisper core...")
            # Transkribiere Stille um CUDA-Kernel zu laden
            segments, _ = fw_model.transcribe(
                silent_audio,
                language=LANGUAGE,
                beam_size=1,
                best_of=1,
                vad_filter=False,  # Bei Stille kein VAD
                word_timestamps=False
            )
            # Konsumiere Generator um Ausführung zu triggern
            list(segments)
        
        warmup_time = time.time() - start_time
        logger.info(f"Warmup completed in {warmup_time:.2f}s")
        
        # VRAM nach Warmup freigeben
        gc.collect()
        if DEVICE == "cuda":
            torch.cuda.empty_cache()
        
        return jsonify({
            'status': 'warmed_up',
            'warmup_time': warmup_time,
            'device': DEVICE,
            'model': MODEL_NAME
        })
        
    except Exception as e:
        logger.error(f"Warmup error: {str(e)}", exc_info=True)
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


@app.route('/transcribe', methods=['POST'])
def transcribe():
    """
    Transkribiert Audio mit WhisperX
    
    Erwartet:
    - file: Audio-Datei (multipart/form-data)
    
    Optional:
    - language: Sprache (Standard: de)
    - align: Alignment aktivieren (Standard: true)
    - speed_mode: "turbo" für minimale Latenz, "precision" für Wort-Zeitstempel
    """
    try:
        start_time = time.time()
        
        # Datei aus Request holen
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'Empty filename'}), 400
        
        # Optionale Parameter
        language = request.form.get('language', LANGUAGE)
        do_align = request.form.get('align', 'true').lower() == 'true'
        speed_mode = request.form.get('speed_mode', 'auto')  # turbo, precision, auto
        user_prompt = request.form.get('initial_prompt', '')
        
        # Initial Prompt zusammenbauen
        if user_prompt:
            initial_prompt = f"{FORMAT_PROMPT} {user_prompt}"
        else:
            initial_prompt = FORMAT_PROMPT
        
        # Auto-Modus: Turbo für kurze Clips (Online), Precision für längere (Offline)
        # Turbo-Modus erkennen basierend auf speed_mode oder Modellname
        is_turbo = speed_mode == 'turbo' or (speed_mode == 'auto' and 'turbo' in MODEL_NAME.lower())
        
        mode_str = "TURBO ⚡" if is_turbo else "PRECISION 🎯"
        logger.info(f"[{mode_str}] Transcribing: {file.filename}, language: {language}")
        if initial_prompt:
            logger.info(f"Initial prompt: {initial_prompt[:100]}..." if len(initial_prompt) > 100 else f"Initial prompt: {initial_prompt}")
        
        print_vram_usage("BEFORE_TRANSCRIBE")
        
        # Temporäre Datei erstellen
        with tempfile.NamedTemporaryFile(delete=False, suffix=Path(file.filename).suffix) as tmp_file:
            file.save(tmp_file.name)
            tmp_path = tmp_file.name
        
        try:
            # Audio laden
            logger.info("Loading audio...")
            audio = whisperx.load_audio(tmp_path)
            audio_duration = len(audio) / 16000  # Sekunden bei 16kHz
            logger.info(f"Audio loaded: {audio_duration:.1f}s")
            
            if is_turbo:
                # ⚡ TURBO-MODUS: Natives Faster-Whisper für minimale Latenz
                logger.info("⚡ TURBO: Using native Faster-Whisper core...")
                
                fw_model = MODEL_CACHE.get("faster_whisper", model)
                
                # Native Transkription ohne Batching
                segments_gen, info = fw_model.transcribe(
                    audio,
                    language=language,
                    initial_prompt=initial_prompt,
                    beam_size=1,        # Maximale Geschwindigkeit
                    best_of=1,          # Keine Alternativen prüfen
                    vad_filter=True,    # Verhindert Halluzinationen in Pausen
                    word_timestamps=False  # Spart Rechenzeit
                )
                
                # Generator zu Liste konvertieren
                segments = [seg._asdict() for seg in segments_gen]
                detected_language = info.language
                
                logger.info(f"⚡ TURBO complete: {len(segments)} segments")
                
            else:
                # 🎯 PRÄZISIONS-MODUS: WhisperX Pipeline mit Batching
                logger.info("🎯 PRECISION: Using WhisperX batch pipeline...")
                
                # Batch-Size basierend auf Audio-Länge
                batch_size = 8 if audio_duration < 60 else 16
                
                result = model.transcribe(
                    audio, 
                    batch_size=batch_size, 
                    language=language, 
                    initial_prompt=initial_prompt
                )
                
                segments = result["segments"]
                detected_language = result.get("language", language)
                
                # Alignment für bessere Zeitstempel
                if do_align and model_a is not None:
                    logger.info("Running alignment for word timestamps...")
                    with torch.no_grad():
                        result = whisperx.align(
                            segments, 
                            model_a, 
                            metadata, 
                            audio, 
                            DEVICE,
                            return_char_alignments=False
                        )
                    segments = result["segments"]
                
                logger.info(f"🎯 PRECISION complete: {len(segments)} segments")
            
            # Vollständigen Text extrahieren
            full_text = " ".join([seg.get("text", "") for seg in segments])
            
            transcription_time = time.time() - start_time
            logger.info(f"✓ Transcription done in {transcription_time:.2f}s | Mode: {mode_str}")
            print_vram_usage("AFTER_TRANSCRIBE")
            
            return jsonify({
                'text': full_text.strip(),
                'segments': segments,
                'language': detected_language,
                'mode': 'turbo' if is_turbo else 'precision',
                'duration': transcription_time
            })
            
        finally:
            # Temporäre Datei löschen
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
            # Speicher freigeben
            gc.collect()
            if DEVICE == "cuda":
                torch.cuda.empty_cache()
    
    except Exception as e:
        logger.error(f"Transcription error: {str(e)}", exc_info=True)
        return jsonify({
            'error': 'Transcription failed',
            'message': str(e)
        }), 500


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
