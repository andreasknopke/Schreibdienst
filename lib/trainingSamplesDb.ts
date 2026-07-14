/**
 * training_samples – manually curated training data for Voxtral distillation.
 *
 * Each row represents a marked passage inside an ARCHIVED dictation:
 *  - voxtral_raw_text:   the part of raw_transcript that Voxtral got wrong
 *                        (precisely the substring Voxtral originally produced)
 *  - corrected_text:    the corresponding final/corrected text (manually
 *                        curated by root – may differ from a single dictation
 *                        layer because the LLM may have rewritten it)
 *  - start_time / end_time: precise timestamps from the Voxtral segment words[]
 *  - word_count:        convenience aggregate for stats
 *
 * Audio itself is NOT duplicated – it is served on demand from the original
 * dictation via /api/offline-dictations?id=...&audio=true and sliced at runtime
 * using lib/audioSlicing.
 *
 * All functions have two variants: default pool and *WithRequest (dynamic pool
 * from DB-Token header). Mirrors the pattern in offlineDictationDb.ts.
 */

import { NextRequest } from 'next/server';
import { getPool, getPoolForRequest } from './db';
import type { RowDataPacket } from 'mysql2';

// ============================================================
// Types
// ============================================================

export interface TrainingSample {
  id: number;
  dictation_id: number;
  marked_by: string;
  voxtral_raw_text: string;
  corrected_text: string;
  start_time: number;
  end_time: number;
  word_count: number;
  note?: string | null;
  last_verify_text?: string | null;
  last_verify_model?: string | null;
  last_verify_at?: Date | null;
  last_verify_wer?: number | null;
  last_verify_error_count?: number | null;
  created_at: Date;
  updated_at: Date;
  /** joined from offline_dictations for the list view */
  dictation?: {
    order_number: string;
    username: string;
    patient_name?: string | null;
    fachabteilung?: string | null;
    mode: string;
    created_at: Date;
  };
}

export interface TrainingStats {
  total_samples: number;
  total_audio_seconds: number;
  total_words: number;
  total_dictations_touched: number;
  last_verify_count: number;
  last_verify_avg_wer: number | null;
  last_verify_avg_error_count: number | null;
}

export interface TrainingSampleInput {
  dictation_id: number;
  marked_by: string;
  voxtral_raw_text: string;
  corrected_text: string;
  start_time: number;
  end_time: number;
  note?: string;
}

export interface VerifyResult {
  sample_id: number;
  voxtral_raw_text: string;
  corrected_text: string;
  transcription: string | null;
  transcription_error: string | null;
  wer: number | null;
  error_count: number | null;
  diff: Array<{ type: 'equal' | 'insert' | 'delete'; value: string; voxtral?: string; corrected?: string }>;
}

// ============================================================
// Schema
// ============================================================

async function _initTable(db: any): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS training_samples (
      id INT AUTO_INCREMENT PRIMARY KEY,
      dictation_id INT NOT NULL,
      marked_by VARCHAR(255) NOT NULL,
      voxtral_raw_text LONGTEXT NOT NULL,
      corrected_text LONGTEXT NOT NULL,
      start_time DOUBLE NOT NULL,
      end_time DOUBLE NOT NULL,
      word_count INT NOT NULL DEFAULT 0,
      note TEXT DEFAULT NULL,
      last_verify_text LONGTEXT DEFAULT NULL,
      last_verify_model VARCHAR(255) DEFAULT NULL,
      last_verify_at TIMESTAMP NULL DEFAULT NULL,
      last_verify_wer DOUBLE DEFAULT NULL,
      last_verify_error_count INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_dictation_id (dictation_id),
      INDEX idx_marked_by (marked_by),
      INDEX idx_created_at (created_at),
      CONSTRAINT fk_training_samples_dictation
        FOREIGN KEY (dictation_id) REFERENCES offline_dictations(id) ON DELETE CASCADE
    )
  `);
}

// ============================================================
// Helpers
// ============================================================

function countWords(text: string): number {
  if (!text) return 0;
  const m = text.trim().match(/\S+/g);
  return m ? m.length : 0;
}

interface JoinedRow extends RowDataPacket {
  id: number;
  dictation_id: number;
  marked_by: string;
  voxtral_raw_text: string;
  corrected_text: string;
  start_time: number;
  end_time: number;
  word_count: number;
  note: string | null;
  last_verify_text: string | null;
  last_verify_model: string | null;
  last_verify_at: Date | null;
  last_verify_wer: number | null;
  last_verify_error_count: number | null;
  created_at: Date;
  updated_at: Date;
  d_order_number: string;
  d_username: string;
  d_patient_name: string | null;
  d_fachabteilung: string | null;
  d_mode: string;
  d_created_at: Date;
}

function mapRow(row: JoinedRow): TrainingSample {
  return {
    id: row.id,
    dictation_id: row.dictation_id,
    marked_by: row.marked_by,
    voxtral_raw_text: row.voxtral_raw_text,
    corrected_text: row.corrected_text,
    start_time: Number(row.start_time),
    end_time: Number(row.end_time),
    word_count: row.word_count,
    note: row.note,
    last_verify_text: row.last_verify_text,
    last_verify_model: row.last_verify_model,
    last_verify_at: row.last_verify_at,
    last_verify_wer: row.last_verify_wer === null ? null : Number(row.last_verify_wer),
    last_verify_error_count: row.last_verify_error_count,
    created_at: row.created_at,
    updated_at: row.updated_at,
    dictation: {
      order_number: row.d_order_number,
      username: row.d_username,
      patient_name: row.d_patient_name,
      fachabteilung: row.d_fachabteilung,
      mode: row.d_mode,
      created_at: row.d_created_at,
    },
  };
}

const JOIN_COLUMNS = `
  ts.id, ts.dictation_id, ts.marked_by, ts.voxtral_raw_text, ts.corrected_text,
  ts.start_time, ts.end_time, ts.word_count, ts.note,
  ts.last_verify_text, ts.last_verify_model, ts.last_verify_at,
  ts.last_verify_wer, ts.last_verify_error_count,
  ts.created_at, ts.updated_at,
  d.order_number AS d_order_number,
  d.username AS d_username,
  d.patient_name AS d_patient_name,
  d.fachabteilung AS d_fachabteilung,
  d.mode AS d_mode,
  d.created_at AS d_created_at
`;

// ============================================================
// Internal (pool parameter)
// ============================================================

async function _ensureTable(db: any): Promise<void> { await _initTable(db); }

async function _createSample(db: any, input: TrainingSampleInput): Promise<number> {
  const wordCount = countWords(input.voxtral_raw_text);
  const [result] = await db.execute(
    `INSERT INTO training_samples
       (dictation_id, marked_by, voxtral_raw_text, corrected_text,
        start_time, end_time, word_count, note)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      input.dictation_id,
      input.marked_by,
      input.voxtral_raw_text,
      input.corrected_text,
      input.start_time,
      input.end_time,
      wordCount,
      input.note || null,
    ]
  );
  return (result as any).insertId;
}

async function _listForDictation(db: any, dictationId: number): Promise<TrainingSample[]> {
  const [rows] = await db.execute(
    `SELECT ${JOIN_COLUMNS}
     FROM training_samples ts
     JOIN offline_dictations d ON d.id = ts.dictation_id
     WHERE ts.dictation_id = ?
     ORDER BY ts.start_time ASC`,
    [dictationId]
  );
  return ((rows as JoinedRow[]) || []).map(mapRow);
}

async function _listAll(db: any, opts: { dictationId?: number } = {}): Promise<TrainingSample[]> {
  if (opts.dictationId) {
    return _listForDictation(db, opts.dictationId);
  }
  const [rows] = await db.execute(
    `SELECT ${JOIN_COLUMNS}
     FROM training_samples ts
     JOIN offline_dictations d ON d.id = ts.dictation_id
     ORDER BY ts.created_at DESC`
  );
  return ((rows as JoinedRow[]) || []).map(mapRow);
}

async function _getById(db: any, id: number): Promise<TrainingSample | null> {
  const [rows] = await db.execute(
    `SELECT ${JOIN_COLUMNS}
     FROM training_samples ts
     JOIN offline_dictations d ON d.id = ts.dictation_id
     WHERE ts.id = ?
     LIMIT 1`,
    [id]
  );
  const typedRows = rows as JoinedRow[];
  return typedRows[0] ? mapRow(typedRows[0]) : null;
}

async function _updateSample(
  db: any,
  id: number,
  patch: Partial<Pick<TrainingSample, 'voxtral_raw_text' | 'corrected_text' | 'start_time' | 'end_time' | 'note'>>
): Promise<void> {
  const sets: string[] = [];
  const params: any[] = [];
  if (patch.voxtral_raw_text !== undefined) {
    sets.push('voxtral_raw_text = ?');
    params.push(patch.voxtral_raw_text);
    sets.push('word_count = ?');
    params.push(countWords(patch.voxtral_raw_text));
  }
  if (patch.corrected_text !== undefined) { sets.push('corrected_text = ?'); params.push(patch.corrected_text); }
  if (patch.start_time !== undefined) { sets.push('start_time = ?'); params.push(Number(patch.start_time)); }
  if (patch.end_time !== undefined) { sets.push('end_time = ?'); params.push(Number(patch.end_time)); }
  if (patch.note !== undefined) { sets.push('note = ?'); params.push(patch.note || null); }
  if (sets.length === 0) return;
  params.push(id);
  await db.execute(`UPDATE training_samples SET ${sets.join(', ')} WHERE id = ?`, params);
}

async function _deleteSample(db: any, id: number): Promise<void> {
  await db.execute(`DELETE FROM training_samples WHERE id = ?`, [id]);
}

async function _saveVerifyResult(
  db: any,
  id: number,
  result: {
    text: string;
    model: string;
    wer: number;
    errorCount: number;
  }
): Promise<void> {
  await db.execute(
    `UPDATE training_samples
     SET last_verify_text = ?, last_verify_model = ?, last_verify_at = NOW(),
         last_verify_wer = ?, last_verify_error_count = ?
     WHERE id = ?`,
    [result.text, result.model, result.wer, result.errorCount, id]
  );
}

async function _getStats(db: any): Promise<TrainingStats> {
  const [rows] = await db.execute(
    `SELECT
       COUNT(*)                                  AS total_samples,
       COALESCE(SUM(end_time - start_time), 0)   AS total_audio_seconds,
       COALESCE(SUM(word_count), 0)              AS total_words,
       COUNT(DISTINCT dictation_id)              AS total_dictations_touched,
       SUM(CASE WHEN last_verify_at IS NOT NULL THEN 1 ELSE 0 END) AS last_verify_count,
       AVG(last_verify_wer)                      AS last_verify_avg_wer,
       AVG(last_verify_error_count)              AS last_verify_avg_error_count
     FROM training_samples`
  );
  const r = rows[0] || {};
  return {
    total_samples: Number(r.total_samples) || 0,
    total_audio_seconds: Number(r.total_audio_seconds) || 0,
    total_words: Number(r.total_words) || 0,
    total_dictations_touched: Number(r.total_dictations_touched) || 0,
    last_verify_count: Number(r.last_verify_count) || 0,
    last_verify_avg_wer: r.last_verify_avg_wer === null ? null : Number(r.last_verify_avg_wer),
    last_verify_avg_error_count: r.last_verify_avg_error_count === null ? null : Number(r.last_verify_avg_error_count),
  };
}

// ============================================================
// Public API – default pool
// ============================================================

export async function initTrainingSamplesTable(): Promise<void> {
  await _initTable(await getPool());
}
export async function createTrainingSample(input: TrainingSampleInput): Promise<number> {
  const db = await getPool(); await _ensureTable(db); return _createSample(db, input);
}
export async function listTrainingSamplesForDictation(dictationId: number): Promise<TrainingSample[]> {
  const db = await getPool(); await _ensureTable(db); return _listForDictation(db, dictationId);
}
export async function listAllTrainingSamples(opts?: { dictationId?: number }): Promise<TrainingSample[]> {
  const db = await getPool(); await _ensureTable(db); return _listAll(db, opts || {});
}
export async function getTrainingSample(id: number): Promise<TrainingSample | null> {
  const db = await getPool(); await _ensureTable(db); return _getById(db, id);
}
export async function updateTrainingSample(id: number, patch: Partial<TrainingSample>): Promise<void> {
  const db = await getPool(); await _ensureTable(db); return _updateSample(db, id, patch);
}
export async function deleteTrainingSample(id: number): Promise<void> {
  const db = await getPool(); await _ensureTable(db); return _deleteSample(db, id);
}
export async function saveVerifyResult(id: number, result: { text: string; model: string; wer: number; errorCount: number; }): Promise<void> {
  const db = await getPool(); await _ensureTable(db); return _saveVerifyResult(db, id, result);
}
export async function getTrainingStats(): Promise<TrainingStats> {
  const db = await getPool(); await _ensureTable(db); return _getStats(db);
}

// ============================================================
// Public API – request-based (DB-Token pool)
// ============================================================

export async function initTrainingSamplesTableWithRequest(req: NextRequest): Promise<void> {
  await _initTable(await getPoolForRequest(req));
}
export async function createTrainingSampleWithRequest(req: NextRequest, input: TrainingSampleInput): Promise<number> {
  const db = await getPoolForRequest(req); await _ensureTable(db); return _createSample(db, input);
}
export async function listTrainingSamplesForDictationWithRequest(req: NextRequest, dictationId: number): Promise<TrainingSample[]> {
  const db = await getPoolForRequest(req); await _ensureTable(db); return _listForDictation(db, dictationId);
}
export async function listAllTrainingSamplesWithRequest(req: NextRequest, opts?: { dictationId?: number }): Promise<TrainingSample[]> {
  const db = await getPoolForRequest(req); await _ensureTable(db); return _listAll(db, opts || {});
}
export async function getTrainingSampleWithRequest(req: NextRequest, id: number): Promise<TrainingSample | null> {
  const db = await getPoolForRequest(req); await _ensureTable(db); return _getById(db, id);
}
export async function updateTrainingSampleWithRequest(req: NextRequest, id: number, patch: Partial<TrainingSample>): Promise<void> {
  const db = await getPoolForRequest(req); await _ensureTable(db); return _updateSample(db, id, patch);
}
export async function deleteTrainingSampleWithRequest(req: NextRequest, id: number): Promise<void> {
  const db = await getPoolForRequest(req); await _ensureTable(db); return _deleteSample(db, id);
}
export async function saveVerifyResultWithRequest(req: NextRequest, id: number, result: { text: string; model: string; wer: number; errorCount: number; }): Promise<void> {
  const db = await getPoolForRequest(req); await _ensureTable(db); return _saveVerifyResult(db, id, result);
}
export async function getTrainingStatsWithRequest(req: NextRequest): Promise<TrainingStats> {
  const db = await getPoolForRequest(req); await _ensureTable(db); return _getStats(db);
}
