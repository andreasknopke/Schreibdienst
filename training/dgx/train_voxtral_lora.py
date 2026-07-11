#!/usr/bin/env python3
"""
train_voxtral_lora.py – LoRA-Feintuning von Voxtral-Mini-3B auf dem DGX Spark (GB10).

Lädt das HuggingFace Dataset (exportiert von export_training_data.py)
und trainiert mistralai/Voxtral-Mini-3B-2507 mit LoRA auf dem Sprachmodell-Teil.

Merge & Export:
  Nach dem Training wird merge_and_unload() aufgerufen, sodass ein direkt
  ladbares fp16-Modell entsteht (identisch zur Produktions-Voxtral-Architektur).

Usage:
  python train_voxtral_lora.py \\
    --data-dir /home/user/voxtral-training/data \\
    --output-dir /home/user/voxtral-training/models/voxtral-mini-finetuned \\
    --model-id mistralai/Voxtral-Mini-3B-2507
"""

import argparse
import json
import logging
import math
import os
import sys
import time
from pathlib import Path
from typing import Optional

import numpy as np

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
logger = logging.getLogger("train_voxtral_lora")

# ============================================================
# Imports
# ============================================================
try:
    import torch
    from torch.utils.data import DataLoader
    from torch.optim import AdamW
    from torch.amp import autocast, GradScaler
except ImportError:
    torch = None
    logger.error("PyTorch nicht installiert → 'pip install torch'")

_has_transformers = False
try:
    from transformers import (
        VoxtralForConditionalGeneration,
        AutoProcessor,
        get_scheduler,
        set_seed,
    )
    _has_transformers = True
except ImportError:
    logger.error("transformers nicht installiert → 'pip install transformers'")

_has_peft = False
try:
    from peft import LoraConfig, get_peft_model, TaskType, PeftModel
    _has_peft = True
except ImportError:
    logger.error("peft nicht installiert → 'pip install peft'")

_has_datasets = False
try:
    from datasets import load_from_disk
    _has_datasets = True
except ImportError:
    logger.error("datasets nicht installiert → 'pip install datasets'")


# ============================================================
# Konfiguration
# ============================================================
DEFAULT_MODEL_ID = "mistralai/Voxtral-Mini-3B-2507"
DEFAULT_DATA_DIR = "./data"
DEFAULT_OUTPUT_DIR = "./models/voxtral-mini-finetuned"
DEFAULT_BATCH_SIZE = 2
DEFAULT_GRAD_ACCUM_STEPS = 8
DEFAULT_LEARNING_RATE = 2e-4
DEFAULT_NUM_EPOCHS = 5
DEFAULT_MAX_LENGTH = 4096
DEFAULT_WARMUP_STEPS = 100
DEFAULT_SAVE_STEPS = 200
DEFAULT_EVAL_STEPS = 200
DEFAULT_LOGGING_STEPS = 25
DEFAULT_LORA_RANK = 32
DEFAULT_LORA_ALPHA = 64
DEFAULT_LORA_DROPOUT = 0.05
DEFAULT_SEED = 42


# ============================================================
# Dataset
# ============================================================

class VoxtralDataset(torch.utils.data.Dataset):
    """
    HuggingFace Dataset Wrapper für Voxtral-Training.

    Verarbeitet Audio + Text getrennt:
      - Audio → processor.feature_extractor → input_features
      - Text  → processor.tokenizer → labels
    """

    def __init__(self, hf_dataset, processor, max_length=4096, is_eval=False):
        self.hf_dataset = hf_dataset
        self.processor = processor
        self.max_length = max_length
        self.is_eval = is_eval

    def __len__(self):
        return len(self.hf_dataset)

    def __getitem__(self, idx):
        item = self.hf_dataset[idx]
        audio_array = item["audio"]["array"]
        sr = item["audio"]["sampling_rate"]
        text = item["text"] or ""

        # ── Audio → input_features ──
        fe = self.processor.feature_extractor
        audio_inputs = fe(audio_array, sampling_rate=sr, return_tensors="pt")
        input_features = audio_inputs["input_features"].squeeze(0)

        # ── Text → labels ──
        tokenizer = self.processor.tokenizer
        tokenized = tokenizer(
            text,
            return_tensors="pt",
            padding="max_length",
            max_length=self.max_length,
            truncation=True,
        )
        labels = tokenized["input_ids"].squeeze(0).clone()
        attention_mask = tokenized.get("attention_mask")
        if attention_mask is not None:
            labels[attention_mask.squeeze(0) == 0] = -100
        else:
            eos_id = tokenizer.eos_token_id
            if eos_id is not None:
                eos_pos = (labels == eos_id).nonzero(as_tuple=True)[0]
                if len(eos_pos) > 0:
                    labels[eos_pos[0] + 1:] = -100

        return {
            "input_features": input_features,
            "labels": labels,
            "_id": torch.tensor(item.get("id", -1), dtype=torch.long),
            "_chunk_idx": torch.tensor(item.get("chunk_idx", -1), dtype=torch.long),
        }


def collate_fn(batch):
    """Dynamisches Padding für Voxtral-Batches.

    input_features: (mel_bins, T) – pad entlang dim=1
    labels:         (T,) – pad mit -100 entlang dim=0
    Metadaten:      direkt stacken
    """
    skip_keys = {"_id", "_chunk_idx"}
    result = {}

    for key in batch[0].keys():
        if key in skip_keys:
            result[key] = torch.stack([b[key] for b in batch])
            continue

        tensors = [b[key] for b in batch]
        ndim = tensors[0].ndim

        if ndim == 1:
            max_len = max(t.shape[0] for t in tensors)
            pad_val = -100 if key == "labels" else 0
            padded = []
            for t in tensors:
                if t.shape[0] < max_len:
                    pad = torch.full((max_len - t.shape[0],), pad_val, dtype=t.dtype)
                    padded.append(torch.cat([t, pad]))
                else:
                    padded.append(t[:max_len])
            result[key] = torch.stack(padded)

        elif ndim == 2:
            max_len = max(t.shape[1] for t in tensors)
            padded = []
            for t in tensors:
                if t.shape[1] < max_len:
                    pad = torch.zeros((t.shape[0], max_len - t.shape[1]), dtype=t.dtype)
                    padded.append(torch.cat([t, pad], dim=1))
                else:
                    padded.append(t[:, :max_len])
            result[key] = torch.stack(padded)

        else:
            raise ValueError(f"Unsupported dim {ndim} for '{key}'")

    return result


# ============================================================
# Modell + LoRA Setup
# ============================================================

def setup_model_and_lora(
    model_id: str,
    hf_token: Optional[str] = None,
    lora_rank: int = 32,
    lora_alpha: int = 64,
    lora_dropout: float = 0.05,
    device: str = "cuda",
):
    """
    Lädt Voxtral, friert Audio-Encoder ein, konfiguriert LoRA auf dem Decoder.
    """
    logger.info(f"Lade Modell: {model_id}")

    kwargs = {}
    if hf_token:
        kwargs["token"] = hf_token

    processor = AutoProcessor.from_pretrained(model_id, **kwargs)
    logger.info(f"Processor: {type(processor).__name__}")

    model = VoxtralForConditionalGeneration.from_pretrained(
        model_id,
        torch_dtype=torch.float16,
        attn_implementation="sdpa",
        **kwargs,
    )
    model = model.to(device)
    model.eval()

    total = sum(p.numel() for p in model.parameters())
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    logger.info(f"Model: {total/1e6:.1f}M params, {trainable/1e6:.1f}M trainable (pre-LoRA)")

    # Audio-Encoder einfrieren, Decoder+LM-Head trainierbar
    for name, param in model.named_parameters():
        if "audio_encoder" in name or "encoder" in name:
            param.requires_grad = False
        elif "lm_head" in name or "decoder" in name or "model" in name:
            param.requires_grad = True
        else:
            param.requires_grad = False

    frozen = sum(p.numel() for p in model.parameters() if not p.requires_grad)
    trainable = sum(p.numel() for p in model.parameters() if p.requires_grad)
    logger.info(f"After freeze: {trainable/1e6:.1f}M trainable, {frozen/1e6:.1f}M frozen")

    lora_config = LoraConfig(
        r=lora_rank,
        lora_alpha=lora_alpha,
        target_modules=["q_proj", "v_proj", "k_proj", "o_proj",
                        "gate_proj", "up_proj", "down_proj"],
        lora_dropout=lora_dropout,
        bias="none",
        task_type=TaskType.SEQ_2_SEQ_LM,
    )

    model = get_peft_model(model, lora_config)
    model.print_trainable_parameters()
    return model, processor


# ============================================================
# Training
# ============================================================

def train(model, train_dataset, eval_dataset, processor, args):
    """LoRA-Training mit Transformer-Architektur."""
    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    logger.info(f"Device: {device}")
    if device.type == "cuda":
        logger.info(f"GPU: {torch.cuda.get_device_name(0)}, "
                    f"VRAM: {torch.cuda.get_device_properties(0).total_memory/1024**3:.1f} GB")

    output_dir = Path(args.output_dir)
    checkpoint_dir = output_dir / "checkpoints"
    tensorboard_dir = output_dir / "tensorboard"
    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    tensorboard_dir.mkdir(parents=True, exist_ok=True)

    train_loader = DataLoader(
        train_dataset, batch_size=args.batch_size, shuffle=True,
        collate_fn=collate_fn, num_workers=2, pin_memory=True,
    )
    eval_loader = None
    if eval_dataset is not None:
        eval_loader = DataLoader(
            eval_dataset, batch_size=args.batch_size, shuffle=False,
            collate_fn=collate_fn, num_workers=1, pin_memory=True,
        )

    optimizer = AdamW(
        filter(lambda p: p.requires_grad, model.parameters()),
        lr=args.learning_rate, weight_decay=0.01,
    )

    total_steps = len(train_loader) * args.num_epochs // args.grad_accum_steps
    scheduler = get_scheduler(
        "cosine", optimizer=optimizer,
        num_warmup_steps=args.warmup_steps,
        num_training_steps=total_steps,
    )

    scaler = GradScaler("cuda", enabled=(device.type == "cuda"))

    from torch.utils.tensorboard import SummaryWriter
    writer = SummaryWriter(log_dir=str(tensorboard_dir))

    model.train()
    global_step = 0
    best_eval_loss = float("inf")
    log_loss = 0.0
    log_steps = 0
    t_start = time.time()

    logger.info(f"Total steps: {total_steps}")

    for epoch in range(args.num_epochs):
        epoch_loss = 0.0
        optimizer.zero_grad()

        for step, batch in enumerate(train_loader):
            batch = {k: v.to(device) for k, v in batch.items()
                     if k not in ("_id", "_chunk_idx")}

            with autocast("cuda", enabled=(device.type == "cuda"), dtype=torch.float16):
                outputs = model(**batch)
                loss = outputs.loss / args.grad_accum_steps

            scaler.scale(loss).backward()
            log_loss += loss.item() * args.grad_accum_steps
            log_steps += 1
            epoch_loss += loss.item() * args.grad_accum_steps

            if (step + 1) % args.grad_accum_steps == 0:
                scaler.unscale_(optimizer)
                torch.nn.utils.clip_grad_norm_(model.parameters(), 1.0)
                scaler.step(optimizer)
                scaler.update()
                scheduler.step()
                optimizer.zero_grad()
                global_step += 1

                if global_step % args.logging_steps == 0:
                    avg_loss = log_loss / max(log_steps, 1)
                    lr_current = scheduler.get_last_lr()[0]
                    elapsed = time.time() - t_start
                    logger.info(
                        f"Ep {epoch+1}/{args.num_epochs} | "
                        f"S {global_step}/{total_steps} | "
                        f"Loss {avg_loss:.4f} | LR {lr_current:.2e} | "
                        f"{elapsed:.0f}s"
                    )
                    writer.add_scalar("Loss/train", avg_loss, global_step)
                    writer.add_scalar("LR", lr_current, global_step)
                    log_loss = 0.0
                    log_steps = 0

                if global_step % args.save_steps == 0:
                    ckpt = checkpoint_dir / f"step_{global_step}"
                    model.save_pretrained(str(ckpt))
                    processor.save_pretrained(str(ckpt))

                if eval_loader and global_step % args.eval_steps == 0:
                    eval_loss = evaluate(model, eval_loader, device)
                    logger.info(f"Eval Loss (S{global_step}): {eval_loss:.4f}")
                    writer.add_scalar("Loss/eval", eval_loss, global_step)
                    model.train()
                    if eval_loss < best_eval_loss:
                        best_eval_loss = eval_loss
                        best_path = checkpoint_dir / "best"
                        model.save_pretrained(str(best_path))
                        processor.save_pretrained(str(best_path))

        logger.info(f"Epoch {epoch+1} – Avg Loss: {epoch_loss/max(step+1, 1):.4f}")
        model.save_pretrained(str(checkpoint_dir / f"epoch_{epoch+1}"))

    writer.close()
    logger.info(f"Training done in {(time.time()-t_start)/60:.1f}min")

    final_path = output_dir / "lora-final"
    model.save_pretrained(str(final_path))
    processor.save_pretrained(str(final_path))
    return final_path


def evaluate(model, eval_loader, device):
    """Evaluierungsloss berechnen."""
    model.eval()
    total_loss = 0.0
    num = 0
    with torch.no_grad():
        for batch in eval_loader:
            batch = {k: v.to(device) for k, v in batch.items()
                     if k not in ("_id", "_chunk_idx")}
            with autocast("cuda", enabled=(device.type == "cuda"), dtype=torch.float16):
                outputs = model(**batch)
            total_loss += outputs.loss.item()
            num += 1
    return total_loss / max(num, 1)


# ============================================================
# Merge
# ============================================================

def merge_and_export(peft_path, base_model_id, output_dir, processor, hf_token=None):
    """Merge LoRA-Adapter mit Base-Modell → direkt ladbares fp16-Modell."""
    logger.info("=" * 60)
    logger.info("  Merge LoRA → Full Model (fp16)")
    logger.info("=" * 60)

    kwargs = {}
    if hf_token:
        kwargs["token"] = hf_token

    base = VoxtralForConditionalGeneration.from_pretrained(
        base_model_id, torch_dtype=torch.float16, **kwargs,
    )
    peft = PeftModel.from_pretrained(base, peft_path)
    merged = peft.merge_and_unload()

    out = Path(output_dir)
    out.mkdir(parents=True, exist_ok=True)
    merged.save_pretrained(str(out), safe_serialization=True)
    processor.save_pretrained(str(out))

    size_gb = sum(f.stat().st_size for f in out.rglob("*")) / 1024**3
    logger.info(f"Modell gespeichert: {out} ({size_gb:.2f} GB)")

    # Verifikation
    test = VoxtralForConditionalGeneration.from_pretrained(
        str(out), torch_dtype=torch.float16,
    )
    logger.info(f"Verifikation: {type(test).__name__} geladen, "
                f"{sum(p.numel() for p in test.parameters())/1e6:.1f}M params")
    return str(out)


# ============================================================
# Main
# ============================================================

def main():
    parser = argparse.ArgumentParser(description="Voxtral LoRA Training (DGX Spark)")

    # Daten
    parser.add_argument("--data-dir", default=DEFAULT_DATA_DIR)
    parser.add_argument("--model-id", default=DEFAULT_MODEL_ID)
    parser.add_argument("--hf-token", default=None)
    parser.add_argument("--output-dir", default=DEFAULT_OUTPUT_DIR)

    # Training
    parser.add_argument("--batch-size", type=int, default=DEFAULT_BATCH_SIZE)
    parser.add_argument("--grad-accum-steps", type=int, default=DEFAULT_GRAD_ACCUM_STEPS)
    parser.add_argument("--learning-rate", type=float, default=DEFAULT_LEARNING_RATE)
    parser.add_argument("--num-epochs", type=int, default=DEFAULT_NUM_EPOCHS)
    parser.add_argument("--max-length", type=int, default=DEFAULT_MAX_LENGTH)
    parser.add_argument("--warmup-steps", type=int, default=DEFAULT_WARMUP_STEPS)
    parser.add_argument("--seed", type=int, default=DEFAULT_SEED)
    parser.add_argument("--save-steps", type=int, default=DEFAULT_SAVE_STEPS)
    parser.add_argument("--eval-steps", type=int, default=DEFAULT_EVAL_STEPS)
    parser.add_argument("--logging-steps", type=int, default=DEFAULT_LOGGING_STEPS)

    # LoRA
    parser.add_argument("--lora-rank", type=int, default=DEFAULT_LORA_RANK)
    parser.add_argument("--lora-alpha", type=int, default=DEFAULT_LORA_ALPHA)
    parser.add_argument("--lora-dropout", type=float, default=DEFAULT_LORA_DROPOUT)

    # Merge
    parser.add_argument("--merge-only", default=None, help="Nur Merge, kein Training")
    parser.add_argument("--skip-merge", action="store_true")

    args = parser.parse_args()
    if args.hf_token is None:
        args.hf_token = os.environ.get("HF_TOKEN")
    set_seed(args.seed)

    # ── Merge-Only ──
    if args.merge_only:
        logger.info("Merge-Only Mode")
        processor = AutoProcessor.from_pretrained(args.model_id)
        merge_and_export(args.merge_only, args.model_id, args.output_dir, processor, args.hf_token)
        return

    # ── Dataset ──
    ds_dir = Path(args.data_dir) / "dataset"
    if not ds_dir.exists():
        logger.error(f"Dataset nicht gefunden: {ds_dir}")
        sys.exit(1)

    dataset = load_from_disk(str(ds_dir))
    logger.info(f"Dataset: {len(dataset)} Beispiele, Spalten: {list(dataset.features.keys())}")

    split = dataset.train_test_split(test_size=0.1, seed=args.seed)
    logger.info(f"Train: {len(split['train'])}, Eval: {len(split['test'])}")

    durations = [d["audio_duration_seconds"] for d in dataset]
    logger.info(f"Audio: Ø {np.mean(durations):.1f}s, min {np.min(durations):.2f}s, max {np.max(durations):.1f}s")

    # ── Modell ──
    model, processor = setup_model_and_lora(
        args.model_id, args.hf_token,
        lora_rank=args.lora_rank, lora_alpha=args.lora_alpha, lora_dropout=args.lora_dropout,
    )

    train_ds = VoxtralDataset(split["train"], processor, max_length=args.max_length)
    eval_ds = VoxtralDataset(split["test"], processor, max_length=args.max_length, is_eval=True) if len(split["test"]) > 0 else None

    # ── Training ──
    lora_path = train(model, train_ds, eval_ds, processor, args)

    # ── Merge ──
    if not args.skip_merge:
        merge_and_export(str(lora_path), args.model_id, args.output_dir, processor, args.hf_token)

    logger.info("=" * 60)
    logger.info("  Training erfolgreich abgeschlossen!")
    logger.info(f"  LoRA:     {lora_path}")
    logger.info(f"  Merged:   {args.output_dir}")
    logger.info("=" * 60)


if __name__ == "__main__":
    main()
