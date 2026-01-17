import mysql from 'mysql2/promise';
import { NextRequest } from 'next/server';

// Database connection pool (default)
let pool: mysql.Pool | null = null;

// Cache für dynamische Pools (basierend auf DB-Token)
const dynamicPools = new Map<string, mysql.Pool>();

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
// DB-Token Decoding (Server-seitig mit Buffer)
// ============================================================
export function decodeDbTokenServer(token: string): DbCredentials | null {
  try {
    const decoded = Buffer.from(token, 'base64').toString('utf8');
    const parsed = JSON.parse(decoded);
    
    if (!parsed.host || !parsed.user || !parsed.password || !parsed.database) {
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
    connectionLimit: 10,      // Erhöht von 5 auf 10
    queueLimit: 0,
    connectTimeout: 10000,    // 10s Verbindungs-Timeout
    enableKeepAlive: true,    // Keep-Alive für Railway
    keepAliveInitialDelay: 10000, // Keep-Alive nach 10s
    ...(credentials.ssl ? { ssl: { rejectUnauthorized: false } } : {})
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
        return getDynamicPool(credentials);
      } else {
        console.warn('[DB] ❌ Ungültiger DB-Token, verwende Default-Pool');
      }
    }
  }
  
  // Fallback auf Default-Pool
  return getPool();
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
    connectionLimit: 10,
    queueLimit: 0,
    connectTimeout: 10000,       // 10s Verbindungs-Timeout
    enableKeepAlive: true,       // Keep-Alive für Railway
    keepAliveInitialDelay: 10000, // Keep-Alive nach 10s
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
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by VARCHAR(255)
    )
  `);
  
  // Migration: Add can_view_all_dictations column if not exists
  try {
    await db.execute(`
      ALTER TABLE users ADD COLUMN can_view_all_dictations BOOLEAN DEFAULT FALSE
    `);
    console.log('[DB] ✓ Added can_view_all_dictations column');
  } catch (e: any) {
    // Column already exists - ignore
    if (!e.message?.includes('Duplicate column')) {
      console.log('[DB] can_view_all_dictations column already exists');
    }
  }
  
  // Migration: Add auto_correct column if not exists (default TRUE for automatic correction)
  try {
    await db.execute(`
      ALTER TABLE users ADD COLUMN auto_correct BOOLEAN DEFAULT TRUE
    `);
    console.log('[DB] ✓ Added auto_correct column');
  } catch (e: any) {
    // Column already exists - ignore
    if (!e.message?.includes('Duplicate column')) {
      console.log('[DB] auto_correct column already exists');
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
  
  // Users table
  await db.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      is_admin BOOLEAN DEFAULT FALSE,
      can_view_all_dictations BOOLEAN DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      created_by VARCHAR(255)
    )
  `);
  
  // Migration: Add can_view_all_dictations column if not exists
  try {
    await db.execute(`
      ALTER TABLE users ADD COLUMN can_view_all_dictations BOOLEAN DEFAULT FALSE
    `);
    console.log('[DB] ✓ Added can_view_all_dictations column');
  } catch (e: any) {
    if (!e.message?.includes('Duplicate column')) {
      console.log('[DB] can_view_all_dictations column already exists');
    }
  }
  
  // Migration: Add auto_correct column if not exists (default TRUE for automatic correction)
  try {
    await db.execute(`
      ALTER TABLE users ADD COLUMN auto_correct BOOLEAN DEFAULT TRUE
    `);
    console.log('[DB] ✓ Added auto_correct column (dynamic)');
  } catch (e: any) {
    if (!e.message?.includes('Duplicate column')) {
      console.log('[DB] auto_correct column already exists');
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

// Standard-Query (nutzt Default-Pool)
export async function query<T = any>(sql: string, params?: any[]): Promise<T[]> {
  const db = await getPool();
  const [rows] = await db.execute(sql, params);
  return rows as T[];
}

// Standard-Execute (nutzt Default-Pool)
export async function execute(sql: string, params?: any[]): Promise<mysql.ResultSetHeader> {
  const db = await getPool();
  const [result] = await db.execute(sql, params);
  return result as mysql.ResultSetHeader;
}

// Query mit Request-Context (nutzt dynamischen Pool wenn Token vorhanden)
export async function queryWithRequest<T = any>(request: NextRequest, sql: string, params?: any[]): Promise<T[]> {
  const db = await getPoolForRequest(request);
  const [rows] = await db.execute(sql, params);
  return rows as T[];
}

// Execute mit Request-Context (nutzt dynamischen Pool wenn Token vorhanden)
export async function executeWithRequest(request: NextRequest, sql: string, params?: any[]): Promise<mysql.ResultSetHeader> {
  const db = await getPoolForRequest(request);
  const [result] = await db.execute(sql, params);
  return result as mysql.ResultSetHeader;
}
