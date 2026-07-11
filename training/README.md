# Schreibdienst – Training: Voxtral-Destillation

Deine archivierten Diktate aus dem Produktivsystem sollen genutzt werden, um
`mistralai/Voxtral-Mini-3B-2507` auf dem **DGX Spark** (GB10, 128 GB Unified Memory)
mittels **LoRA** feinzutunen.

**Ziel**: Ein direkt ladbares fp16-Modell, das die bestehende Produktions-Voxtral-
Version ersetzen kann. Am Ende steht ein gemergter Checkpoint via `merge_and_unload()`,
der unter `VOXTRAL_LOCAL_MODEL` in den vLLM-Container eingehängt wird.

---

## Überblick

```
┌──────────────┐     ┌────────────────────┐     ┌──────────────────┐
│ SQL-Dump     │────→│ export_training_   │────→│ HF Dataset + WAV │
│ database/    │     │ data.py            │     │ data/            │
└──────────────┘     └────────────────────┘     └────────┬─────────┘
                                                         │
                                              deploy_to_dgx.ps1
                                                         │
                                               ┌─────────┴──────────┐
                                               │ DGX Spark (GB10)   │
                                               │ start_training.sh  │
                                               │   → Docker-Image   │
                                               │   → LoRA Training  │
                                               │   → merge+unload   │
                                               │ models/            │
                                               └────────────────────┘
```

### Was passiert in den einzelnen Schritten?

| Schritt | Wo | Beschreibung |
|---|---|---|
| **1. Datenbank aufsetzen** | Lokaler PC | `docker run mariadb` + SQL-Dump importieren |
| **2. Daten exportieren** | Lokaler PC | Python filtert archivierte Diktate mit manueller Korrektur, konvertiert OGG→WAV 16 kHz, chunked anhand Word-Timestamps, erstellt HF Dataset |
| **3. Auf Spark deployen** | Lokaler PC → Spark | SCP/rsync kopiert Audios, Dataset und Skripte |
| **4. Training starten** | DGX Spark | Docker-Container baut auf Produktions-Image auf, führt LoRA-SFT durch |
| **5. Merge & Test** | DGX Spark | LoRA-Adapter wird mit Base-Modell gemergt → fertiges fp16-Modell |

---

## Voraussetzungen

- **Lokaler PC**: Windows 11, Docker Desktop, Python 3.10+
- **SQL-Dump**: `database/schreibdienst-db-2026-07-11.sql` (≥ 50 MB)
- **DGX Spark**: Ubuntu, NVIDIA-Treiber, Docker mit GPU-Support
- **HuggingFace Token**: Lesezugriff auf `mistralai/Voxtral-Mini-3B-2507`
  (einmalig auf https://huggingface.co/mistralai/Voxtral-Mini-3B-2507 "Agree and access repository")

---

## Anleitung – Schritt für Schritt

### Phase 1: Datenbank + Export (lokaler PC)

#### 1.1 Python-Umgebung einrichten

```powershell
cd training
.\setup_export_env.ps1
.\.venv-export\Scripts\Activate.ps1
```

#### 1.2 MariaDB per Docker starten + SQL-Dump importieren

```powershell
.\import_db.ps1
```

Das Skript:
- Startet `mariadb:10.11` auf Port 3307 (Default)
- Importiert den SQL-Dump aus `../database/`
- Zeigt eine Verifikation (Tabellen, Diktat-Anzahlen)

> **Hinweis**: Der Import der >50 MB SQL-Datei dauert einige Minuten.
> Zum Aufräumen: `.\import_db.ps1 -CleanUp`

#### 1.3 Trainingsdaten exportieren

```powershell
python export_training_data.py
```

Das Skript:
1. Fragt `offline_dictations` mit `archived = TRUE` ab
2. Filtert auf Diktate mit `correction_type = 'manual'` (Korrekturlog)
3. Lädt Audio aus `dictation_audio` + Word-Timestamps aus `dictation_segments`
4. Konvertiert OGG/WebM → WAV 16 kHz Mono
5. Chunked lange Audios an Segment-Grenzen (30s Fenster, 25% Overlap)
6. Aligniert Roh-Text mit `corrected_text` via SequenceMatcher
7. Schreibt `data/audio/*.wav` + `data/dataset/` (HF Dataset Arrow/Parquet) + `data/manifest.json`

**Ausgabe:**

```
data/
  audio/000001_000.wav    # Chunk 0 von Diktat #1
  audio/000001_001.wav    # Chunk 1 von Diktat #1
  audio/000002_000.wav    # Chunk 0 von Diktat #2
  ...
  dataset/
    dataset_info.json      # HF Dataset Metadaten
    train.parquet          # Trainingsdaten als Parquet
    ...                    # Arrow-Dateien
  manifest.json            # Export-Report
```

> **Test-Modus**: `python export_training_data.py --limit 5` exportiert nur 5 Diktate.

---

### Phase 2: Deployment auf DGX Spark

#### 2.1 Daten + Skripte kopieren

```powershell
.\deploy_to_dgx.ps1 -RemoteHost 192.168.188.173 -RemoteUser ksai0001_local
```

Kopiert:
- `data/audio/` → `~/voxtral-training/audio/`
- `data/dataset/` → `~/voxtral-training/dataset/`
- `data/manifest.json` → `~/voxtral-training/`
- `dgx/` → `~/voxtral-training/scripts/`

---

### Phase 3: Training auf dem DGX Spark

#### 3.1 SSH auf den Spark

```bash
ssh ksai0001_local@192.168.188.173
cd ~/voxtral-training
```

#### 3.2 Training starten

```bash
chmod +x scripts/start_training.sh
./scripts/start_training.sh
```

Das Skript:
1. Baut Docker-Image `voxtral-train-dgx:latest` auf Basis von `nvcr.io/nvidia/vllm:26.03-py3`
2. Installiert Transformers, PEFT, Datasets, TensorBoard etc.
3. Startet LoRA-Training mit:
   - Batch 2 × 8 Gradient Accumulation
   - Learning Rate 2e-4 (cosine scheduler)
   - LoRA rank=32, alpha=64
   - 90% Train / 10% Evaluation (stratifiziert)
   - TensorBoard-Logs in `models/voxtral-mini-finetuned/tensorboard/`
4. Nach Training: `merge_and_unload()` → gemergtes fp16-Modell

**Parameter anpassen** (per ENV):

```bash
TRAIN_BATCH_SIZE=4 TRAIN_EPOCHS=10 TRAIN_LR=1e-4 ./scripts/start_training.sh
```

**Nur Merge (ohne Training):**

```bash
./scripts/start_training.sh --merge-only ./checkpoints/best
```

#### 3.3 Training überwachen

```bash
# TensorBoard (lokal auf Spark)
tensorboard --logdir models/voxtral-mini-finetuned/tensorboard --port 6006

# Docker-Logs
docker logs -f $(docker ps -q --filter name=voxtral-train)

# GPU-Auslastung
watch -n 2 nvidia-smi
```

#### 3.4 Evaluation

```bash
# Baseline vs Finetuned vergleichen
python scripts/evaluate_voxtral.py \
    --data-dir ./data \
    --baseline-model mistralai/Voxtral-Mini-3B-2507 \
    --finetuned-model ./models/voxtral-mini-finetuned \
    --max-samples 50
```

---

### Phase 4: Deployment

```bash
# Gemergtes Modell in Produktion einhängen
export VOXTRAL_LOCAL_MODEL=~/voxtral-training/models/voxtral-mini-finetuned
sudo systemctl restart voxtral-vllm

# Test
curl http://127.0.0.1:8000/v1/audio/transcriptions \
    -F file=@test-audio.wav \
    -F language=de
```

---

## Verzeichnisstruktur

```
training/                         # ← Alles Training-bezogene hier
├── README.md                     # Diese Anleitung
├── .env.example                  # DB-Konfiguration
├── .gitignore                    # Verweist auf ../.gitignore
│
├── import_db.ps1                 # Docker MariaDB + SQL-Import
├── setup_export_env.ps1          # Python Venv + Pakete
├── export_training_data.py       # Export: SQL → WAV + HF Dataset
├── deploy_to_dgx.ps1             # SCP/rsync → DGX Spark
│
├── dgx/                          # ← Dateien, die auf dem Spark laufen
│   ├── start_training.sh         # Docker-Launcher für Training
│   ├── train_voxtral_lora.py     # LoRA SFT + Merge
│   └── evaluate_voxtral.py       # WER/CER Evaluation
│
├── .venv-export/                 # Python-Venv (automatisch angelegt)
└── __pycache__/                  # Python-Cache (ignoriert)
```

---

## Dateien, die NICHT ins Git dürfen

| Pfad | Grund |
|---|---|
| `database/` | SQL-Dump mit Produktivdaten (Patienten, Audios) – **bereits in `.gitignore`** ✅ |
| `data/` | Exportierte WAVs + Dataset – **jetzt in `.gitignore` ergänzt** ✅ |
| `training/.venv-export/` | Python-Venv – durch `.gitignore` + `/.gitignore` abgedeckt |
| `.env.local` / `.env` | Zugangsdaten – bereits in `.gitignore` |

---

## Datenbank-Schema (relevant)

```
offline_dictations
├── id, username, mode, status
├── corrected_text           ← Ground-Truth für Training
├── raw_transcript, transcript, methodik, befund, beurteilung
├── archived, archived_at, archived_by
├── audio_mime_type, audio_duration_seconds
└── created_at, completed_at

dictation_audio
├── dictation_id → offline_dictations.id
└── audio_data (LONGBLOB)    ← Original-Audio (OGG/WebM)

dictation_segments
├── dictation_id → offline_dictations.id
└── segments (JSON)          ← Word-Timestamps [{text, start, end, words}]

correction_log
├── dictation_id → offline_dictations.id
├── correction_type: 'textFormatting'|'dictionary'|'llm'|...|'manual'  ← Filter
├── text_before, text_after, change_score
├── model_name, model_provider, username
└── created_at
```

---

## Fehlerbehebung

| Problem | Lösung |
|---|---|
| `pymysql` nicht gefunden | `pip install pymysql` oder `.\setup_export_env.ps1` neu laufen lassen |
| Keine archivierten Diktate gefunden | Prüfe: `docker exec schreibdienst-mariadb mysql ... -e "SELECT COUNT(*) FROM offline_dictations WHERE archived=TRUE"` |
| Audio-Konvertierung fehlschlägt | FFmpeg installieren: `winget install FFmpeg` oder `choco install ffmpeg` |
| Docker-Container läuft nicht | `.\import_db.ps1 -CleanUp` + erneut starten |
| Out-of-Memory auf Spark | Batch-Größe reduzieren: `TRAIN_BATCH_SIZE=1 ./start_training.sh` |
| Model nicht geladen (HF-Token) | `export HF_TOKEN=hf_xxx` setzen, Token unter hf.co/settings/tokens |
| Merge schlägt fehl | Prüfen: genug Festplattenplatz (~12 GB für gemergtes Modell) |

---

## Technische Details

### Chunking-Strategie mit Word-Timestamps

Das Export-Skript nutzt die `dictation_segments`-Tabelle, die Whisper-Segmente mit
Wort-für-Wort-Timestamps enthält (`{word, start, end, score}`):

- **Kurze Diktate** (< 30s) bleiben als ein Chunk
- **Lange Diktate** werden an Segment-Grenzen (natürliche Pausen) geschnitten
- **Text-Alignment**: SequenceMatcher gleicht Segment-Roh-Text mit `corrected_text`
  ab, sodass Ground-Truth und Audio-Ausschnitt korrespondieren
- **Overlap**: 25% zwischen Chunks, um Informationen an Grenzen nicht zu verlieren

### LoRA-Konfiguration

| Parameter | Wert | Begründung |
|---|---|---|
| rank | 32 | Guter Kompromiss Qualität/Speicher |
| alpha | 64 | Standard für rank=32 |
| dropout | 0.05 | Leichte Regularisierung |
| target_modules | q,v,k,o,gate,up,down_proj | Standard LLM-LoRA |
| trainable | ~0.5% aller Parameter | ~15M von 3B |

### GB10-Speicher-Management

Der GB10 hat **128 GB Unified Memory** (CPU+GPU geteilt). Das Training nutzt:

- `PYTORCH_CUDA_ALLOC_CONF=expandable_segments:True` (Fragmentierung vermeiden)
- Batch 2 + 8× Gradient Accumulation = effektive Batch 16
- FP16 Training (half precision)
- Audio-Encoder eingefroren → nur Decoder-LoRA trainiert

---

## Lizenz

Die Nutzung von `mistralai/Voxtral-Mini-3B-2507` erfordert die Zustimmung
zur Lizenz auf HuggingFace. Siehe dazu die Modell-Seite:
https://huggingface.co/mistralai/Voxtral-Mini-3B-2507
