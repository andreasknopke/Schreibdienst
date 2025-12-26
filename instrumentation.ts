/**
 * Next.js Instrumentation - runs on server startup
 * Used to initialize data directories for Railway volumes
 */

export async function register() {
  // Only run on server
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    const fs = await import('fs');
    const path = await import('path');
    
    const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'cache');
    const DICTIONARIES_DIR = path.join(DATA_DIR, 'dictionaries');
    
    console.log('[Instrumentation] Initializing data directories...');
    console.log('[Instrumentation] DATA_DIR:', DATA_DIR);
    console.log('[Instrumentation] CWD:', process.cwd());
    
    // Create directories
    const dirs = [DATA_DIR, DICTIONARIES_DIR];
    
    for (const dir of dirs) {
      try {
        if (!fs.existsSync(dir)) {
          console.log('[Instrumentation] Creating directory:', dir);
          fs.mkdirSync(dir, { recursive: true });
        }
        
        // Test write access
        const testFile = path.join(dir, '.write-test');
        fs.writeFileSync(testFile, 'test');
        fs.unlinkSync(testFile);
        console.log('[Instrumentation] ✓ Directory writable:', dir);
      } catch (err: any) {
        console.error('[Instrumentation] ✗ Directory error:', dir, err.message);
      }
    }
    
    // Create default users.json if it doesn't exist
    const usersFile = path.join(DATA_DIR, 'users.json');
    if (!fs.existsSync(usersFile)) {
      try {
        fs.writeFileSync(usersFile, JSON.stringify({ users: [] }, null, 2));
        console.log('[Instrumentation] ✓ Created users.json');
      } catch (err: any) {
        console.error('[Instrumentation] ✗ Could not create users.json:', err.message);
      }
    }
    
    // List contents
    try {
      console.log('[Instrumentation] Contents of', DATA_DIR + ':', fs.readdirSync(DATA_DIR));
    } catch (e) {
      console.log('[Instrumentation] Could not list directory');
    }
  }
}
