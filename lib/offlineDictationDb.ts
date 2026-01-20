import { NextRequest } from 'next/server';
import mysql from 'mysql2/promise';
import { getPool, query, execute, getPoolForRequest } from './db';

// Migration version - increment when adding new migrations
const CURRENT_MIGRATION_VERSION = 5;

// Offline Dictation Status
export type DictationStatus = 'pending' | 'processing' | 'completed' | 'error';

// Priority levels
export type DictationPriority = 'normal' | 'urgent' | 'stat';

// Offline Dictation Entry
export interface OfflineDictation {
  id: number;
  username: string;
  audio_data: Buffer | null; // BLOB data
  audio_mime_type: string;
  audio_duration_seconds: number;
  order_number: string;
  patient_name?: string;
  patient_dob?: string;
  priority: DictationPriority;
  status: DictationStatus;
  mode: 'befund' | 'arztbrief';
  // Zusätzliche Metadaten
  bemerkung?: string;
  termin?: Date;
  fachabteilung?: string;
  berechtigte?: string; // JSON array of usernames
  // Results
  raw_transcript?: string; // Pure Transkription vor LLM-Korrektur
  segments?: string; // JSON array with word-level timestamps for highlighting
  transcript?: string;
  methodik?: string;
  befund?: string;
  beurteilung?: string;
  corrected_text?: string;
  change_score?: number; // Änderungsscore (0-100) für Ampelsystem
  error_message?: string;
  // Archive status
  archived?: boolean;
  archived_at?: Date;
  archived_by?: string;
  // Timestamps
  created_at: Date;
  processing_started_at?: Date;
  completed_at?: Date;
}

// Initialize offline dictation tables
export async function initOfflineDictationTable(): Promise<void> {
  const db = await getPool();
  
  await db.execute(`
    CREATE TABLE IF NOT EXISTS offline_dictations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) NOT NULL,
      audio_data LONGBLOB,
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
      raw_transcript TEXT,
      segments LONGTEXT,
      transcript TEXT,
      methodik TEXT,
      befund TEXT,
      beurteilung TEXT,
      corrected_text TEXT,
      change_score INT DEFAULT NULL,
      error_message TEXT,
      archived BOOLEAN DEFAULT FALSE,
      archived_at TIMESTAMP NULL,
      archived_by VARCHAR(255) DEFAULT NULL,
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
  
  // Run schema migrations using fast INFORMATION_SCHEMA check
  await runSchemaMigrations(db, 'default');

  // Initialize correction log table (CREATE IF NOT EXISTS is fast)
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
  
  console.log('[DB] ✓ Offline dictations table ready');
}

// Shared schema migration logic - used by both init functions
async function runSchemaMigrations(db: mysql.Pool, poolKey: string): Promise<void> {
  // Check current migration version in config table
  try {
    const [versionRows] = await db.execute(
      `SELECT config_value FROM config WHERE config_key = 'offline_dictation_migration_version'`
    ) as any;
    
    const currentVersion = versionRows[0]?.config_value ? parseInt(versionRows[0].config_value) : 0;
    
    if (currentVersion >= CURRENT_MIGRATION_VERSION) {
      console.log(`[DB] Schema already at version ${currentVersion}, skipping migrations (${poolKey})`);
      return;
    }
    
    console.log(`[DB] Schema version ${currentVersion} -> ${CURRENT_MIGRATION_VERSION}, running migrations...`);
  } catch (e: any) {
    console.log(`[DB] First-time schema setup for ${poolKey}`);
  }
  
  // Get existing columns in one query
  const [existingCols] = await db.execute(`
    SELECT COLUMN_NAME 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
    AND TABLE_NAME = 'offline_dictations'
  `) as any;
  
  const existingColumns = new Set((existingCols || []).map((row: any) => row.COLUMN_NAME.toLowerCase()));
  
  // Define required columns and their ALTER statements
  const requiredMigrations: { column: string; sql: string }[] = [
    { column: 'raw_transcript', sql: 'ADD COLUMN raw_transcript TEXT AFTER mode' },
    { column: 'change_score', sql: 'ADD COLUMN change_score INT DEFAULT NULL AFTER corrected_text' },
    { column: 'segments', sql: 'ADD COLUMN segments LONGTEXT AFTER raw_transcript' },
    { column: 'archived', sql: 'ADD COLUMN archived BOOLEAN DEFAULT FALSE AFTER error_message' },
    { column: 'archived_at', sql: 'ADD COLUMN archived_at TIMESTAMP NULL AFTER archived' },
    { column: 'archived_by', sql: 'ADD COLUMN archived_by VARCHAR(255) DEFAULT NULL AFTER archived_at' },
    { column: 'bemerkung', sql: 'ADD COLUMN bemerkung TEXT AFTER mode' },
    { column: 'termin', sql: 'ADD COLUMN termin DATETIME NULL AFTER bemerkung' },
    { column: 'fachabteilung', sql: 'ADD COLUMN fachabteilung VARCHAR(255) AFTER termin' },
    { column: 'berechtigte', sql: 'ADD COLUMN berechtigte TEXT AFTER fachabteilung' },
  ];
  
  // Only run ALTER statements for missing columns
  let migrationsRun = 0;
  for (const migration of requiredMigrations) {
    if (!existingColumns.has(migration.column.toLowerCase())) {
      try {
        await db.execute(`ALTER TABLE offline_dictations ${migration.sql}`);
        console.log(`[DB] ✓ Added ${migration.column} column (${poolKey})`);
        migrationsRun++;
      } catch (e: any) {
        // Column might exist but not in our set (race condition)
      }
    }
  }
  
  // Check and add indexes
  const [existingIndexes] = await db.execute(`
    SELECT INDEX_NAME 
    FROM INFORMATION_SCHEMA.STATISTICS 
    WHERE TABLE_SCHEMA = DATABASE() 
    AND TABLE_NAME = 'offline_dictations'
  `) as any;
  
  const indexSet = new Set((existingIndexes || []).map((row: any) => row.INDEX_NAME.toLowerCase()));
  
  const requiredIndexes = [
    { name: 'idx_archived', sql: 'CREATE INDEX idx_archived ON offline_dictations(archived)' },
    { name: 'idx_fachabteilung', sql: 'CREATE INDEX idx_fachabteilung ON offline_dictations(fachabteilung)' },
  ];
  
  for (const index of requiredIndexes) {
    if (!indexSet.has(index.name.toLowerCase())) {
      try {
        await db.execute(index.sql);
        console.log(`[DB] ✓ Added ${index.name} index (${poolKey})`);
        migrationsRun++;
      } catch (e: any) {
        // Index might exist (race condition)
      }
    }
  }
  
  // Save current migration version
  try {
    await db.execute(
      `INSERT INTO config (config_key, config_value) VALUES ('offline_dictation_migration_version', ?)
       ON DUPLICATE KEY UPDATE config_value = ?`,
      [CURRENT_MIGRATION_VERSION.toString(), CURRENT_MIGRATION_VERSION.toString()]
    );
  } catch (e: any) {
    console.warn(`[DB] Could not save migration version: ${e.message}`);
  }
  
  if (migrationsRun > 0) {
    console.log(`[DB] ✓ Schema migrated to version ${CURRENT_MIGRATION_VERSION} (${migrationsRun} changes)`);
  }
}

// Create a new offline dictation
export async function createOfflineDictation(
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
  const result = await execute(
    `INSERT INTO offline_dictations 
      (username, audio_data, audio_mime_type, audio_duration_seconds, order_number, patient_name, patient_dob, priority, mode, bemerkung, termin, fachabteilung, berechtigte, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [
      data.username,
      data.audioData,
      data.audioMimeType,
      data.audioDuration,
      data.orderNumber,
      data.patientName || null,
      data.patientDob || null,
      data.priority,
      data.mode,
      data.bemerkung || null,
      data.termin || null,
      data.fachabteilung || null,
      data.berechtigte ? JSON.stringify(data.berechtigte) : null
    ]
  );
  return result.insertId;
}

// Get dictations for a user (without audio data for list view)
export async function getUserDictations(username: string, includeArchived: boolean = false): Promise<Omit<OfflineDictation, 'audio_data'>[]> {
  const archivedCondition = includeArchived ? '' : 'AND (archived IS NULL OR archived = FALSE)';
  return query(
    `SELECT id, username, audio_mime_type, audio_duration_seconds, order_number, patient_name, patient_dob,
            priority, status, mode, bemerkung, termin, fachabteilung, berechtigte,
            raw_transcript, segments, transcript, methodik, befund, beurteilung, corrected_text, 
            change_score, error_message, archived, archived_at, archived_by,
            created_at, processing_started_at, completed_at
     FROM offline_dictations 
     WHERE username = ? ${archivedCondition}
     ORDER BY 
       CASE priority 
         WHEN 'stat' THEN 1 
         WHEN 'urgent' THEN 2 
         ELSE 3 
       END,
       created_at DESC`,
    [username]
  );
}

// Get all dictations (for users with view all permission)
export async function getAllDictations(statusFilter?: DictationStatus, userFilter?: string, includeArchived: boolean = false): Promise<Omit<OfflineDictation, 'audio_data'>[]> {
  const conditions: string[] = [];
  const params: (string)[] = [];
  
  if (!includeArchived) {
    conditions.push('(archived IS NULL OR archived = FALSE)');
  }
  
  if (statusFilter) {
    conditions.push('status = ?');
    params.push(statusFilter);
  }
  if (userFilter) {
    conditions.push('username = ?');
    params.push(userFilter);
  }
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  
  return query(
    `SELECT id, username, audio_mime_type, audio_duration_seconds, order_number, patient_name, patient_dob,
            priority, status, mode, bemerkung, termin, fachabteilung, berechtigte,
            raw_transcript, segments, transcript, methodik, befund, beurteilung, corrected_text, 
            change_score, error_message, archived, archived_at, archived_by,
            created_at, processing_started_at, completed_at
     FROM offline_dictations 
     ${whereClause}
     ORDER BY 
       CASE priority 
         WHEN 'stat' THEN 1 
         WHEN 'urgent' THEN 2 
         ELSE 3 
       END,
       created_at DESC`,
    params
  );
}

// Get list of unique usernames with dictations
export async function getDictationUsers(): Promise<string[]> {
  const result = await query<{ username: string }>(
    `SELECT DISTINCT username FROM offline_dictations ORDER BY username`,
    []
  );
  return result.map(r => r.username);
}

// Get all pending dictations for processing (worker)
export async function getPendingDictations(limit: number = 10): Promise<OfflineDictation[]> {
  // Note: LIMIT must be embedded directly as mysql2 has issues with parameterized LIMIT
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  return query(
    `SELECT * FROM offline_dictations 
     WHERE status = 'pending'
     ORDER BY 
       CASE priority 
         WHEN 'stat' THEN 1 
         WHEN 'urgent' THEN 2 
         ELSE 3 
       END,
       created_at ASC
     LIMIT ${safeLimit}`,
    []
  );
}

// Get a single dictation by ID
export async function getDictationById(id: number, includeAudio: boolean = false): Promise<OfflineDictation | null> {
  const fields = includeAudio 
    ? '*' 
    : `id, username, audio_mime_type, audio_duration_seconds, order_number, patient_name, patient_dob,
       priority, status, mode, raw_transcript, segments, transcript, methodik, befund, beurteilung, corrected_text, change_score, error_message,
       created_at, processing_started_at, completed_at`;
  
  const rows = await query<OfflineDictation>(
    `SELECT ${fields} FROM offline_dictations WHERE id = ?`,
    [id]
  );
  return rows[0] || null;
}

// Update dictation status to processing
export async function markDictationProcessing(id: number): Promise<void> {
  await execute(
    `UPDATE offline_dictations 
     SET status = 'processing', processing_started_at = NOW()
     WHERE id = ?`,
    [id]
  );
}

// Update dictation with results
export async function completeDictation(
  id: number,
  results: {
    rawTranscript?: string;
    transcript?: string;
    methodik?: string;
    befund?: string;
    beurteilung?: string;
    correctedText?: string;
    changeScore?: number;
  }
): Promise<void> {
  await execute(
    `UPDATE offline_dictations 
     SET status = 'completed',
         raw_transcript = ?,
         transcript = ?,
         methodik = ?,
         befund = ?,
         beurteilung = ?,
         corrected_text = ?,
         change_score = ?,
         completed_at = NOW()
     WHERE id = ?`,
    [
      results.rawTranscript || null,
      results.transcript || null,
      results.methodik || null,
      results.befund || null,
      results.beurteilung || null,
      results.correctedText || null,
      results.changeScore ?? null,
      id
    ]
  );
}

// Mark dictation as error
export async function markDictationError(id: number, errorMessage: string): Promise<void> {
  await execute(
    `UPDATE offline_dictations 
     SET status = 'error', error_message = ?, completed_at = NOW()
     WHERE id = ?`,
    [errorMessage, id]
  );
}

// Delete audio data (keep results)
export async function deleteAudioData(id: number): Promise<void> {
  await execute(
    `UPDATE offline_dictations SET audio_data = NULL WHERE id = ?`,
    [id]
  );
}

// Update corrected text (after manual re-correction)
export async function updateCorrectedText(
  id: number, 
  correctedText: string, 
  changeScore?: number
): Promise<void> {
  await execute(
    `UPDATE offline_dictations 
     SET corrected_text = ?, change_score = ?
     WHERE id = ?`,
    [correctedText, changeScore ?? null, id]
  );
}

// Delete dictation completely
export async function deleteDictation(id: number): Promise<void> {
  await execute(`DELETE FROM offline_dictations WHERE id = ?`, [id]);
}

// Get queue statistics
export async function getQueueStats(): Promise<{
  pending: number;
  processing: number;
  completed: number;
  error: number;
}> {
  const rows = await query<{ status: DictationStatus; count: number }>(
    `SELECT status, COUNT(*) as count FROM offline_dictations GROUP BY status`
  );
  
  const stats = { pending: 0, processing: 0, completed: 0, error: 0 };
  for (const row of rows) {
    stats[row.status] = row.count;
  }
  return stats;
}

// Retry a failed dictation
export async function retryDictation(id: number): Promise<void> {
  await execute(
    `UPDATE offline_dictations 
     SET status = 'pending', 
         error_message = NULL, 
         processing_started_at = NULL, 
         completed_at = NULL
     WHERE id = ? AND status = 'error'`,
    [id]
  );
}

// Update audio data with compressed version
export async function updateAudioData(
  id: number,
  audioData: Buffer,
  mimeType: string
): Promise<void> {
  await execute(
    `UPDATE offline_dictations 
     SET audio_data = ?, audio_mime_type = ?
     WHERE id = ?`,
    [audioData, mimeType, id]
  );
}

// Archive a dictation
export async function archiveDictation(id: number, archivedBy: string): Promise<void> {
  await execute(
    `UPDATE offline_dictations 
     SET archived = TRUE, archived_at = NOW(), archived_by = ?
     WHERE id = ?`,
    [archivedBy, id]
  );
}

// Unarchive a dictation
export async function unarchiveDictation(id: number): Promise<void> {
  await execute(
    `UPDATE offline_dictations 
     SET archived = FALSE, archived_at = NULL, archived_by = NULL
     WHERE id = ?`,
    [id]
  );
}

// Get archived dictations with filters
export async function getArchivedDictations(filters?: {
  username?: string;
  archivedBy?: string;
  patientName?: string;
  fromDate?: string;
  toDate?: string;
}): Promise<Omit<OfflineDictation, 'audio_data'>[]> {
  const conditions: string[] = ['archived = TRUE'];
  const params: any[] = [];
  
  if (filters?.username) {
    conditions.push('username = ?');
    params.push(filters.username);
  }
  if (filters?.archivedBy) {
    conditions.push('archived_by = ?');
    params.push(filters.archivedBy);
  }
  if (filters?.patientName) {
    conditions.push('patient_name LIKE ?');
    params.push(`%${filters.patientName}%`);
  }
  if (filters?.fromDate) {
    conditions.push('created_at >= ?');
    params.push(filters.fromDate);
  }
  if (filters?.toDate) {
    conditions.push('created_at <= ?');
    params.push(filters.toDate);
  }
  
  const whereClause = conditions.join(' AND ');
  
  return query(
    `SELECT id, username, audio_mime_type, audio_duration_seconds, order_number, patient_name, patient_dob,
            priority, status, mode, bemerkung, termin, fachabteilung, berechtigte,
            raw_transcript, segments, transcript, methodik, befund, beurteilung, corrected_text, 
            change_score, error_message, archived, archived_at, archived_by,
            created_at, processing_started_at, completed_at
     FROM offline_dictations 
     WHERE ${whereClause}
     ORDER BY archived_at DESC`,
    params
  );
}

// ============================================================
// Request-basierte Funktionen (für dynamische DB über Token)
// ============================================================

// Track if we've initialized the table per database pool
const tableInitializedPerPool = new Map<string, boolean>();

// Helper to get pool key for tracking
function getPoolKeyFromRequest(request: NextRequest): string {
  const dbToken = request.headers.get('x-db-token');
  if (dbToken) {
    try {
      const decoded = Buffer.from(dbToken, 'base64').toString('utf8');
      const parsed = JSON.parse(decoded);
      return `${parsed.host}:${parsed.port || 3306}:${parsed.database}:${parsed.user}`;
    } catch {
      // Invalid token, fall through to default
    }
  }
  return 'default';
}

// Initialize offline dictation tables with Request context
export async function initOfflineDictationTableWithRequest(request: NextRequest): Promise<void> {
  const poolKey = getPoolKeyFromRequest(request);
  
  // Only initialize once per pool - fast path without DB access
  if (tableInitializedPerPool.get(poolKey)) {
    return;
  }
  
  const db = await getPoolForRequest(request);
  
  await db.execute(`
    CREATE TABLE IF NOT EXISTS offline_dictations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) NOT NULL,
      audio_data LONGBLOB,
      audio_mime_type VARCHAR(100) DEFAULT 'audio/webm',
      audio_duration_seconds FLOAT DEFAULT 0,
      order_number VARCHAR(255) NOT NULL,
      patient_name VARCHAR(255),
      patient_dob DATE,
      priority ENUM('normal', 'urgent', 'stat') DEFAULT 'normal',
      status ENUM('pending', 'processing', 'completed', 'error') DEFAULT 'pending',
      mode ENUM('befund', 'arztbrief') DEFAULT 'befund',
      raw_transcript TEXT,
      segments LONGTEXT,
      transcript TEXT,
      methodik TEXT,
      befund TEXT,
      beurteilung TEXT,
      corrected_text TEXT,
      change_score INT DEFAULT NULL,
      error_message TEXT,
      bemerkung TEXT,
      termin DATETIME NULL,
      fachabteilung VARCHAR(255),
      berechtigte TEXT,
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
  
  // Run schema migrations only if needed (fast path using INFORMATION_SCHEMA)
  await runSchemaMigrations(db, poolKey);

  // Initialize correction log table (CREATE IF NOT EXISTS is fast)
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
  
  tableInitializedPerPool.set(poolKey, true);
  console.log(`[DB] ✓ Offline dictations table ready (${poolKey})`);
}

// Create a new offline dictation with Request context
export async function createOfflineDictationWithRequest(
  request: NextRequest,
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
  const db = await getPoolForRequest(request);
  const [result] = await db.execute(
    `INSERT INTO offline_dictations 
      (username, audio_data, audio_mime_type, audio_duration_seconds, order_number, patient_name, patient_dob, priority, mode, bemerkung, termin, fachabteilung, berechtigte, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [
      data.username,
      data.audioData,
      data.audioMimeType,
      data.audioDuration,
      data.orderNumber,
      data.patientName || null,
      data.patientDob || null,
      data.priority,
      data.mode,
      data.bemerkung || null,
      data.termin || null,
      data.fachabteilung || null,
      data.berechtigte ? JSON.stringify(data.berechtigte) : null
    ]
  );
  return (result as any).insertId;
}

// Get dictations for a user with Request context
export async function getUserDictationsWithRequest(
  request: NextRequest,
  username: string,
  includeArchived: boolean = false
): Promise<Omit<OfflineDictation, 'audio_data'>[]> {
  const db = await getPoolForRequest(request);
  const archivedCondition = includeArchived ? '' : 'AND (archived IS NULL OR archived = FALSE)';
  const [rows] = await db.execute(
    `SELECT id, username, audio_mime_type, audio_duration_seconds, order_number, patient_name, patient_dob,
            priority, status, mode, bemerkung, termin, fachabteilung, berechtigte,
            raw_transcript, segments, transcript, methodik, befund, beurteilung, corrected_text, 
            change_score, error_message, archived, archived_at, archived_by,
            created_at, processing_started_at, completed_at
     FROM offline_dictations 
     WHERE username = ? ${archivedCondition}
     ORDER BY 
       CASE priority 
         WHEN 'stat' THEN 1 
         WHEN 'urgent' THEN 2 
         ELSE 3 
       END,
       created_at DESC`,
    [username]
  );
  return rows as Omit<OfflineDictation, 'audio_data'>[];
}

// Get all dictations with Request context
export async function getAllDictationsWithRequest(
  request: NextRequest,
  statusFilter?: DictationStatus,
  userFilter?: string,
  includeArchived: boolean = false
): Promise<Omit<OfflineDictation, 'audio_data'>[]> {
  const db = await getPoolForRequest(request);
  const conditions: string[] = [];
  const params: string[] = [];
  
  if (!includeArchived) {
    conditions.push('(archived IS NULL OR archived = FALSE)');
  }
  
  if (statusFilter) {
    conditions.push('status = ?');
    params.push(statusFilter);
  }
  if (userFilter) {
    conditions.push('username = ?');
    params.push(userFilter);
  }
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  
  const [rows] = await db.execute(
    `SELECT id, username, audio_mime_type, audio_duration_seconds, order_number, patient_name, patient_dob,
            priority, status, mode, bemerkung, termin, fachabteilung, berechtigte,
            raw_transcript, segments, transcript, methodik, befund, beurteilung, corrected_text, 
            change_score, error_message, archived, archived_at, archived_by,
            created_at, processing_started_at, completed_at
     FROM offline_dictations 
     ${whereClause}
     ORDER BY 
       CASE priority 
         WHEN 'stat' THEN 1 
         WHEN 'urgent' THEN 2 
         ELSE 3 
       END,
       created_at DESC`,
    params
  );
  return rows as Omit<OfflineDictation, 'audio_data'>[];
}

// Get list of unique usernames with Request context
export async function getDictationUsersWithRequest(request: NextRequest): Promise<string[]> {
  const db = await getPoolForRequest(request);
  const [rows] = await db.execute<any[]>(
    `SELECT DISTINCT username FROM offline_dictations ORDER BY username`
  );
  return rows.map((r: any) => r.username);
}

// Get pending dictations with Request context
export async function getPendingDictationsWithRequest(
  request: NextRequest,
  limit: number = 10
): Promise<OfflineDictation[]> {
  const db = await getPoolForRequest(request);
  const safeLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const [rows] = await db.execute(
    `SELECT * FROM offline_dictations 
     WHERE status = 'pending'
     ORDER BY 
       CASE priority 
         WHEN 'stat' THEN 1 
         WHEN 'urgent' THEN 2 
         ELSE 3 
       END,
       created_at ASC
     LIMIT ${safeLimit}`
  );
  return rows as OfflineDictation[];
}

// Get a single dictation by ID with Request context
export async function getDictationByIdWithRequest(
  request: NextRequest,
  id: number,
  includeAudio: boolean = false
): Promise<OfflineDictation | null> {
  const db = await getPoolForRequest(request);
  const fields = includeAudio 
    ? '*' 
    : `id, username, audio_mime_type, audio_duration_seconds, order_number, patient_name, patient_dob,
       priority, status, mode, raw_transcript, segments, transcript, methodik, befund, beurteilung, corrected_text, change_score, error_message,
       created_at, processing_started_at, completed_at`;
  
  const [rows] = await db.execute<any[]>(
    `SELECT ${fields} FROM offline_dictations WHERE id = ?`,
    [id]
  );
  return rows[0] || null;
}

// Mark dictation as processing with Request context
export async function markDictationProcessingWithRequest(
  request: NextRequest,
  id: number
): Promise<void> {
  const db = await getPoolForRequest(request);
  await db.execute(
    `UPDATE offline_dictations 
     SET status = 'processing', processing_started_at = NOW()
     WHERE id = ?`,
    [id]
  );
}

// Complete dictation with Request context
export async function completeDictationWithRequest(
  request: NextRequest,
  id: number,
  results: {
    rawTranscript?: string;
    segments?: any[]; // Word-level timestamps for highlighting
    transcript?: string;
    methodik?: string;
    befund?: string;
    beurteilung?: string;
    correctedText?: string;
    changeScore?: number;
  }
): Promise<void> {
  const db = await getPoolForRequest(request);
  // Serialize segments to JSON string for storage
  const segmentsJson = results.segments ? JSON.stringify(results.segments) : null;
  
  // DEBUG: Log what we're saving
  console.log(`[DB] completeDictationWithRequest: id=${id}, segments=${results.segments?.length || 0} items, segmentsJson length=${segmentsJson?.length || 0} chars`);
  
  await db.execute(
    `UPDATE offline_dictations 
     SET status = 'completed',
         raw_transcript = ?,
         segments = ?,
         transcript = ?,
         methodik = ?,
         befund = ?,
         beurteilung = ?,
         corrected_text = ?,
         change_score = ?,
         completed_at = NOW()
     WHERE id = ?`,
    [
      results.rawTranscript || null,
      segmentsJson,
      results.transcript || null,
      results.methodik || null,
      results.befund || null,
      results.beurteilung || null,
      results.correctedText || null,
      results.changeScore ?? null,
      id
    ]
  );
}

// Mark dictation as error with Request context
export async function markDictationErrorWithRequest(
  request: NextRequest,
  id: number,
  errorMessage: string
): Promise<void> {
  const db = await getPoolForRequest(request);
  await db.execute(
    `UPDATE offline_dictations 
     SET status = 'error', error_message = ?, completed_at = NOW()
     WHERE id = ?`,
    [errorMessage, id]
  );
}

// Delete audio data with Request context
export async function deleteAudioDataWithRequest(
  request: NextRequest,
  id: number
): Promise<void> {
  const db = await getPoolForRequest(request);
  await db.execute(
    `UPDATE offline_dictations SET audio_data = NULL WHERE id = ?`,
    [id]
  );
}

// Update corrected text with Request context
export async function updateCorrectedTextWithRequest(
  request: NextRequest,
  id: number,
  correctedText: string,
  changeScore?: number
): Promise<void> {
  const db = await getPoolForRequest(request);
  await db.execute(
    `UPDATE offline_dictations 
     SET corrected_text = ?, change_score = ?
     WHERE id = ?`,
    [correctedText, changeScore ?? null, id]
  );
}

// Delete dictation with Request context
export async function deleteDictationWithRequest(
  request: NextRequest,
  id: number
): Promise<void> {
  const db = await getPoolForRequest(request);
  await db.execute(`DELETE FROM offline_dictations WHERE id = ?`, [id]);
}

// Get queue stats with Request context
export async function getQueueStatsWithRequest(
  request: NextRequest
): Promise<{
  pending: number;
  processing: number;
  completed: number;
  error: number;
}> {
  const db = await getPoolForRequest(request);
  const [rows] = await db.execute<any[]>(
    `SELECT status, COUNT(*) as count FROM offline_dictations GROUP BY status`
  );
  
  const stats = { pending: 0, processing: 0, completed: 0, error: 0 };
  for (const row of rows) {
    stats[row.status as DictationStatus] = row.count;
  }
  return stats;
}

// Retry dictation with Request context
export async function retryDictationWithRequest(
  request: NextRequest,
  id: number
): Promise<void> {
  const db = await getPoolForRequest(request);
  await db.execute(
    `UPDATE offline_dictations 
     SET status = 'pending', 
         error_message = NULL, 
         processing_started_at = NULL, 
         completed_at = NULL
     WHERE id = ? AND status = 'error'`,
    [id]
  );
}

// Update audio data with Request context
export async function updateAudioDataWithRequest(
  request: NextRequest,
  id: number,
  audioData: Buffer,
  mimeType: string
): Promise<void> {
  const db = await getPoolForRequest(request);
  await db.execute(
    `UPDATE offline_dictations 
     SET audio_data = ?, audio_mime_type = ?
     WHERE id = ?`,
    [audioData, mimeType, id]
  );
}

// Archive a dictation with Request context
export async function archiveDictationWithRequest(
  request: NextRequest,
  id: number,
  archivedBy: string
): Promise<void> {
  const db = await getPoolForRequest(request);
  await db.execute(
    `UPDATE offline_dictations 
     SET archived = TRUE, archived_at = NOW(), archived_by = ?
     WHERE id = ?`,
    [archivedBy, id]
  );
}

// Unarchive a dictation with Request context
export async function unarchiveDictationWithRequest(
  request: NextRequest,
  id: number
): Promise<void> {
  const db = await getPoolForRequest(request);
  await db.execute(
    `UPDATE offline_dictations 
     SET archived = FALSE, archived_at = NULL, archived_by = NULL
     WHERE id = ?`,
    [id]
  );
}

// Get archived dictations with Request context
export async function getArchivedDictationsWithRequest(
  request: NextRequest,
  filters?: {
    username?: string;
    archivedBy?: string;
    patientName?: string;
    fromDate?: string;
    toDate?: string;
  }
): Promise<Omit<OfflineDictation, 'audio_data'>[]> {
  const db = await getPoolForRequest(request);
  const conditions: string[] = ['archived = TRUE'];
  const params: any[] = [];
  
  if (filters?.username) {
    conditions.push('username = ?');
    params.push(filters.username);
  }
  if (filters?.archivedBy) {
    conditions.push('archived_by = ?');
    params.push(filters.archivedBy);
  }
  if (filters?.patientName) {
    conditions.push('patient_name LIKE ?');
    params.push(`%${filters.patientName}%`);
  }
  if (filters?.fromDate) {
    conditions.push('created_at >= ?');
    params.push(filters.fromDate);
  }
  if (filters?.toDate) {
    conditions.push('created_at <= ?');
    params.push(filters.toDate);
  }
  
  const whereClause = conditions.join(' AND ');
  
  const [rows] = await db.execute(
    `SELECT id, username, audio_mime_type, audio_duration_seconds, order_number, patient_name, patient_dob,
            priority, status, mode, bemerkung, termin, fachabteilung, berechtigte,
            raw_transcript, segments, transcript, methodik, befund, beurteilung, corrected_text, 
            change_score, error_message, archived, archived_at, archived_by,
            created_at, processing_started_at, completed_at
     FROM offline_dictations 
     WHERE ${whereClause}
     ORDER BY archived_at DESC`,
    params
  );
  return rows as Omit<OfflineDictation, 'audio_data'>[];
}
