import { NextRequest, NextResponse } from 'next/server';
import { getPoolForRequest } from '@/lib/db';
import { authenticateUserWithRequest } from '@/lib/usersDb';

// Prüft ob der User root ist
async function isRootUser(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return false;
  }
  
  try {
    const credentials = Buffer.from(authHeader.slice(6), 'base64').toString();
    const [username, password] = credentials.split(':');
    const result = await authenticateUserWithRequest(request, username, password);
    return result.success && result.user?.username.toLowerCase() === 'root';
  } catch {
    return false;
  }
}

// POST /api/config/migrate - Führt alle Datenbank-Migrationen aus
export async function POST(request: NextRequest) {
  console.log('\n=== Database Migration Request ===');
  
  // Nur root darf Migrationen ausführen
  if (!await isRootUser(request)) {
    return NextResponse.json({ 
      success: false, 
      error: 'Nur der root-Benutzer kann Migrationen ausführen' 
    }, { status: 403 });
  }
  
  const status = {
    templates: false,
    dictionary: false,
    users: false,
    config: false,
    offlineDictations: false,
    customActions: false
  };
  
  try {
    const pool = await getPoolForRequest(request);
    
    // 1. Users-Tabelle
    try {
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS users (
          id INT AUTO_INCREMENT PRIMARY KEY,
          username VARCHAR(100) UNIQUE NOT NULL,
          password_hash VARCHAR(255) NOT NULL,
          is_admin BOOLEAN DEFAULT FALSE,
          can_view_all_dictations BOOLEAN DEFAULT FALSE,
          default_mode ENUM('befund', 'arztbrief') DEFAULT 'befund',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      
      // Migration: default_mode Spalte hinzufügen falls nicht vorhanden
      try {
        await pool.execute(`
          ALTER TABLE users ADD COLUMN default_mode ENUM('befund', 'arztbrief') DEFAULT 'befund'
        `);
        console.log('[Migration] users table: added default_mode column');
      } catch (alterError: any) {
        // Spalte existiert bereits - das ist OK
        if (!alterError.message.includes('Duplicate column')) {
          console.log('[Migration] users table: default_mode column already exists');
        }
      }
      
      status.users = true;
      console.log('[Migration] users table: OK');
    } catch (error: any) {
      console.error('[Migration] users table error:', error.message);
    }
    
    // 2. Dictionary-Tabelle
    try {
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS dictionary_entries (
          id INT AUTO_INCREMENT PRIMARY KEY,
          username VARCHAR(100) NOT NULL,
          wrong_word VARCHAR(500) NOT NULL,
          correct_word VARCHAR(500) NOT NULL,
          added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          use_in_prompt BOOLEAN DEFAULT FALSE,
          match_stem BOOLEAN DEFAULT FALSE,
          UNIQUE KEY unique_user_word (username, wrong_word(191))
        )
      `);
      
      // Migration: use_in_prompt Spalte hinzufügen falls nicht vorhanden
      try {
        await pool.execute(`
          ALTER TABLE dictionary_entries ADD COLUMN use_in_prompt BOOLEAN DEFAULT FALSE
        `);
        console.log('[Migration] dictionary_entries table: added use_in_prompt column');
      } catch (alterError: any) {
        if (!alterError.message.includes('Duplicate column')) {
          console.log('[Migration] dictionary_entries table: use_in_prompt column already exists');
        }
      }
      
      // Migration: match_stem Spalte hinzufügen falls nicht vorhanden
      try {
        await pool.execute(`
          ALTER TABLE dictionary_entries ADD COLUMN match_stem BOOLEAN DEFAULT FALSE
        `);
        console.log('[Migration] dictionary_entries table: added match_stem column');
      } catch (alterError: any) {
        if (!alterError.message.includes('Duplicate column')) {
          console.log('[Migration] dictionary_entries table: match_stem column already exists');
        }
      }
      
      status.dictionary = true;
      console.log('[Migration] dictionary_entries table: OK');
    } catch (error: any) {
      console.error('[Migration] dictionary_entries table error:', error.message);
    }

    // 3. Templates-Tabelle (NEU)
    try {
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS templates (
          id INT AUTO_INCREMENT PRIMARY KEY,
          username VARCHAR(100) NOT NULL,
          name VARCHAR(200) NOT NULL,
          content TEXT NOT NULL,
          field ENUM('methodik', 'befund', 'beurteilung') DEFAULT 'befund',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY unique_user_template (username, name)
        )
      `);
      status.templates = true;
      console.log('[Migration] templates table: OK');
    } catch (error: any) {
      console.error('[Migration] templates table error:', error.message);
    }
    
    // 4. Runtime Config-Tabelle
    try {
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS runtime_config (
          id INT AUTO_INCREMENT PRIMARY KEY,
          config_key VARCHAR(100) UNIQUE NOT NULL,
          config_value TEXT,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )
      `);
      status.config = true;
      console.log('[Migration] runtime_config table: OK');
    } catch (error: any) {
      console.error('[Migration] runtime_config table error:', error.message);
    }
    
    // 5. Offline Dictations-Tabelle
    try {
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS offline_dictations (
          id INT AUTO_INCREMENT PRIMARY KEY,
          client_id VARCHAR(100) NOT NULL,
          username VARCHAR(100) NOT NULL,
          audio_data LONGBLOB NOT NULL,
          audio_type VARCHAR(50) DEFAULT 'audio/webm',
          mode VARCHAR(20) DEFAULT 'befund',
          active_field VARCHAR(50) DEFAULT 'befund',
          status ENUM('pending', 'processing', 'completed', 'failed') DEFAULT 'pending',
          transcript LONGTEXT,
          corrected_text LONGTEXT,
          error_message TEXT,
          methodik LONGTEXT,
          befund LONGTEXT,
          beurteilung LONGTEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          processed_at TIMESTAMP NULL,
          UNIQUE KEY unique_client_id (client_id)
        )
      `);
      status.offlineDictations = true;
      console.log('[Migration] offline_dictations table: OK');
    } catch (error: any) {
      console.error('[Migration] offline_dictations table error:', error.message);
    }
    
    // 6. Custom Actions-Tabelle (für benutzerdefinierte LLM-Aktionen)
    try {
      await pool.execute(`
        CREATE TABLE IF NOT EXISTS custom_actions (
          id INT AUTO_INCREMENT PRIMARY KEY,
          username VARCHAR(100) NOT NULL,
          name VARCHAR(200) NOT NULL,
          icon VARCHAR(20) DEFAULT '⚡',
          prompt TEXT NOT NULL,
          target_field ENUM('current', 'methodik', 'befund', 'beurteilung', 'all') DEFAULT 'current',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
          UNIQUE KEY unique_user_action (username, name)
        )
      `);
      status.customActions = true;
      console.log('[Migration] custom_actions table: OK');
    } catch (error: any) {
      console.error('[Migration] custom_actions table error:', error.message);
    }
    
    // Prüfe ob root-User existiert (nur Hinweis, keine automatische Erstellung)
    try {
      const [rows] = await pool.query<any[]>(
        "SELECT id FROM users WHERE LOWER(username) = 'root'"
      );
      if (!rows || rows.length === 0) {
        console.log('[Migration] Hinweis: Kein root-User vorhanden. Bitte manuell über /api/auth registrieren.');
      } else {
        console.log('[Migration] root-User existiert bereits');
      }
    } catch (error: any) {
      console.error('[Migration] root user check error:', error.message);
    }
    
    console.log('[Migration] Complete:', status);
    console.log('=== Database Migration Complete ===\n');
    
    return NextResponse.json({ 
      success: true, 
      status,
      message: 'Alle Migrationen erfolgreich ausgeführt'
    });
    
  } catch (error: any) {
    console.error('[Migration] Fatal error:', error.message);
    console.log('=== Database Migration Failed ===\n');
    return NextResponse.json({ 
      success: false, 
      error: error.message || 'Migration fehlgeschlagen',
      status
    }, { status: 500 });
  }
}
