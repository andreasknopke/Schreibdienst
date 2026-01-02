import { NextRequest, NextResponse } from 'next/server';
import {
  archiveDictationWithRequest,
  unarchiveDictationWithRequest,
  getArchivedDictationsWithRequest,
  initOfflineDictationTableWithRequest,
} from '@/lib/offlineDictationDb';

export const runtime = 'nodejs';

// GET: Get archived dictations with optional filters
export async function GET(req: NextRequest) {
  try {
    await initOfflineDictationTableWithRequest(req);
    
    const { searchParams } = new URL(req.url);
    const username = searchParams.get('username') || undefined;
    const archivedBy = searchParams.get('archivedBy') || undefined;
    const patientName = searchParams.get('patientName') || undefined;
    const fromDate = searchParams.get('fromDate') || undefined;
    const toDate = searchParams.get('toDate') || undefined;
    
    const dictations = await getArchivedDictationsWithRequest(req, {
      username,
      archivedBy,
      patientName,
      fromDate,
      toDate,
    });
    
    return NextResponse.json({ dictations });
  } catch (error: any) {
    console.error('[Archive] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST: Archive a dictation
export async function POST(req: NextRequest) {
  try {
    await initOfflineDictationTableWithRequest(req);
    
    const body = await req.json();
    const { id, archivedBy } = body;
    
    if (!id || !archivedBy) {
      return NextResponse.json(
        { error: 'id and archivedBy are required' },
        { status: 400 }
      );
    }
    
    await archiveDictationWithRequest(req, parseInt(id), archivedBy);
    
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Archive] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE: Unarchive a dictation
export async function DELETE(req: NextRequest) {
  try {
    await initOfflineDictationTableWithRequest(req);
    
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json({ error: 'id is required' }, { status: 400 });
    }
    
    await unarchiveDictationWithRequest(req, parseInt(id));
    
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[Archive] DELETE error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
