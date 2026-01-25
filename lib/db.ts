import mysql from 'mysql2/promise';
import { NextRequest } from 'next/server';
import { parseDbToken, isLegacyToken, encryptToken } from './crypto';

// Database connection pool (default)
let pool: mysql.Pool | null = null;

// Cache für dynamische Pools (basierend auf DB-Token)
const dynamicPools = new Map<string, mysql.Pool>();

// Globales Cache für Tabellen-Existenz-Checks (verhindert wiederholte CREATE TABLE Queries)
// Key: "poolKey:tableName", Value: true wenn Tabelle geprüft wurde
export const tableExistsCache = new Set<string>();

// Letzte erfolgreiche Verbindungszeit (für Health-Check)
let lastSuccessfulQuery = Date.now();
const CONNECTION_HEALTH_THRESHOLD = 30000; // 30 Sekunden

// Pool-Stats Logging (alle 60 Sekunden max)
let lastPoolStatsLog = 0;
const POOL_STATS_INTERVAL = 60000;

// Aktive Queries Tracking (für Diagnose)
let activeQueries = 0;
let maxConcurrentQueries = 0;
const QUERY_TIMEOUT = 30000; // 30 Sekunden Query-Timeout

// ============================================================
// DB-Token Credentials Interface
// ============================================================
export interface DbCredentials {
  host: string;
  user: string;
  password: string;
  database: string;
  port: number;
  ssl?: boolean;
}

// ============================================================
// DB-Token Decoding (Server-seitig - unterstützt verschlüsselt und Legacy)
// ============================================================
export function decodeDbTokenServer(token: string): DbCredentials | null {
  try {
    // parseDbToken unterstützt sowohl verschlüsselte als auch Legacy-Tokens
    const parsed = parseDbToken(token);
    
    if (!parsed || !parsed.host || !parsed.user || !parsed.password || !parsed.database) {
      console.error('[DB] Token ungültig: Fehlende Felder');
      return null;
    }
    
    return {
      host: parsed.host,
      user: parsed.user,
      password: parsed.password,
      database: parsed.database,
      port: parsed.port || 3306,
      ssl: parsed.ssl !== false
    };
  } catch (e) {
    console.error('[DB] Token Dekodierung fehlgeschlagen:', e);
    return null;
  }
}

// Re-export für Verwendung in anderen Modulen
export { encryptToken, isLegacyToken } from './crypto';

// ============================================================
// Dynamischen Pool für Credentials erstellen/abrufen
// ============================================================
export function getDynamicPool(credentials: DbCredentials): mysql.Pool {
  const poolKey = `${credentials.host}:${credentials.port}:${credentials.database}:${credentials.user}`;
  
  if (dynamicPools.has(poolKey)) {
    return dynamicPools.get(poolKey)!;
  }
  
  console.log(`[DB] Erstelle neuen dynamischen Pool: ${credentials.host}:${credentials.port}/${credentials.database}`);
  
  const newPool = mysql.createPool({
    host: credentials.host,
    port: credentials.port,
    user: credentials.user,
    password: credentials.password,
    database: credentials.database,
    waitForConnections: true,
    connectionLimit: 5,       // Reduziert von 10 auf 5 für Railway
    queueLimit: 0,
    connectTimeout: 15000,    // 15s Verbindungs-Timeout (erhöht)
    enableKeepAlive: true,    // Keep-Alive für Railway
    keepAliveInitialDelay: 5000, // Keep-Alive alle 5s (reduziert von 10s)
    idleTimeout: 300000,      // Idle-Verbindungen nach 5 Minuten schließen (erhöht von 60s)
    ...(credentials.ssl ? { ssl: { rejectUnauthorized: false } } : {})
  });
  
  // Event-Handler für Pool-Diagnose
  newPool.on('connection', (connection) => {
    console.log(`[DB Pool] New connection created (dynamic)`);
  });
  
  newPool.on('acquire', (connection) => {
    // Log wenn Verbindung aus Pool geholt wird (nur bei Problemen aktivieren)
  });
  
  newPool.on('enqueue', () => {
    console.warn(`[DB Pool] ⚠️ Connection request queued - pool exhausted!`);
  });
  
  newPool.on('release', (connection) => {
    // Stille Release
  });
  
  dynamicPools.set(poolKey, newPool);
  return newPool;
}

// ============================================================
// Pool basierend auf Request Header abrufen
// ============================================================
// Track ob wir den Pool schon einmal für diese Credentials verwendet haben (verhindert Spam-Logs)
const loggedPools = new Set<string>();

export async function getPoolForRequest(request?: NextRequest): Promise<mysql.Pool> {
  const start = Date.now();
  
  // Prüfe auf X-DB-Token Header
  if (request) {
    const dbToken = request.headers.get('x-db-token');
    if (dbToken) {
      const credentials = decodeDbTokenServer(dbToken);
      if (credentials) {
        const poolKey = `${credentials.host}:${credentials.port}:${credentials.database}`;
        // Nur beim ersten Mal loggen
        if (!loggedPools.has(poolKey)) {
          console.log(`[DB] ✓ Verwende dynamische DB: ${credentials.host}/${credentials.database}`);
          loggedPools.add(poolKey);
        }
        const pool = getDynamicPool(credentials);
        const elapsed = Date.now() - start;
        if (elapsed > 50) {
          console.log(`[DB] getPoolForRequest took ${elapsed}ms (dynamic)`);
        }
        return pool;
      } else {
        console.warn('[DB] ❌ Ungültiger DB-Token, verwende Default-Pool');
      }
    }
  }
  
  // Fallback auf Default-Pool
  const pool = await getPool();
  const elapsed = Date.now() - start;
  if (elapsed > 50) {
    console.log(`[DB] getPoolForRequest took ${elapsed}ms (default)`);
  }
  return pool;
}

// ============================================================
// Default Connection String und Pool
// ============================================================
function getConnectionString(): string {
  // Railway internal URL or external URL
  return process.env.DATABASE_URL || process.env.MYSQL_URL || '';
}

export async function getPool(): Promise<mysql.Pool> {
  if (pool) return pool;
  
  const connectionString = getConnectionString();
  
  if (!connectionString) {
    throw new Error('DATABASE_URL or MYSQL_URL not configured');
  }
  
  console.log('[DB] Connecting to MySQL (default pool)...');
  
  pool = mysql.createPool({
    uri: connectionString,
    waitForConnections: true,
    connectionLimit: 5,          // Reduziert von 10 auf 5
    queueLimit: 0,
    connectTimeout: 15000,       // 15s Verbindungs-Timeout (erhöht)
    enableKeepAlive: true,       // Keep-Alive für Railway
    keepAliveInitialDelay: 5000, // Keep-Alive alle 5s (reduziert)
    idleTimeout: 300000,         // Idle-Verbindungen nach 5 Minuten schließen (erhöht)
  });
  
  // Event-Handler für Pool-Diagnose
  pool.on('connection', (connection) => {
    console.log(`[DB Pool] New default connection created`);
  });
  
  pool.on('enqueue', () => {
    console.warn(`[DB Pool] ⚠️ Default pool: Connection request queued - pool exhausted!`);
  });
  
  // Test connection
  try {
    const connection = await pool.getConnection();
    console.log('[DB] ✓ Connected to MySQL (default)');
    connection.release();
  } catch (error) {
    console.error('[DB] ✗ Failed to connect:', error);
    throw error;
  }
  
  return pool;
}

export async function initDatabase(): Promise<void> {
  const db = await getPool();
  
  console.log('[DB] Initializing tables...');
  
  // Users table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      is_admin BOOLEAN DEFAULT FALSE,
      can_view_all_dictations BOOLEAN DEFAULT FALSE,
      auto_correct BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by VARCHAR(255)
    )
  `);
  
  // Fast migration: Check columns via INFORMATION_SCHEMA instead of try/catch ALTER
  const [existingCols] = await db.execute(`
    SELECT COLUMN_NAME 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
    AND TABLE_NAME = 'users'
  `) as any;
  
  const existingColumns = new Set((existingCols || []).map((row: any) => row.COLUMN_NAME.toLowerCase()));
  
  const userMigrations = [
    { column: 'can_view_all_dictations', sql: 'ADD COLUMN can_view_all_dictations BOOLEAN DEFAULT FALSE' },
    { column: 'auto_correct', sql: 'ADD COLUMN auto_correct BOOLEAN DEFAULT TRUE' },
  ];
  
  for (const migration of userMigrations) {
    if (!existingColumns.has(migration.column.toLowerCase())) {
      try {
        await db.execute(`ALTER TABLE users ${migration.sql}`);
        console.log(`[DB] ✓ Added ${migration.column} column`);
      } catch (e: any) {
        // Ignore - might exist
      }
    }
  }
  console.log('[DB] ✓ Users table ready');
  
  // Dictionary entries table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS dictionary_entries (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) NOT NULL,
      wrong_word VARCHAR(500) NOT NULL,
      correct_word VARCHAR(500) NOT NULL,
      added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_entry (username, wrong_word(191))
    )
  `);
  console.log('[DB] ✓ Dictionary table ready');
  
  // Config table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS config (
      config_key VARCHAR(255) PRIMARY KEY,
      config_value TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  console.log('[DB] ✓ Config table ready');
  
  console.log('[DB] ✓ Database initialized');
}

// Initialisiere Datenbank mit Request-Context (für dynamische DB)
export async function initDatabaseWithRequest(request: NextRequest): Promise<void> {
  const db = await getPoolForRequest(request);
  
  console.log('[DB] Initializing tables (dynamic)...');
  
  // Users table - include all columns in CREATE statement
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      is_admin BOOLEAN DEFAULT FALSE,
      can_view_all_dictations BOOLEAN DEFAULT FALSE,
      auto_correct BOOLEAN DEFAULT TRUE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by VARCHAR(255)
    )
  `);
  
  // Fast migration: Check columns via INFORMATION_SCHEMA instead of try/catch ALTER
  const [existingCols] = await db.execute(`
    SELECT COLUMN_NAME 
    FROM INFORMATION_SCHEMA.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
    AND TABLE_NAME = 'users'
  `) as any;
  
  const existingColumns = new Set((existingCols || []).map((row: any) => row.COLUMN_NAME.toLowerCase()));
  
  const userMigrations = [
    { column: 'can_view_all_dictations', sql: 'ADD COLUMN can_view_all_dictations BOOLEAN DEFAULT FALSE' },
    { column: 'auto_correct', sql: 'ADD COLUMN auto_correct BOOLEAN DEFAULT TRUE' },
  ];
  
  for (const migration of userMigrations) {
    if (!existingColumns.has(migration.column.toLowerCase())) {
      try {
        await db.execute(`ALTER TABLE users ${migration.sql}`);
        console.log(`[DB] ✓ Added ${migration.column} column (dynamic)`);
      } catch (e: any) {
        // Ignore - might exist
      }
    }
  }
  
  // Dictionary entries table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS dictionary_entries (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) NOT NULL,
      wrong_word VARCHAR(500) NOT NULL,
      correct_word VARCHAR(500) NOT NULL,
      added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY unique_entry (username, wrong_word(191))
    )
  `);
  
  // Config table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS config (
      config_key VARCHAR(255) PRIMARY KEY,
      config_value TEXT NOT NULL,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  
  console.log('[DB] ✓ Database initialized (dynamic)');
}

// ============================================================
// Helper für Queries (mit optionalem Request für dynamische DB)
// ============================================================

// Log Pool-Stats (max alle 60s)
async function logPoolStats(db: mysql.Pool, prefix: string = ''): Promise<void> {
  const now = Date.now();
  if (now - lastPoolStatsLog < POOL_STATS_INTERVAL) return;
  lastPoolStatsLog = now;
  
  try {
    // mysql2/promise Pool hat keine direkte Stats-API, aber wir können es über eine Query prüfen
    const [rows] = await db.query('SELECT 1 as ping');
    console.log(`[DB Pool${prefix}] Health check OK`);
  } catch (e) {
    console.warn(`[DB Pool${prefix}] Health check failed:`, e);
  }
}

// Wrapper für Query mit Retry-Logik und Timeout
async function executeWithRetry<T>(
  db: mysql.Pool,
  operation: () => Promise<T>,
  maxRetries: number = 2,
  operationName: string = 'query'
): Promise<T> {
  let lastError: Error | null = null;
  const totalStart = Date.now();
  
  // Track aktive Queries
  activeQueries++;
  if (activeQueries > maxConcurrentQueries) {
    maxConcurrentQueries = activeQueries;
  }
  if (activeQueries > 3) {
    console.warn(`[DB] ⚠️ ${activeQueries} concurrent queries (max seen: ${maxConcurrentQueries})`);
  }
  
  try {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const attemptStart = Date.now();
      try {
        // Wrap operation mit Timeout
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error(`Query timeout after ${QUERY_TIMEOUT}ms`)), QUERY_TIMEOUT);
        });
        
        const result = await Promise.race([operation(), timeoutPromise]);
        const attemptTime = Date.now() - attemptStart;
        
        // Log alle Queries mit Timing (auch schnelle, für Diagnose)
        if (attemptTime > 100) {
          console.log(`[DB Time] ${operationName}: ${attemptTime}ms${attempt > 0 ? ` (retry ${attempt})` : ''} [active: ${activeQueries}]`);
        }
        
        // Warnung für sehr langsame Queries
        if (attemptTime > 2000) {
          console.warn(`[DB] ⚠️ VERY SLOW ${operationName}: ${attemptTime}ms`);
        }
        
        lastSuccessfulQuery = Date.now();
        return result;
      } catch (error: any) {
        lastError = error;
        const attemptTime = Date.now() - attemptStart;
        console.error(`[DB] ✗ ${operationName} failed after ${attemptTime}ms: ${error.code || error.message}`);
        
        // Prüfe auf Verbindungsfehler die einen Retry rechtfertigen
        const isConnectionError = 
          error.code === 'ECONNRESET' ||
          error.code === 'ETIMEDOUT' ||
          error.code === 'ECONNREFUSED' ||
          error.code === 'PROTOCOL_CONNECTION_LOST' ||
          error.message?.includes('Connection lost') ||
          error.message?.includes('Cannot enqueue') ||
          error.message?.includes('Pool is closed') ||
          error.message?.includes('Query timeout');
        
        if (isConnectionError && attempt < maxRetries) {
          console.warn(`[DB] Retrying ${operationName} (attempt ${attempt + 2}/${maxRetries + 1})...`);
          // Kurze Pause vor Retry
          await new Promise(resolve => setTimeout(resolve, 500 * (attempt + 1)));
          continue;
        }
        
        throw error;
      }
    }
    
    throw lastError;
  } finally {
    activeQueries--;
  }
}

// Standard-Query (nutzt Default-Pool)
export async function query<T = any>(sql: string, params?: any[]): Promise<T[]> {
  const db = await getPool();
  // Extrahiere Query-Typ für Logging (SELECT, INSERT, etc.)
  const queryType = sql.trim().split(/\s+/)[0].toUpperCase();
  return executeWithRetry(db, async () => {
    const [rows] = await db.execute(sql, params);
    return rows as T[];
  }, 2, queryType);
}

// Standard-Execute (nutzt Default-Pool)
export async function execute(sql: string, params?: any[]): Promise<mysql.ResultSetHeader> {
  const db = await getPool();
  const queryType = sql.trim().split(/\s+/)[0].toUpperCase();
  return executeWithRetry(db, async () => {
    const [result] = await db.execute(sql, params);
    return result as mysql.ResultSetHeader;
  }, 2, queryType);
}

// Query mit Request-Context (nutzt dynamischen Pool wenn Token vorhanden)
export async function queryWithRequest<T = any>(request: NextRequest, sql: string, params?: any[]): Promise<T[]> {
  const db = await getPoolForRequest(request);
  const queryType = sql.trim().split(/\s+/)[0].toUpperCase();
  return executeWithRetry(db, async () => {
    const [rows] = await db.execute(sql, params);
    return rows as T[];
  }, 2, queryType);
}

// Execute mit Request-Context (nutzt dynamischen Pool wenn Token vorhanden)
export async function executeWithRequest(request: NextRequest, sql: string, params?: any[]): Promise<mysql.ResultSetHeader> {
  const db = await getPoolForRequest(request);
  const queryType = sql.trim().split(/\s+/)[0].toUpperCase();
  return executeWithRetry(db, async () => {
    const [result] = await db.execute(sql, params);
    return result as mysql.ResultSetHeader;
  }, 2, queryType);
}

// Pool-Reset Funktion für Notfälle (z.B. nach vielen Fehlern)
export async function resetPools(): Promise<void> {
  console.log('[DB] Resetting all connection pools...');
  
  // Default Pool zurücksetzen
  if (pool) {
    try {
      await pool.end();
    } catch (e) {
      console.warn('[DB] Error closing default pool:', e);
    }
    pool = null;
  }
  
  // Dynamische Pools zurücksetzen
  for (const [key, dynPool] of dynamicPools) {
    try {
      await dynPool.end();
    } catch (e) {
      console.warn(`[DB] Error closing pool ${key}:`, e);
    }
  }
  dynamicPools.clear();
  loggedPools.clear();
  
  console.log('[DB] ✓ All pools reset');
}