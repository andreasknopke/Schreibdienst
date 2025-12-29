"use client";
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthProvider';
import Spinner from './Spinner';

interface CustomAction {
  id: number;
  name: string;
  icon: string;
  prompt: string;
  targetField: 'current' | 'methodik' | 'befund' | 'beurteilung' | 'all';
}

// Emoji-Auswahl für Buttons
const EMOJI_OPTIONS = ['⚡', '🔍', '📝', '✨', '🎯', '💡', '🔬', '📊', '🏥', '💊', '🩺', '📋', '✅', '⚠️', '🔄', '📌'];

interface CustomActionsManagerProps {
  onClose: () => void;
}

export default function CustomActionsManager({ onClose }: CustomActionsManagerProps) {
  const { getAuthHeader, getDbTokenHeader } = useAuth();
  const [actions, setActions] = useState<CustomAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Edit state
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editName, setEditName] = useState('');
  const [editIcon, setEditIcon] = useState('⚡');
  const [editPrompt, setEditPrompt] = useState('');
  const [editTargetField, setEditTargetField] = useState<CustomAction['targetField']>('current');
  
  // New action state
  const [showNewForm, setShowNewForm] = useState(false);
  const [newName, setNewName] = useState('');
  const [newIcon, setNewIcon] = useState('⚡');
  const [newPrompt, setNewPrompt] = useState('');
  const [newTargetField, setNewTargetField] = useState<CustomAction['targetField']>('current');
  
  const [showEmojiPicker, setShowEmojiPicker] = useState<'new' | 'edit' | null>(null);

  const fetchActions = useCallback(async () => {
    try {
      setLoading(true);
      const response = await fetch('/api/custom-actions', {
        headers: {
          'Authorization': getAuthHeader(),
          ...getDbTokenHeader()
        }
      });
      
      if (!response.ok) {
        throw new Error('Fehler beim Laden der Aktionen');
      }
      
      const data = await response.json();
      setActions(data.actions || []);
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [getAuthHeader, getDbTokenHeader]);

  useEffect(() => {
    fetchActions();
  }, [fetchActions]);

  const handleAdd = async () => {
    if (!newName.trim() || !newPrompt.trim()) {
      setError('Name und Prompt sind erforderlich');
      return;
    }
    
    setSaving(true);
    setError(null);
    
    try {
      const response = await fetch('/api/custom-actions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': getAuthHeader(),
          ...getDbTokenHeader()
        },
        body: JSON.stringify({
          name: newName.trim(),
          icon: newIcon,
          prompt: newPrompt.trim(),
          targetField: newTargetField
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Fehler beim Speichern');
      }
      
      setNewName('');
      setNewIcon('⚡');
      setNewPrompt('');
      setNewTargetField('current');
      setShowNewForm(false);
      await fetchActions();
      
      // Notify other components
      window.dispatchEvent(new CustomEvent('custom-actions-changed'));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleUpdate = async () => {
    if (!editingId || !editName.trim() || !editPrompt.trim()) {
      setError('Name und Prompt sind erforderlich');
      return;
    }
    
    setSaving(true);
    setError(null);
    
    try {
      const response = await fetch('/api/custom-actions', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': getAuthHeader(),
          ...getDbTokenHeader()
        },
        body: JSON.stringify({
          id: editingId,
          name: editName.trim(),
          icon: editIcon,
          prompt: editPrompt.trim(),
          targetField: editTargetField
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Fehler beim Aktualisieren');
      }
      
      setEditingId(null);
      await fetchActions();
      
      // Notify other components
      window.dispatchEvent(new CustomEvent('custom-actions-changed'));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: number) => {
    if (!confirm('Diese Aktion wirklich löschen?')) return;
    
    setSaving(true);
    setError(null);
    
    try {
      const response = await fetch(`/api/custom-actions?id=${id}`, {
        method: 'DELETE',
        headers: {
          'Authorization': getAuthHeader(),
          ...getDbTokenHeader()
        }
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Fehler beim Löschen');
      }
      
      await fetchActions();
      
      // Notify other components
      window.dispatchEvent(new CustomEvent('custom-actions-changed'));
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (action: CustomAction) => {
    setEditingId(action.id);
    setEditName(action.name);
    setEditIcon(action.icon);
    setEditPrompt(action.prompt);
    setEditTargetField(action.targetField);
    setShowNewForm(false);
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
    setEditIcon('⚡');
    setEditPrompt('');
    setEditTargetField('current');
  };

  const getTargetFieldLabel = (field: CustomAction['targetField']) => {
    switch (field) {
      case 'current': return 'Aktives Feld';
      case 'methodik': return 'Methodik';
      case 'befund': return 'Befund';
      case 'beurteilung': return 'Beurteilung';
      case 'all': return 'Alle Felder';
      default: return field;
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
          <h2 className="text-lg font-semibold">⚡ Aktions-Buttons verwalten</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-xl">
            ✕
          </button>
        </div>
        
        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4 space-y-4">
          {error && (
            <div className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 p-3 rounded-lg text-sm">
              {error}
            </div>
          )}
          
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Spinner size={24} />
            </div>
          ) : (
            <>
              {/* Existing Actions */}
              {actions.length > 0 && (
                <div className="space-y-3">
                  <h3 className="text-sm font-medium text-gray-600 dark:text-gray-400">Vorhandene Aktionen</h3>
                  {actions.map(action => (
                    <div key={action.id} className="border dark:border-gray-700 rounded-lg p-3">
                      {editingId === action.id ? (
                        // Edit form
                        <div className="space-y-3">
                          <div className="flex gap-2">
                            <div className="relative">
                              <button
                                type="button"
                                onClick={() => setShowEmojiPicker(showEmojiPicker === 'edit' ? null : 'edit')}
                                className="w-10 h-10 text-xl border dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                              >
                                {editIcon}
                              </button>
                              {showEmojiPicker === 'edit' && (
                                <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border dark:border-gray-600 rounded-lg p-2 shadow-lg z-10 grid grid-cols-8 gap-1">
                                  {EMOJI_OPTIONS.map(emoji => (
                                    <button
                                      key={emoji}
                                      onClick={() => { setEditIcon(emoji); setShowEmojiPicker(null); }}
                                      className="w-8 h-8 text-lg hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                                    >
                                      {emoji}
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                            <input
                              type="text"
                              value={editName}
                              onChange={e => setEditName(e.target.value)}
                              placeholder="Name"
                              className="flex-1 input input-sm"
                            />
                            <select
                              value={editTargetField}
                              onChange={e => setEditTargetField(e.target.value as CustomAction['targetField'])}
                              className="input input-sm w-32"
                            >
                              <option value="current">Aktives Feld</option>
                              <option value="methodik">Methodik</option>
                              <option value="befund">Befund</option>
                              <option value="beurteilung">Beurteilung</option>
                              <option value="all">Alle Felder</option>
                            </select>
                          </div>
                          <textarea
                            value={editPrompt}
                            onChange={e => setEditPrompt(e.target.value)}
                            placeholder="Prompt / Anweisung an das LLM..."
                            className="textarea text-sm w-full"
                            rows={3}
                          />
                          <div className="flex justify-end gap-2">
                            <button onClick={cancelEdit} className="btn btn-sm btn-ghost">
                              Abbrechen
                            </button>
                            <button onClick={handleUpdate} disabled={saving} className="btn btn-sm btn-primary">
                              {saving ? <Spinner size={14} /> : 'Speichern'}
                            </button>
                          </div>
                        </div>
                      ) : (
                        // Display
                        <div className="flex items-start gap-3">
                          <span className="text-xl">{action.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{action.name}</span>
                              <span className="text-xs px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 rounded">
                                {getTargetFieldLabel(action.targetField)}
                              </span>
                            </div>
                            <p className="text-sm text-gray-500 dark:text-gray-400 truncate mt-0.5">
                              {action.prompt}
                            </p>
                          </div>
                          <div className="flex gap-1">
                            <button
                              onClick={() => startEdit(action)}
                              className="btn btn-sm btn-ghost"
                              title="Bearbeiten"
                            >
                              ✏️
                            </button>
                            <button
                              onClick={() => handleDelete(action.id)}
                              className="btn btn-sm btn-ghost text-red-500"
                              title="Löschen"
                              disabled={saving}
                            >
                              🗑️
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              
              {/* New Action Form */}
              {showNewForm ? (
                <div className="border-2 border-dashed border-blue-300 dark:border-blue-700 rounded-lg p-4 space-y-3">
                  <h3 className="text-sm font-medium text-blue-600 dark:text-blue-400">Neue Aktion erstellen</h3>
                  <div className="flex gap-2">
                    <div className="relative">
                      <button
                        type="button"
                        onClick={() => setShowEmojiPicker(showEmojiPicker === 'new' ? null : 'new')}
                        className="w-10 h-10 text-xl border dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800"
                      >
                        {newIcon}
                      </button>
                      {showEmojiPicker === 'new' && (
                        <div className="absolute top-full left-0 mt-1 bg-white dark:bg-gray-800 border dark:border-gray-600 rounded-lg p-2 shadow-lg z-10 grid grid-cols-8 gap-1">
                          {EMOJI_OPTIONS.map(emoji => (
                            <button
                              key={emoji}
                              onClick={() => { setNewIcon(emoji); setShowEmojiPicker(null); }}
                              className="w-8 h-8 text-lg hover:bg-gray-100 dark:hover:bg-gray-700 rounded"
                            >
                              {emoji}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    <input
                      type="text"
                      value={newName}
                      onChange={e => setNewName(e.target.value)}
                      placeholder="Name (z.B. 'Schizas finden')"
                      className="flex-1 input input-sm"
                    />
                    <select
                      value={newTargetField}
                      onChange={e => setNewTargetField(e.target.value as CustomAction['targetField'])}
                      className="input input-sm w-32"
                    >
                      <option value="current">Aktives Feld</option>
                      <option value="methodik">Methodik</option>
                      <option value="befund">Befund</option>
                      <option value="beurteilung">Beurteilung</option>
                      <option value="all">Alle Felder</option>
                    </select>
                  </div>
                  <textarea
                    value={newPrompt}
                    onChange={e => setNewPrompt(e.target.value)}
                    placeholder="Prompt / Anweisung an das LLM...&#10;&#10;Beispiele:&#10;- Suche nach Klassifikationen wie Schizas, Modic, Pfirrmann und gib Details dazu aus&#10;- Formuliere den Text kürzer und prägnanter&#10;- Finde und korrigiere medizinische Fachbegriffe"
                    className="textarea text-sm w-full"
                    rows={4}
                  />
                  <div className="flex justify-end gap-2">
                    <button onClick={() => { setShowNewForm(false); setNewName(''); setNewIcon('⚡'); setNewPrompt(''); }} className="btn btn-sm btn-ghost">
                      Abbrechen
                    </button>
                    <button onClick={handleAdd} disabled={saving || !newName.trim() || !newPrompt.trim()} className="btn btn-sm btn-primary">
                      {saving ? <Spinner size={14} /> : 'Hinzufügen'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => { setShowNewForm(true); cancelEdit(); }}
                  className="w-full border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-4 text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 hover:border-gray-400 dark:hover:border-gray-500 transition-colors"
                >
                  + Neue Aktion erstellen
                </button>
              )}
              
              {/* Info Box */}
              <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-sm">
                <p className="font-medium text-blue-700 dark:text-blue-300 mb-1">💡 Tipps für Prompts:</p>
                <ul className="text-blue-600 dark:text-blue-400 space-y-1 text-xs">
                  <li>• <strong>Klassifikationen:</strong> "Suche nach Klassifikationen (Schizas, Modic, Pfirrmann) und erkläre sie"</li>
                  <li>• <strong>Kürzen:</strong> "Fasse den Text kürzer zusammen, behalte alle wichtigen Informationen"</li>
                  <li>• <strong>Erweitern:</strong> "Ergänze den Text mit typischen Formulierungen für diesen Befundtyp"</li>
                  <li>• <strong>Analyse:</strong> "Liste alle genannten anatomischen Strukturen auf"</li>
                </ul>
              </div>
            </>
          )}
        </div>
        
        {/* Footer */}
        <div className="border-t dark:border-gray-700 p-4 flex justify-end">
          <button onClick={onClose} className="btn btn-primary">
            Fertig
          </button>
        </div>
      </div>
    </div>
  );
}
