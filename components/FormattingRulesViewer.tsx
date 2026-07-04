"use client";
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthProvider';

interface FormattingRule {
  id: string;
  commands: string;
  replacement: string;
}

interface RuleCategory {
  category: string;
  icon: string;
  items: FormattingRule[];
}

export default function FormattingRulesViewer() {
  const { getAuthHeader, getDbTokenHeader } = useAuth();
  const [categories, setCategories] = useState<RuleCategory[]>([]);
  const [disabledIds, setDisabledIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [savingId, setSavingId] = useState<string | null>(null);

  const headers = useCallback(() => ({
    'Authorization': getAuthHeader(),
    ...getDbTokenHeader(),
    'Content-Type': 'application/json',
  }), [getAuthHeader, getDbTokenHeader]);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      fetch('/api/formattings').then(r => r.json()),
      fetch('/api/users/settings', { headers: { 'Authorization': getAuthHeader(), ...getDbTokenHeader() } }).then(r => r.json()),
    ])
      .then(([fmtData, settingsData]) => {
        setCategories(fmtData.rules || []);
        const d = settingsData.disabledFormattings;
        if (Array.isArray(d)) setDisabledIds(new Set(d));
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [getAuthHeader, getDbTokenHeader]);

  const toggleRule = useCallback(async (id: string) => {
    setSavingId(id);
    const wasDisabled = disabledIds.has(id);
    const next = new Set(disabledIds);
    if (wasDisabled) next.delete(id); else next.add(id);
    setDisabledIds(next);

    try {
      const res = await fetch('/api/users/settings', {
        method: 'PATCH',
        headers: headers(),
        body: JSON.stringify({ disabledFormattings: [...next] }),
      });
      if (!res.ok) {
        setDisabledIds(disabledIds); // rollback
      }
    } catch {
      setDisabledIds(disabledIds); // rollback
    } finally {
      setSavingId(null);
    }
  }, [disabledIds, headers]);

  if (loading) {
    return <div className="text-sm text-gray-500 dark:text-gray-400 p-4">Lade Formatierungsregeln…</div>;
  }

  if (error) {
    return <div className="text-sm text-red-500 p-4">Fehler: {error}</div>;
  }

  return (
    <div className="space-y-4">
      {categories.map((cat) => (
        <div key={cat.category}>
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-1.5 flex items-center gap-1.5">
            <span>{cat.icon}</span>
            <span>{cat.category}</span>
          </h3>
          <div className="space-y-0.5">
            {cat.items.map((item) => {
              const isDisabled = disabledIds.has(item.id);
              return (
                <div
                  key={item.id}
                  className={`flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-gray-50 dark:hover:bg-gray-800/40 ${isDisabled ? 'opacity-50' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={!isDisabled}
                    onChange={() => toggleRule(item.id)}
                    disabled={savingId === item.id}
                    className="rounded shrink-0"
                    title={isDisabled ? 'Regel aktivieren' : 'Regel deaktivieren'}
                  />
                  <code className={`font-medium shrink-0 ${isDisabled ? 'line-through' : 'text-gray-800 dark:text-gray-200'}`}>
                    {item.commands}
                  </code>
                  <span className="text-gray-400 dark:text-gray-500 mx-1">→</span>
                  <code className="text-green-700 dark:text-green-400 shrink-0 font-mono text-[11px]">
                    {item.replacement}
                  </code>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
