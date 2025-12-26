/**
 * Next.js Instrumentation - runs on server startup
 * Used to initialize MySQL database tables
 */

export async function register() {
  // Only run on server
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    console.log('[Instrumentation] Starting server initialization...');
    
    // Check if MySQL is configured
    const mysqlUrl = process.env.DATABASE_URL || process.env.MYSQL_URL;
    
    if (mysqlUrl) {
      console.log('[Instrumentation] MySQL configured, initializing database...');
      try {
        const { initDatabase } = await import('./lib/db');
        await initDatabase();
        console.log('[Instrumentation] ✓ MySQL database initialized');
      } catch (err: any) {
        console.error('[Instrumentation] ✗ MySQL initialization failed:', err.message);
      }
    } else {
      console.log('[Instrumentation] No DATABASE_URL or MYSQL_URL configured, skipping MySQL init');
    }
  }
}
