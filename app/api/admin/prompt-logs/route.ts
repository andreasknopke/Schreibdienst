import { NextResponse } from 'next/server';
import { getLlmPromptLogs, clearLlmPromptLogs } from '@/lib/llmPromptLog';

export const runtime = 'nodejs';

/**
 * GET /api/admin/prompt-logs
 * Gibt die letzten LLM-Prompt-Logs zurück (neueste zuerst).
 * Die Admin-Konsole im Frontend ist ohnehin nur für Admins sichtbar.
 */
export async function GET() {
  try {
    const entries = getLlmPromptLogs();
    return NextResponse.json({ entries });
  } catch (error: any) {
    console.error('[PromptLogs] Error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

/**
 * DELETE /api/admin/prompt-logs
 * Löscht alle Prompt-Logs.
 */
export async function DELETE() {
  try {
    clearLlmPromptLogs();
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[PromptLogs] Delete error:', error.message);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
