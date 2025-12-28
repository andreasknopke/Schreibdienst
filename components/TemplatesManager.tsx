"use client";
import { useState, useEffect } from 'react';
import { useAuth } from './AuthProvider';

interface Template {
  id: number;
  name: string;
  content: string;
  field: 'methodik' | 'befund' | 'beurteilung';
  createdAt: string;
  updatedAt: string;
}

export default function TemplatesManager() {
  const { getAuthHeader, getDbTokenHeader } = useAuth();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  
  // Form state
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [field, setField] = useState<'methodik' | 'befund' | 'beurteilung'>('befund');
  const [adding, setAdding] = useState(false);
  
  // Edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editContent, setEditContent] = useState('');
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
  }, []);

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
        body: JSON.stringify({ name, content, field })
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
        setField('befund');
        await fetchTemplates();
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
    setEditName(template.name);
    setEditContent(template.content);
    setEditField(template.field);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditContent('');
    setEditField('befund');
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    
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
          field: editField 
        })
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Fehler beim Speichern');
        return;
      }

      if (data.success) {
        setSuccess('Textbaustein aktualisiert');
        handleCancelEdit();
        await fetchTemplates();
        setTimeout(() => setSuccess(''), 3000);
      }
    } catch {
      setError('Netzwerkfehler');
    }
  };

  const handleDelete = async (id: number, templateName: string) => {
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
        body: JSON.stringify({ id })
      });

      const data = await response.json();

      if (!response.ok) {
        setError(data.error || 'Fehler beim Löschen');
        return;
      }

      if (data.success) {
        setSuccess('Textbaustein gelöscht');
        await fetchTemplates();
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
    <div className="space-y-4">
      {/* Add form */}
      <form onSubmit={handleAdd} className="space-y-3 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <h3 className="font-medium text-sm">Neuer Textbaustein</h3>
        <div className="flex gap-2">
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
        </div>
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Textbaustein-Inhalt..."
          className="w-full px-3 py-2 text-sm border rounded dark:bg-gray-700 dark:border-gray-600 min-h-[100px]"
          required
        />
        <button
          type="submit"
          disabled={adding || !name.trim() || !content.trim()}
          className="w-full px-3 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
        >
          {adding ? 'Speichere...' : '+ Textbaustein hinzufügen'}
        </button>
      </form>

      {error && (
        <div className="p-2 text-sm text-red-600 bg-red-50 dark:bg-red-900/20 rounded">
          {error}
        </div>
      )}

      {success && (
        <div className="p-2 text-sm text-green-600 bg-green-50 dark:bg-green-900/20 rounded">
          {success}
        </div>
      )}

      {/* Templates list */}
      <div className="space-y-2">
        <h3 className="font-medium text-sm text-gray-600 dark:text-gray-400">
          Meine Textbausteine ({templates.length})
        </h3>
        
        {templates.length === 0 ? (
          <p className="text-sm text-gray-500 italic">Noch keine Textbausteine vorhanden</p>
        ) : (
          <div className="space-y-2 max-h-[400px] overflow-y-auto">
            {templates.map((template) => (
              <div
                key={template.id}
                className="p-3 bg-white dark:bg-gray-800 border dark:border-gray-700 rounded-lg"
              >
                {editingId === template.id ? (
                  // Edit mode
                  <div className="space-y-2">
                    <div className="flex gap-2">
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
                    </div>
                    <textarea
                      value={editContent}
                      onChange={(e) => setEditContent(e.target.value)}
                      className="w-full px-2 py-1 text-sm border rounded dark:bg-gray-700 dark:border-gray-600 min-h-[80px]"
                    />
                    <div className="flex gap-2">
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
                ) : (
                  // View mode
                  <>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{template.name}</span>
                          <span className="text-xs px-1.5 py-0.5 bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 rounded">
                            {fieldLabels[template.field]}
                          </span>
                        </div>
                        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 line-clamp-2">
                          {template.content}
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
                          onClick={() => handleDelete(template.id, template.name)}
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
                  </>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
