#!/usr/bin/env python3
"""
evaluate_voxtral.py – WER/CER-Evaluation von Voxtral-Modellen auf dem DGX Spark.

Vergleicht Baseline (Original-Modell) mit Finetuned auf dem exportierten Dataset.

Usage:
  # Baseline + Finetuned vergleichen:
  python evaluate_voxtral.py --data-dir ./data \\
      --baseline-model mistralai/Voxtral-Mini-3B-2507 \\
      --finetuned-model ./models/voxtral-mini-finetuned \\
      --max-samples 20

  # Nur Baseline:
  python evaluate_voxtral.py --data-dir ./data --baseline-model mistralai/Voxtral-Mini-3B-2507
"""

import argparse
import json
import logging
import os
import time
from pathlib import Path
from typing import Optional

import numpy as np

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("evaluate_voxtral")

try:
    import torch
except ImportError:
    torch = None

try:
    from transformers import VoxtralForConditionalGeneration, AutoProcessor
except ImportError:
    VoxtralForConditionalGeneration = None
    AutoProcessor = None

try:
    from datasets import load_from_disk
except ImportError:
    load_from_disk = None

try:
    import jiwer
    HAS_JIWER = True
except ImportError:
    HAS_JIWER = False


# ============================================================
# WER/CER
# ============================================================

def _levenshtein(ref, hyp):
    """Levenshtein-Distanz (Listen)."""
    n, m = len(ref), len(hyp)
    dp = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n + 1):
        dp[i][0] = i
    for j in range(m + 1):
        dp[0][j] = j
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            cost = 0 if ref[i - 1] == hyp[j - 1] else 1
            dp[i][j] = min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost)
    return dp[n][m]


def compute_wer(reference: str, hypothesis: str) -> float:
    if HAS_JIWER:
        return jiwer.wer(reference, hypothesis)
    r = reference.strip().split()
    h = hypothesis.strip().split()
    if not r:
        return 0.0 if not h else 1.0
    return _levenshtein(r, h) / max(len(r), 1)


def compute_cer(reference: str, hypothesis: str) -> float:
    if HAS_JIWER:
        return jiwer.cer(reference, hypothesis)
    r = list(reference.strip().lower())
    h = list(hypothesis.strip().lower())
    if not r:
        return 0.0 if not h else 1.0
    return _levenshtein(r, h) / max(len(r), 1)


# ============================================================
# Transkription (einzelne Datei)
# ============================================================

def transcribe_file(model, processor, audio_path: str, language="de",
                    max_new_tokens=512, device="cuda") -> str:
    try:
        import librosa
        audio, sr = librosa.load(audio_path, sr=16000, mono=True)
    except Exception as e:
        logger.error(f"Audio laden fehlgeschlagen: {audio_path} – {e}")
        return ""

    inputs = processor(audio=audio, sampling_rate=sr, return_tensors="pt").to(device)

    with torch.no_grad(), torch.amp.autocast("cuda", enabled=(device == "cuda"), dtype=torch.float16):
        outputs = model.generate(**inputs, max_new_tokens=max_new_tokens,
                                 do_sample=False, num_beams=1)

    decoded = processor.batch_decode(outputs, skip_special_tokens=True)
    return decoded[0].strip() if decoded else ""


# ============================================================
# Evaluation
# ============================================================

def evaluate_model(model_id, dataset, label_key="text",
                   hf_token=None, max_samples=0) -> dict:
    device = "cuda" if torch.cuda.is_available() else "cpu"

    kwargs = {}
    if hf_token:
        kwargs["token"] = hf_token

    logger.info(f"[{model_id}] Lade Modell...")
    t0 = time.time()
    processor = AutoProcessor.from_pretrained(model_id, **kwargs)
    model = VoxtralForConditionalGeneration.from_pretrained(
        model_id, torch_dtype=torch.float16, **kwargs,
    ).to(device).eval()
    logger.info(f"[{model_id}] Geladen in {time.time()-t0:.1f}s")

    if max_samples > 0 and len(dataset) > max_samples:
        indices = np.random.RandomState(42).choice(len(dataset), max_samples, replace=False)
        subset = dataset.select(indices)
    else:
        subset = dataset

    logger.info(f"[{model_id}] Transkribiere {len(subset)} Beispiele...")

    refs, hyps = [], []
    latencies = []

    for i, item in enumerate(subset):
        ap = item.get("audio_path", "") or item.get("audio", {}).get("path", "")
        ref = item.get(label_key, "")
        if not ap or not os.path.exists(ap) or not ref:
            continue

        t_start = time.time()
        hyp = transcribe_file(model, processor, ap, language="de")
        latencies.append(time.time() - t_start)
        refs.append(ref)
        hyps.append(hyp)

        if (i + 1) % 10 == 0:
            logger.info(f"  [{i+1}/{len(subset)}] "
                        f"WER: {compute_wer(ref, hyp):.3f} | "
                        f"HYP: {hyp[:60]}...")

    wer = [compute_wer(r, h) for r, h in zip(refs, hyps)]
    cer = [compute_cer(r, h) for r, h in zip(refs, hyps)]
    audio_dur = sum(item.get("audio_duration_seconds", 0)
                    for item in subset[:len(refs)])

    results = {
        "model": model_id,
        "samples": len(refs),
        "wer_mean": float(np.mean(wer)) if wer else 0,
        "wer_median": float(np.median(wer)) if wer else 0,
        "wer_std": float(np.std(wer)) if wer else 0,
        "cer_mean": float(np.mean(cer)) if cer else 0,
        "avg_latency": round(np.mean(latencies), 3) if latencies else 0,
        "total_latency": round(sum(latencies), 1) if latencies else 0,
        "total_audio_sec": round(audio_dur, 1),
        "rtf": round(sum(latencies) / max(audio_dur, 0.01), 3) if audio_dur > 0 else 0,
    }

    logger.info(f"[{model_id}] WER: {results['wer_mean']:.3f} | "
                f"CER: {results['cer_mean']:.3f} | "
                f"RTF: {results['rtf']:.3f}")
    return results


# ============================================================
# Main
# ============================================================

def main():
    parser = argparse.ArgumentParser(description="Voxtral WER/CER Evaluation")
    parser.add_argument("--data-dir", default="./data")
    parser.add_argument("--baseline-model", default="")
    parser.add_argument("--finetuned-model", default="")
    parser.add_argument("--hf-token", default=None)
    parser.add_argument("--max-samples", type=int, default=0)
    parser.add_argument("--output", default="")
    args = parser.parse_args()
    if args.hf_token is None:
        args.hf_token = os.environ.get("HF_TOKEN")

    ds_dir = Path(args.data_dir) / "dataset"
    if not ds_dir.exists():
        logger.error(f"Dataset nicht gefunden: {ds_dir}")
        return
    dataset = load_from_disk(str(ds_dir))
    logger.info(f"Dataset: {len(dataset)} Beispiele")

    results = []
    for model_id in [args.baseline_model, args.finetuned_model]:
        if not model_id:
            continue
        logger.info(f"\n{'='*60}\n  {model_id}\n{'='*60}")
        try:
            results.append(evaluate_model(
                model_id, dataset, hf_token=args.hf_token, max_samples=args.max_samples))
        except Exception as e:
            logger.error(f"Fehler: {e}")

    if results:
        print("\n" + "=" * 60)
        print("  EVALUIERUNG")
        print("=" * 60)
        for r in results:
            print(f"  {r['model']}")
            print(f"    WER: {r['wer_mean']:.3f} | CER: {r['cer_mean']:.3f} | RTF: {r['rtf']:.3f}")
        if len(results) == 2:
            d = results[0]["wer_mean"] - results[1]["wer_mean"]
            print(f"  Δ WER: {abs(d):.3f} ({'Verbesserung' if d > 0 else 'Verschlechterung'})")
        print("=" * 60)

    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            json.dump(results, f, indent=2, ensure_ascii=False)


if __name__ == "__main__":
    main()
