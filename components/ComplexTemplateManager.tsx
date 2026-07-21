'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import Spinner from '@/components/Spinner';

interface ComplexTemplate {
  id: number;
  name: string;
  field: string;
  templateIds: number[];
  templateNames: { id: number; name: string }[];
}

interface AvailableTemplate {
  id: number;
  name: string;
  content: string;
  field: string;
}

interface ComplexTemplateManagerProps {
  open: boolean;
  onClose: () => void;
  availableTemplates: AvailableTemplate[];
  currentField: string;
  onChanged: () => void;
  onLoadComplex: (templateIds: number[]) => void;
  /** Custom fetch function that includes auth headers */
  apiFetch: (url: string, options?: RequestInit) => Promise<Response>;
  /** Beim Öffnen direkt in den Erstellen-Modus springen */
  defaultCreateMode?: boolean;
  /** Wird aufgerufen nachdem defaultCreateMode verarbeitet wurde */
  editComplexId?: number | null;
  onEditComplexConsumed?: () => void;
}

export default function ComplexTemplateManager({
  open,
  onClose,
  availableTemplates,
  currentField,
  onChanged,
  onLoadComplex,
  apiFetch,
  defaultCreateMode = false,
  onDefaultCreateConsumed,
  editComplexId,
  onEditComplexConsumed,
}: ComplexTemplateManagerProps) {
  const [complexTemplates, setComplexTemplates] = useState<ComplexTemplate[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editMode, setEditMode] = useState<'list' | 'edit'>('list');
  const [editId, setEditId] = useState<number | null>(null);
  const [name, setName] = useState('');
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [error, setError] = useState<string | null>(null);
  const createHandledRef = useRef(false);
  const editHandledRef = useRef(false);

  const fetchComplexTemplates = useCallback(async () => {
    setLoading(true);
    try {
      const res = await apiFetch('/api/templates/complex');
      const data = await res.json();
      if (data.success) {
        setComplexTemplates(data.complexTemplates || []);
      }
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, []);

  const handleEdit = useCallback((ct: ComplexTemplate) => {
    setEditMode('edit');
    setEditId(ct.id);
    setName(ct.name);
    setSelectedIds(ct.templateIds);
    setError(null);
  }, []);

  const handleNew = useCallback(() => {
    setEditMode('edit');
    setEditId(null);
    setName('');
    setSelectedIds([]);
    setError(null);
  }, []);

  useEffect(() => {
    if (!open) {
      createHandledRef.current = false;
      editHandledRef.current = false;
      return;
    }
    fetchComplexTemplates();
    if (defaultCreateMode && !createHandledRef.current) {
      createHandledRef.current = true;
      handleNew();
      onDefaultCreateConsumed?.();
    } else if (!defaultCreateMode) {
      setEditMode('list');
      setEditId(null);
      setName('');
      setSelectedIds([]);
      setError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Wird ausgelöst nachdem Templates geladen sind und editComplexId gesetzt ist
  useEffect(() => {
    if (!open || !editComplexId || editHandledRef.current || complexTemplates.length === 0) return;
    const ct = complexTemplates.find((t) => t.id === editComplexId);
    if (ct) {
      editHandledRef.current = true;
      handleEdit(ct);
      onEditComplexConsumed?.();
    }
  }, [open, editComplexId, complexTemplates]);

  const handleDelete = useCallback(async (id: number) => {
    if (!window.confirm('Wirklich löschen?')) return;
    try {
      const res = await apiFetch('/api/templates/complex', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (data.success) {
        await fetchComplexTemplates();
        onChanged();
      }
    } catch {
      setError('Fehler beim Löschen');
    }
  }, [fetchComplexTemplates, onChanged]);

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      setError('Name erforderlich');
      return;
    }
    if (selectedIds.length === 0) {
      setError('Mindestens ein Baustein auswählen');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const ids = selectedIds;
      let res;
      if (editId) {
        res = await apiFetch('/api/templates/complex', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editId, name: name.trim(), field: currentField, templateIds: ids }),
        });
      } else {
        res = await apiFetch('/api/templates/complex', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: name.trim(), field: currentField, templateIds: ids }),
        });
      }
      const data = await res.json();
      if (data.success) {
        await fetchComplexTemplates();
        setEditMode('list');
        onChanged();
      } else {
        setError(data.error || 'Fehler beim Speichern');
      }
    } catch {
      setError('Fehler beim Speichern');
    } finally {
      setSaving(false);
    }
  }, [name, selectedIds, editId, currentField, fetchComplexTemplates, onChanged]);

  const handleLoad = useCallback((ct: ComplexTemplate) => {
    if (ct.templateIds.length === 0) {
      setError('Komplexbaustein enthält keine Bausteine');
      return;
    }
    onLoadComplex(ct.templateIds);
    onClose();
  }, [onLoadComplex, onClose]);

  const toggleTemplate = useCallback((id: number) => {
    setSelectedIds((prev) => {
      const idx = prev.indexOf(id);
      if (idx >= 0) {
        return prev.filter((i) => i !== id);
      }
      return [...prev, id];
    });
  }, []);

  const moveSelectedUp = useCallback((index: number) => {
    if (index <= 0) return;
    setSelectedIds((prev) => {
      const next = [...prev];
      [next[index - 1], next[index]] = [next[index], next[index - 1]];
      return next;
    });
  }, []);

  const moveSelectedDown = useCallback((index: number) => {
    setSelectedIds((prev) => {
      if (index >= prev.length - 1) return prev;
      const next = [...prev];
      [next[index], next[index + 1]] = [next[index + 1], next[index]];
      return next;
    });
  }, []);

  const filteredTemplates = availableTemplates.filter((t) => t.field === currentField);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-black/40 px-4" onClick={onClose}>
      <div
        className="w-full max-w-lg rounded-xl border border-gray-200 bg-white shadow-2xl dark:border-gray-700 dark:bg-gray-900 max-h-[75vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 dark:border-gray-700 shrink-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            {editMode === 'list' ? 'Komplexbausteine' : editId ? 'Komplexbaustein bearbeiten' : 'Neuen Komplexbaustein definieren'}
          </h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-lg leading-none">✕</button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
          {error && (
            <div className="text-xs text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded">
              {error}
            </div>
          )}

          {editMode === 'list' && (
            <>
              {loading ? (
                <div className="flex justify-center py-8"><Spinner size={20} /></div>
              ) : complexTemplates.length === 0 ? (
                <p className="text-xs text-gray-400 dark:text-gray-500 text-center py-8">
                  Noch keine Komplexbausteine definiert.
                </p>
              ) : (
                <div className="divide-y divide-gray-100 dark:divide-gray-800">
                  {complexTemplates.map((ct) => (
                    <div key={ct.id} className="py-2.5 flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">
                          {ct.name}
                        </div>
                        <div className="text-[10px] text-gray-400 dark:text-gray-500 mt-0.5">
                          {ct.templateNames.map((tn) => tn.name).join(', ') || `${ct.templateIds.length} Bausteine`}
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => handleLoad(ct)}
                          className="px-2 py-1 text-[11px] bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                          title="Komplexbaustein laden"
                        >
                          Laden
                        </button>
                        <button
                          onClick={() => handleEdit(ct)}
                          className="px-2 py-1 text-[11px] border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                          title="Bearbeiten"
                        >
                          ✏️
                        </button>
                        <button
                          onClick={() => handleDelete(ct.id)}
                          className="px-2 py-1 text-[11px] text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors"
                          title="Löschen"
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button
                onClick={handleNew}
                className="w-full py-2 text-xs font-medium text-blue-600 dark:text-blue-400 border border-dashed border-blue-300 dark:border-blue-700 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
              >
                + Neuen Komplexbaustein definieren
              </button>
            </>
          )}

          {editMode === 'edit' && (
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-1">Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="input w-full text-sm"
                  placeholder="z.B. Kompletter Fuss-Befund"
                  autoFocus
                />
              </div>
              <div>
                <label className="text-xs font-medium text-gray-700 dark:text-gray-300 block mb-1">
                  Ausgewählte Bausteine ({selectedIds.length}) — Reihenfolge per ▲▼ anpassen
                </label>
                {/* Sortierbare Liste der ausgewählten Bausteine */}
                {selectedIds.length > 0 ? (
                  <div className="border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-800 mb-2">
                    {selectedIds.map((id, index) => {
                      const tpl = filteredTemplates.find((t) => t.id === id);
                      return (
                        <div
                          key={id}
                          className="flex items-center gap-1 px-2 py-1.5 text-xs"
                        >
                          <span className="text-gray-400 dark:text-gray-500 w-4 shrink-0">{index + 1}.</span>
                          <span className="flex-1 truncate text-gray-800 dark:text-gray-200">
                            {tpl?.name || '(unbekannt)'}
                          </span>
                          <div className="flex items-center gap-0.5 shrink-0">
                            <button
                              onClick={() => moveSelectedUp(index)}
                              disabled={index === 0}
                              className="px-1 py-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                              title="Nach oben"
                            >▲</button>
                            <button
                              onClick={() => moveSelectedDown(index)}
                              disabled={index === selectedIds.length - 1}
                              className="px-1 py-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 disabled:opacity-30 disabled:pointer-events-none transition-colors"
                              title="Nach unten"
                            >▼</button>
                            <button
                              onClick={() => toggleTemplate(id)}
                              className="ml-1 px-1 py-0.5 text-red-400 hover:text-red-600 transition-colors"
                              title="Entfernen"
                            >✕</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  <div className="px-3 py-3 text-xs text-gray-400 text-center border border-dashed border-gray-300 dark:border-gray-700 rounded-lg mb-2">
                    Noch keine Bausteine ausgewählt.
                  </div>
                )}

                {/* Verfügbare Bausteine zum Hinzufügen */}
                <label className="text-xs font-medium text-gray-500 dark:text-gray-400 block mb-1">
                  Verfügbare Bausteine (anklicken zum Hinzufügen)
                </label>
                <div className="max-h-36 overflow-y-auto border border-gray-200 dark:border-gray-700 rounded-lg divide-y divide-gray-100 dark:divide-gray-800">
                  {filteredTemplates.length === 0 ? (
                    <div className="px-3 py-4 text-xs text-gray-400 text-center">
                      Keine Bausteine für dieses Feld vorhanden.
                    </div>
                  ) : (
                    filteredTemplates
                      .filter((t) => !selectedIds.includes(t.id))
                      .map((t) => (
                        <label
                          key={t.id}
                          className="flex items-center gap-2 px-3 py-2 hover:bg-blue-50 dark:hover:bg-blue-900/20 cursor-pointer text-xs transition-colors"
                        >
                          <input
                            type="checkbox"
                            checked={false}
                            onChange={() => toggleTemplate(t.id)}
                            className="accent-blue-600"
                          />
                          <span className="text-gray-800 dark:text-gray-200 truncate">{t.name}</span>
                        </label>
                      ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        {editMode === 'edit' && (
          <div className="flex items-center justify-between gap-2 px-4 py-3 border-t border-gray-200 dark:border-gray-700 shrink-0">
            <button
              onClick={() => { setEditMode('list'); setError(null); }}
              className="px-3 py-1.5 text-xs border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-200 rounded hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
            >
              Abbrechen
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="px-4 py-1.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-1.5"
            >
              {saving && <Spinner size={12} />}
              {editId ? 'Speichern' : 'Anlegen'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
