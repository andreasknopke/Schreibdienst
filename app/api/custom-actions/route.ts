import { NextRequest, NextResponse } from 'next/server';
import { 
  getCustomActionsWithRequest, 
  addCustomActionWithRequest, 
  updateCustomActionWithRequest, 
  deleteCustomActionWithRequest 
} from '@/lib/customActionsDb';
import { authenticateUserWithRequest } from '@/lib/usersDb';

export const runtime = 'nodejs';

interface AuthResult {
  username: string;
}

// Extract username from auth header
async function getAuthenticatedUser(request: NextRequest): Promise<AuthResult | null> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Basic ')) {
    return null;
  }
  
  try {
    const credentials = Buffer.from(authHeader.slice(6), 'base64').toString();
    const [username, password] = credentials.split(':');
    const result = await authenticateUserWithRequest(request, username, password);
    
    if (result.success && result.user) {
      return { username: result.user.username };
    }
  } catch {
    // Invalid auth header
  }
  
  return null;
}

// GET: Fetch all custom actions for a user
export async function GET(req: NextRequest) {
  const auth = await getAuthenticatedUser(req);
  if (!auth) {
    return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  }
  
  try {
    const actions = await getCustomActionsWithRequest(req, auth.username);
    return NextResponse.json({ actions });
  } catch (error: any) {
    console.error('[API/CustomActions] GET error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// POST: Add a new custom action
export async function POST(req: NextRequest) {
  const auth = await getAuthenticatedUser(req);
  if (!auth) {
    return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  }
  
  try {
    const body = await req.json();
    const { name, icon, prompt, targetField } = body;
    
    if (!name || !prompt) {
      return NextResponse.json({ error: 'Name und Prompt sind erforderlich' }, { status: 400 });
    }
    
    const result = await addCustomActionWithRequest(
      req, 
      auth.username, 
      name, 
      icon || '⚡', 
      prompt, 
      targetField || 'current'
    );
    
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    
    return NextResponse.json({ success: true, id: result.id });
  } catch (error: any) {
    console.error('[API/CustomActions] POST error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// PUT: Update a custom action
export async function PUT(req: NextRequest) {
  const auth = await getAuthenticatedUser(req);
  if (!auth) {
    return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  }
  
  try {
    const body = await req.json();
    const { id, name, icon, prompt, targetField } = body;
    
    if (!id || !name || !prompt) {
      return NextResponse.json({ error: 'ID, Name und Prompt sind erforderlich' }, { status: 400 });
    }
    
    const result = await updateCustomActionWithRequest(
      req,
      auth.username,
      id,
      name,
      icon || '⚡',
      prompt,
      targetField || 'current'
    );
    
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[API/CustomActions] PUT error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

// DELETE: Delete a custom action
export async function DELETE(req: NextRequest) {
  const auth = await getAuthenticatedUser(req);
  if (!auth) {
    return NextResponse.json({ error: 'Nicht authentifiziert' }, { status: 401 });
  }
  
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get('id');
    
    if (!id) {
      return NextResponse.json({ error: 'ID ist erforderlich' }, { status: 400 });
    }
    
    const result = await deleteCustomActionWithRequest(req, auth.username, parseInt(id, 10));
    
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }
    
    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('[API/CustomActions] DELETE error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
