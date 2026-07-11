#!/usr/bin/env python3
"""
export_training_data.py – Phase 1+2 der Voxtral-Destillations-Pipeline
======================================================================

Extrahiert archivierte Diktate mit manueller Korrektur aus dem SQL-Dump,
konvertiert Audio nach WAV 16 kHz, chunked anhand von Word-Timestamps
aus dictation_segments, und erstellt ein HuggingFace Dataset (Arrow/Parquet).

Usage:
  # Umgebung aktivieren (vorher setup_export_env.ps1 ausführen)
  cd training
  python export_training_data.py

  # Mit benutzerdefinierter DB
  python export_training_data.py --host 127.0.0.1 --port 3306 --user root --password ... --database schreibdienst

Siehe README.md für die vollständige Pipeline-Dokumentation.
"""

import argparse
import json
import os
import sys
import time
import logging
from pathlib import Path
from typing import Any, Optional
from difflib import SequenceMatcher
from concurrent.futures import ThreadPoolExecutor, as_completed

import numpy as np
import soundfile as sf
from tqdm import tqdm

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("export_training_data")

# ============================================================
# Optionale Importe
# ============================================================
try:
    import pymysql
    pymysql.install_as_MySQLdb()
except ImportError:
    pymysql = None
    logger.error("pymysql nicht installiert → 'pip install pymysql'")

try:
    from dotenv import load_dotenv
    load_dotenv()
except ImportError:
    pass

try:
    import librosa
except ImportError:
    librosa = None
    logger.error("librosa nicht installiert → 'pip install librosa'")

try:
    import datasets
    from datasets import Dataset, Audio, Features, Value, Sequence as DatasetSequence
except ImportError:
    datasets = None
    logger.error("datasets nicht installiert → 'pip install datasets'")


# ============================================================
# Konfiguration (aus .env oder CLI)
# ============================================================
DB_HOST = os.getenv("DB_HOST", "127.0.0.1")
DB_PORT = int(os.getenv("DB_PORT", "3307"))
DB_USER = os.getenv("DB_USER", "root")
DB_PASSWORD = os.getenv("DB_PASSWORD", "schreibdienst")
DB_NAME = os.getenv("DB_NAME", "schreibdienst")
DUMP_PATH = os.getenv("DUMP_PATH", "../database/schreibdienst-db-2026-07-11.sql")
OUTPUT_DIR = Path(os.getenv("OUTPUT_DIR", "../data"))
TARGET_SR = int(os.getenv("TARGET_SR", "16000"))
WORKERS = int(os.getenv("WORKERS", "4"))
LIMIT = int(os.getenv("LIMIT", "0"))
CHUNK_DURATION = float(os.getenv("CHUNK_DURATION", "30.0"))
CHUNK_OVERLAP = float(os.getenv("CHUNK_OVERLAP", "0.25"))
MAX_DURATION_FULL = float(os.getenv("MAX_DURATION_FULL", "180.0"))


# ============================================================
# SQL Queries
# ============================================================

FILTER_SQL = """
SELECT
    d.id, d.username, d.audio_mime_type, d.audio_duration_seconds,
    d.order_number, d.patient_name, d.patient_dob,
    d.priority, d.status, d.mode,
    d.raw_transcript, d.transcript, d.methodik, d.befund, d.beurteilung,
    d.corrected_text, d.change_score,
    d.archived_at, d.archived_by, d.created_at, d.completed_at,
    a.audio_data,
    s.segments
FROM offline_dictations d
JOIN dictation_audio a ON a.dictation_id = d.id
LEFT JOIN dictation_segments s ON s.dictation_id = d.id
WHERE d.archived = TRUE
  AND EXISTS (
      SELECT 1 FROM correction_log cl
      WHERE cl.dictation_id = d.id AND cl.correction_type = 'manual'
  )
  AND d.corrected_text IS NOT NULL AND TRIM(d.corrected_text) != ''
  AND a.audio_data IS NOT NULL
ORDER BY d.archived_at DESC
"""

CORRECTION_LOG_SQL = """
SELECT cl.id, cl.correction_type, cl.model_name, cl.model_provider,
       cl.username, cl.text_before, cl.text_after, cl.change_score,
       cl.metadata_json, cl.created_at
FROM correction_log cl
WHERE cl.dictation_id = %s
ORDER BY cl.created_at ASC
"""


# ============================================================
# Datenbank-Helper
# ============================================================

def get_db_connection(host, port, user, password, database):
    if pymysql is None:
        raise ImportError("pymysql nicht installiert")
    return pymysql.connect(
        host=host,
        port=port,
        user=user,
        password=password,
        database=database,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
    )


def fetch_dictations(conn, limit=0):
    """Archivierte Diktate mit manueller Korrektur + Audio + corrected_text abrufen."""
    sql = FILTER_SQL
    if limit > 0:
        sql += f" LIMIT {limit}"
    with conn.cursor() as cur:
        cur.execute(sql)
        rows = cur.fetchall()
    logger.info(f"Gefundene Diktate: {len(rows)} (limit={limit or 'alle'})")
    return rows


def fetch_correction_log(conn, dictation_id):
    """Korrekturprotokoll für ein Diktat abrufen."""
    with conn.cursor() as cur:
        cur.execute(CORRECTION_LOG_SQL, (dictation_id,))
        rows = cur.fetchall()
    return rows


# ============================================================
# Audio-Konvertierung
# ============================================================

def convert_to_wav(audio_bytes: bytes, source_mime: str) -> tuple[Optional[np.ndarray], int]:
    """
    Konvertiert rohe Audio-Bytes nach WAV 16 kHz Mono.
    Gibt (samples, sampling_rate) zurück.
    """
    if librosa is None:
        raise ImportError("librosa nicht installiert")

    import tempfile
    with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        y, sr = librosa.load(tmp_path, sr=None, mono=True)
        if sr != TARGET_SR:
            y = librosa.resample(y, orig_sr=sr, target_sr=TARGET_SR)
        return y, TARGET_SR
    except Exception as e:
        logger.error(f"Audio-Konvertierung fehlgeschlagen: {e}")
        return None, TARGET_SR
    finally:
        os.unlink(tmp_path)


def audio_chunk_by_timestamps(y: np.ndarray, sr: int, start_sec: float, end_sec: float) -> np.ndarray:
    """Extrahiert einen Audio-Ausschnitt anhand von Start/End-Sekunden."""
    start_sample = int(start_sec * sr)
    end_sample = int(end_sec * sr)
    start_sample = max(0, start_sample)
    end_sample = min(len(y), end_sample)
    if start_sample >= end_sample:
        return np.array([], dtype=y.dtype)
    return y[start_sample:end_sample]


def chunk_audio_fixed_windows(y: np.ndarray, sr: int) -> list[dict]:
    """
    Fallback: Fixed-Window-Chunking für Diktate ohne Word-Timestamps.
    Erzeugt CHUNK_DURATION-Sekunden-Fenster mit CHUNK_OVERLAP-Overlap.
    """
    total_sec = len(y) / sr
    if total_sec <= CHUNK_DURATION:
        return [{"start": 0.0, "end": total_sec, "type": "full"}]

    chunks = []
    step = CHUNK_DURATION * (1.0 - CHUNK_OVERLAP)
    pos = 0.0
    while pos < total_sec:
        end = min(pos + CHUNK_DURATION, total_sec)
        chunks.append({"start": pos, "end": end, "type": "window"})
        pos += step
        if end >= total_sec:
            break
    return chunks


# ============================================================
# Text-Alignment: Segment-Roh-Text → corrected_text
# ============================================================

def _build_chunk_text(
    chunk_segments: list[dict],
    corrected_text: str,
    all_segments: list[dict],
) -> str:
    """
    Findet den zum Audio-Chunk passenden corrected_text via SequenceMatcher.
    Fallback: Roh-Text der Segmente.
    """
    raw_chunk_text = " ".join(s.get("text", "") for s in chunk_segments).strip()

    if not corrected_text or not raw_chunk_text:
        return raw_chunk_text

    if raw_chunk_text in corrected_text:
        return raw_chunk_text

    matcher = SequenceMatcher(None, raw_chunk_text.lower(), corrected_text.lower())
    ratio = matcher.ratio()

    if ratio > 0.5:
        i, j, k = matcher.find_longest_match(
            0, len(raw_chunk_text),
            0, len(corrected_text),
        )
        if k > max(10, len(raw_chunk_text) * 0.3):
            return corrected_text[j:j + k]

    return raw_chunk_text


# ============================================================
# Chunking-Strategie (mit Word-Timestamps)
# ============================================================

def build_chunks_from_segments(
    segments: list[dict],
    corrected_text: str,
    audio_duration: float,
) -> list[dict]:
    """
    Erzeugt Trainings-Chunks basierend auf Word-Timestamps.

    Kurze Audios (< CHUNK_DURATION) → ein Chunk.
    Lange Audios → Segment-Grenzen, max CHUNK_DURATION pro Chunk.
    """
    if not segments:
        return []

    if audio_duration <= CHUNK_DURATION:
        return [{
            "start": 0.0,
            "end": audio_duration,
            "text": corrected_text,
            "segments": segments,
        }]

    chunks = []
    current_chunk_segments = []
    current_start = segments[0].get("start", 0.0) if segments else 0.0

    for seg in segments:
        seg_start = seg.get("start", 0.0)
        seg_end = seg.get("end", 0.0)

        if current_chunk_segments:
            chunk_duration = seg_end - current_start
            if chunk_duration > CHUNK_DURATION:
                chunk_text = _build_chunk_text(
                    current_chunk_segments, corrected_text, all_segments=segments
                )
                chunks.append({
                    "start": current_start,
                    "end": current_chunk_segments[-1]["end"],
                    "text": chunk_text,
                    "segments": list(current_chunk_segments),
                })
                overlap_sec = CHUNK_DURATION * CHUNK_OVERLAP
                while current_chunk_segments:
                    if current_chunk_segments[0]["end"] >= seg_start - overlap_sec:
                        break
                    current_chunk_segments.pop(0)
                if current_chunk_segments:
                    current_start = current_chunk_segments[0]["start"]
                else:
                    current_start = seg_start

        current_chunk_segments.append(seg)

    if current_chunk_segments:
        chunk_text = _build_chunk_text(
            current_chunk_segments, corrected_text, all_segments=segments
        )
        chunks.append({
            "start": current_start,
            "end": current_chunk_segments[-1]["end"],
            "text": chunk_text,
            "segments": list(current_chunk_segments),
        })

    return chunks


# ============================================================
# Export-Logik pro Diktat
# ============================================================

def export_dictation(
    row: dict,
    conn,
    output_dir: Path,
) -> list[dict]:
    """
    Exportiert ein Diktat:
    1. Konvertiert Audio → WAV 16 kHz
    2. Parst Word-Timestamps
    3. Baut Chunks (an Segment-Grenzen)
    4. Schreibt WAV-Dateien
    5. Gibt Trainings-Beispiele zurück
    """
    dict_id = row["id"]
    audio_data = row.get("audio_data")
    segments_raw = row.get("segments")
    corrected_text = row.get("corrected_text") or ""
    audio_mime = row.get("audio_mime_type") or "audio/ogg"
    audio_duration = row.get("audio_duration_seconds") or 0.0
    mode = row.get("mode") or "befund"
    username = row.get("username") or ""

    if not audio_data:
        logger.debug(f"Diktat {dict_id}: Keine Audio-Daten")
        return []

    # Word-Timestamps parsen
    segments = []
    if segments_raw:
        try:
            segments = json.loads(segments_raw) if isinstance(segments_raw, (str, bytes)) else segments_raw
        except (json.JSONDecodeError, TypeError) as e:
            logger.warning(f"Diktat {dict_id}: segments-Parsefehler: {e}")

    # Korrektur-Log laden
    correction_log = fetch_correction_log(conn, dict_id)
    has_llm = any(cl["correction_type"] == "llm" for cl in correction_log)
    has_manual = any(cl["correction_type"] == "manual" for cl in correction_log)
    if not has_manual:
        logger.debug(f"Diktat {dict_id}: Keine manuelle Korrektur – überspringe")
        return []

    # Audio konvertieren
    y, sr = convert_to_wav(audio_data, audio_mime)
    if y is None or len(y) == 0:
        logger.error(f"Diktat {dict_id}: Audio-Konvertierung fehlgeschlagen")
        return []

    actual_duration = len(y) / sr

    # Chunking
    if segments:
        chunks = build_chunks_from_segments(segments, corrected_text, actual_duration)
    else:
        chunks = chunk_audio_fixed_windows(y, sr)
        for c in chunks:
            c["text"] = corrected_text
            c["segments"] = []

    if not chunks:
        chunks = [{"start": 0.0, "end": actual_duration, "text": corrected_text, "segments": segments or []}]

    # WAV-Dateien schreiben
    audio_dir = output_dir / "audio"
    audio_dir.mkdir(parents=True, exist_ok=True)

    examples = []
    for idx, chunk in enumerate(chunks):
        start_sec = chunk["start"]
        end_sec = chunk["end"]
        chunk_text = chunk.get("text", corrected_text)

        chunk_audio = audio_chunk_by_timestamps(y, sr, start_sec, end_sec)
        if len(chunk_audio) == 0:
            logger.warning(f"Diktat {dict_id}, Chunk {idx}: Leeres Audio")
            continue

        chunk_duration = len(chunk_audio) / sr
        audio_filename = f"{dict_id:06d}_{idx:03d}.wav"
        audio_path = audio_dir / audio_filename
        sf.write(str(audio_path), chunk_audio, sr)
        file_size = audio_path.stat().st_size

        examples.append({
            "id": dict_id,
            "chunk_idx": idx,
            "audio_path": str(audio_path.resolve()),
            "audio_filename": audio_filename,
            "text": chunk_text.strip(),
            "audio_duration_seconds": round(chunk_duration, 3),
            "start_sec": round(start_sec, 3),
            "end_sec": round(end_sec, 3),
            "mode": mode,
            "username": username,
            "file_size_bytes": file_size,
            "sampling_rate": sr,
            "has_llm_correction": has_llm,
            "has_manual_correction": has_manual,
            "num_corrections": len(correction_log),
            "correction_log": [
                {
                    "type": cl["correction_type"],
                    "model": cl.get("model_name"),
                    "provider": cl.get("model_provider"),
                    "username": cl.get("username"),
                    "change_score": cl.get("change_score"),
                }
                for cl in correction_log
            ],
        })

    return examples


# ============================================================
# HuggingFace Dataset bauen
# ============================================================

def build_hf_dataset(examples: list[dict], output_dir: Path) -> Optional[Dataset]:
    """Baut ein HuggingFace Dataset aus den extrahierten Trainingsbeispielen."""
    if datasets is None:
        logger.error("HuggingFace 'datasets' nicht installiert -> kein Dataset")
        return None

    if not examples:
        logger.warning("Keine Trainingsbeispiele -> kein Dataset")
        return None

    features = Features({
        "id": Value("int32"),
        "chunk_idx": Value("int32"),
        "audio": Audio(sampling_rate=TARGET_SR),
        "text": Value("string"),
        "audio_duration_seconds": Value("float32"),
        "start_sec": Value("float32"),
        "end_sec": Value("float32"),
        "mode": Value("string"),
        "username": Value("string"),
        "has_llm_correction": Value("bool"),
        "has_manual_correction": Value("bool"),
        "num_corrections": Value("int32"),
        "correction_log": DatasetSequence({
            "type": Value("string"),
            "model": Value("string"),
            "provider": Value("string"),
            "username": Value("string"),
            "change_score": Value("int32"),
        }),
    })

    data_dict = {
        "id": [ex["id"] for ex in examples],
        "chunk_idx": [ex["chunk_idx"] for ex in examples],
        "audio": [str(ex["audio_path"]) for ex in examples],
        "text": [ex["text"] for ex in examples],
        "audio_duration_seconds": [ex["audio_duration_seconds"] for ex in examples],
        "start_sec": [ex["start_sec"] for ex in examples],
        "end_sec": [ex["end_sec"] for ex in examples],
        "mode": [ex["mode"] for ex in examples],
        "username": [ex["username"] for ex in examples],
        "has_llm_correction": [ex["has_llm_correction"] for ex in examples],
        "has_manual_correction": [ex["has_manual_correction"] for ex in examples],
        "num_corrections": [ex["num_corrections"] for ex in examples],
        "correction_log": [ex["correction_log"] for ex in examples],
    }

    dataset = Dataset.from_dict(data_dict, features=features)
    dataset_dir = output_dir / "dataset"
    dataset_dir.mkdir(parents=True, exist_ok=True)

    dataset.save_to_disk(str(dataset_dir))
    logger.info(f"Dataset gespeichert: {dataset_dir}")

    parquet_path = dataset_dir / "train.parquet"
    dataset.to_parquet(str(parquet_path))
    logger.info(f"Parquet gespeichert: {parquet_path}")

    return dataset


# ============================================================
# Report
# ============================================================

def print_report(all_examples: list[dict], duration_sec: float):
    if not all_examples:
        print("\n=== REPORT: Keine Daten exportiert ===")
        return

    unique_ids = set(ex["id"] for ex in all_examples)
    total_audio_sec = sum(ex["audio_duration_seconds"] for ex in all_examples)
    total_file_bytes = sum(ex["file_size_bytes"] for ex in all_examples)
    modes = {}
    for ex in all_examples:
        m = ex["mode"]
        modes[m] = modes.get(m, 0) + 1

    print("\n" + "=" * 60)
    print("  EXPORT REPORT")
    print("=" * 60)
    print(f"  Diktate (eindeutig):   {len(unique_ids)}")
    print(f"  Trainings-Beispiele:   {len(all_examples)} (Chunks)")
    print(f"  Gesamt-Audio:          {total_audio_sec:.1f}s ({total_audio_sec/60:.1f}min)")
    print(f"  Gesamt-Dateigröße:     {total_file_bytes / 1024**3:.2f} GB")
    print(f"  Export-Dauer:          {duration_sec:.1f}s")
    print(f"  Modus-Verteilung:      {modes}")
    print(f"  Sampling-Rate:         {TARGET_SR} Hz")

    durations = [ex["audio_duration_seconds"] for ex in all_examples]
    if durations:
        print(f"  Chunk-Dauer:           Ø {np.mean(durations):.1f}s "
              f"| min {min(durations):.1f}s | max {max(durations):.1f}s")
    print("=" * 60)
    print()


# ============================================================
# Main
# ============================================================

def main():
    parser = argparse.ArgumentParser(
        description="Export archivierter Diktate für Voxtral-Destillation"
    )
    parser.add_argument("--host", default=DB_HOST)
    parser.add_argument("--port", type=int, default=DB_PORT)
    parser.add_argument("--user", default=DB_USER)
    parser.add_argument("--password", default=DB_PASSWORD)
    parser.add_argument("--database", default=DB_NAME)
    parser.add_argument("--output", default=str(OUTPUT_DIR))
    parser.add_argument("--limit", type=int, default=LIMIT,
                        help="Nur N Diktate exportieren (0 = alle)")
    parser.add_argument("--sr", type=int, default=TARGET_SR)
    parser.add_argument("--workers", type=int, default=WORKERS)
    args = parser.parse_args()

    output_dir = Path(args.output)
    output_dir.mkdir(parents=True, exist_ok=True)

    logger.info("=" * 60)
    logger.info("  Export-Training-Data für Voxtral-Destillation")
    logger.info("=" * 60)
    logger.info(f"  Datenbank:     {args.host}:{args.port}/{args.database}")
    logger.info(f"  Output:        {output_dir}")
    logger.info(f"  SR:            {args.sr} Hz")
    logger.info(f"  Limit:         {args.limit or 'alle'}")
    logger.info(f"  Chunk:         {CHUNK_DURATION}s, Overlap {CHUNK_OVERLAP*100:.0f}%")
    logger.info(f"  Workers:       {args.workers}")
    logger.info("")

    t_start = time.time()
    conn = get_db_connection(args.host, args.port, args.user, args.password, args.database)
    rows = fetch_dictations(conn, limit=args.limit)

    if not rows:
        logger.warning("Keine archivierten Diktate mit manueller Korrektur gefunden!")
        conn.close()
        print_report([], time.time() - t_start)
        return

    all_examples = []
    if args.workers > 1 and len(rows) > 1:
        logger.info(f"Exportiere {len(rows)} Diktate mit {args.workers} Workern...")
        with ThreadPoolExecutor(max_workers=args.workers) as executor:
            futures = {
                executor.submit(export_dictation, row, conn, output_dir): row["id"]
                for row in rows
            }
            for future in tqdm(as_completed(futures), total=len(futures), desc="Export"):
                try:
                    all_examples.extend(future.result())
                except Exception as e:
                    logger.error(f"Export-Fehler: {e}")
    else:
        logger.info(f"Exportiere {len(rows)} Diktate (seriell)...")
        for row in tqdm(rows, desc="Export"):
            try:
                all_examples.extend(export_dictation(row, conn, output_dir))
            except Exception as e:
                logger.error(f"Diktat {row['id']}: Export-Fehler: {e}")

    conn.close()
    elapsed = time.time() - t_start
    print_report(all_examples, elapsed)

    if all_examples:
        logger.info("Baue HuggingFace Dataset...")
        dataset = build_hf_dataset(all_examples, output_dir)
        if dataset is not None:
            logger.info(f"Dataset: {len(dataset)} Beispiele")

    # Manifest
    manifest = {
        "export_date": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "num_dictations": len(set(ex["id"] for ex in all_examples)),
        "num_chunks": len(all_examples),
        "total_audio_seconds": round(sum(ex["audio_duration_seconds"] for ex in all_examples), 1),
        "sampling_rate": args.sr,
        "chunk_duration": CHUNK_DURATION,
        "chunk_overlap": CHUNK_OVERLAP,
        "db_name": args.database,
    }
    with open(output_dir / "manifest.json", "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=2, ensure_ascii=False)
    logger.info(f"Manifest: {output_dir / 'manifest.json'}")

    logger.info("=" * 60)
    logger.info("  Export abgeschlossen!")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
