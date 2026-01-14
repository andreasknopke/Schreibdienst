"use client";

import { useEffect, useState } from 'react';
import Spinner from '@/components/Spinner';

interface SystemStats {
  uptime_seconds: number;
  load_average: number[];
  memory: {
    total_mb: number;
    free_mb: number;
    process_usage_mb: number;
  };
  cpus: number;
  platform: string;
  arch: string;
}

interface DbStats {
  latency_ms: number;
  size_mb: number;
  db_name: string;
}

interface JobStats {
  counts: {
    total: number;
    pending: number;
    processing: number;
    completed: number;
    error: number;
    stats_by_status: Record<string, number>;
  };
  performance: {
    avg_audio_duration_sec: string | number;
    avg_processing_time_sec: string | number;
    avg_processing_factor: string | number;
  };
  llm_corrections: {
    total_count: number;
  };
}

interface StatsResponse {
  timestamp: string;
  system: SystemStats;
  database: DbStats;
  jobs: JobStats;
}

export default function StatsPage() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/stats', { cache: 'no-store' });
      if (!res.ok) throw new Error('Failed to fetch stats');
      const data = await res.json();
      setStats(data);
      setLastUpdated(new Date());
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    // Auto-refresh every 30 seconds
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  const formatUptime = (seconds: number) => {
    const days = Math.floor(seconds / (3600 * 24));
    const hours = Math.floor((seconds % (3600 * 24)) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return `${days}d ${hours}h ${minutes}m`;
  };

  const getProcessingSpeedText = (factor: number) => {
    if (!factor) return 'N/A';
    // factor 0.5 means 30s processing for 60s audio (2x speed)
    const speed = (1 / factor).toFixed(1);
    return `${speed}x real-time`;
  };

  const memoryPercent = stats 
    ? Math.round((stats.system.memory.process_usage_mb / stats.system.memory.total_mb) * 100)
    : 0;

  return (
    <div className="container mx-auto p-4 max-w-6xl space-y-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">System Status & Health</h1>
          <p className="text-sm text-gray-500">
            Last updated: {lastUpdated ? lastUpdated.toLocaleTimeString() : 'Never'}
          </p>
        </div>
        <button 
          onClick={fetchStats}
          disabled={loading}
          className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50 transition-colors flex items-center gap-2"
        >
          {loading && <Spinner className="w-4 h-4 text-white" />}
          Refresh
        </button>
      </div>

      {error && (
        <div className="p-4 bg-red-50 text-red-700 border border-red-200 rounded-md">
          Error: {error}
        </div>
      )}

      {/* Grid Layout */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">

        {/* Card: Job Overview */}
        <div className="bg-white dark:bg-zinc-800 rounded-lg shadow p-6 border dark:border-zinc-700">
          <h3 className="text-lg font-semibold mb-4 text-gray-800 dark:text-gray-200 border-b pb-2">Aufträge (Jobs)</h3>
          {stats ? (
            <div className="space-y-4">
               <div className="grid grid-cols-2 gap-4">
                  <div className="text-center p-3 bg-gray-50 dark:bg-zinc-700/50 rounded">
                    <div className="text-2xl font-bold">{stats.jobs.counts.total}</div>
                    <div className="text-xs text-gray-500 uppercase">Total</div>
                  </div>
                  <div className="text-center p-3 bg-green-50 dark:bg-green-900/20 rounded">
                    <div className="text-2xl font-bold text-green-600 dark:text-green-400">{stats.jobs.counts.completed}</div>
                    <div className="text-xs text-green-600/80 uppercase">Completed</div>
                  </div>
                  <div className="text-center p-3 bg-yellow-50 dark:bg-yellow-900/20 rounded">
                    <div className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                      {stats.jobs.counts.processing + stats.jobs.counts.pending}
                    </div>
                    <div className="text-xs text-yellow-600/80 uppercase">Active</div>
                  </div>
                  <div className="text-center p-3 bg-red-50 dark:bg-red-900/20 rounded">
                    <div className="text-2xl font-bold text-red-600 dark:text-red-400">{stats.jobs.counts.error}</div>
                    <div className="text-xs text-red-600/80 uppercase">Errors</div>
                  </div>
               </div>
               
               <div className="pt-2">
                 <div className="flex justify-between text-sm mb-1">
                   <span>LLM Corrections Total</span>
                   <span className="font-mono">{stats.jobs.llm_corrections.total_count}</span>
                 </div>
               </div>
            </div>
          ) : (
            <div className="h-40 bg-gray-100 animate-pulse rounded"></div>
          )}
        </div>

        {/* Card: Performance */}
        <div className="bg-white dark:bg-zinc-800 rounded-lg shadow p-6 border dark:border-zinc-700">
          <h3 className="text-lg font-semibold mb-4 text-gray-800 dark:text-gray-200 border-b pb-2">Performance (Last 100)</h3>
          {stats ? (
             <div className="space-y-4">
               
               <div className="flex flex-col gap-1 p-3 bg-slate-50 dark:bg-zinc-700/30 rounded">
                 <span className="text-sm text-gray-500">Avg Audio Duration</span>
                 <span className="text-xl font-medium">{Number(stats.jobs.performance.avg_audio_duration_sec).toFixed(1)}s</span>
               </div>

               <div className="flex flex-col gap-1 p-3 bg-slate-50 dark:bg-zinc-700/30 rounded">
                 <span className="text-sm text-gray-500">Avg Processing Time</span>
                 <span className="text-xl font-medium">{Number(stats.jobs.performance.avg_processing_time_sec).toFixed(1)}s</span>
               </div>

               <div className="flex flex-col gap-1 p-3 bg-blue-50 dark:bg-blue-900/10 rounded border border-blue-100 dark:border-blue-900/30">
                 <span className="text-sm text-blue-600 dark:text-blue-400">Processing Speed</span>
                 <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold text-blue-700 dark:text-blue-300">
                       {getProcessingSpeedText(Number(stats.jobs.performance.avg_processing_factor))}
                    </span>
                 </div>
                 <span className="text-xs text-blue-500 dark:text-blue-400/70">
                   Fact: {Number(stats.jobs.performance.avg_processing_factor).toFixed(2)} (Time/Audio)
                 </span>
               </div>

             </div>
          ) : (
            <div className="h-40 bg-gray-100 animate-pulse rounded"></div>
          )}
        </div>

        {/* Card: System Health */}
        <div className="bg-white dark:bg-zinc-800 rounded-lg shadow p-6 border dark:border-zinc-700">
          <h3 className="text-lg font-semibold mb-4 text-gray-800 dark:text-gray-200 border-b pb-2">System Resources</h3>
          {stats ? (
            <div className="space-y-4">
              
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <div className="text-gray-500">CPU Load (1m)</div>
                  <div className="font-mono text-lg">{stats.system.load_average[0].toFixed(2)}</div>
                </div>
                <div>
                   <div className="text-gray-500">Cores</div>
                   <div className="font-mono text-lg">{stats.system.cpus}</div>
                </div>
              </div>

              <div>
                <div className="flex justify-between text-sm mb-1">
                  <span className="text-gray-500">App Memory Usage</span>
                  <span className="font-mono">{stats.system.memory.process_usage_mb} MB</span>
                </div>
                <div className="w-full bg-gray-200 rounded-full h-2.5 dark:bg-gray-700">
                  <div className="bg-purple-600 h-2.5 rounded-full" style={{ width: `${memoryPercent}%` }}></div>
                </div>
                <div className="text-xs text-gray-400 mt-1 text-right">
                  {memoryPercent}% of Total ({stats.system.memory.total_mb} MB)
                </div>
              </div>
              
              <div className="pt-2 border-t dark:border-zinc-700">
                <div className="text-xs text-gray-500 mb-1">Uptime</div>
                <div className="font-mono">{formatUptime(stats.system.uptime_seconds)}</div>
              </div>

            </div>
          ) : (
             <div className="h-40 bg-gray-100 animate-pulse rounded"></div>
          )}
        </div>

         {/* Card: Database */}
         <div className="bg-white dark:bg-zinc-800 rounded-lg shadow p-6 border dark:border-zinc-700">
          <h3 className="text-lg font-semibold mb-4 text-gray-800 dark:text-gray-200 border-b pb-2">Database</h3>
          {stats ? (
            <div className="space-y-4">
               
               <div className="flex justify-between items-center py-2 border-b dark:border-zinc-700/50">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Status</span>
                  <span className="px-2 py-1 bg-green-100 text-green-800 text-xs font-medium rounded-full">Connected</span>
               </div>

               <div className="flex justify-between items-center py-2 border-b dark:border-zinc-700/50">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Response Time</span>
                  <span className={`font-mono font-bold ${stats.database.latency_ms > 100 ? 'text-orange-500' : 'text-green-600'}`}>
                    {stats.database.latency_ms} ms
                  </span>
               </div>

               <div className="flex justify-between items-center py-2 border-b dark:border-zinc-700/50">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Size</span>
                  <span className="font-mono font-bold">{stats.database.size_mb} MB</span>
               </div>

               <div className="flex justify-between items-center py-2">
                  <span className="text-sm text-gray-600 dark:text-gray-400">Schema</span>
                  <span className="text-xs text-gray-500 truncate max-w-[150px]">{stats.database.db_name}</span>
               </div>

            </div>
          ) : (
            <div className="h-40 bg-gray-100 animate-pulse rounded"></div>
          )}
        </div>

      </div>
    </div>
  );
}
