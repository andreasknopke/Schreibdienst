import { NextRequest, NextResponse } from 'next/server';
import { logOnlineUsageEventWithRequest, type OnlineUsageEventType } from '@/lib/onlineUsageDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_EVENT_TYPES: OnlineUsageEventType[] = ['utterance', 'session', 'manual_correction'];

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const username = typeof body.username === 'string' ? body.username.trim() : '';
    const eventType = body.eventType as OnlineUsageEventType;

    if (!username || !VALID_EVENT_TYPES.includes(eventType)) {
      return NextResponse.json({ success: false, error: 'Invalid usage event' }, { status: 400 });
    }

    await logOnlineUsageEventWithRequest(request, {
      username,
      eventType,
      provider: typeof body.provider === 'string' ? body.provider : undefined,
      wordCount: Number(body.wordCount || 0),
      utteranceCount: Number(body.utteranceCount || 0),
      audioDurationSeconds: Number(body.audioDurationSeconds || 0),
      manualCorrections: Number(body.manualCorrections || 0),
    });

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[API] Online usage log error:', error);
    return NextResponse.json({ success: false, error: 'Failed to log usage' }, { status: 500 });
  }
}
