#!/usr/bin/env bash
# ============================================================
# start_training.sh – Voxtral LoRA Training auf DGX Spark (GB10)
#
# Nutzt den Docker-Container der Produktion (voxtral-vllm-dgx),
# ergänzt um Trainings-Abhängigkeiten (PEFT, TRL, TensorBoard).
#
# Das trainierte Modell wird automatisch gemergt und unter
#   ~/voxtral-training/models/voxtral-mini-finetuned/
# abgelegt.
#
# Usage:
#   ./start_training.sh                          # Training + Merge
#   HF_TOKEN=hf_xxx ./start_training.sh          # Mit Token
#   ./start_training.sh --skip-merge             # Nur LoRA, kein Merge
#   ./start_training.sh --merge-only /pfad       # Nur Merge
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${SCRIPT_DIR}/data"
MODEL_ID="${VOXTRAL_LOCAL_MODEL:-mistralai/Voxtral-Mini-3B-2507}"
OUTPUT_DIR="${SCRIPT_DIR}/models/voxtral-mini-finetuned"
BATCH_SIZE="${TRAIN_BATCH_SIZE:-2}"
GRAD_ACCUM="${TRAIN_GRAD_ACCUM:-8}"
LEARNING_RATE="${TRAIN_LR:-2e-4}"
NUM_EPOCHS="${TRAIN_EPOCHS:-5}"
LORA_RANK="${TRAIN_LORA_RANK:-32}"
CACHE_DIR="${HF_HOME:-${HOME}/.cache/huggingface}"

# HF Token aus Datei
HF_TOKEN="${HF_TOKEN:-}"
if [ -z "${HF_TOKEN}" ] && [ -f "${CACHE_DIR}/token" ]; then
    HF_TOKEN="$(tr -d '\r\n' < "${CACHE_DIR}/token")"
fi

# Prüfen
if [ ! -d "${DATA_DIR}/dataset" ]; then
    echo "FEHLER: Dataset nicht gefunden unter ${DATA_DIR}/dataset"
    exit 1
fi
if ! command -v docker >/dev/null 2>&1; then
    echo "FEHLER: Docker nicht gefunden"
    exit 1
fi
if ! nvidia-smi >/dev/null 2>&1; then
    echo "FEHLER: NVIDIA GPU nicht gefunden"
    exit 1
fi

echo "======================================"
echo " Voxtral LoRA Training – DGX Spark"
echo "======================================"
echo "Modell:    ${MODEL_ID}"
echo "Batch:     ${BATCH_SIZE} × ${GRAD_ACCUM}"
echo "LR:        ${LEARNING_RATE}"
echo "Epochen:   ${NUM_EPOCHS}"
echo "LoRA:      r=${LORA_RANK}"
echo "GPU:       $(nvidia-smi --query-gpu=name --format=csv,noheader 2>/dev/null || echo '?')"
echo ""

# Trainings-Image bauen (falls nicht vorhanden)
TRAIN_IMAGE="voxtral-train-dgx:latest"
if ! docker image inspect "${TRAIN_IMAGE}" >/dev/null 2>&1; then
    echo "Baue Trainings-Image: ${TRAIN_IMAGE}"
    cat > /tmp/Dockerfile.train << 'DOCKERFILE'
FROM nvcr.io/nvidia/vllm:26.03-py3
ENV PIP_NO_CACHE_DIR=1 HF_HUB_ENABLE_HF_TRANSFER=1 DEBIAN_FRONTEND=noninteractive

RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg libsndfile1 build-essential && rm -rf /var/lib/apt/lists/*

RUN python -m pip install --upgrade pip "setuptools<82"
RUN python -m pip install \
    transformers>=4.50.0 "torch>=2.5.0" accelerate>=1.5.0 peft>=0.14.0 \
    datasets>=3.4.0 tensorboard>=2.18.0 soundfile>=0.13.0 librosa>=0.10.0 \
    "huggingface_hub[hf_transfer]>=0.29.0" "mistral-common[audio]>=1.5.0" \
    "trl>=0.16.0" "scipy>=1.14.0" jiwer

ENV PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
ENV OMP_NUM_THREADS=8
DOCKERFILE
    docker build -t "${TRAIN_IMAGE}" -f /tmp/Dockerfile.train /tmp/
    echo ""
fi

mkdir -p "${OUTPUT_DIR}"

# Env-Datei
ENV_FILE="/tmp/voxtral_train_env_$$.env"
cat > "${ENV_FILE}" << ENVEOF
HF_TOKEN=${HF_TOKEN}
HF_HOME=/root/.cache/huggingface
HF_HUB_ENABLE_HF_TRANSFER=1
PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True
OMP_NUM_THREADS=8
ENVEOF

echo "Starte Training..."
docker run --rm \
    --gpus all --ipc=host --ulimit memlock=-1 --shm-size=64g \
    --env-file "${ENV_FILE}" \
    -v "${DATA_DIR}:/app/data:ro" \
    -v "${OUTPUT_DIR}:/app/models" \
    -v "${CACHE_DIR}:/root/.cache/huggingface" \
    -v "${SCRIPT_DIR}/train_voxtral_lora.py:/app/train_voxtral_lora.py:ro" \
    -v "${SCRIPT_DIR}/evaluate_voxtral.py:/app/evaluate_voxtral.py:ro" \
    "${TRAIN_IMAGE}" \
    python /app/train_voxtral_lora.py \
    --data-dir /app/data \
    --output-dir /app/models \
    --model-id "${MODEL_ID}" \
    --batch-size "${BATCH_SIZE}" \
    --grad-accum-steps "${GRAD_ACCUM}" \
    --learning-rate "${LEARNING_RATE}" \
    --num-epochs "${NUM_EPOCHS}" \
    --lora-rank "${LORA_RANK}" \
    "$@"

TRAIN_EXIT=$?
rm -f "${ENV_FILE}"

echo ""
if [ $TRAIN_EXIT -eq 0 ]; then
    echo "=== Training erfolgreich ==="
    echo "Modell: ${OUTPUT_DIR}"
    echo ""
    echo "Deployment:"
    echo "  export VOXTRAL_LOCAL_MODEL=${OUTPUT_DIR}"
    echo "  sudo systemctl restart voxtral-vllm"
else
    echo "!!! Training fehlgeschlagen (Exit: ${TRAIN_EXIT}) !!!"
fi
exit ${TRAIN_EXIT}
