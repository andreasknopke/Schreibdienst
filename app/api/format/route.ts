import { NextResponse } from 'next/server';
import { formatAsArztbrief, formatAsBefund, normalizeGermanText } from '@/lib/formatMedical';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const { text, mode } = (await req.json()) as { text?: string; mode?: 'arztbrief' | 'befund' };
    if (!text) return NextResponse.json({ error: 'Missing text' }, { status: 400 });
    const normalized = normalizeGermanText(text);
    const formatted = mode === 'befund' ? formatAsBefund(normalized) : formatAsArztbrief(normalized);
    return NextResponse.json({ text: formatted });
  } catch (e: any) {
    return NextResponse.json({ error: 'Format error', message: e?.message }, { status: 500 });
  }
}
