import { NextRequest } from 'next/server';
import { query, execute, getPoolForRequest } from './db';

/**
 * WhisperX Recovery Log - Protokolliert alle Heilungsversuche
 */

export type RecoveryAction = 
  | 'system_cleanup'      // torch.cuda.empty_cache()
  | 'system_kill_zombies' // Kill zombie python processes
  | 'system_reboot'       // Full restart
  | 'health_check'        // Audio chunk test
  | 'error_detected'      // Initial error detection
  | 'recovery_success'    // Recovery succeeded
  | 'recovery_failed';    // Recovery ultimately failed

export type LogLevel = 'info' | 'warn' | 'error' | 'success';

export interface WhisperRecoveryLog {
  id: number;
  timestamp: Date;
  log_level: LogLevel;
  action: RecoveryAction;
  message: string;
  details?: string;
  error_context?: string;
  duration_ms?: number;
  success: boolean;
}

// Initialize recovery log table
export async function initWhisperRecoveryLogTable(): Promise<void> {
  await execute(`
    CREATE TABLE IF NOT EXISTS whisper_recovery_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      log_level ENUM('info', 'warn', 'error', 'success') NOT NULL DEFAULT 'info',
      action VARCHAR(50) NOT NULL,
      message TEXT NOT NULL,
      details TEXT,
      error_context TEXT,
      duration_ms INT DEFAULT NULL,
      success BOOLEAN DEFAULT FALSE,
      INDEX idx_timestamp (timestamp),
      INDEX idx_action (action),
      INDEX idx_log_level (log_level)
    )
  `);
  console.log('[DB] ✓ WhisperX recovery log table ready');
}

// Log a recovery event
export async function logRecoveryEvent(
  logLevel: LogLevel,
  action: RecoveryAction,
  message: string,
  options?: {
    details?: string;
    errorContext?: string;
    durationMs?: number;
    success?: boolean;
  }
): Promise<number> {
  const result = await execute(
    `INSERT INTO whisper_recovery_log 
      (log_level, action, message, details, error_context, duration_ms, success)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      logLevel,
      action,
      message,
      options?.details || null,
      options?.errorContext || null,
      options?.durationMs || null,
      options?.success ?? false
    ]
  );
  
  // Also log to console with timestamp
  const prefix = {
    'info': '[WhisperX Recovery] ℹ️',
    'warn': '[WhisperX Recovery] ⚠️',
    'error': '[WhisperX Recovery] ❌',
    'success': '[WhisperX Recovery] ✅'
  }[logLevel];
  
  console.log(`${prefix} ${action}: ${message}${options?.details ? ` | ${options.details}` : ''}`);
  
  return result.insertId;
}

// Get recent recovery logs
export async function getRecoveryLogs(
  limit: number = 100,
  filter?: {
    logLevel?: LogLevel;
    action?: RecoveryAction;
    fromDate?: Date;
    toDate?: Date;
  }
): Promise<WhisperRecoveryLog[]> {
  const conditions: string[] = [];
  const params: any[] = [];
  
  if (filter?.logLevel) {
    conditions.push('log_level = ?');
    params.push(filter.logLevel);
  }
  
  if (filter?.action) {
    conditions.push('action = ?');
    params.push(filter.action);
  }
  
  if (filter?.fromDate) {
    conditions.push('timestamp >= ?');
    params.push(filter.fromDate);
  }
  
  if (filter?.toDate) {
    conditions.push('timestamp <= ?');
    params.push(filter.toDate);
  }
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  
  // Limit muss als Zahl eingebettet werden
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
  
  return query<WhisperRecoveryLog>(
    `SELECT * FROM whisper_recovery_log 
     ${whereClause}
     ORDER BY timestamp DESC
     LIMIT ${safeLimit}`,
    params
  );
}

// Clear old logs (older than X days)
export async function clearOldLogs(daysToKeep: number = 30): Promise<number> {
  const result = await execute(
    `DELETE FROM whisper_recovery_log 
     WHERE timestamp < DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [daysToKeep]
  );
  return result.affectedRows || 0;
}

// Get recovery statistics
export async function getRecoveryStats(days: number = 7): Promise<{
  totalErrors: number;
  successfulRecoveries: number;
  failedRecoveries: number;
  actionBreakdown: { action: string; count: number }[];
}> {
  const [errorCount] = await query<{ count: number }>(
    `SELECT COUNT(*) as count FROM whisper_recovery_log 
     WHERE action = 'error_detected' 
     AND timestamp > DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [days]
  );
  
  const [successCount] = await query<{ count: number }>(
    `SELECT COUNT(*) as count FROM whisper_recovery_log 
     WHERE action = 'recovery_success' 
     AND timestamp > DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [days]
  );
  
  const [failedCount] = await query<{ count: number }>(
    `SELECT COUNT(*) as count FROM whisper_recovery_log 
     WHERE action = 'recovery_failed' 
     AND timestamp > DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [days]
  );
  
  const breakdown = await query<{ action: string; count: number }>(
    `SELECT action, COUNT(*) as count FROM whisper_recovery_log 
     WHERE timestamp > DATE_SUB(NOW(), INTERVAL ? DAY)
     GROUP BY action
     ORDER BY count DESC`,
    [days]
  );
  
  return {
    totalErrors: errorCount?.count || 0,
    successfulRecoveries: successCount?.count || 0,
    failedRecoveries: failedCount?.count || 0,
    actionBreakdown: breakdown
  };
}

// ============================================================
// Request-basierte Funktionen (für dynamische DB über Token)
// ============================================================

let tableInitialized = false;

export async function initWhisperRecoveryLogTableWithRequest(request: NextRequest): Promise<void> {
  if (tableInitialized) return;
  
  const db = await getPoolForRequest(request);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS whisper_recovery_log (
      id INT AUTO_INCREMENT PRIMARY KEY,
      timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      log_level ENUM('info', 'warn', 'error', 'success') NOT NULL DEFAULT 'info',
      action VARCHAR(50) NOT NULL,
      message TEXT NOT NULL,
      details TEXT,
      error_context TEXT,
      duration_ms INT DEFAULT NULL,
      success BOOLEAN DEFAULT FALSE,
      INDEX idx_timestamp (timestamp),
      INDEX idx_action (action),
      INDEX idx_log_level (log_level)
    )
  `);
  
  tableInitialized = true;
  console.log('[DB] ✓ WhisperX recovery log table ready');
}

export async function logRecoveryEventWithRequest(
  request: NextRequest,
  logLevel: LogLevel,
  action: RecoveryAction,
  message: string,
  options?: {
    details?: string;
    errorContext?: string;
    durationMs?: number;
    success?: boolean;
  }
): Promise<number> {
  await initWhisperRecoveryLogTableWithRequest(request);
  
  const db = await getPoolForRequest(request);
  const [result] = await db.execute(
    `INSERT INTO whisper_recovery_log 
      (log_level, action, message, details, error_context, duration_ms, success)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      logLevel,
      action,
      message,
      options?.details || null,
      options?.errorContext || null,
      options?.durationMs || null,
      options?.success ?? false
    ]
  );
  
  // Also log to console with timestamp
  const prefix = {
    'info': '[WhisperX Recovery] ℹ️',
    'warn': '[WhisperX Recovery] ⚠️',
    'error': '[WhisperX Recovery] ❌',
    'success': '[WhisperX Recovery] ✅'
  }[logLevel];
  
  console.log(`${prefix} ${action}: ${message}${options?.details ? ` | ${options.details}` : ''}`);
  
  return (result as any).insertId;
}

export async function getRecoveryLogsWithRequest(
  request: NextRequest,
  limit: number = 100,
  filter?: {
    logLevel?: LogLevel;
    action?: RecoveryAction;
    fromDate?: Date;
    toDate?: Date;
  }
): Promise<WhisperRecoveryLog[]> {
  await initWhisperRecoveryLogTableWithRequest(request);
  
  const db = await getPoolForRequest(request);
  const conditions: string[] = [];
  const params: any[] = [];
  
  if (filter?.logLevel) {
    conditions.push('log_level = ?');
    params.push(filter.logLevel);
  }
  
  if (filter?.action) {
    conditions.push('action = ?');
    params.push(filter.action);
  }
  
  if (filter?.fromDate) {
    conditions.push('timestamp >= ?');
    params.push(filter.fromDate);
  }
  
  if (filter?.toDate) {
    conditions.push('timestamp <= ?');
    params.push(filter.toDate);
  }
  
  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
  
  const [rows] = await db.execute(
    `SELECT * FROM whisper_recovery_log 
     ${whereClause}
     ORDER BY timestamp DESC
     LIMIT ${safeLimit}`,
    params
  );
  
  return rows as WhisperRecoveryLog[];
}

export async function getRecoveryStatsWithRequest(
  request: NextRequest,
  days: number = 7
): Promise<{
  totalErrors: number;
  successfulRecoveries: number;
  failedRecoveries: number;
  actionBreakdown: { action: string; count: number }[];
}> {
  await initWhisperRecoveryLogTableWithRequest(request);
  
  const db = await getPoolForRequest(request);
  
  const [[errorCount]] = await db.execute(
    `SELECT COUNT(*) as count FROM whisper_recovery_log 
     WHERE action = 'error_detected' 
     AND timestamp > DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [days]
  ) as any;
  
  const [[successCount]] = await db.execute(
    `SELECT COUNT(*) as count FROM whisper_recovery_log 
     WHERE action = 'recovery_success' 
     AND timestamp > DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [days]
  ) as any;
  
  const [[failedCount]] = await db.execute(
    `SELECT COUNT(*) as count FROM whisper_recovery_log 
     WHERE action = 'recovery_failed' 
     AND timestamp > DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [days]
  ) as any;
  
  const [breakdown] = await db.execute(
    `SELECT action, COUNT(*) as count FROM whisper_recovery_log 
     WHERE timestamp > DATE_SUB(NOW(), INTERVAL ? DAY)
     GROUP BY action
     ORDER BY count DESC`,
    [days]
  ) as any;
  
  return {
    totalErrors: errorCount?.count || 0,
    successfulRecoveries: successCount?.count || 0,
    failedRecoveries: failedCount?.count || 0,
    actionBreakdown: breakdown || []
  };
}

export async function clearOldLogsWithRequest(
  request: NextRequest,
  daysToKeep: number = 30
): Promise<number> {
  await initWhisperRecoveryLogTableWithRequest(request);
  
  const db = await getPoolForRequest(request);
  const [result] = await db.execute(
    `DELETE FROM whisper_recovery_log 
     WHERE timestamp < DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [daysToKeep]
  ) as any;
  
  return result.affectedRows || 0;
}
