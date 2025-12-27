import { getPool, query, execute } from './db';

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
  // Results
  raw_transcript?: string; // Pure Transkription vor LLM-Korrektur
  transcript?: string;
  methodik?: string;
  befund?: string;
  beurteilung?: string;
  corrected_text?: string;
  change_score?: number; // Änderungsscore (0-100) für Ampelsystem
  error_message?: string;
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
      raw_transcript TEXT,
      transcript TEXT,
      methodik TEXT,
      befund TEXT,
      beurteilung TEXT,
      corrected_text TEXT,
      error_message TEXT,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      processing_started_at TIMESTAMP NULL,
      completed_at TIMESTAMP NULL,
      INDEX idx_username (username),
      INDEX idx_status (status),
      INDEX idx_priority (priority),
      INDEX idx_created_at (created_at)
    )
  `);
  
  // Migrate existing tables to add raw_transcript column if missing
  try {
    await db.execute(`ALTER TABLE offline_dictations ADD COLUMN raw_transcript TEXT AFTER mode`);
    console.log('[DB] ✓ Added raw_transcript column');
  } catch (e: any) {
    // Column already exists - ignore error
    if (!e.message?.includes('Duplicate column')) {
      console.log('[DB] raw_transcript column already exists');
    }
  }
  
  // Migrate existing tables to add change_score column if missing
  try {
    await db.execute(`ALTER TABLE offline_dictations ADD COLUMN change_score INT DEFAULT NULL AFTER corrected_text`);
    console.log('[DB] ✓ Added change_score column');
  } catch (e: any) {
    // Column already exists - ignore error
    if (!e.message?.includes('Duplicate column')) {
      console.log('[DB] change_score column already exists');
    }
  }
  
  console.log('[DB] ✓ Offline dictations table ready');
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
  }
): Promise<number> {
  const result = await execute(
    `INSERT INTO offline_dictations 
      (username, audio_data, audio_mime_type, audio_duration_seconds, order_number, patient_name, patient_dob, priority, mode, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [
      data.username,
      data.audioData,
      data.audioMimeType,
      data.audioDuration,
      data.orderNumber,
      data.patientName || null,
      data.patientDob || null,
      data.priority,
      data.mode
    ]
  );
  return result.insertId;
}

// Get dictations for a user (without audio data for list view)
export async function getUserDictations(username: string): Promise<Omit<OfflineDictation, 'audio_data'>[]> {
  return query(
    `SELECT id, username, audio_mime_type, audio_duration_seconds, order_number, patient_name, patient_dob,
            priority, status, mode, raw_transcript, transcript, methodik, befund, beurteilung, corrected_text, change_score, error_message,
            created_at, processing_started_at, completed_at
     FROM offline_dictations 
     WHERE username = ?
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
export async function getAllDictations(statusFilter?: DictationStatus, userFilter?: string): Promise<Omit<OfflineDictation, 'audio_data'>[]> {
  const conditions: string[] = [];
  const params: (string)[] = [];
  
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
            priority, status, mode, raw_transcript, transcript, methodik, befund, beurteilung, corrected_text, change_score, error_message,
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
       priority, status, mode, raw_transcript, transcript, methodik, befund, beurteilung, corrected_text, change_score, error_message,
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
