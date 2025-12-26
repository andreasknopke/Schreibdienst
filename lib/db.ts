import mysql from 'mysql2/promise';

// Database connection pool
let pool: mysql.Pool | null = null;

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
  
  console.log('[DB] Connecting to MySQL...');
  
  pool = mysql.createPool({
    uri: connectionString,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });
  
  // Test connection
  try {
    const connection = await pool.getConnection();
    console.log('[DB] ✓ Connected to MySQL');
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

// Helper for queries
export async function query<T = any>(sql: string, params?: any[]): Promise<T[]> {
  const db = await getPool();
  const [rows] = await db.execute(sql, params);
  return rows as T[];
}

export async function execute(sql: string, params?: any[]): Promise<mysql.ResultSetHeader> {
  const db = await getPool();
  const [result] = await db.execute(sql, params);
  return result as mysql.ResultSetHeader;
}
