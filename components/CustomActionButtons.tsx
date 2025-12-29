"use client";
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthProvider';
import Spinner from './Spinner';

// Identifier für PowerShell Clipboard-Listener (RadCentre Integration)
const CLIPBOARD_IDENTIFIER = '##RAD##';

interface CustomAction {
  id: number;
  name: string;
  icon: string;
  prompt: string;
  targetField: 'current' | 'methodik' | 'befund' | 'beurteilung' | 'all';
}

interface CustomActionButtonsProps {
  currentField: 'methodik' | 'befund' | 'beurteilung' | 'transcript';
  getText: () => string;
  getAllTexts?: () => { methodik: string; befund: string; beurteilung: string };
  onResult: (result: string, isAppend?: boolean) => void;
  disabled?: boolean;
  onManageClick: () => void;
}

export default function CustomActionButtons({
  currentField,
  getText,
  getAllTexts,
  onResult,
  disabled,
  onManageClick
}: CustomActionButtonsProps) {
  const { getAuthHeader, getDbTokenHeader, username } = useAuth();
  const [actions, setActions] = useState<CustomAction[]>([]);
  const [loading, setLoading] = useState(true);
  const [executing, setExecuting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resultModal, setResultModal] = useState<{ action: CustomAction; result: string } | null>(null);

  const fetchActions = useCallback(async () => {
    if (!username) return;
    
    try {
      setLoading(true);
      const response = await fetch('/api/custom-actions', {
        headers: {
          'Authorization': getAuthHeader(),
          ...getDbTokenHeader()
        }
      });
      
      if (!response.ok) return;
      
      const data = await response.json();
      setActions(data.actions || []);
    } catch (err) {
      console.error('[CustomActionButtons] Fetch error:', err);
    } finally {
      setLoading(false);
    }
  }, [username, getAuthHeader, getDbTokenHeader]);

  useEffect(() => {
    fetchActions();
  }, [fetchActions]);

  // Listen for changes from the manager
  useEffect(() => {
    const handleChange = () => fetchActions();
    window.addEventListener('custom-actions-changed', handleChange);
    return () => window.removeEventListener('custom-actions-changed', handleChange);
  }, [fetchActions]);

  const executeAction = async (action: CustomAction) => {
    setExecuting(action.id);
    setError(null);
    
    try {
      let text = '';
      let fieldName = currentField;
      
      if (action.targetField === 'all' && getAllTexts) {
        const texts = getAllTexts();
        text = `Methodik:\n${texts.methodik}\n\nBefund:\n${texts.befund}\n\nBeurteilung:\n${texts.beurteilung}`;
        fieldName = 'all' as any;
      } else if (action.targetField !== 'current' && getAllTexts) {
        const texts = getAllTexts();
        text = texts[action.targetField as keyof typeof texts] || '';
        fieldName = action.targetField as any;
      } else {
        text = getText();
      }
      
      if (!text.trim()) {
        setError('Kein Text zum Verarbeiten vorhanden');
        return;
      }
      
      const response = await fetch('/api/custom-actions/execute', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': getAuthHeader(),
          ...getDbTokenHeader()
        },
        body: JSON.stringify({
          prompt: action.prompt,
          text,
          fieldName
        })
      });
      
      const data = await response.json();
      
      if (!response.ok) {
        throw new Error(data.error || 'Fehler bei der Ausführung');
      }
      
      // Show result in modal
      setResultModal({ action, result: data.result });
      
    } catch (err: any) {
      setError(err.message);
    } finally {
      setExecuting(null);
    }
  };

  const handleApplyResult = () => {
    if (resultModal) {
      onResult(resultModal.result);
      setResultModal(null);
    }
  };

  const handleCopyResult = () => {
    if (resultModal) {
      navigator.clipboard.writeText(CLIPBOARD_IDENTIFIER + resultModal.result);
    }
  };

  // Filter actions relevant to current field
  const relevantActions = actions.filter(action => {
    if (action.targetField === 'current' || action.targetField === 'all') return true;
    // Map 'transcript' to 'befund' for arztbrief mode
    const mappedField = currentField === 'transcript' ? 'befund' : currentField;
    return action.targetField === mappedField;
  });

  if (!username) return null;

  return (
    <>
      <div className="flex flex-col gap-1">
        {/* Action buttons */}
        {!loading && relevantActions.map(action => (
          <button
            key={action.id}
            onClick={() => executeAction(action)}
            disabled={disabled || executing !== null}
            className={`
              flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-lg
              border border-gray-200 dark:border-gray-700
              bg-white dark:bg-gray-800
              hover:bg-gray-50 dark:hover:bg-gray-700
              disabled:opacity-50 disabled:cursor-not-allowed
              transition-colors whitespace-nowrap
              ${executing === action.id ? 'ring-2 ring-blue-500' : ''}
            `}
            title={action.prompt}
          >
            {executing === action.id ? (
              <Spinner size={12} />
            ) : (
              <span>{action.icon}</span>
            )}
            <span className="truncate max-w-[80px]">{action.name}</span>
          </button>
        ))}
        
        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-2">
            <Spinner size={14} />
          </div>
        )}
        
        {/* Manage button */}
        <button
          onClick={onManageClick}
          className="flex items-center gap-1.5 px-2 py-1.5 text-xs rounded-lg
            border border-dashed border-gray-300 dark:border-gray-600
            text-gray-500 dark:text-gray-400
            hover:bg-gray-50 dark:hover:bg-gray-800
            hover:border-gray-400 dark:hover:border-gray-500
            transition-colors"
          title="Aktionen verwalten"
        >
          <span>⚙️</span>
          <span>{actions.length === 0 ? 'Aktionen' : ''}</span>
        </button>
        
        {/* Error display */}
        {error && (
          <div className="text-xs text-red-500 px-1 mt-1">
            {error}
          </div>
        )}
      </div>
      
      {/* Result Modal */}
      {resultModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between p-4 border-b dark:border-gray-700">
              <h3 className="font-semibold flex items-center gap-2">
                <span>{resultModal.action.icon}</span>
                <span>{resultModal.action.name}</span>
              </h3>
              <button
                onClick={() => setResultModal(null)}
                className="text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 text-xl"
              >
                ✕
              </button>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4">
              <pre className="whitespace-pre-wrap text-sm font-mono bg-gray-50 dark:bg-gray-800 p-4 rounded-lg">
                {resultModal.result}
              </pre>
            </div>
            
            <div className="border-t dark:border-gray-700 p-4 flex justify-end gap-2">
              <button onClick={handleCopyResult} className="btn btn-ghost">
                📋 Kopieren
              </button>
              <button onClick={() => setResultModal(null)} className="btn btn-ghost">
                Schließen
              </button>
              <button onClick={handleApplyResult} className="btn btn-primary">
                ✓ Übernehmen
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
