"use client";
import { useState, useEffect } from 'react';

interface FormattingRule {
  command: string;
  replacement: string;
  file: string;
}

interface RuleCategory {
  category: string;
  icon: string;
  items: FormattingRule[];
}

export default function FormattingRulesViewer() {
  const [categories, setCategories] = useState<RuleCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    setLoading(true);
    fetch('/api/formattings')
      .then((res) => {
        if (!res.ok) throw new Error('Fehler beim Laden');
        return res.json();
      })
      .then((data) => {
        setCategories(data.rules || []);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, []);

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
            {cat.items.map((item, i) => (
              <div
                key={i}
                className="flex items-baseline justify-between gap-3 rounded px-2 py-1 text-xs hover:bg-gray-50 dark:hover:bg-gray-800/40"
              >
                <code className="text-gray-800 dark:text-gray-200 font-medium shrink-0">
                  {item.command}
                </code>
                <span className="text-gray-400 dark:text-gray-500 mx-1">→</span>
                <code className="text-green-700 dark:text-green-400 shrink-0 font-mono text-[11px]">
                  {item.replacement}
                </code>
                <span className="text-[10px] text-gray-400 dark:text-gray-600 ml-auto shrink-0">
                  {item.file}
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
      <p className="text-[10px] text-gray-400 dark:text-gray-600 pt-2 border-t border-gray-100 dark:border-gray-800">
        Diese Regeln werden deterministisch in <code>lib/textFormatting.ts</code> verarbeitet – noch bevor der Text zum LLM geht.
      </p>
    </div>
  );
}
