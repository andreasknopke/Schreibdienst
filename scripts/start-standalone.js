const fs = require('fs');
const path = require('path');

const appRoot = process.cwd();
const dataDir = process.env.DATA_DIR || path.join(appRoot, 'cache');
const dictionariesDir = path.join(dataDir, 'dictionaries');
const usersFile = path.join(dataDir, 'users.json');

console.log('[Startup] Initializing standalone runtime');
console.log('[Startup] DATA_DIR:', dataDir);

for (const dir of [dataDir, dictionariesDir]) {
  try {
    fs.mkdirSync(dir, { recursive: true, mode: 0o775 });
    console.log('[Startup] Directory ready:', dir);
  } catch (error) {
    console.error('[Startup] Failed to prepare directory:', dir, error.message);
  }
}

if (!fs.existsSync(usersFile)) {
  try {
    fs.writeFileSync(usersFile, JSON.stringify({ users: [] }, null, 2));
    console.log('[Startup] Created users.json');
  } catch (error) {
    console.error('[Startup] Could not create users.json:', error.message);
  }
}

console.log('[Startup] Starting Next.js standalone server');
require(path.join(appRoot, 'server.js'));