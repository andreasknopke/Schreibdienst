/**
 * Production startup script for Railway
 * Ensures cache directories exist and are writable before starting Next.js
 */

const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'cache');
const DICTIONARIES_DIR = path.join(DATA_DIR, 'dictionaries');

console.log('[Startup] Initializing data directories...');
console.log('[Startup] DATA_DIR:', DATA_DIR);

// Create directories
const dirs = [DATA_DIR, DICTIONARIES_DIR];

for (const dir of dirs) {
  try {
    if (!fs.existsSync(dir)) {
      console.log('[Startup] Creating directory:', dir);
      fs.mkdirSync(dir, { recursive: true, mode: 0o777 });
    }
    
    // Try to make it writable
    try {
      fs.chmodSync(dir, 0o777);
    } catch (e) {
      // Ignore chmod errors - might not have permission
    }
    
    // Test write access
    const testFile = path.join(dir, '.write-test');
    fs.writeFileSync(testFile, 'test');
    fs.unlinkSync(testFile);
    console.log('[Startup] ✓ Directory writable:', dir);
  } catch (err) {
    console.error('[Startup] ✗ Directory not writable:', dir, err.message);
  }
}

// Create default users.json if it doesn't exist
const usersFile = path.join(DATA_DIR, 'users.json');
if (!fs.existsSync(usersFile)) {
  try {
    fs.writeFileSync(usersFile, JSON.stringify({ users: [] }, null, 2));
    console.log('[Startup] ✓ Created users.json');
  } catch (err) {
    console.error('[Startup] ✗ Could not create users.json:', err.message);
  }
}

// List contents
try {
  console.log('[Startup] Contents of', DATA_DIR + ':', fs.readdirSync(DATA_DIR));
} catch (e) {
  console.log('[Startup] Could not list directory');
}

// Start Next.js
console.log('[Startup] Starting Next.js...');
const nextProcess = spawn('npx', ['next', 'start'], {
  stdio: 'inherit',
  env: process.env
});

nextProcess.on('close', (code) => {
  process.exit(code);
});
