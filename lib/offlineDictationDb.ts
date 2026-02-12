import { NextRequest } from 'next/server';
import { getPool, getPoolForRequest } from './db';
import mysql from 'mysql2/promise';

// ============================================================
// Types
// ============================================================

export type DictationStatus = 'pending' | 'processing' | 'completed' | 'error';
export type DictationPriority = 'normal' | 'urgent' | 'stat';

/**
 * Summary data for list views – lightweight, no large text fields.
 * Excludes: audio_data, segments, raw_transcript, methodik, befund, beurteilung.
 */
export interface DictationSummary {
  id: number;
  username: string;
  audio_mime_type: string;
  audio_duration_seconds: number;
  order_number: string;
  patient_name?: string;
  patient_dob?: string;
  priority: DictationPriority;
  status: DictationStatus;
  mode: 'befund' | 'arztbrief';
  bemerkung?: string;
  termin?: Date;
  fachabteilung?: string;
  berechtigte?: string;
  transcript?: string;
  corrected_text?: string;
  change_score?: number;
  error_message?: string;
  archived?: boolean;
  archived_at?: Date;
  archived_by?: string;
  created_at: Date;
  processing_started_at?: Date;
  completed_at?: Date;
}

/**
 * Full dictation data including text content + segments (loaded on demand).
 */
export interface OfflineDictation extends DictationSummary {
  audio_data?: Buffer | null;
  raw_transcript?: string;
  segments?: string;
  methodik?: string;
  befund?: string;
  beurteilung?: string;
}

// ============================================================
// Column sets for queries
// ============================================================

/** Columns selected for list/summary views – no large text blobs */
const SUMMARY_COLUMNS = `
  id, username, audio_mime_type, audio_duration_seconds, order_number,
  patient_name, patient_dob, priority, status, mode,
  bemerkung, termin, fachabteilung, berechtigte,
  transcript, corrected_text, change_score, error_message,
  archived, archived_at, archived_by,
  created_at, processing_started_at, completed_at
`.replace(/\n/g, ' ').trim();

/** Columns for full detail view (everything except audio_data, joined with segments) */
const DETAIL_COLUMNS = `
  d.id, d.username, d.audio_mime_type, d.audio_duration_seconds, d.order_number,
  d.patient_name, d.patient_dob, d.priority, d.status, d.mode,
  d.bemerkung, d.termin, d.fachabteilung, d.berechtigte,
  d.raw_transcript, d.transcript, d.methodik, d.befund, d.beurteilung,
  d.corrected_text, d.change_score, d.error_message,
  d.archived, d.archived_at, d.archived_by,
  d.created_at, d.processing_started_at, d.completed_at,
  s.segments
`.replace(/\n/g, ' ').trim();

/** Priority sort – FIELD() is efficient on ENUM */
const PRIORITY_ORDER = `FIELD(priority, 'stat', 'urgent', 'normal')`;

// ============================================================
// Table initialization (once per pool, cached)
// ============================================================

const tableInitializedPerPool = new Map<string, boolean>();

function poolKeyFromRequest(request?: NextRequest): string {
  if (request) {
    const dbToken = request.headers.get('x-db-token');
    if (dbToken) {
      try {
        const decoded = Buffer.from(dbToken, 'base64').toString('utf8');
        const parsed = JSON.parse(decoded);
        return `${parsed.host}:${parsed.port || 3306}:${parsed.database}:${parsed.user}`;
      } catch { /* fall through */ }
    }
  }
  return 'default';
}

async function _initTables(db: mysql.Pool, poolKey: string): Promise<void> {
  if (tableInitializedPerPool.get(poolKey)) return;

  // ── Main table (no audio_data, no segments – those live in separate tables) ──
  await db.execute(`
    CREATE TABLE IF NOT EXISTS offline_dictations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) NOT NULL,
      audio_mime_type VARCHAR(100) DEFAULT 'audio/webm',
      audio_duration_seconds FLOAT DEFAULT 0,
      order_number VARCHAR(255) NOT NULL,
      patient_name VARCHAR(255),
      patient_dob DATE,
      priority ENUM('normal', 'urgent', 'stat') DEFAULT 'normal',
      status ENUM('pending', 'processing', 'completed', 'error') DEFAULT 'pending',
      mode ENUM('befund', 'arztbrief') DEFAULT 'befund',
      bemerkung TEXT,
      termin DATETIME NULL,
      fachabteilung VARCHAR(255),
      berechtigte TEXT,
      raw_transcript LONGTEXT,
      transcript LONGTEXT,
      methodik LONGTEXT,
      befund LONGTEXT,
      beurteilung LONGTEXT,
      corrected_text LONGTEXT,
      change_score INT DEFAULT NULL,
      error_message TEXT,
      archived BOOLEAN DEFAULT FALSE,
      archived_at TIMESTAMP NULL,
      archived_by VARCHAR(255),
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      processing_started_at TIMESTAMP NULL,
      completed_at TIMESTAMP NULL,
      INDEX idx_username (username),
      INDEX idx_status (status),
      INDEX idx_priority (priority),
      INDEX idx_created_at (created_at),
      INDEX idx_archived (archived),
      INDEX idx_fachabteilung (fachabteilung)
    )
  `);

  // ── Separate audio storage (keeps main table rows small) ──
  await db.execute(`
    CREATE TABLE IF NOT EXISTS dictation_audio (
      dictation_id INT PRIMARY KEY,
      audio_data LONGBLOB NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (dictation_id) REFERENCES offline_dictations(id) ON DELETE CASCADE
    )
  `);

  // ── Separate segments storage (word-level timestamps, can be >1 MB) ──
  await db.execute(`
    CREATE TABLE IF NOT EXISTS dictation_segments (
      dictation_id INT PRIMARY KEY,
      segments LONGTEXT NOT NULL,
      FOREIGN KEY (dictation_id) REFERENCES offline_dictations(id) ON DELETE CASCADE
    )
  `);

  // ── Correction log ──
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

  // ── Migrate legacy: move audio_data from main table to dictation_audio ──
  try {
    const [cols] = await db.execute(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'offline_dictations' AND COLUMN_NAME = 'audio_data'
    `) as any;
    if (cols && cols.length > 0) {
      // Move any existing audio data to the new table
      await db.execute(`
        INSERT IGNORE INTO dictation_audio (dictation_id, audio_data)
        SELECT id, audio_data FROM offline_dictations WHERE audio_data IS NOT NULL
      `);
      try {
        await db.execute(`ALTER TABLE offline_dictations DROP COLUMN audio_data`);
        console.log(`[DB] ✓ Migrated audio_data → dictation_audio (${poolKey})`);
      } catch (e: any) {
        console.log(`[DB] Could not drop audio_data column: ${e.message}`);
      }
    }
  } catch { /* fresh install */ }

  // ── Migrate legacy: move segments from main table to dictation_segments ──
  try {
    const [cols] = await db.execute(`
      SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'offline_dictations' AND COLUMN_NAME = 'segments'
    `) as any;
    if (cols && cols.length > 0) {
      await db.execute(`
        INSERT IGNORE INTO dictation_segments (dictation_id, segments)
        SELECT id, segments FROM offline_dictations WHERE segments IS NOT NULL AND segments != ''
      `);
      try {
        await db.execute(`ALTER TABLE offline_dictations DROP COLUMN segments`);
        console.log(`[DB] ✓ Migrated segments → dictation_segments (${poolKey})`);
      } catch (e: any) {
        console.log(`[DB] Could not drop segments column: ${e.message}`);
      }
    }
  } catch { /* fresh install */ }

  // ── Ensure text columns are LONGTEXT ──
  try {
    await db.execute(`ALTER TABLE offline_dictations
      MODIFY COLUMN raw_transcript LONGTEXT,
      MODIFY COLUMN transcript LONGTEXT,
      MODIFY COLUMN methodik LONGTEXT,
      MODIFY COLUMN befund LONGTEXT,
      MODIFY COLUMN beurteilung LONGTEXT,
      MODIFY COLUMN corrected_text LONGTEXT`);
  } catch { /* already LONGTEXT */ }

  // ── Ensure all required columns exist ──
  const [existingCols] = await db.execute(`
    SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'offline_dictations'
  `) as any;
  const existingSet = new Set((existingCols || []).map((r: any) => r.COLUMN_NAME.toLowerCase()));

  const requiredColumns: { column: string; sql: string }[] = [
    { column: 'raw_transcript', sql: 'ADD COLUMN raw_transcript LONGTEXT' },
    { column: 'change_score', sql: 'ADD COLUMN change_score INT DEFAULT NULL' },
    { column: 'archived', sql: 'ADD COLUMN archived BOOLEAN DEFAULT FALSE' },
    { column: 'archived_at', sql: 'ADD COLUMN archived_at TIMESTAMP NULL' },
    { column: 'archived_by', sql: 'ADD COLUMN archived_by VARCHAR(255)' },
    { column: 'bemerkung', sql: 'ADD COLUMN bemerkung TEXT' },
    { column: 'termin', sql: 'ADD COLUMN termin DATETIME NULL' },
    { column: 'fachabteilung', sql: 'ADD COLUMN fachabteilung VARCHAR(255)' },
    { column: 'berechtigte', sql: 'ADD COLUMN berechtigte TEXT' },
  ];

  for (const { column, sql } of requiredColumns) {
    if (!existingSet.has(column.toLowerCase())) {
      try {
        await db.execute(`ALTER TABLE offline_dictations ${sql}`);
        console.log(`[DB] ✓ Added ${column} (${poolKey})`);
      } catch { /* ignore */ }
    }
  }

  tableInitializedPerPool.set(poolKey, true);
  console.log(`[DB] ✓ All tables ready (${poolKey})`);
}

// ============================================================
// Internal helpers (accept pool parameter → zero duplication)
// ============================================================

async function _createDictation(
  db: mysql.Pool,
  data: {
    username: string;
    audioData: Buffer;
    audioMimeType: string;
    audioDuration: number;
    orderNumber: string;
    patientName?: string;
    patientDob?: string;
    priority: DictationPriority;
    mode: 'befund' | 'arztbrief';
    bemerkung?: string;
    termin?: string;
    fachabteilung?: string;
    berechtigte?: string[];
  }
): Promise<number> {
  // Insert metadata row
  const [result] = await db.execute(
    `INSERT INTO offline_dictations 
      (username, audio_mime_type, audio_duration_seconds, order_number, patient_name, patient_dob, 
       priority, mode, bemerkung, termin, fachabteilung, berechtigte, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [
      data.username, data.audioMimeType, data.audioDuration, data.orderNumber,
      data.patientName || null, data.patientDob || null, data.priority, data.mode,
      data.bemerkung || null, data.termin || null, data.fachabteilung || null,
      data.berechtigte ? JSON.stringify(data.berechtigte) : null,
    ]
  );
  const id = (result as any).insertId;

  // Insert audio into separate table
  await db.execute(
    `INSERT INTO dictation_audio (dictation_id, audio_data) VALUES (?, ?)`,
    [id, data.audioData]
  );

  return id;
}

async function _getUserDictations(
  db: mysql.Pool, username: string, includeArchived: boolean
): Promise<DictationSummary[]> {
  const archivedCond = includeArchived ? '' : 'AND (archived IS NULL OR archived = FALSE)';
  const [rows] = await db.execute(
    `SELECT ${SUMMARY_COLUMNS} FROM offline_dictations
     WHERE username = ? ${archivedCond}
     ORDER BY ${PRIORITY_ORDER}, created_at DESC`,
    [username]
  );
  return rows as DictationSummary[];
}

async function _getAllDictations(
  db: mysql.Pool, statusFilter?: DictationStatus, userFilter?: string, includeArchived: boolean = false
): Promise<DictationSummary[]> {
  const conditions: string[] = [];
  const params: string[] = [];
  if (!includeArchived) conditions.push('(archived IS NULL OR archived = FALSE)');
  if (statusFilter) { conditions.push('status = ?'); params.push(statusFilter); }
  if (userFilter) { conditions.push('username = ?'); params.push(userFilter); }
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const [rows] = await db.execute(
    `SELECT ${SUMMARY_COLUMNS} FROM offline_dictations ${whereClause}
     ORDER BY ${PRIORITY_ORDER}, created_at DESC`,
    params
  );
  return rows as DictationSummary[];
}

async function _getDictationUsers(db: mysql.Pool): Promise<string[]> {
  const [rows] = await db.execute<any[]>(
    `SELECT DISTINCT username FROM offline_dictations ORDER BY username`
  );
  return rows.map((r: any) => r.username);
}

async function _getPendingDictations(db: mysql.Pool, limit: number): Promise<DictationSummary[]> {
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const [rows] = await db.execute(
    `SELECT ${SUMMARY_COLUMNS} FROM offline_dictations
     WHERE status = 'pending'
     ORDER BY ${PRIORITY_ORDER}, created_at ASC
     LIMIT ${safeLimit}`
  );
  return rows as DictationSummary[];
}

async function _getDictationById(db: mysql.Pool, id: number): Promise<OfflineDictation | null> {
  const [rows] = await db.execute<any[]>(
    `SELECT ${DETAIL_COLUMNS}
     FROM offline_dictations d
     LEFT JOIN dictation_segments s ON s.dictation_id = d.id
     WHERE d.id = ?`,
    [id]
  );
  return rows[0] || null;
}

async function _getAudioData(db: mysql.Pool, id: number): Promise<{ audio_data: Buffer; audio_mime_type: string } | null> {
  const [rows] = await db.execute<any[]>(
    `SELECT a.audio_data, d.audio_mime_type
     FROM dictation_audio a
     JOIN offline_dictations d ON d.id = a.dictation_id
     WHERE a.dictation_id = ?`,
    [id]
  );
  return rows[0] || null;
}

async function _completeDictation(
  db: mysql.Pool, id: number,
  results: {
    rawTranscript?: string; segments?: any[]; transcript?: string;
    methodik?: string; befund?: string; beurteilung?: string;
    correctedText?: string; changeScore?: number;
  }
): Promise<void> {
  const segmentsJson = results.segments ? JSON.stringify(results.segments) : null;
  console.log(`[DB] completeDictation: id=${id}, segments=${results.segments?.length || 0} items`);

  await db.execute(
    `UPDATE offline_dictations 
     SET status = 'completed', raw_transcript = ?, transcript = ?,
         methodik = ?, befund = ?, beurteilung = ?,
         corrected_text = ?, change_score = ?, completed_at = NOW()
     WHERE id = ?`,
    [
      results.rawTranscript || null, results.transcript || null,
      results.methodik || null, results.befund || null, results.beurteilung || null,
      results.correctedText || null, results.changeScore ?? null, id,
    ]
  );

  // Save segments into separate table
  if (segmentsJson) {
    await db.execute(
      `INSERT INTO dictation_segments (dictation_id, segments) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE segments = VALUES(segments)`,
      [id, segmentsJson]
    );
  }
}

async function _markProcessing(db: mysql.Pool, id: number): Promise<void> {
  await db.execute(
    `UPDATE offline_dictations SET status = 'processing', processing_started_at = NOW() WHERE id = ?`, [id]
  );
}

async function _markError(db: mysql.Pool, id: number, errorMessage: string): Promise<void> {
  await db.execute(
    `UPDATE offline_dictations SET status = 'error', error_message = ?, completed_at = NOW() WHERE id = ?`,
    [errorMessage, id]
  );
}

async function _deleteAudioData(db: mysql.Pool, id: number): Promise<void> {
  await db.execute(`DELETE FROM dictation_audio WHERE dictation_id = ?`, [id]);
}

async function _updateCorrectedText(db: mysql.Pool, id: number, correctedText: string, changeScore?: number): Promise<void> {
  await db.execute(
    `UPDATE offline_dictations SET corrected_text = ?, change_score = ? WHERE id = ?`,
    [correctedText, changeScore ?? null, id]
  );
}

async function _deleteDictation(db: mysql.Pool, id: number): Promise<void> {
  await db.execute(`DELETE FROM offline_dictations WHERE id = ?`, [id]);
}

async function _getQueueStats(db: mysql.Pool) {
  const [rows] = await db.execute<any[]>(
    `SELECT status, COUNT(*) as count FROM offline_dictations WHERE (archived IS NULL OR archived = FALSE) GROUP BY status`
  );
  const stats = { pending: 0, processing: 0, completed: 0, error: 0 };
  for (const row of rows) stats[row.status as DictationStatus] = row.count;
  return stats;
}

async function _retryDictation(db: mysql.Pool, id: number): Promise<void> {
  await db.execute(
    `UPDATE offline_dictations 
     SET status = 'pending', error_message = NULL, processing_started_at = NULL, completed_at = NULL
     WHERE id = ? AND status = 'error'`, [id]
  );
}

async function _updateAudioData(db: mysql.Pool, id: number, audioData: Buffer, mimeType: string): Promise<void> {
  await db.execute(
    `INSERT INTO dictation_audio (dictation_id, audio_data) VALUES (?, ?)
     ON DUPLICATE KEY UPDATE audio_data = VALUES(audio_data)`,
    [id, audioData]
  );
  await db.execute(`UPDATE offline_dictations SET audio_mime_type = ? WHERE id = ?`, [mimeType, id]);
}

async function _archiveDictation(db: mysql.Pool, id: number, archivedBy: string): Promise<void> {
  await db.execute(
    `UPDATE offline_dictations SET archived = TRUE, archived_at = NOW(), archived_by = ? WHERE id = ?`,
    [archivedBy, id]
  );
}

async function _unarchiveDictation(db: mysql.Pool, id: number): Promise<void> {
  await db.execute(
    `UPDATE offline_dictations SET archived = FALSE, archived_at = NULL, archived_by = NULL WHERE id = ?`, [id]
  );
}

async function _getArchivedDictations(
  db: mysql.Pool,
  filters?: { username?: string; archivedBy?: string; patientName?: string; fromDate?: string; toDate?: string; }
): Promise<DictationSummary[]> {
  const conditions: string[] = ['archived = TRUE'];
  const params: any[] = [];
  if (filters?.username) { conditions.push('username = ?'); params.push(filters.username); }
  if (filters?.archivedBy) { conditions.push('archived_by = ?'); params.push(filters.archivedBy); }
  if (filters?.patientName) { conditions.push('patient_name LIKE ?'); params.push(`%${filters.patientName}%`); }
  if (filters?.fromDate) { conditions.push('created_at >= ?'); params.push(filters.fromDate); }
  if (filters?.toDate) { conditions.push('created_at <= ?'); params.push(filters.toDate); }

  const [rows] = await db.execute(
    `SELECT ${SUMMARY_COLUMNS} FROM offline_dictations WHERE ${conditions.join(' AND ')} ORDER BY archived_at DESC`,
    params
  );
  return rows as DictationSummary[];
}

// ============================================================
// Public API – Default pool
// ============================================================

export async function initOfflineDictationTable(): Promise<void> {
  return _initTables(await getPool(), 'default');
}

export async function createOfflineDictation(data: Parameters<typeof _createDictation>[1]): Promise<number> {
  return _createDictation(await getPool(), data);
}

export async function getUserDictations(username: string, includeArchived = false): Promise<DictationSummary[]> {
  return _getUserDictations(await getPool(), username, includeArchived);
}

export async function getAllDictations(statusFilter?: DictationStatus, userFilter?: string, includeArchived = false): Promise<DictationSummary[]> {
  return _getAllDictations(await getPool(), statusFilter, userFilter, includeArchived);
}

export async function getDictationUsers(): Promise<string[]> {
  return _getDictationUsers(await getPool());
}

export async function getPendingDictations(limit = 10): Promise<DictationSummary[]> {
  return _getPendingDictations(await getPool(), limit);
}

export async function getDictationById(id: number, includeAudio = false): Promise<OfflineDictation | null> {
  const pool = await getPool();
  const dictation = await _getDictationById(pool, id);
  if (!dictation || !includeAudio) return dictation;
  const audio = await _getAudioData(pool, id);
  if (audio) dictation.audio_data = audio.audio_data;
  return dictation;
}

export async function getAudioData(id: number) {
  return _getAudioData(await getPool(), id);
}

export async function completeDictation(id: number, results: Parameters<typeof _completeDictation>[2]): Promise<void> {
  return _completeDictation(await getPool(), id, results);
}

export async function markDictationProcessing(id: number): Promise<void> {
  return _markProcessing(await getPool(), id);
}

export async function markDictationError(id: number, msg: string): Promise<void> {
  return _markError(await getPool(), id, msg);
}

export async function deleteAudioData(id: number): Promise<void> {
  return _deleteAudioData(await getPool(), id);
}

export async function updateCorrectedText(id: number, text: string, score?: number): Promise<void> {
  return _updateCorrectedText(await getPool(), id, text, score);
}

export async function deleteDictation(id: number): Promise<void> {
  return _deleteDictation(await getPool(), id);
}

export async function getQueueStats() {
  return _getQueueStats(await getPool());
}

export async function retryDictation(id: number): Promise<void> {
  return _retryDictation(await getPool(), id);
}

export async function updateAudioData(id: number, data: Buffer, mime: string): Promise<void> {
  return _updateAudioData(await getPool(), id, data, mime);
}

export async function archiveDictation(id: number, by: string): Promise<void> {
  return _archiveDictation(await getPool(), id, by);
}

export async function unarchiveDictation(id: number): Promise<void> {
  return _unarchiveDictation(await getPool(), id);
}

export async function getArchivedDictations(filters?: Parameters<typeof _getArchivedDictations>[1]): Promise<DictationSummary[]> {
  return _getArchivedDictations(await getPool(), filters);
}

// ============================================================
// Public API – Request-based (dynamic pool via DB-Token)
// ============================================================

export async function initOfflineDictationTableWithRequest(req: NextRequest): Promise<void> {
  return _initTables(await getPoolForRequest(req), poolKeyFromRequest(req));
}

export async function createOfflineDictationWithRequest(req: NextRequest, data: Parameters<typeof _createDictation>[1]): Promise<number> {
  return _createDictation(await getPoolForRequest(req), data);
}

export async function getUserDictationsWithRequest(req: NextRequest, username: string, includeArchived = false): Promise<DictationSummary[]> {
  return _getUserDictations(await getPoolForRequest(req), username, includeArchived);
}

export async function getAllDictationsWithRequest(req: NextRequest, statusFilter?: DictationStatus, userFilter?: string, includeArchived = false): Promise<DictationSummary[]> {
  return _getAllDictations(await getPoolForRequest(req), statusFilter, userFilter, includeArchived);
}

export async function getDictationUsersWithRequest(req: NextRequest): Promise<string[]> {
  return _getDictationUsers(await getPoolForRequest(req));
}

export async function getPendingDictationsWithRequest(req: NextRequest, limit = 10): Promise<DictationSummary[]> {
  return _getPendingDictations(await getPoolForRequest(req), limit);
}

export async function getDictationByIdWithRequest(req: NextRequest, id: number, includeAudio = false): Promise<OfflineDictation | null> {
  const pool = await getPoolForRequest(req);
  const dictation = await _getDictationById(pool, id);
  if (!dictation || !includeAudio) return dictation;
  const audio = await _getAudioData(pool, id);
  if (audio) dictation.audio_data = audio.audio_data;
  return dictation;
}

export async function getAudioDataWithRequest(req: NextRequest, id: number) {
  return _getAudioData(await getPoolForRequest(req), id);
}

export async function completeDictationWithRequest(req: NextRequest, id: number, results: Parameters<typeof _completeDictation>[2]): Promise<void> {
  return _completeDictation(await getPoolForRequest(req), id, results);
}

export async function markDictationProcessingWithRequest(req: NextRequest, id: number): Promise<void> {
  return _markProcessing(await getPoolForRequest(req), id);
}

export async function markDictationErrorWithRequest(req: NextRequest, id: number, msg: string): Promise<void> {
  return _markError(await getPoolForRequest(req), id, msg);
}

export async function deleteAudioDataWithRequest(req: NextRequest, id: number): Promise<void> {
  return _deleteAudioData(await getPoolForRequest(req), id);
}

export async function updateCorrectedTextWithRequest(req: NextRequest, id: number, text: string, score?: number): Promise<void> {
  return _updateCorrectedText(await getPoolForRequest(req), id, text, score);
}

export async function deleteDictationWithRequest(req: NextRequest, id: number): Promise<void> {
  return _deleteDictation(await getPoolForRequest(req), id);
}

export async function getQueueStatsWithRequest(req: NextRequest) {
  return _getQueueStats(await getPoolForRequest(req));
}

export async function retryDictationWithRequest(req: NextRequest, id: number): Promise<void> {
  return _retryDictation(await getPoolForRequest(req), id);
}

export async function updateAudioDataWithRequest(req: NextRequest, id: number, data: Buffer, mime: string): Promise<void> {
  return _updateAudioData(await getPoolForRequest(req), id, data, mime);
}

export async function archiveDictationWithRequest(req: NextRequest, id: number, by: string): Promise<void> {
  return _archiveDictation(await getPoolForRequest(req), id, by);
}

export async function unarchiveDictationWithRequest(req: NextRequest, id: number): Promise<void> {
  return _unarchiveDictation(await getPoolForRequest(req), id);
}

export async function getArchivedDictationsWithRequest(req: NextRequest, filters?: Parameters<typeof _getArchivedDictations>[1]): Promise<DictationSummary[]> {
  return _getArchivedDictations(await getPoolForRequest(req), filters);
}
