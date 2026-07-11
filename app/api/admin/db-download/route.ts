import { NextRequest, NextResponse } from 'next/server';
import { getPoolForRequest } from '@/lib/db';
import { authenticateUserWithRequest } from '@/lib/usersDb';
import { parseBasicAuth } from '@/lib/apiHelpers';

export const runtime = 'nodejs';

/**
 * Prüft ob der User root ist
 */
async function isRootUser(request: NextRequest): Promise<boolean> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return false;
  }

  try {
    const parsed = parseBasicAuth(authHeader);
    if (!parsed) return false;
    const result = await authenticateUserWithRequest(request, parsed.username, parsed.password);
    return result.success && result.user?.username.toLowerCase() === 'root';
  } catch {
    return false;
  }
}

/**
 * Escaped einen Wert für SQL (String-Werte mit Anführungszeichen, NULL etc.)
 */
function escapeSqlValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'NULL';
  }
  if (typeof value === 'number') {
    return value.toString();
  }
  if (typeof value === 'boolean') {
    return value ? '1' : '0';
  }
  // Buffer (BLOB/BINARY)
  if (Buffer.isBuffer(value)) {
    return `X'${value.toString('hex')}'`;
  }
  // Date-Objekte
  if (value instanceof Date) {
    return `'${value.toISOString().slice(0, 19).replace('T', ' ')}'`;
  }
  // Strings escapen
  const str = String(value);
  // Single quotes escapen, Backslashes escapen
  const escaped = str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r');
  return `'${escaped}'`;
}

/**
 * Erzeugt einen vollständigen SQL-Dump als String.
 */
async function generateSqlDump(request: NextRequest): Promise<string> {
  const pool = await getPoolForRequest(request);

  const lines: string[] = [];
  const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

  // Header
  lines.push(`-- ============================================================`);
  lines.push(`-- Schreibdienst Database Dump`);
  lines.push(`-- Generated: ${now}`);
  lines.push(`-- ============================================================`);
  lines.push('');
  lines.push('SET FOREIGN_KEY_CHECKS = 0;');
  lines.push('SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";');
  lines.push('SET AUTOCOMMIT = 0;');
  lines.push('SET NAMES utf8mb4;');
  lines.push('');

  // Alle Tabellen abfragen
  const [tables] = await pool.execute<any[]>(
    `SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
     ORDER BY TABLE_NAME`
  );

  const tableNames: string[] = [];
  for (const row of tables) {
    const name = row.TABLE_NAME || row[Object.keys(row)[0]];
    tableNames.push(name);
  }

  for (const tableName of tableNames) {
    try {
      // --- Table structure ---
      const [createResult] = await pool.execute<any[]>(
        `SHOW CREATE TABLE \`${tableName}\``
      );
      if (createResult && createResult.length > 0) {
        const createStmt = createResult[0]['Create Table'] || '';
        lines.push(`-- ------------------------------------------------`);
        lines.push(`-- Table structure for \`${tableName}\``);
        lines.push(`-- ------------------------------------------------`);
        lines.push(`DROP TABLE IF EXISTS \`${tableName}\`;`);
        lines.push(`${createStmt};`);
        lines.push('');
      }

      // --- Table data ---
      const [rows] = await pool.execute<any[]>(`SELECT * FROM \`${tableName}\``);

      if (rows && rows.length > 0) {
        lines.push(`-- ------------------------------------------------`);
        lines.push(`-- Data for \`${tableName}\` (${rows.length} rows)`);
        lines.push(`-- ------------------------------------------------`);

        // Spaltennamen aus den Spalteninformationen holen
        const columns = Object.keys(rows[0]);

        for (const row of rows) {
          const values = columns.map((col) => escapeSqlValue(row[col]));
          const escapedCols = columns.map((col) => `\`${col}\``);
          lines.push(
            `INSERT INTO \`${tableName}\` (${escapedCols.join(', ')}) VALUES (${values.join(', ')});`
          );
        }
        lines.push('');
      }
    } catch (err) {
      console.error(`[DB-Dump] Fehler bei Tabelle ${tableName}:`, err);
      lines.push(`-- ⚠️ Fehler beim Auslesen der Tabelle \`${tableName}\``);
      lines.push('');
    }
  }

  // Footer
  lines.push('SET FOREIGN_KEY_CHECKS = 1;');
  lines.push('COMMIT;');
  lines.push('');
  lines.push('-- ============================================================');
  lines.push('-- End of Dump');
  lines.push('-- ============================================================');

  return lines.join('\n');
}

/**
 * GET /api/admin/db-download
 * Lädt die gesamte Datenbank als SQL-Datei herunter.
 * Nur für root-Benutzer verfügbar.
 */
export async function GET(request: NextRequest) {
  console.log('\n=== Database Download Request ===');

  // Nur root darf die Datenbank herunterladen
  if (!(await isRootUser(request))) {
    return NextResponse.json(
      { error: 'Nur der root-Benutzer kann die Datenbank herunterladen' },
      { status: 403 }
    );
  }

  try {
    const sql = await generateSqlDump(request);
    const filename = `schreibdienst-db-${new Date().toISOString().slice(0, 10)}.sql`;

    return new NextResponse(sql, {
      status: 200,
      headers: {
        'Content-Type': 'application/sql',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Content-Length': Buffer.byteLength(sql, 'utf-8').toString(),
      },
    });
  } catch (error: any) {
    console.error('[DB-Download] Fehler:', error.message);
    return NextResponse.json(
      { error: 'Fehler beim Erstellen des Datenbank-Dumps: ' + error.message },
      { status: 500 }
    );
  }
}
