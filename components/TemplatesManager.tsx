"use client";
import { useState, useEffect } from 'react';
import { useAuth } from './AuthProvider';
import TemplateRichTextEditor from './TemplateRichTextEditor';
import BracketHighlight from './BracketHighlight';
import FolderSelect from './FolderSelect';
import { normalizeRichTextRanges, type RichTextFormatRange } from '@/lib/richTextFormatting';

interface Template {
  id: number;
  name: string;
  content: string;
  field: 'methodik' | 'befund' | 'beurteilung';
  formatRanges?: RichTextFormatRange[];
  createdAt: string;
  updatedAt: string;
  scope?: 'private' | 'group';
  groupName?: string;
  folderId?: number | null;
}

interface TemplatesManagerProps {
  mode?: 'create' | 'manage';
  apiFetch?: (url: string, options?: RequestInit) => Promise<Response>;
}

export default function TemplatesManager({ mode = 'create', apiFetch }: TemplatesManagerProps) {
  const { getAuthHeader, getDbTokenHeader } = useAuth();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Form state
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [contentFormats, setContentFormats] = useState<RichTextFormatRange[]>([]);
  const [field, setField] = useState<'methodik' | 'befund' | 'beurteilung'>('befund');
  const [adding, setAdding] = useState(false);
  const [selectedGroupIds, setSelectedGroupIds] = useState<Set<number>>(new Set());
  const [folderId, setFolderId] = useState<number | null>(null);
  const [editFolderId, setEditFolderId] = useState<number | null>(null);
  
  // User-Gruppen (für Gruppenauswahl)
  const [userGroups, setUserGroups] = useState<{ id: number; name: string }[]>([]);
  
  // Edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editScope, setEditScope] = useState<'private' | 'group' | null>(null);
  const [editSelectedGroupIds, setEditSelectedGroupIds] = useState<Set<number>>(new Set());
  const [editName, setEditName] = useState('');
  const [editContent, setEditContent] = useState('');
  const [editContentFormats, setEditContentFormats] = useState<RichTextFormatRange[]>([]);
  const [editField, setEditField] = useState<'methodik' | 'befund' | 'beurteilung'>('befund');

  const fetchTemplates = async () => {
    try {
      const response = await fetch('/api/templates', {
        headers: { 
          'Authorization': getAuthHeader(),
          ...getDbTokenHeader()
        }
      });
      const data = await response.json();
      if (data.templates) {
        setTemplates(data.templates);
      }
    } catch {
      setError('Fehler beim Laden der Textbausteine');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTemplates();
    fetchUserGroups();
  }, []);

  const fetchUserGroups = async () => {
    try {
      const response = await fetch('/api/templates/my-groups', {
        headers: {
          'Authorization': getAuthHeader(),
          ...getDbTokenHeader()
        }
      });
      const data = await response.json();
      if (data.success && data.groups) {
        setUserGroups(data.groups);
      }
    } catch {
      // Gruppen sind optional, kein Fehler nötig
    }
  };

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setAdding(true);

    try {
      const response = await fetch('/api/templates', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': getAuthHeader(),
          ...getDbTokenHeader()
        },
        body: JSON.stringify({
          name,
          content,
          field,
          folderId,
          formatRanges: normalizeRichTextRanges(contentFormats, content.length),
          groupIds: selectedGroupIds.size > 0 ? Array.from(selectedGroupIds) : false,
        })
      });

      const data = await response.json();

      if (response.status === 401) {
        setError('Sitzung abgelaufen - bitte erneut anmelden');
        return;
      }

      if (!response.ok) {
        setError(data.error || `Fehler (${response.status})`);
        return;
      }

      if (data.success) {
        setSuccess('Textbaustein hinzugefügt');
        setName('');
        setContent('');
        setContentFormats([]);
        setField('befund');
        setFolderId(null);
        setSelectedGroupIds(new Set());
        await fetchTemplates();
        // Event senden um andere Komponenten zu aktualisieren
        window.dispatchEvent(new CustomEvent('templates-changed'));
        setTimeout(() => setSuccess(''), 3000);
      }
    } catch {
      setError('Netzwerkfehler');
    } finally {
      setAdding(false);
    }
  };

  const handleEdit = (template: Template) => {
    setEditingId(template.id);
    setEditScope(template.scope || null);
    setEditSelectedGroupIds(new Set());
    setEditName(template.name);
    setEditContent(template.content);
    setEditContentFormats(template.formatRanges ?? []);
    setEditField(template.field);
    setEditFolderId(template.folderId ?? null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditScope(null);
    setEditSelectedGroupIds(new Set());
    setEditName('');
    setEditContent('');
    setEditContentFormats([]);
    setEditField('befund');
    setEditFolderId(null);
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;

    // Confirm bei Gruppen-Bausteinen
    if (editScope === 'group') {
      if (!confirm('Baustein für alle Gruppenmitglieder verändern?')) {
        return;
      }
    }
    
    setError('');
    setSuccess('');

    try {
      const response = await fetch('/api/templates', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': getAuthHeader(),
          ...getDbTokenHeader()
        },
        body: JSON.stringify({ 
          id: editingId, 
          name: editName, 
          content: editContent,
          field: editField,
          scope: editScope,
          folderId: editFolderId,
          groupIds: editSelectedGroupIds.size > 0 ? Array.from(editSelectedGroupIds) : false,
          formatRanges: normalizeRichTextRanges(editContentFormats, editContent.length),
        })
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Fehler beim Speichern');
        return;
      }

      if (data.success) {
        // Wenn ein privater Baustein als Gruppenbaustein übernommen wurde,
        // den privaten Baustein löschen, damit er nicht doppelt angezeigt wird.
        if (editSelectedGroupIds.size > 0 && editScope !== 'group') {
          await fetch('/api/templates', {
            method: 'DELETE',
            headers: {
              'Content-Type': 'application/json',
              'Authorization': getAuthHeader(),
              ...getDbTokenHeader()
            },
            body: JSON.stringify({ id: editingId })
          });
        }

        setSuccess('Textbaustein aktualisiert');
        handleCancelEdit();
        await fetchTemplates();
        // Event senden um andere Komponenten zu aktualisieren
        window.dispatchEvent(new CustomEvent('templates-changed'));
        setTimeout(() => setSuccess(''), 3000);
      }
    } catch {
      setError('Netzwerkfehler');
    }
  };

  const handleDelete = async (id: number, templateName: string, scope?: string) => {
    if (!confirm(`Textbaustein "${templateName}" wirklich löschen?`)) {
      return;
    }

    setError('');
    setSuccess('');

    try {
      const response = await fetch('/api/templates', {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': getAuthHeader(),
          ...getDbTokenHeader()
        },
        body: JSON.stringify({ id, scope })
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Fehler beim Löschen');
        return;
      }

      if (data.success) {
        setSuccess('Textbaustein gelöscht');
        await fetchTemplates();
        // Event senden um andere Komponenten zu aktualisieren
        window.dispatchEvent(new CustomEvent('templates-changed'));
        setTimeout(() => setSuccess(''), 3000);
      }
    } catch {
      setError('Netzwerkfehler');
    }
  };

  const fieldLabels = {
    methodik: 'Methodik',
    befund: 'Befund',
    beurteilung: 'Beurteilung'
  };

  if (loading) {
    return <div className="text-center py-4">Lade Textbausteine...</div>;
  }

  return (
    <div id="templates-manager-root" className="flex flex-col flex-1 min-h-0 h-full">
      {/* Add form – nur im 'create'-Modus */}
      {mode === 'create' && (
        <form id="tm-create-form" onSubmit={handleAdd} className="flex flex-col flex-1 min-h-0 gap-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
          <h3 className="font-medium text-sm flex-shrink-0">Neuer Textbaustein</h3>
          <div id="tm-create-name-row" className="flex gap-2 flex-shrink-0">
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name (z.B. CCT, MRT Knie)"
              className="flex-1 px-3 py-1.5 text-sm border rounded dark:bg-gray-700 dark:border-gray-600"
              required
            />
            <select
              value={field}
              onChange={(e) => setField(e.target.value as any)}
              className="px-2 py-1.5 text-sm border rounded dark:bg-gray-700 dark:border-gray-600"
            >
              <option value="methodik">Methodik</option>
              <option value="befund">Befund</option>
              <option value="beurteilung">Beurteilung</option>
            </select>
            {apiFetch && (
              <FolderSelect
                value={folderId}
                onChange={setFolderId}
                apiFetch={apiFetch}
              />
            )}
          </div>
          <TemplateRichTextEditor
            value={content}
            formats={contentFormats}
            onChange={(value, formats) => {
              setContent(value);
              setContentFormats(formats);
            }}
            placeholder="Textbaustein-Inhalt..."
            className="w-full px-3 py-2 text-sm border rounded dark:bg-gray-700 dark:border-gray-600 bg-white h-full min-h-0"
            disabled={adding}
          />
          {userGroups.length > 0 && (
            <div className="flex flex-col gap-1.5 flex-shrink-0">
              <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Mit Gruppe teilen:</span>
              <span className="text-[10px] text-gray-400 dark:text-gray-500 -mt-1">Andere Benutzer können eine Kopie dieses Bausteins anlegen.</span>
              <div className="flex flex-wrap gap-2">
                {userGroups.map((g) => {
                  const checked = selectedGroupIds.has(g.id);
                  return (
                    <label
                      key={g.id}
                      className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded cursor-pointer transition-colors ${
                        checked
                          ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700'
                          : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const next = new Set(selectedGroupIds);
                          if (next.has(g.id)) next.delete(g.id); else next.add(g.id);
                          setSelectedGroupIds(next);
                        }}
                        className="sr-only"
                      />
                      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="flex-shrink-0">
                        <path d="M20 6 9 17l-5-5"/>
                      </svg>
                      <span>{g.name}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
          <button
            type="submit"
            disabled={adding || !name.trim() || !content.trim()}
            className="w-full px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 flex-shrink-0"
          >
            {adding ? 'Speichere...' : '+ Textbaustein hinzufügen'}
          </button>
        </form>
      )}

      {error && (
        <div id="tm-error" className="p-2 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded flex-shrink-0">
          {error}
        </div>
      )}

      {success && (
        <div id="tm-success" className="p-2 text-sm text-green-600 bg-green-50 dark:bg-green-900/20 rounded flex-shrink-0">
          {success}
        </div>
      )}

      {/* Templates list – nur im 'manage'-Modus */}
      {mode === 'manage' && (
        <div id="tm-manage-root" className="flex flex-col flex-1 min-h-0">
          <h3 className="font-medium text-sm text-gray-600 dark:text-gray-400 flex-shrink-0">
            Meine Textbausteine ({templates.length})
          </h3>
        
        {templates.length === 0 ? (
          <p className="text-sm text-gray-500 italic">Noch keine Textbausteine vorhanden</p>
        ) : editingId !== null ? (
          /* Nur den gerade editierten Baustein anzeigen, vollflächig */
          <div id="tm-edit-container" className="flex flex-col flex-1 min-h-0">
            {templates.filter(t => t.id === editingId).map(template => (
              <div key={template.id} className="flex flex-col flex-1 min-h-0 p-3 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg">
                <div id="tm-edit-form-body" className="flex flex-col flex-1 min-h-0 gap-2">
                  <div id="tm-edit-name-row" className="flex gap-2 flex-shrink-0">
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      className="flex-1 px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600"
                    />
                    <select
                      value={editField}
                      onChange={(e) => setEditField(e.target.value as any)}
                      className="px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600"
                    >
                      <option value="methodik">Methodik</option>
                      <option value="befund">Befund</option>
                      <option value="beurteilung">Beurteilung</option>
                    </select>
                    {apiFetch && (
                      <FolderSelect
                        value={editFolderId}
                        onChange={setEditFolderId}
                        apiFetch={apiFetch}
                      />
                    )}
                  </div>
                  <TemplateRichTextEditor
                    value={editContent}
                    formats={editContentFormats}
                    onChange={(value, formats) => {
                      setEditContent(value);
                      setEditContentFormats(formats);
                    }}
                    className="w-full px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600 bg-white h-full min-h-0"
                  />
                  {template.scope === 'group' ? (
                    <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-2 py-1 rounded flex-shrink-0">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/></svg>
                      <span>Abteilungs-Baustein – Änderung gilt für alle Gruppenmitglieder</span>
                    </div>
                  ) : userGroups.length > 0 ? (
                    <div className="flex flex-col gap-1.5 flex-shrink-0">
                      <span className="text-xs text-gray-500 dark:text-gray-400 font-medium">Mit Gruppe teilen:</span>
                      <span className="text-[10px] text-gray-400 dark:text-gray-500 -mt-1">Andere Benutzer können eine Kopie dieses Bausteins anlegen.</span>
                      <div className="flex flex-wrap gap-2">
                        {userGroups.map((g) => {
                          const checked = editSelectedGroupIds.has(g.id);
                          return (
                            <label
                              key={g.id}
                              className={`flex items-center gap-1.5 px-2 py-1 text-xs rounded cursor-pointer transition-colors ${
                                checked
                                  ? 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700'
                                  : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-400 border border-gray-200 dark:border-gray-600 hover:bg-gray-200 dark:hover:bg-gray-600'
                              }`}
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => {
                                  const next = new Set(editSelectedGroupIds);
                                  if (next.has(g.id)) next.delete(g.id); else next.add(g.id);
                                  setEditSelectedGroupIds(next);
                                }}
                                className="sr-only"
                              />
                              <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" className="flex-shrink-0">
                                <path d="M20 6 9 17l-5-5"/>
                              </svg>
                              <span>{g.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ) : null}
                  <div id="tm-edit-actions" className="flex gap-2 flex-shrink-0">
                    <button
                      onClick={handleSaveEdit}
                      className="px-3 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600"
                    >
                      Speichern
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      className="px-3 py-1 text-xs bg-gray-300 dark:bg-gray-600 rounded hover:bg-gray-400"
                    >
                      Abbrechen
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-2 flex-1 min-h-0 overflow-y-auto">
            {templates.map((template) => (
              <div
                key={template.id}
                className="p-3 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{template.name}</span>
                      <span className="text-xs px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
                        {fieldLabels[template.field]}
                      </span>
                      {template.scope === 'group' && (
                        <span className="text-xs px-1.5 py-0.5 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 rounded" title={template.groupName ? `Gruppe: ${template.groupName}` : 'Abteilungs-Baustein'}>
                          {template.groupName || 'Geteilt'}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                      <BracketHighlight text={template.content} />
                    </p>
                  </div>
                  <div className="flex gap-1">
                    <button
                      onClick={() => handleEdit(template)}
                      className="p-1 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded"
                      title="Bearbeiten"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>
                      </svg>
                    </button>
                    <button
                      onClick={() => handleDelete(template.id, template.name, template.scope)}
                      className="p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
                      title="Löschen"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 6h18"/>
                        <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/>
                        <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/>
                      </svg>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      )}

    </div>
  );
}
