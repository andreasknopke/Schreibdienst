"use client";

import { useEffect, useMemo, useState } from 'react';
import Spinner from '@/components/Spinner';
import { fetchWithDbToken } from '@/lib/fetchWithDbToken';

type PeriodKey = 'today' | 'month' | 'year' | 'allTime';

interface OnlineUserStats {
  username: string;
  utterances: number;
  words: number;
  minutes: number;
  manualCorrections: number;
  vocabularyEntries: number;
}

interface OnlinePeriodStats {
  label: string;
  totals: Omit<OnlineUserStats, 'username'> & { users: number };
  users: OnlineUserStats[];
}

interface TrendPoint {
  day: string;
  words: number;
  minutes: number;
  utterances: number;
  manualCorrections: number;
  vocabularyEntries: number;
}

interface StatsResponse {
  timestamp: string;
  online: {
    periods: Record<PeriodKey, OnlinePeriodStats>;
    trend: TrendPoint[];
    providerBreakdown: Array<{ provider: string; requests: number; words: number }>;
  };
  database: { latency_ms: number; size_mb: number; db_name: string };
  jobs: {
    counts: { total: number; pending: number; processing: number; completed: number; error: number };
    performance: { avg_processing_factor: string | number };
    llm_corrections: { total_count: number };
  };
  system: {
    uptime_seconds: number;
    load_average: number[];
    memory: { total_mb: number; process_usage_mb: number };
    cpus: number;
  };
}

const PERIOD_OPTIONS: Array<{ key: PeriodKey; label: string }> = [
  { key: 'today', label: 'Heute' },
  { key: 'month', label: 'Monat' },
  { key: 'year', label: 'Jahr' },
  { key: 'allTime', label: 'Gesamt' },
];

function formatNumber(value: number): string {
  return Math.round(value || 0).toLocaleString('de-DE');
}

function formatMinutes(value: number): string {
  if (value < 60) return `${value.toLocaleString('de-DE', { maximumFractionDigits: 1 })} min`;
  return `${(value / 60).toLocaleString('de-DE', { maximumFractionDigits: 1 })} h`;
}

function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

function StatCard({ label, value, hint, color }: { label: string; value: string; hint: string; color: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className={`mb-3 h-1.5 w-12 rounded-full ${color}`} />
      <div className="text-sm text-gray-500 dark:text-gray-400">{label}</div>
      <div className="mt-1 text-2xl font-bold text-gray-950 dark:text-white">{value}</div>
      <div className="mt-1 text-xs text-gray-500 dark:text-gray-500">{hint}</div>
    </div>
  );
}

function BarChart({ data, metric, label }: { data: TrendPoint[]; metric: keyof TrendPoint; label: string }) {
  const values = data.map((point) => Number(point[metric] || 0));
  const max = Math.max(1, ...values);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 dark:text-white">{label}</h3>
        <span className="text-xs text-gray-500">30 Tage</span>
      </div>
      <div className="flex h-48 items-end gap-1 overflow-hidden sm:gap-2">
        {data.map((point) => {
          const value = Number(point[metric] || 0);
          const height = Math.max(3, (value / max) * 100);
          return (
            <div key={point.day} className="group flex min-w-0 flex-1 flex-col items-center gap-2">
              <div className="relative flex h-40 w-full items-end rounded-t bg-blue-50 dark:bg-blue-950/20">
                <div
                  className="w-full rounded-t bg-gradient-to-t from-blue-600 to-cyan-400 transition-all group-hover:from-blue-700"
                  style={{ height: `${height}%` }}
                  title={`${new Date(point.day).toLocaleDateString('de-DE')}: ${formatNumber(value)}`}
                />
              </div>
              <span className="hidden text-[10px] text-gray-400 sm:block">{new Date(point.day).getDate()}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function StatsPage() {
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [period, setPeriod] = useState<PeriodKey>('today');

  const fetchStats = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchWithDbToken('/api/stats', { cache: 'no-store' });
      if (!res.ok) throw new Error('Statistiken konnten nicht geladen werden');
      setStats(await res.json());
      setLastUpdated(new Date());
    } catch (err: any) {
      setError(err.message || 'Unbekannter Fehler');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 30000);
    return () => clearInterval(interval);
  }, []);

  const activePeriod = stats?.online.periods[period];
  const topUsers = useMemo(() => activePeriod?.users.slice(0, 12) ?? [], [activePeriod]);
  const maxUserWords = Math.max(1, ...topUsers.map((user) => user.words));
  const memoryPercent = stats ? Math.round((stats.system.memory.process_usage_mb / stats.system.memory.total_mb) * 100) : 0;

  return (
    <div className="mx-auto max-w-7xl space-y-6 p-2 sm:p-4">
      <div className="flex flex-col gap-4 rounded-3xl bg-gradient-to-br from-blue-600 via-indigo-600 to-slate-900 p-5 text-white shadow-lg sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm uppercase tracking-wide text-blue-100">Online Usage Dashboard</p>
          <h1 className="mt-1 text-3xl font-bold">Live-Diktat Statistiken</h1>
          <p className="mt-2 max-w-2xl text-sm text-blue-100">
            Nutzer, Wörter, Äußerungen, Minuten, manuelle Korrekturen und Wörterbuch-Einträge nach Zeitraum.
          </p>
          <p className="mt-2 text-xs text-blue-200">Aktualisiert: {lastUpdated ? lastUpdated.toLocaleTimeString('de-DE') : 'nie'}</p>
        </div>
        <button
          onClick={fetchStats}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-blue-700 shadow-sm transition hover:bg-blue-50 disabled:opacity-60"
        >
          {loading && <Spinner className="h-4 w-4 text-blue-700" />}
          Aktualisieren
        </button>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>}

      <div className="flex flex-wrap gap-2">
        {PERIOD_OPTIONS.map((option) => (
          <button
            key={option.key}
            onClick={() => setPeriod(option.key)}
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${period === option.key ? 'bg-blue-600 text-white shadow' : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50 dark:bg-zinc-900 dark:text-gray-300 dark:ring-zinc-800'}`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {activePeriod ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
            <StatCard label="Aktive Nutzer" value={formatNumber(activePeriod.totals.users)} hint={activePeriod.label} color="bg-blue-500" />
            <StatCard label="Äußerungen" value={formatNumber(activePeriod.totals.utterances)} hint="Online Transkriptionen" color="bg-cyan-500" />
            <StatCard label="Wörter" value={formatNumber(activePeriod.totals.words)} hint="Transkribierter Text" color="bg-emerald-500" />
            <StatCard label="Minuten" value={formatMinutes(activePeriod.totals.minutes)} hint="Audio-Dauer" color="bg-violet-500" />
            <StatCard label="Manuelle Korrekturen" value={formatNumber(activePeriod.totals.manualCorrections)} hint="Bearbeitete Textfelder" color="bg-amber-500" />
            <StatCard label="Wörterbuch" value={formatNumber(activePeriod.totals.vocabularyEntries)} hint="Einträge" color="bg-rose-500" />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <BarChart data={stats?.online.trend ?? []} metric="words" label="Wörter pro Tag" />
            <BarChart data={stats?.online.trend ?? []} metric="minutes" label="Diktat-Minuten pro Tag" />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.5fr_1fr]">
            <div className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
              <div className="border-b border-gray-100 p-4 dark:border-zinc-800">
                <h2 className="font-semibold text-gray-900 dark:text-white">Nutzer-Ranking ({activePeriod.label})</h2>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-sm">
                  <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-zinc-800/70">
                    <tr>
                      <th className="px-4 py-3">Nutzer</th>
                      <th className="px-4 py-3 text-right">Wörter</th>
                      <th className="px-4 py-3 text-right">Äußerungen</th>
                      <th className="px-4 py-3 text-right">Minuten</th>
                      <th className="px-4 py-3 text-right">Korrekturen</th>
                      <th className="px-4 py-3 text-right">Wörterbuch</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
                    {topUsers.length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-500">Noch keine Online-Nutzung für diesen Zeitraum.</td></tr>
                    ) : topUsers.map((user) => (
                      <tr key={user.username} className="hover:bg-gray-50 dark:hover:bg-zinc-800/50">
                        <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">
                          <div>{user.username}</div>
                          <div className="mt-1 h-1.5 w-32 rounded-full bg-gray-100 dark:bg-zinc-800">
                            <div className="h-1.5 rounded-full bg-blue-500" style={{ width: `${Math.max(4, (user.words / maxUserWords) * 100)}%` }} />
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-semibold">{formatNumber(user.words)}</td>
                        <td className="px-4 py-3 text-right">{formatNumber(user.utterances)}</td>
                        <td className="px-4 py-3 text-right">{formatMinutes(user.minutes)}</td>
                        <td className="px-4 py-3 text-right">{formatNumber(user.manualCorrections)}</td>
                        <td className="px-4 py-3 text-right">{formatNumber(user.vocabularyEntries)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <h3 className="mb-3 font-semibold text-gray-900 dark:text-white">Provider</h3>
                <div className="space-y-3">
                  {(stats?.online.providerBreakdown ?? []).map((provider) => (
                    <div key={provider.provider} className="flex items-center justify-between rounded-xl bg-gray-50 p-3 dark:bg-zinc-800/60">
                      <div>
                        <div className="font-medium text-gray-900 dark:text-white">{provider.provider}</div>
                        <div className="text-xs text-gray-500">{formatNumber(provider.words)} Wörter</div>
                      </div>
                      <div className="text-right text-sm font-semibold">{formatNumber(provider.requests)}</div>
                    </div>
                  ))}
                  {stats?.online.providerBreakdown.length === 0 && <div className="text-sm text-gray-500">Noch keine Provider-Daten.</div>}
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
                <h3 className="mb-3 font-semibold text-gray-900 dark:text-white">System & Offline</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-xl bg-gray-50 p-3 dark:bg-zinc-800/60"><span className="text-gray-500">DB</span><div className="font-semibold">{stats?.database.latency_ms} ms</div></div>
                  <div className="rounded-xl bg-gray-50 p-3 dark:bg-zinc-800/60"><span className="text-gray-500">Speicher</span><div className="font-semibold">{memoryPercent}%</div></div>
                  <div className="rounded-xl bg-gray-50 p-3 dark:bg-zinc-800/60"><span className="text-gray-500">Offline Jobs</span><div className="font-semibold">{formatNumber(stats?.jobs.counts.total ?? 0)}</div></div>
                  <div className="rounded-xl bg-gray-50 p-3 dark:bg-zinc-800/60"><span className="text-gray-500">Uptime</span><div className="font-semibold">{formatUptime(stats?.system.uptime_seconds ?? 0)}</div></div>
                </div>
              </div>
            </div>
          </div>
        </>
      ) : (
        <div className="rounded-2xl border border-gray-200 bg-white p-10 text-center dark:border-zinc-800 dark:bg-zinc-900">
          <Spinner className="mx-auto h-8 w-8 text-blue-600" />
          <p className="mt-3 text-gray-500">Statistiken werden geladen…</p>
        </div>
      )}
    </div>
  );
}
