// API Helper für DB-Token Integration
// Zentrale Funktionen für Request-basierte Datenbankabfragen

import { NextRequest } from 'next/server';
import { getPoolForRequest, decodeDbTokenServer, initDatabaseWithRequest } from './db';
import mysql from 'mysql2/promise';

export { decodeDbTokenServer as decodeDbToken };

/**
 * Parst einen Basic-Auth-Header und extrahiert Username und Passwort.
 * Verwendet indexOf(':') statt split(':'), damit Passwörter mit
 * Doppelpunkten korrekt verarbeitet werden (Security-Fix).
 *
 * @returns { username, password } oder null bei ungültigem Header
 */
export function parseBasicAuth(authHeader: string | null): { username: string; password: string } | null {
  if (!authHeader || !authHeader.startsWith('Basic ')) return null;
  try {
    const base64 = authHeader.slice(6);
    const credentials = Buffer.from(base64, 'base64').toString('utf8');
    const colonIndex = credentials.indexOf(':');
    if (colonIndex === -1) return null;
    return {
      username: credentials.slice(0, colonIndex),
      password: credentials.slice(colonIndex + 1),
    };
  } catch {
    return null;
  }
}

// Führt eine Query mit Request-Context aus
export async function queryWithRequest<T = any>(
  request: NextRequest, 
  sql: string, 
  params?: any[]
): Promise<T[]> {
  const db = await getPoolForRequest(request);
  const [rows] = await db.execute(sql, params);
  return rows as T[];
}

// Führt ein Execute mit Request-Context aus
export async function executeWithRequest(
  request: NextRequest, 
  sql: string, 
  params?: any[]
): Promise<mysql.ResultSetHeader> {
  const db = await getPoolForRequest(request);
  const [result] = await db.execute(sql, params);
  return result as mysql.ResultSetHeader;
}

// Prüft ob Request einen gültigen DB-Token hat
export function hasDbToken(request: NextRequest): boolean {
  const dbToken = request.headers.get('x-db-token');
  if (!dbToken) return false;
  return decodeDbTokenServer(dbToken) !== null;
}

// Holt den DB-Token aus dem Request
export function getDbTokenFromRequest(request: NextRequest): string | null {
  return request.headers.get('x-db-token');
}

// Initialisiert die Datenbank für einen Request (erstellt Tabellen falls nötig)
export async function ensureDatabaseInitialized(request: NextRequest): Promise<void> {
  const dbToken = request.headers.get('x-db-token');
  if (dbToken) {
    await initDatabaseWithRequest(request);
  }
}

// Hole Pool für Request (re-export für einfachen Zugriff)
export { getPoolForRequest } from './db';
