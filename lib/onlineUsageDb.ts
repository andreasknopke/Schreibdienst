import { NextRequest } from 'next/server';
import { getPool, getPoolForRequest } from './db';
import mysql from 'mysql2/promise';

export type OnlineUsageEventType = 'utterance' | 'session' | 'manual_correction';

export interface OnlineUsageEventInput {
  username: string;
  eventType: OnlineUsageEventType;
  provider?: string;
  wordCount?: number;
  utteranceCount?: number;
  audioDurationSeconds?: number;
  manualCorrections?: number;
}

async function ensureOnlineUsageTable(db: mysql.Pool): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS online_usage_events (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(255) NOT NULL,
      event_type ENUM('utterance', 'session', 'manual_correction') NOT NULL,
      provider VARCHAR(100) DEFAULT NULL,
      word_count INT DEFAULT 0,
      utterance_count INT DEFAULT 0,
      audio_duration_seconds FLOAT DEFAULT 0,
      manual_corrections INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_username_created_at (username, created_at),
      INDEX idx_event_type_created_at (event_type, created_at),
      INDEX idx_created_at (created_at)
    )
  `);
}

async function _logOnlineUsageEvent(db: mysql.Pool, input: OnlineUsageEventInput): Promise<void> {
  const username = input.username?.trim().toLowerCase();
  if (!username) return;

  await ensureOnlineUsageTable(db);
  await db.execute(
    `INSERT INTO online_usage_events
      (username, event_type, provider, word_count, utterance_count, audio_duration_seconds, manual_corrections)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      username,
      input.eventType,
      input.provider ?? null,
      Math.max(0, Math.round(input.wordCount ?? 0)),
      Math.max(0, Math.round(input.utteranceCount ?? 0)),
      Math.max(0, Number(input.audioDurationSeconds ?? 0)),
      Math.max(0, Math.round(input.manualCorrections ?? 0)),
    ]
  );
}

export async function initOnlineUsageTable(): Promise<void> {
  const db = await getPool();
  await ensureOnlineUsageTable(db);
}

export async function initOnlineUsageTableWithRequest(req: NextRequest): Promise<void> {
  const db = await getPoolForRequest(req);
  await ensureOnlineUsageTable(db);
}

export async function logOnlineUsageEvent(input: OnlineUsageEventInput): Promise<void> {
  const db = await getPool();
  await _logOnlineUsageEvent(db, input);
}

export async function logOnlineUsageEventWithRequest(req: NextRequest, input: OnlineUsageEventInput): Promise<void> {
  const db = await getPoolForRequest(req);
  await _logOnlineUsageEvent(db, input);
}

export function countWords(text: string): number {
  return text
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
}
