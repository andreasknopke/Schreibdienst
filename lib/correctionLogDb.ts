import { NextRequest } from 'next/server';
import { getPool, query, execute, getPoolForRequest } from './db';

// Correction types
export type CorrectionType = 'textFormatting' | 'llm' | 'doublePrecision' | 'manual';

// Correction Log Entry
export interface CorrectionLogEntry {
  id: number;
  dictation_id: number;
  correction_type: CorrectionType;
  // For LLM and Double Precision corrections
  model_name?: string;
  model_provider?: string; // 'openai', 'mistral', 'lmstudio'
  // For manual corrections
  username?: string;
  // Text changes
  text_before: string;
  text_after: string;
  change_score?: number; // 0-100 score
  // Timestamps
  created_at: Date;
}

/**
 * Initialize correction log table with automatic migration
 */
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
  
  console.log('[DB] ✓ Correction log table ready');
}

/**
 * Initialize correction log table with request context
 */
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
  
  console.log('[DB] ✓ Correction log table ready');
}

/**
 * Log a text formatting correction
 */
export async function logTextFormattingCorrection(
  dictationId: number,
  textBefore: string,
  textAfter: string,
  changeScore?: number
): Promise<number> {
  const result = await execute(
    `INSERT INTO correction_log 
      (dictation_id, correction_type, text_before, text_after, change_score)
     VALUES (?, 'textFormatting', ?, ?, ?)`,
    [dictationId, textBefore, textAfter, changeScore ?? null]
  );
  return result.insertId;
}

/**
 * Log an LLM correction
 */
export async function logLLMCorrection(
  dictationId: number,
  textBefore: string,
  textAfter: string,
  modelName: string,
  modelProvider: string,
  changeScore?: number
): Promise<number> {
  const result = await execute(
    `INSERT INTO correction_log 
      (dictation_id, correction_type, model_name, model_provider, text_before, text_after, change_score)
     VALUES (?, 'llm', ?, ?, ?, ?, ?)`,
    [dictationId, modelName, modelProvider, textBefore, textAfter, changeScore ?? null]
  );
  return result.insertId;
}

/**
 * Log a double precision correction
 */
export async function logDoublePrecisionCorrection(
  dictationId: number,
  textBefore: string,
  textAfter: string,
  modelName: string,
  modelProvider: string,
  changeScore?: number
): Promise<number> {
  const result = await execute(
    `INSERT INTO correction_log 
      (dictation_id, correction_type, model_name, model_provider, text_before, text_after, change_score)
     VALUES (?, 'doublePrecision', ?, ?, ?, ?, ?)`,
    [dictationId, modelName, modelProvider, textBefore, textAfter, changeScore ?? null]
  );
  return result.insertId;
}

/**
 * Log a manual correction
 */
export async function logManualCorrection(
  dictationId: number,
  textBefore: string,
  textAfter: string,
  username: string,
  changeScore?: number
): Promise<number> {
  const result = await execute(
    `INSERT INTO correction_log 
      (dictation_id, correction_type, username, text_before, text_after, change_score)
     VALUES (?, 'manual', ?, ?, ?, ?)`,
    [dictationId, username, textBefore, textAfter, changeScore ?? null]
  );
  return result.insertId;
}

/**
 * Get all correction logs for a dictation
 */
export async function getCorrectionLogByDictationId(dictationId: number): Promise<CorrectionLogEntry[]> {
  return query<CorrectionLogEntry>(
    `SELECT * FROM correction_log WHERE dictation_id = ? ORDER BY created_at ASC`,
    [dictationId]
  );
}

/**
 * Get correction log statistics for a dictation
 */
export async function getCorrectionLogStats(dictationId: number): Promise<{
  totalCorrections: number;
  byType: { [key in CorrectionType]?: number };
}> {
  const rows = await query<{ correction_type: CorrectionType; count: number }>(
    `SELECT correction_type, COUNT(*) as count FROM correction_log WHERE dictation_id = ? GROUP BY correction_type`,
    [dictationId]
  );
  
  const stats = {
    totalCorrections: 0,
    byType: {} as { [key in CorrectionType]?: number }
  };
  
  for (const row of rows) {
    const correctionType = row.correction_type as CorrectionType;
    stats.byType[correctionType] = row.count;
    stats.totalCorrections += row.count;
  }
  
  return stats;
}

// Request-based versions for use in API routes

export async function logTextFormattingCorrectionWithRequest(
  req: NextRequest,
  dictationId: number,
  textBefore: string,
  textAfter: string,
  changeScore?: number
): Promise<number> {
  const db = await getPoolForRequest(req);
  const [result] = await db.execute(
    `INSERT INTO correction_log 
      (dictation_id, correction_type, text_before, text_after, change_score)
     VALUES (?, 'textFormatting', ?, ?, ?)`,
    [dictationId, textBefore, textAfter, changeScore ?? null]
  ) as any;
  return result.insertId;
}

export async function logLLMCorrectionWithRequest(
  req: NextRequest,
  dictationId: number,
  textBefore: string,
  textAfter: string,
  modelName: string,
  modelProvider: string,
  changeScore?: number
): Promise<number> {
  const db = await getPoolForRequest(req);
  const [result] = await db.execute(
    `INSERT INTO correction_log 
      (dictation_id, correction_type, model_name, model_provider, text_before, text_after, change_score)
     VALUES (?, 'llm', ?, ?, ?, ?, ?)`,
    [dictationId, modelName, modelProvider, textBefore, textAfter, changeScore ?? null]
  ) as any;
  return result.insertId;
}

export async function logDoublePrecisionCorrectionWithRequest(
  req: NextRequest,
  dictationId: number,
  textBefore: string,
  textAfter: string,
  modelName: string,
  modelProvider: string,
  changeScore?: number
): Promise<number> {
  const db = await getPoolForRequest(req);
  const [result] = await db.execute(
    `INSERT INTO correction_log 
      (dictation_id, correction_type, model_name, model_provider, text_before, text_after, change_score)
     VALUES (?, 'doublePrecision', ?, ?, ?, ?, ?)`,
    [dictationId, modelName, modelProvider, textBefore, textAfter, changeScore ?? null]
  ) as any;
  return result.insertId;
}

export async function logManualCorrectionWithRequest(
  req: NextRequest,
  dictationId: number,
  textBefore: string,
  textAfter: string,
  username: string,
  changeScore?: number
): Promise<number> {
  const db = await getPoolForRequest(req);
  const [result] = await db.execute(
    `INSERT INTO correction_log 
      (dictation_id, correction_type, username, text_before, text_after, change_score)
     VALUES (?, 'manual', ?, ?, ?, ?)`,
    [dictationId, username, textBefore, textAfter, changeScore ?? null]
  ) as any;
  return result.insertId;
}

export async function getCorrectionLogByDictationIdWithRequest(
  req: NextRequest,
  dictationId: number
): Promise<CorrectionLogEntry[]> {
  const db = await getPoolForRequest(req);
  const [rows] = await db.execute(
    `SELECT * FROM correction_log WHERE dictation_id = ? ORDER BY created_at ASC`,
    [dictationId]
  ) as any;
  return rows;
}

export async function getCorrectionLogStatsWithRequest(
  req: NextRequest,
  dictationId: number
): Promise<{
  totalCorrections: number;
  byType: { [key in CorrectionType]?: number };
}> {
  const db = await getPoolForRequest(req);
  const [rows] = await db.execute(
    `SELECT correction_type, COUNT(*) as count FROM correction_log WHERE dictation_id = ? GROUP BY correction_type`,
    [dictationId]
  ) as any;
  
  const stats = {
    totalCorrections: 0,
    byType: {} as { [key in CorrectionType]?: number }
  };
  
  for (const row of rows) {
    const correctionType = row.correction_type as CorrectionType;
    stats.byType[correctionType] = row.count;
    stats.totalCorrections += row.count;
  }
  
  return stats;
}
