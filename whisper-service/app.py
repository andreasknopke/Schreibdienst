#!/usr/bin/env python3
"""
WhisperX Speech-to-Text Service
Serverseitige Spracherkennung mit WhisperX
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import whisperx
import torch
import tempfile
import os
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

# Modell beim Start laden
logger.info(f"Loading WhisperX model {MODEL_NAME} on {DEVICE}...")
model = whisperx.load_model(MODEL_NAME, DEVICE, compute_type=COMPUTE_TYPE, language=LANGUAGE)
logger.info("WhisperX model loaded successfully")

# Alignment-Modell (optional, für bessere Zeitstempel)
try:
    model_a, metadata = whisperx.load_align_model(language_code=LANGUAGE, device=DEVICE)
    logger.info("Alignment model loaded successfully")
except Exception as e:
    logger.warning(f"Could not load alignment model: {e}")
    model_a = None
    metadata = None


@app.route('/health', methods=['GET'])
def health():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'device': DEVICE,
        'model': MODEL_NAME,
        'language': LANGUAGE
    })


@app.route('/transcribe', methods=['POST'])
def transcribe():
    """
    Transkribiert Audio mit WhisperX
    
    Erwartet:
    - file: Audio-Datei (multipart/form-data)
    
    Optional:
    - language: Sprache (Standard: de)
    - align: Alignment aktivieren (Standard: true)
    """
    try:
        # Datei aus Request holen
        if 'file' not in request.files:
            return jsonify({'error': 'No file provided'}), 400
        
        file = request.files['file']
        if file.filename == '':
            return jsonify({'error': 'Empty filename'}), 400
        
        # Optionale Parameter
        language = request.form.get('language', LANGUAGE)
        do_align = request.form.get('align', 'true').lower() == 'true'
        user_prompt = request.form.get('initial_prompt', '')  # Wörterbuch-Wörter vom Frontend
        
        # Initial Prompt zusammenbauen: Format-Hinweis + Benutzer-Wörter
        if user_prompt:
            initial_prompt = f"{FORMAT_PROMPT} {user_prompt}"
        else:
            initial_prompt = FORMAT_PROMPT
        
        logger.info(f"Transcribing file: {file.filename}, language: {language}, align: {do_align}")
        logger.info(f"Initial prompt: {initial_prompt[:100]}..." if len(initial_prompt) > 100 else f"Initial prompt: {initial_prompt}")
        
        # Temporäre Datei erstellen
        with tempfile.NamedTemporaryFile(delete=False, suffix=Path(file.filename).suffix) as tmp_file:
            file.save(tmp_file.name)
            tmp_path = tmp_file.name
        
        try:
            # Audio laden und transkribieren
            logger.info("Loading audio...")
            audio = whisperx.load_audio(tmp_path)
            
            logger.info("Transcribing with WhisperX...")
            result = model.transcribe(audio, batch_size=16, language=language, initial_prompt=initial_prompt)
            
            # Alignment für bessere Zeitstempel (optional)
            if do_align and model_a is not None:
                logger.info("Aligning transcription...")
                result = whisperx.align(
                    result["segments"], 
                    model_a, 
                    metadata, 
                    audio, 
                    DEVICE,
                    return_char_alignments=False
                )
            
            # Vollständigen Text extrahieren
            full_text = " ".join([segment["text"] for segment in result["segments"]])
            
            logger.info(f"Transcription successful: {len(result['segments'])} segments")
            
            return jsonify({
                'text': full_text.strip(),
                'segments': result['segments'],
                'language': result.get('language', language)
            })
            
        finally:
            # Temporäre Datei löschen
            if os.path.exists(tmp_path):
                os.unlink(tmp_path)
    
    except Exception as e:
        logger.error(f"Transcription error: {str(e)}", exc_info=True)
        return jsonify({
            'error': 'Transcription failed',
            'message': str(e)
        }), 500


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, debug=False)
