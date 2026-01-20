"use client";
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from './AuthProvider';

interface RecoveryLog {
  id: number;
  timestamp: string;
  log_level: 'info' | 'warn' | 'error' | 'success';
  action: string;
  message: string;
  details?: string;
  error_context?: string;
  duration_ms?: number;
  success: boolean;
}

interface RecoveryStats {
  totalErrors: number;
  successfulRecoveries: number;
  failedRecoveries: number;
  actionBreakdown: { action: string; count: number }[];
}

interface WhisperXStatus {
  healthy: boolean;
  message: string;
  responseTime?: number;
  whisperUrl: string;
}

export default function WhisperXRecoveryLogs() {
  const { getDbTokenHeader } = useAuth();
  const [logs, setLogs] = useState<RecoveryLog[]>([]);
  const [stats, setStats] = useState<RecoveryStats | null>(null);
  const [status, setStatus] = useState<WhisperXStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);
  const [actionResult, setActionResult] = useState<{ success: boolean; message: string; steps?: string[] } | null>(null);
  const [filterLevel, setFilterLevel] = useState<string>('');
  const [autoRefresh, setAutoRefresh] = useState(true);

  // Logs und Status laden
  const fetchData = useCallback(async () => {
    try {
      const [logsRes, statusRes] = await Promise.all([
        fetch(`/api/whisperx-recovery-logs?limit=50${filterLevel ? `&level=${filterLevel}` : ''}`, {
          headers: { ...getDbTokenHeader() }
        }),
        fetch('/api/whisperx-system', {
          headers: { ...getDbTokenHeader() }
        })
      ]);
      
      if (logsRes.ok) {
        const logsData = await logsRes.json();
        setLogs(logsData.logs || []);
        setStats(logsData.stats || null);
      }
      
      if (statusRes.ok) {
        const statusData = await statusRes.json();
        setStatus(statusData);
      }
      
      setError('');
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [filterLevel, getDbTokenHeader]);

  useEffect(() => {
    fetchData();
    
    // Auto-Refresh alle 10 Sekunden wenn aktiviert
    let interval: NodeJS.Timeout;
    if (autoRefresh) {
      interval = setInterval(fetchData, 10000);
    }
    
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [fetchData, autoRefresh]);

  // System-Aktion ausführen
  const executeAction = async (action: string, label: string) => {
    setActionInProgress(action);
    setActionResult(null);
    
    try {
      const res = await fetch('/api/whisperx-system', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...getDbTokenHeader()
        },
        body: JSON.stringify({ action })
      });
      
      const data = await res.json();
      setActionResult({
        success: data.success,
        message: data.message || data.error || 'Unbekannter Fehler',
        steps: data.steps
      });
      
      // Logs neu laden
      await fetchData();
    } catch (err: any) {
      setActionResult({
        success: false,
        message: err.message
      });
    } finally {
      setActionInProgress(null);
    }
  };

  // Alte Logs löschen
  const clearOldLogs = async () => {
    if (!confirm('Logs älter als 30 Tage löschen?')) return;
    
    try {
      const res = await fetch('/api/whisperx-recovery-logs?daysToKeep=30', {
        method: 'DELETE',
        headers: { ...getDbTokenHeader() }
      });
      
      const data = await res.json();
      if (data.success) {
        setActionResult({
          success: true,
          message: data.message
        });
        await fetchData();
      }
    } catch (err: any) {
      setError(err.message);
    }
  };

  // Log-Level Badge
  const LevelBadge = ({ level }: { level: string }) => {
    const colors = {
      'info': 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
      'warn': 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200',
      'error': 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
      'success': 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
    };
    const icons = { 'info': 'ℹ️', 'warn': '⚠️', 'error': '❌', 'success': '✅' };
    
    return (
      <span className={`px-2 py-0.5 rounded text-xs font-medium ${colors[level as keyof typeof colors] || colors.info}`}>
        {icons[level as keyof typeof icons] || '•'} {level}
      </span>
    );
  };

  // Aktion Badge
  const ActionBadge = ({ action }: { action: string }) => {
    const labels: Record<string, string> = {
      'system_cleanup': '🧹 VRAM Cleanup',
      'system_kill_zombies': '💀 Zombie Kill',
      'system_reboot': '🔄 Server Restart',
      'health_check': '🩺 Health Check',
      'error_detected': '🚨 Fehler erkannt',
      'recovery_success': '✅ Recovery OK',
      'recovery_failed': '❌ Recovery Fehlgeschlagen'
    };
    
    return (
      <span className="text-xs text-gray-600 dark:text-gray-400">
        {labels[action] || action}
      </span>
    );
  };

  if (loading) {
    return (
      <div className="p-4 flex justify-center">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-blue-600"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <h4 className="font-medium text-sm flex items-center gap-2">
        <span>🔧</span>
        <span>WhisperX System & Recovery</span>
      </h4>
      
      {error && (
        <div className="text-sm text-red-600 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg">
          {error}
        </div>
      )}
      
      {/* Status */}
      <div className="p-3 bg-gray-50 dark:bg-gray-800 rounded-lg">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">WhisperX Status</span>
          <label className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={autoRefresh}
              onChange={(e) => setAutoRefresh(e.target.checked)}
              className="rounded"
            />
            Auto-Refresh
          </label>
        </div>
        
        {status && (
          <div className="flex items-center gap-3 text-sm">
            <span className={`w-3 h-3 rounded-full ${status.healthy ? 'bg-green-500' : 'bg-red-500'}`}></span>
            <span className={status.healthy ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}>
              {status.message}
            </span>
            <span className="text-xs text-gray-500">{status.whisperUrl}</span>
          </div>
        )}
      </div>
      
      {/* Statistiken */}
      {stats && (
        <div className="grid grid-cols-3 gap-2 text-center text-sm">
          <div className="p-2 bg-red-50 dark:bg-red-900/20 rounded">
            <div className="text-2xl font-bold text-red-600">{stats.totalErrors}</div>
            <div className="text-xs text-gray-500">Fehler (7 Tage)</div>
          </div>
          <div className="p-2 bg-green-50 dark:bg-green-900/20 rounded">
            <div className="text-2xl font-bold text-green-600">{stats.successfulRecoveries}</div>
            <div className="text-xs text-gray-500">Erfolgreiche Recoveries</div>
          </div>
          <div className="p-2 bg-orange-50 dark:bg-orange-900/20 rounded">
            <div className="text-2xl font-bold text-orange-600">{stats.failedRecoveries}</div>
            <div className="text-xs text-gray-500">Fehlgeschlagene</div>
          </div>
        </div>
      )}
      
      {/* Aktionen */}
      <div className="space-y-2">
        <div className="text-xs text-gray-500 font-medium">Manuelle Aktionen</div>
        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={() => executeAction('system_cleanup', 'VRAM Cleanup')}
            disabled={!!actionInProgress}
            className="btn btn-sm btn-outline flex items-center justify-center gap-1"
          >
            {actionInProgress === 'system_cleanup' ? '⏳' : '🧹'} VRAM Cleanup
          </button>
          <button
            onClick={() => executeAction('system_kill_zombies', 'Kill Zombies')}
            disabled={!!actionInProgress}
            className="btn btn-sm btn-outline flex items-center justify-center gap-1"
          >
            {actionInProgress === 'system_kill_zombies' ? '⏳' : '💀'} Kill Zombies
          </button>
          <button
            onClick={() => executeAction('health_check', 'Health Check')}
            disabled={!!actionInProgress}
            className="btn btn-sm btn-outline flex items-center justify-center gap-1"
          >
            {actionInProgress === 'health_check' ? '⏳' : '🩺'} Health Check
          </button>
          <button
            onClick={() => executeAction('system_reboot', 'Server Restart')}
            disabled={!!actionInProgress}
            className="btn btn-sm btn-outline text-orange-600 flex items-center justify-center gap-1"
          >
            {actionInProgress === 'system_reboot' ? '⏳' : '🔄'} Server Restart
          </button>
        </div>
        <button
          onClick={() => executeAction('full_recovery', 'Vollständige Recovery')}
          disabled={!!actionInProgress}
          className="w-full btn btn-sm bg-purple-600 text-white hover:bg-purple-700 flex items-center justify-center gap-1"
        >
          {actionInProgress === 'full_recovery' ? (
            <>⏳ Recovery läuft...</>
          ) : (
            <>🛠️ Vollständige Recovery ausführen</>
          )}
        </button>
      </div>
      
      {/* Aktionsergebnis */}
      {actionResult && (
        <div className={`p-3 rounded-lg text-sm ${
          actionResult.success 
            ? 'bg-green-50 dark:bg-green-900/20 text-green-700 dark:text-green-300' 
            : 'bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300'
        }`}>
          <div className="font-medium">{actionResult.success ? '✅' : '❌'} {actionResult.message}</div>
          {actionResult.steps && (
            <div className="mt-2 text-xs font-mono whitespace-pre-wrap">
              {actionResult.steps.join('\n')}
            </div>
          )}
        </div>
      )}
      
      {/* Log-Filter */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-gray-500">Filter:</span>
        <select
          value={filterLevel}
          onChange={(e) => setFilterLevel(e.target.value)}
          className="input py-1 text-xs"
        >
          <option value="">Alle</option>
          <option value="error">Nur Fehler</option>
          <option value="warn">Warnungen</option>
          <option value="success">Erfolge</option>
          <option value="info">Info</option>
        </select>
        <button
          onClick={fetchData}
          className="btn btn-xs btn-outline"
        >
          🔄 Aktualisieren
        </button>
        <button
          onClick={clearOldLogs}
          className="btn btn-xs btn-outline text-gray-500"
        >
          🗑️ Alte löschen
        </button>
      </div>
      
      {/* Logs Liste */}
      <div className="space-y-1 max-h-64 overflow-y-auto">
        {logs.length === 0 ? (
          <div className="text-center text-gray-400 py-4 text-sm">
            Keine Recovery-Logs vorhanden
          </div>
        ) : (
          logs.map((log) => (
            <div
              key={log.id}
              className="p-2 bg-gray-50 dark:bg-gray-800 rounded text-xs border-l-2 border-gray-300 dark:border-gray-600"
              style={{
                borderLeftColor: {
                  'error': '#ef4444',
                  'warn': '#f59e0b',
                  'success': '#22c55e',
                  'info': '#3b82f6'
                }[log.log_level]
              }}
            >
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-gray-400">
                  {new Date(log.timestamp).toLocaleString('de-DE', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit'
                  })}
                </span>
                <LevelBadge level={log.log_level} />
                <ActionBadge action={log.action} />
                {log.duration_ms && (
                  <span className="text-gray-400">{log.duration_ms}ms</span>
                )}
              </div>
              <div className="mt-1 text-gray-700 dark:text-gray-300">
                {log.message}
              </div>
              {log.details && (
                <div className="mt-1 text-gray-500 text-[10px]">
                  {log.details}
                </div>
              )}
              {log.error_context && (
                <details className="mt-1">
                  <summary className="text-gray-400 cursor-pointer text-[10px]">Fehlerdetails</summary>
                  <pre className="mt-1 p-1 bg-gray-100 dark:bg-gray-900 rounded text-[10px] overflow-x-auto">
                    {log.error_context}
                  </pre>
                </details>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
