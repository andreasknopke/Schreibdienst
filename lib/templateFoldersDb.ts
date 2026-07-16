/**
 * Datenbank-Operationen für Template-Ordner (Baumstruktur).
 */
import { NextRequest } from 'next/server';
import { getPoolForRequest } from '@/lib/db';

export interface TemplateFolder {
  id: number;
  parentId: number | null;
  name: string;
  username: string | null;
  groupId: number | null;
  sortOrder: number;
  children?: TemplateFolder[];
}

export interface TemplateFolderTree {
  personal: TemplateFolder[];
  groups: { groupId: number; groupName: string; folders: TemplateFolder[] }[];
}

function rowToFolder(row: any): TemplateFolder {
  return {
    id: Number(row.id),
    parentId: row.parent_id !== null && row.parent_id !== undefined ? Number(row.parent_id) : null,
    name: row.name,
    username: row.username || null,
    groupId: row.group_id !== null && row.group_id !== undefined ? Number(row.group_id) : null,
    sortOrder: Number(row.sort_order) || 0,
  };
}

export async function ensureTemplateFoldersTable(request: NextRequest): Promise<void> {
  const db = await getPoolForRequest(request);
  await db.execute(`
    CREATE TABLE IF NOT EXISTS template_folders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      parent_id INT DEFAULT NULL,
      name VARCHAR(255) NOT NULL,
      username VARCHAR(255) DEFAULT NULL,
      group_id INT DEFAULT NULL,
      sort_order INT DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_folders_parent (parent_id),
      INDEX idx_folders_username (username),
      INDEX idx_folders_group (group_id)
    )
  `);

  // folder_id zu templates hinzufügen falls nicht vorhanden
  try {
    await db.execute(`ALTER TABLE templates ADD COLUMN folder_id INT DEFAULT NULL`);
  } catch { /* bereits vorhanden */ }

  // folder_id zu template_group_entries hinzufügen falls nicht vorhanden
  try {
    await db.execute(`ALTER TABLE template_group_entries ADD COLUMN folder_id INT DEFAULT NULL`);
  } catch { /* bereits vorhanden */ }
}

/**
 * Gibt die Ordner-Struktur für einen User zurück:
 * - Persönliche Ordner (username = user)
 * - Gruppen-Ordner (group_id in den Gruppen des Users)
 */
export async function getFolderTree(
  request: NextRequest,
  username: string,
  userGroupIds: number[],
): Promise<TemplateFolderTree> {
  await ensureTemplateFoldersTable(request);
  const db = await getPoolForRequest(request);

  // Persönliche Ordner
  const [personalRows] = await db.execute<any[]>(
    'SELECT * FROM template_folders WHERE username = ? AND group_id IS NULL ORDER BY sort_order, name',
    [username.toLowerCase()],
  );
  const personal = (personalRows as any[]).map(rowToFolder);

  // Gruppen-Ordner
  const groups: TemplateFolderTree['groups'] = [];
  for (const groupId of userGroupIds) {
    const [groupRows] = await db.execute<any[]>(
      'SELECT * FROM template_folders WHERE group_id = ? ORDER BY sort_order, name',
      [groupId],
    );
    if ((groupRows as any[]).length > 0) {
      const [nameRows] = await db.execute<any[]>(
        'SELECT name FROM dictionary_groups WHERE id = ?',
        [groupId],
      );
      const groupName = (nameRows as any[])[0]?.name || `Gruppe ${groupId}`;
      groups.push({
        groupId,
        groupName,
        folders: (groupRows as any[]).map(rowToFolder),
      });
    }
  }

  return { personal, groups };
}

function buildTree(flatList: TemplateFolder[]): TemplateFolder[] {
  const map = new Map<number, TemplateFolder>();
  const roots: TemplateFolder[] = [];

  for (const item of flatList) {
    map.set(item.id, { ...item, children: [] });
  }

  for (const item of flatList) {
    const node = map.get(item.id)!;
    if (item.parentId !== null && map.has(item.parentId)) {
      map.get(item.parentId)!.children!.push(node);
    } else {
      roots.push(node);
    }
  }

  return roots;
}

export interface CreateFolderParams {
  name: string;
  parentId?: number | null;
  groupId?: number | null;
}

/**
 * Erstellt einen neuen Ordner.
 */
export async function createFolder(
  request: NextRequest,
  username: string,
  params: CreateFolderParams,
): Promise<{ success: boolean; folder?: TemplateFolder; error?: string }> {
  await ensureTemplateFoldersTable(request);
  const db = await getPoolForRequest(request);

  const name = params.name.trim();
  if (!name) return { success: false, error: 'Name erforderlich' };

  const parentId = params.parentId ?? null;
  const groupId = params.groupId ?? null;

  const [result] = await db.execute<any>(
    `INSERT INTO template_folders (parent_id, name, username, group_id)
     VALUES (?, ?, ?, ?)`,
    [parentId, name, groupId ? null : username.toLowerCase(), groupId],
  );

  const folder: TemplateFolder = {
    id: result.insertId,
    parentId,
    name,
    username: groupId ? null : username.toLowerCase(),
    groupId,
    sortOrder: 0,
    children: [],
  };

  return { success: true, folder };
}

/**
 * Benennt einen Ordner um.
 */
export async function renameFolder(
  request: NextRequest,
  folderId: number,
  newName: string,
): Promise<{ success: boolean; error?: string }> {
  await ensureTemplateFoldersTable(request);
  const db = await getPoolForRequest(request);

  const name = newName.trim();
  if (!name) return { success: false, error: 'Name erforderlich' };

  await db.execute('UPDATE template_folders SET name = ? WHERE id = ?', [name, folderId]);
  return { success: true };
}

/**
 * Verschiebt einen Ordner (neues parent_id).
 */
export async function moveFolder(
  request: NextRequest,
  folderId: number,
  newParentId: number | null,
): Promise<{ success: boolean; error?: string }> {
  await ensureTemplateFoldersTable(request);
  const db = await getPoolForRequest(request);

  // Prüfen, dass kein Zirkel entsteht
  if (newParentId !== null) {
    let current = newParentId;
    while (current !== null) {
      if (current === folderId) return { success: false, error: 'Ein Ordner kann nicht in sich selbst verschoben werden' };
      const [rows] = await db.execute<any[]>('SELECT parent_id FROM template_folders WHERE id = ?', [current]);
      current = (rows as any[])[0]?.parent_id ?? null;
    }
  }

  await db.execute('UPDATE template_folders SET parent_id = ? WHERE id = ?', [newParentId, folderId]);
  return { success: true };
}

/**
 * Löscht einen Ordner (und alle Unterordner via CASCADE).
 */
export async function deleteFolder(
  request: NextRequest,
  folderId: number,
): Promise<{ success: boolean; error?: string }> {
  await ensureTemplateFoldersTable(request);
  const db = await getPoolForRequest(request);

  // Templates in diesem Ordner auf NULL setzen
  await db.execute('UPDATE templates SET folder_id = NULL WHERE folder_id = ?', [folderId]);
  await db.execute('UPDATE template_group_entries SET folder_id = NULL WHERE folder_id = ?', [folderId]);

  await db.execute('DELETE FROM template_folders WHERE id = ?', [folderId]);
  return { success: true };
}
