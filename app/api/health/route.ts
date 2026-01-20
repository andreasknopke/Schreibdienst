import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export const runtime = 'nodejs';

export async function GET() {
  const cwd = process.cwd();
  const cacheDir = path.join(cwd, 'cache');
  const dictionariesDir = path.join(cacheDir, 'dictionaries');
  const usersFile = path.join(cacheDir, 'users.json');
  
  const checks = {
    ok: true,
    time: new Date().toISOString(),
    cwd,
    cacheDir,
    cacheDirExists: false,
    cacheDirWritable: false,
    dictionariesDirExists: false,
    usersFileExists: false,
    files: [] as string[],
    error: null as string | null,
  };
  
  try {
    checks.cacheDirExists = fs.existsSync(cacheDir);
    checks.dictionariesDirExists = fs.existsSync(dictionariesDir);
    checks.usersFileExists = fs.existsSync(usersFile);
    
    // Try to list files
    if (checks.cacheDirExists) {
      checks.files = fs.readdirSync(cacheDir);
    }
    
    // Try to write a test file
    const testFile = path.join(cacheDir, '.write-test');
    try {
      // Ensure cache dir exists
      if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
        checks.cacheDirExists = true;
      }
      fs.writeFileSync(testFile, 'test');
      fs.unlinkSync(testFile);
      checks.cacheDirWritable = true;
    } catch (writeErr: any) {
      checks.cacheDirWritable = false;
      checks.error = writeErr.message;
    }
  } catch (err: any) {
    checks.ok = false;
    checks.error = err.message;
  }
  
  return NextResponse.json(checks);
}
