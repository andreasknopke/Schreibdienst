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

# Retry-Konfiguration
MAX_RETRIES = 3
RETRY_WAIT_AFTER_ERROR = 60  # Sekunden zwischen Retries nach Fehler
VRAM_CLEAR_WAIT = 30  # Sekunden warten nach VRAM-Clear vor Diktat

# Retry-Log für Debugging
RETRY_LOG = []

def log_retry_attempt(attempt: int, error: str, action: str):
    """Loggt Retry-Versuche für Debugging und Monitoring."""
    entry = {
        'timestamp': time.strftime('%Y-%m-%d %H:%M:%S'),
        'attempt': attempt,
        'error': error,
        'action': action
    }
    RETRY_LOG.append(entry)
    # Behalte nur die letzten 100 Einträge
    if len(RETRY_LOG) > 100:
        RETRY_LOG.pop(0)
    logger.warning(f"[RETRY LOG] Attempt {attempt}: {action} - Error: {error}")

def clear_vram():
    """Löscht den VRAM und gibt GPU-Speicher frei."""
    global MODEL_CACHE
    
    logger.info("[VRAM CLEAR] Starting VRAM cleanup...")
    print_vram_usage("BEFORE_CLEAR")
    
    try:
        # Garbage Collection
        gc.collect()
        
        if DEVICE == "cuda":
            # Synchronisiere CUDA
            torch.cuda.synchronize()
            
            # Leere den Cache
            torch.cuda.empty_cache()
            
            # Zusätzliche IPC-Bereinigung (falls verfügbar)
            if hasattr(torch.cuda, 'ipc_collect'):
                torch.cuda.ipc_collect()
            
            # Setze Memory-Statistiken zurück
            torch.cuda.reset_peak_memory_stats()
            
        print_vram_usage("AFTER_CLEAR")
        logger.info("[VRAM CLEAR] ✓ VRAM cleanup complete")
        return True
    except Exception as e:
        logger.error(f"[VRAM CLEAR] ✗ Error during VRAM cleanup: {e}")
        return False

def restart_whisper_models():
    """Startet die Whisper-Modelle neu (lädt sie erneut)."""
    global MODEL_CACHE, model, model_a, metadata
    
    logger.info("[RESTART] Starting Whisper model restart...")
    
    try:
        # Modelle entladen
        MODEL_CACHE["whisperx"] = None
        MODEL_CACHE["faster_whisper"] = None
        MODEL_CACHE["align_model"] = None
        MODEL_CACHE["align_metadata"] = None
        MODEL_CACHE["is_warmed_up"] = False
        
        # VRAM freigeben
        clear_vram()
        
        # Modelle neu laden
        load_models()
        
        # Aliase aktualisieren
        model = MODEL_CACHE["whisperx"]
        model_a = MODEL_CACHE["align_model"]
        metadata = MODEL_CACHE["align_metadata"]
        
        logger.info("[RESTART] ✓ Whisper models restarted successfully")
        return True
    except Exception as e:
        logger.error(f"[RESTART] ✗ Error restarting models: {e}")
        return False

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
    vram_info = {}
    if torch.cuda.is_available():
        vram_info = {
            'allocated_mb': torch.cuda.memory_allocated() / 1024**2,
            'reserved_mb': torch.cuda.memory_reserved() / 1024**2,
        }
    return jsonify({
        'status': 'healthy',
        'device': DEVICE,
        'model': MODEL_NAME,
        'language': LANGUAGE,
        'warmed_up': MODEL_CACHE.get("is_warmed_up", False),
        'turbo_available': MODEL_CACHE.get("faster_whisper") is not None,
        'align_available': MODEL_CACHE.get("align_model") is not None,
        'vram': vram_info,
        'retry_count': len(RETRY_LOG)
    })


@app.route('/clear-vram', methods=['POST'])
def clear_vram_endpoint():
    """
    Endpoint zum manuellen Löschen des VRAM.
    Wird vor jedem Diktat aufgerufen.
    """
    try:
        success = clear_vram()
        return jsonify({
            'status': 'success' if success else 'partial',
            'message': 'VRAM cleared successfully' if success else 'VRAM clear had issues',
            'device': DEVICE
        })
    except Exception as e:
        logger.error(f"[VRAM CLEAR] Endpoint error: {e}", exc_info=True)
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


@app.route('/restart', methods=['POST'])
def restart_endpoint():
    """
    Endpoint zum Neustarten der Whisper-Modelle.
    Löscht VRAM und lädt Modelle neu.
    """
    try:
        success = restart_whisper_models()
        return jsonify({
            'status': 'success' if success else 'error',
            'message': 'Whisper models restarted successfully' if success else 'Restart failed',
            'device': DEVICE,
            'model': MODEL_NAME
        })
    except Exception as e:
        logger.error(f"[RESTART] Endpoint error: {e}", exc_info=True)
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500


@app.route('/retry-logs', methods=['GET'])
def retry_logs_endpoint():
    """
    Endpoint zum Abrufen der Retry-Logs.
    """
    return jsonify({
        'logs': RETRY_LOG,
        'count': len(RETRY_LOG)
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
    
    Mit automatischem Retry bei Fehlern:
    - VRAM wird vor jedem Diktat gelöscht (30s warten)
    - Bei Fehler: VRAM löschen, Whisper neu starten, 60s warten, erneut versuchen
    - Maximal 3 Versuche
    
    Erwartet:
    - file: Audio-Datei (multipart/form-data)
    
    Optional:
    - language: Sprache (Standard: de)
    - align: Alignment aktivieren (Standard: true)
    - speed_mode: "turbo" für minimale Latenz, "precision" für Wort-Zeitstempel
    """
    # VRAM vor dem Diktat löschen
    logger.info("[PRE-TRANSCRIBE] Clearing VRAM before dictation...")
    clear_vram()
    logger.info(f"[PRE-TRANSCRIBE] Waiting {VRAM_CLEAR_WAIT}s after VRAM clear...")
    time.sleep(VRAM_CLEAR_WAIT)
    
    # Datei-Daten für Retry speichern
    if 'file' not in request.files:
        return jsonify({'error': 'No file provided'}), 400
    
    file = request.files['file']
    if file.filename == '':
        return jsonify({'error': 'Empty filename'}), 400
    
    # Datei in Speicher lesen für Retries
    file_content = file.read()
    file_filename = file.filename
    file.seek(0)  # Reset für erste Verwendung
    
    # Optionale Parameter
    language = request.form.get('language', LANGUAGE)
    do_align = request.form.get('align', 'true').lower() == 'true'
    speed_mode = request.form.get('speed_mode', 'auto')
    user_prompt = request.form.get('initial_prompt', '')
    
    last_error = None
    
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            result = _do_transcription(
                file_content, 
                file_filename, 
                language, 
                do_align, 
                speed_mode, 
                user_prompt,
                attempt
            )
            return result
            
        except Exception as e:
            last_error = str(e)
            logger.error(f"[TRANSCRIBE] Attempt {attempt}/{MAX_RETRIES} failed: {last_error}", exc_info=True)
            log_retry_attempt(attempt, last_error, "transcription_failed")
            
            if attempt < MAX_RETRIES:
                # VRAM löschen und Whisper neu starten
                logger.info(f"[RETRY] Clearing VRAM and restarting Whisper...")
                log_retry_attempt(attempt, last_error, "clearing_vram")
                clear_vram()
                
                logger.info(f"[RETRY] Restarting Whisper models...")
                log_retry_attempt(attempt, last_error, "restarting_whisper")
                restart_whisper_models()
                
                logger.info(f"[RETRY] Waiting {RETRY_WAIT_AFTER_ERROR}s before retry...")
                log_retry_attempt(attempt, last_error, f"waiting_{RETRY_WAIT_AFTER_ERROR}s")
                time.sleep(RETRY_WAIT_AFTER_ERROR)
    
    # Alle Versuche fehlgeschlagen
    logger.error(f"[TRANSCRIBE] All {MAX_RETRIES} attempts failed. Last error: {last_error}")
    log_retry_attempt(MAX_RETRIES, last_error, "all_attempts_exhausted")
    return jsonify({
        'error': 'Transcription failed after all retries',
        'message': last_error,
        'attempts': MAX_RETRIES
    }), 500


def _do_transcription(file_content: bytes, filename: str, language: str, do_align: bool, speed_mode: str, user_prompt: str, attempt: int):
    """
    Interne Transkriptions-Funktion für Retry-Logik.
    """
    start_time = time.time()
    
    # Initial Prompt zusammenbauen
    if user_prompt:
        initial_prompt = f"{FORMAT_PROMPT} {user_prompt}"
    else:
        initial_prompt = FORMAT_PROMPT
    
    # Auto-Modus: Turbo für kurze Clips (Online), Precision für längere (Offline)
    is_turbo = speed_mode == 'turbo' or (speed_mode == 'auto' and 'turbo' in MODEL_NAME.lower())
    
    mode_str = "TURBO ⚡" if is_turbo else "PRECISION 🎯"
    logger.info(f"[{mode_str}] Transcribing (attempt {attempt}): {filename}, language: {language}")
    if initial_prompt:
        logger.info(f"Initial prompt: {initial_prompt[:100]}..." if len(initial_prompt) > 100 else f"Initial prompt: {initial_prompt}")
    
    print_vram_usage("BEFORE_TRANSCRIBE")
    
    # Temporäre Datei erstellen
    suffix = Path(filename).suffix if filename else '.wav'
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp_file:
        tmp_file.write(file_content)
        tmp_path = tmp_file.name
    
    try:
        # Audio laden
        logger.info("Loading audio...")
        audio = whisperx.load_audio(tmp_path)
        audio_duration = len(audio) / 16000
        logger.info(f"Audio loaded: {audio_duration:.1f}s")
        
        if is_turbo:
            # ⚡ TURBO-MODUS
            logger.info("⚡ TURBO: Using native Faster-Whisper core...")
            
            fw_model = MODEL_CACHE.get("faster_whisper", model)
            
            segments_gen, info = fw_model.transcribe(
                audio,
                language=language,
                initial_prompt=initial_prompt,
                beam_size=1,
                best_of=1,
                vad_filter=True,
                word_timestamps=False
            )
            
            segments = [seg._asdict() for seg in segments_gen]
            detected_language = info.language
            
            logger.info(f"⚡ TURBO complete: {len(segments)} segments")
            
        else:
            # 🎯 PRÄZISIONS-MODUS
            logger.info("🎯 PRECISION: Using WhisperX batch pipeline...")
            
            batch_size = 8 if audio_duration < 60 else 16
            
            result = model.transcribe(
                audio, 
                batch_size=batch_size, 
                language=language, 
                initial_prompt=initial_prompt
            )
            
            segments = result["segments"]
            detected_language = result.get("language", language)
            
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
        
        full_text = " ".join([seg.get("text", "") for seg in segments])
        
        transcription_time = time.time() - start_time
        logger.info(f"✓ Transcription done in {transcription_time:.2f}s | Mode: {mode_str} | Attempt: {attempt}")
        print_vram_usage("AFTER_TRANSCRIBE")
        
        return jsonify({
            'text': full_text.strip(),
            'segments': segments,
            'language': detected_language,
            'mode': 'turbo' if is_turbo else 'precision',
            'duration': transcription_time,
            'attempt': attempt
        })
        
    finally:
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)
        gc.collect()
        if DEVICE == "cuda":
            torch.cuda.empty_cache()


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
