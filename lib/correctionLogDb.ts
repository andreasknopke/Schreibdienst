import { NextRequest } from 'next/server';
import { getPool, getPoolForRequest } from './db';
import mysql from 'mysql2/promise';

// ============================================================
// Types
// ============================================================

export type CorrectionType = 'textFormatting' | 'llm' | 'doublePrecision' | 'manual';

export interface CorrectionLogEntry {
  id: number;
  dictation_id: number;
  correction_type: CorrectionType;
  model_name?: string;
  model_provider?: string;
  username?: string;
  text_before: string;
  text_after: string;
  change_score?: number;
  created_at: Date;
}

// ============================================================
// Table init (table creation is handled in offlineDictationDb._initTables)
// These exist for backward-compat with routes that call initCorrectionLogTable*
// ============================================================

export async function initCorrectionLogTable(): Promise<void> {
  const db = await getPool();
  await db.execute(`
    CREATE TABLE IF NOT EXISTS correction_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      dictation_id INT NOT NULL,
      correction_type ENUM('textFormatting', 'llm', 'doublePrecision', 'manual') NOT NULL,
      model_name VARCHAR(255) DEFAULT NULL,
      model_provider VARCHAR(100) DEFAULT NULL,
      username VARCHAR(255) DEFAULT NULL,
      text_before LONGTEXT NOT NULL,
      text_after LONGTEXT NOT NULL,
      change_score INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_dictation_id (dictation_id),
      INDEX idx_correction_type (correction_type),
      INDEX idx_created_at (created_at),
      FOREIGN KEY (dictation_id) REFERENCES offline_dictations(id) ON DELETE CASCADE
    )
  `);
}

export async function initCorrectionLogTableWithRequest(req: NextRequest): Promise<void> {
  const db = await getPoolForRequest(req);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS correction_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      dictation_id INT NOT NULL,
      correction_type ENUM('textFormatting', 'llm', 'doublePrecision', 'manual') NOT NULL,
      model_name VARCHAR(255) DEFAULT NULL,
      model_provider VARCHAR(100) DEFAULT NULL,
      username VARCHAR(255) DEFAULT NULL,
      text_before LONGTEXT NOT NULL,
      text_after LONGTEXT NOT NULL,
      change_score INT DEFAULT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_dictation_id (dictation_id),
      INDEX idx_correction_type (correction_type),
      INDEX idx_created_at (created_at),
      FOREIGN KEY (dictation_id) REFERENCES offline_dictations(id) ON DELETE CASCADE
    )
  `);
}

// ============================================================
// Internal helpers (pool parameter → zero duplication)
// ============================================================

async function _logCorrection(
  db: mysql.Pool,
  dictationId: number,
  type: CorrectionType,
  textBefore: string,
  textAfter: string,
  opts?: { modelName?: string; modelProvider?: string; username?: string; changeScore?: number }
): Promise<number> {
  const [result] = await db.execute(
    `INSERT INTO correction_log 
      (dictation_id, correction_type, model_name, model_provider, username, text_before, text_after, change_score)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      dictationId, type,
      opts?.modelName ?? null, opts?.modelProvider ?? null, opts?.username ?? null,
      textBefore, textAfter, opts?.changeScore ?? null,
    ]
  ) as any;
  return result.insertId;
}

async function _getLogsByDictation(db: mysql.Pool, dictationId: number): Promise<CorrectionLogEntry[]> {
  const [rows] = await db.execute(
    `SELECT * FROM correction_log WHERE dictation_id = ? ORDER BY created_at ASC`,
    [dictationId]
  );
  return rows as CorrectionLogEntry[];
}

async function _getLogStats(db: mysql.Pool, dictationId: number) {
  const [rows] = await db.execute<any[]>(
    `SELECT correction_type, COUNT(*) as count FROM correction_log WHERE dictation_id = ? GROUP BY correction_type`,
    [dictationId]
  );
  const stats = { totalCorrections: 0, byType: {} as { [key in CorrectionType]?: number } };
  for (const row of rows) {
    stats.byType[row.correction_type as CorrectionType] = row.count;
    stats.totalCorrections += row.count;
  }
  return stats;
}

// ============================================================
// Public API – Default pool
// ============================================================

export function logTextFormattingCorrection(dictationId: number, textBefore: string, textAfter: string, changeScore?: number) {
  return getPool().then(db => _logCorrection(db, dictationId, 'textFormatting', textBefore, textAfter, { changeScore }));
}

export function logLLMCorrection(dictationId: number, textBefore: string, textAfter: string, modelName: string, modelProvider: string, changeScore?: number) {
  return getPool().then(db => _logCorrection(db, dictationId, 'llm', textBefore, textAfter, { modelName, modelProvider, changeScore }));
}

export function logDoublePrecisionCorrection(dictationId: number, textBefore: string, textAfter: string, modelName: string, modelProvider: string, changeScore?: number) {
  return getPool().then(db => _logCorrection(db, dictationId, 'doublePrecision', textBefore, textAfter, { modelName, modelProvider, changeScore }));
}

export function logManualCorrection(dictationId: number, textBefore: string, textAfter: string, username: string, changeScore?: number) {
  return getPool().then(db => _logCorrection(db, dictationId, 'manual', textBefore, textAfter, { username, changeScore }));
}

export function getCorrectionLogByDictationId(dictationId: number) {
  return getPool().then(db => _getLogsByDictation(db, dictationId));
}

export function getCorrectionLogStats(dictationId: number) {
  return getPool().then(db => _getLogStats(db, dictationId));
}

// ============================================================
// Public API – Request-based (dynamic pool via DB-Token)
// ============================================================

export function logTextFormattingCorrectionWithRequest(req: NextRequest, dictationId: number, textBefore: string, textAfter: string, changeScore?: number) {
  return getPoolForRequest(req).then(db => _logCorrection(db, dictationId, 'textFormatting', textBefore, textAfter, { changeScore }));
}

export function logLLMCorrectionWithRequest(req: NextRequest, dictationId: number, textBefore: string, textAfter: string, modelName: string, modelProvider: string, changeScore?: number) {
  return getPoolForRequest(req).then(db => _logCorrection(db, dictationId, 'llm', textBefore, textAfter, { modelName, modelProvider, changeScore }));
}

export function logDoublePrecisionCorrectionWithRequest(req: NextRequest, dictationId: number, textBefore: string, textAfter: string, modelName: string, modelProvider: string, changeScore?: number) {
  return getPoolForRequest(req).then(db => _logCorrection(db, dictationId, 'doublePrecision', textBefore, textAfter, { modelName, modelProvider, changeScore }));
}

export function logManualCorrectionWithRequest(req: NextRequest, dictationId: number, textBefore: string, textAfter: string, username: string, changeScore?: number) {
  return getPoolForRequest(req).then(db => _logCorrection(db, dictationId, 'manual', textBefore, textAfter, { username, changeScore }));
}

export function getCorrectionLogByDictationIdWithRequest(req: NextRequest, dictationId: number) {
  return getPoolForRequest(req).then(db => _getLogsByDictation(db, dictationId));
}

export function getCorrectionLogStatsWithRequest(req: NextRequest, dictationId: number) {
  return getPoolForRequest(req).then(db => _getLogStats(db, dictationId));
}
