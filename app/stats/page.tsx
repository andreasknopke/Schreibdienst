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
  key: string;
  label: string;
  title: string;
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
    trends: Record<PeriodKey, TrendPoint[]>;
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

const MONTH_NAV = new Intl.DateTimeFormat('de-DE', { month: 'long', year: 'numeric' });

function pad2Client(value: number): string {
  return String(value).padStart(2, '0');
}

function currentMonthKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad2Client(now.getMonth() + 1)}`;
}

function shiftMonthKey(monthKey: string, offset: number): string {
  const [year, month] = monthKey.split('-').map((part) => Number(part));
  const date = new Date(year, (month || 1) - 1 + offset, 1);
  return `${date.getFullYear()}-${pad2Client(date.getMonth() + 1)}`;
}

function formatMonthLabel(monthKey: string): string {
  const [year, month] = monthKey.split('-').map((part) => Number(part));
  if (!year || !month) return monthKey;
  return MONTH_NAV.format(new Date(year, month - 1, 1));
}

function isFutureMonth(monthKey: string): boolean {
  return monthKey.localeCompare(currentMonthKey()) > 0;
}

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

function getPeriodCaption(period: PeriodKey, monthLabel?: string): string {
  if (period === 'today') return 'Heute nach Nutzer';
  if (period === 'month') return `${monthLabel ?? 'Aktueller Monat'} nach Tag`;
  return 'Monatlich kumuliert';
}

function getBarWidth(period: PeriodKey): string {
  if (period === 'today') return 'minmax(64px, 64px)';
  if (period === 'month') return 'minmax(40px, 40px)';
  return 'minmax(72px, 72px)';
}

function BarChart({ data, metric, label, period, caption }: { data: TrendPoint[]; metric: keyof Pick<TrendPoint, 'words' | 'minutes' | 'utterances' | 'manualCorrections' | 'vocabularyEntries'>; label: string; period: PeriodKey; caption?: string }) {
  const values = data.map((point) => Number(point[metric] || 0));
  const max = Math.max(1, ...values);
  const barWidth = getBarWidth(period);

  return (
    <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="font-semibold text-gray-900 dark:text-white">{label}</h3>
        <span className="text-xs text-gray-500">{caption ?? getPeriodCaption(period)}</span>
      </div>
      <div className="overflow-x-auto pb-2">
        <div
          className="grid h-48 min-w-full items-end gap-2"
          style={{
            gridTemplateColumns: `repeat(${Math.max(data.length, 1)}, ${barWidth})`,
            width: 'max-content',
          }}
        >
          {data.map((point) => {
            const value = Number(point[metric] || 0);
            const height = Math.max(3, (value / max) * 100);
            return (
              <div key={point.key} className="group flex flex-col items-center gap-2">
                <div className="relative flex h-40 w-full items-end rounded-t bg-blue-50 dark:bg-blue-950/20">
                  <div
                    className="w-full rounded-t bg-gradient-to-t from-blue-600 to-cyan-400 transition-all group-hover:from-blue-700"
                    style={{ height: `${height}%` }}
                    title={`${point.title}: ${formatNumber(value)}`}
                  />
                </div>
                <span className="hidden w-full whitespace-normal break-words text-center text-[10px] leading-tight text-gray-400 sm:block">{point.label}</span>
              </div>
            );
          })}
        </div>
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
  const [selectedMonth, setSelectedMonth] = useState<string>(() => currentMonthKey());
  const [showDepartments, setShowDepartments] = useState(false);
  const [deptStats, setDeptStats] = useState<any[] | null>(null);
  const [deptLoading, setDeptLoading] = useState(false);
  const [deptSortColumn, setDeptSortColumn] = useState<string>('department');
  const [deptSortDirection, setDeptSortDirection] = useState<'asc' | 'desc'>('asc');
  const [deptPeriod, setDeptPeriod] = useState<'month' | 'year' | 'all'>('all');
  const [deptSelectedMonth, setDeptSelectedMonth] = useState<string>(() => currentMonthKey());

  const handleDeptSort = (column: string) => {
    setDeptSortDirection((prev) => (deptSortColumn === column && prev === 'asc' ? 'desc' : 'asc'));
    setDeptSortColumn(column);
  };

  const sortedDeptStats = useMemo(() => {
    if (!deptStats) return null;
    const sorted = [...deptStats];
    sorted.sort((a: any, b: any) => {
      const aVal = a[deptSortColumn] ?? '';
      const bVal = b[deptSortColumn] ?? '';
      const compare = typeof aVal === 'number' ? aVal - bVal : String(aVal).localeCompare(String(bVal));
      return deptSortDirection === 'asc' ? compare : -compare;
    });
    return sorted;
  }, [deptStats, deptSortColumn, deptSortDirection]);

  const deptPeriodCaption = useMemo(() => {
    if (deptPeriod === 'all') return 'Gesamt';
    if (deptPeriod === 'year') return `Jahr ${deptSelectedMonth.split('-')[0]}`;
    return formatMonthLabel(deptSelectedMonth);
  }, [deptPeriod, deptSelectedMonth]);

  const fetchDeptStats = async (monthParam?: string) => {
    setDeptLoading(true);
    try {
      const params = monthParam ? `?month=${encodeURIComponent(monthParam)}` : '';
      const res = await fetchWithDbToken(`/api/stats/department${params}`, { cache: 'no-store' });
      if (!res.ok) throw new Error('Abteilungsstatistiken konnten nicht geladen werden');
      const data = await res.json();
      setDeptStats(data.departments || []);
    } catch (err: any) {
      setError(err.message || 'Unbekannter Fehler');
    } finally {
      setDeptLoading(false);
    }
  };

  const loadDeptStats = (period: 'month' | 'year' | 'all', monthKey: string) => {
    setDeptPeriod(period);
    if (period === 'all') {
      fetchDeptStats(undefined);
    } else if (period === 'year') {
      const year = monthKey.split('-')[0];
      fetchDeptStats(`year-${year}`);
    } else {
      fetchDeptStats(monthKey);
    }
  };

  const deptGoToPrevMonth = () => {
    setDeptSelectedMonth((current) => {
      const prev = shiftMonthKey(current, -1);
      loadDeptStats(deptPeriod, prev);
      return prev;
    });
  };

  const deptGoToNextMonth = () => {
    setDeptSelectedMonth((current) => {
      const next = shiftMonthKey(current, 1);
      if (isFutureMonth(next)) return current;
      loadDeptStats(deptPeriod, next);
      return next;
    });
  };

  const deptIsNextMonthDisabled = isFutureMonth(shiftMonthKey(deptSelectedMonth, 1));

  const exportDeptToCSV = () => {
    if (!sortedDeptStats || sortedDeptStats.length === 0) return;
    const rows = [
      ['Abteilung', 'Nutzer', 'Diktierzeit (h)', 'Wörter', 'Äußerungen', 'Wörterbuch', 'Bausteine', 'Gruppen-Baust.'],
      ...sortedDeptStats.map((d: any) => [
        d.department,
        d.user_count,
        (d.total_audio_duration_seconds / 3600).toFixed(1),
        d.total_word_count,
        d.total_utterances,
        d.dictionary_entry_count,
        d.template_count,
        d.group_template_count,
      ]),
    ];
    const csv =
      '\uFEFF' +
      rows
        .map((row) =>
          row
            .map((cell) => {
              const str = String(cell ?? '');
              return str.includes(';') || str.includes('"') || str.includes('\n')
                ? `"${str.replace(/"/g, '""')}"`
                : str;
            })
            .join(';')
        )
        .join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Abteilungsstatistik_${deptPeriodCaption.replace(/\s+/g, '_')}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const fetchStats = async (monthKey: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ month: monthKey });
      const res = await fetchWithDbToken(`/api/stats?${params.toString()}`, { cache: 'no-store' });
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
    fetchStats(selectedMonth);
    const interval = setInterval(() => fetchStats(selectedMonth), 30000);
    return () => clearInterval(interval);
  }, [selectedMonth]);

  const goToPrevMonth = () => setSelectedMonth((current) => shiftMonthKey(current, -1));
  const goToNextMonth = () => {
    setSelectedMonth((current) => {
      const next = shiftMonthKey(current, 1);
      return isFutureMonth(next) ? current : next;
    });
  };
  const isNextMonthDisabled = isFutureMonth(shiftMonthKey(selectedMonth, 1));

  const activePeriod = stats?.online.periods[period];
  const activeTrend = stats?.online.trends[period] ?? [];
  const topUsers = useMemo(() => activePeriod?.users.slice(0, 12) ?? [], [activePeriod]);
  const maxUserWords = Math.max(1, ...topUsers.map((user) => user.words));
  const memoryPercent = stats ? Math.round((stats.system.memory.process_usage_mb / stats.system.memory.total_mb) * 100) : 0;
  const monthCaption = period === 'month' ? getPeriodCaption('month', formatMonthLabel(selectedMonth)) : undefined;

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
          onClick={() => fetchStats(selectedMonth)}
          disabled={loading}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-white px-4 py-2 text-sm font-semibold text-blue-700 shadow-sm transition hover:bg-blue-50 disabled:opacity-60"
        >
          {loading && <Spinner className="h-4 w-4 text-blue-700" />}
          Aktualisieren
        </button>
      </div>

      {error && <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-700">{error}</div>}

      <div className="flex flex-wrap items-center gap-2">
        {PERIOD_OPTIONS.map((option) => (
          <button
            key={option.key}
            onClick={() => { setPeriod(option.key); setShowDepartments(false); }}
            className={`rounded-full px-4 py-2 text-sm font-medium transition ${period === option.key && !showDepartments ? 'bg-blue-600 text-white shadow' : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50 dark:bg-zinc-900 dark:text-gray-300 dark:ring-zinc-800'}`}
          >
            {option.label}
          </button>
        ))}

        <button
          onClick={() => { setShowDepartments(true); if (!deptStats) loadDeptStats(deptPeriod, deptSelectedMonth); }}
          className={`rounded-full px-4 py-2 text-sm font-medium transition ${showDepartments ? 'bg-emerald-600 text-white shadow' : 'bg-white text-gray-600 ring-1 ring-gray-200 hover:bg-gray-50 dark:bg-zinc-900 dark:text-gray-300 dark:ring-zinc-800'}`}
        >
          Abteilungen
        </button>

        {period === 'month' && (
          <div className="ml-auto inline-flex items-center gap-2 rounded-full bg-white px-2 py-1 text-sm text-gray-700 ring-1 ring-gray-200 shadow-sm dark:bg-zinc-900 dark:text-gray-200 dark:ring-zinc-800">
            <button
              type="button"
              onClick={goToPrevMonth}
              className="rounded-full p-1.5 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-zinc-800 dark:hover:text-white"
              aria-label="Vorheriger Monat"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 0 1 0 1.06L9.06 10l3.73 3.71a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
              </svg>
            </button>
            <label className="inline-flex items-center gap-2">
              <span className="text-xs uppercase tracking-wide text-gray-500">Monat</span>
              <input
                type="month"
                value={selectedMonth}
                max={currentMonthKey()}
                onChange={(event) => {
                  const next = event.target.value;
                  if (!next) return;
                  if (isFutureMonth(next)) return;
                  setSelectedMonth(next);
                }}
                className="rounded-md border border-gray-200 bg-white px-2 py-1 text-sm font-medium text-gray-800 focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-white"
              />
            </label>
            <button
              type="button"
              onClick={goToNextMonth}
              disabled={isNextMonthDisabled}
              className="rounded-full p-1.5 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-400 dark:hover:bg-zinc-800 dark:hover:text-white"
              aria-label="Nächster Monat"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 0 1 0-1.06L10.94 10 7.21 6.29a.75.75 0 1 1 1.06-1.06l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0Z" clipRule="evenodd" />
              </svg>
            </button>
            <span className="ml-1 hidden text-sm font-semibold capitalize sm:inline">{formatMonthLabel(selectedMonth)}</span>
          </div>
        )}
      </div>

      {showDepartments ? (
        <div className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
          <div className="border-b border-gray-100 p-4 dark:border-zinc-800">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold text-gray-900 dark:text-white">Abteilungsstatistik</h2>
                <p className="text-xs text-gray-500 mt-1">Nutzer, Diktierzeit und Inhalte pro Abteilung</p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                {([
                  { key: 'month' as const, label: 'Monat' },
                  { key: 'year' as const, label: 'Jahr' },
                  { key: 'all' as const, label: 'Gesamt' },
                ]).map((opt) => (
                  <button
                    key={opt.key}
                    onClick={() => {
                      setDeptPeriod(opt.key);
                      if (opt.key === 'all') {
                        fetchDeptStats(undefined);
                      } else if (opt.key === 'year') {
                        const year = deptSelectedMonth.split('-')[0];
                        fetchDeptStats(`year-${year}`);
                      } else {
                        fetchDeptStats(deptSelectedMonth);
                      }
                    }}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition ${
                      deptPeriod === opt.key
                        ? 'bg-emerald-600 text-white shadow'
                        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-zinc-800 dark:text-gray-300 dark:hover:bg-zinc-700'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}

                {deptPeriod === 'month' && (
                  <div className="ml-2 inline-flex items-center gap-1 rounded-full bg-gray-100 px-1.5 py-1 text-xs dark:bg-zinc-800">
                    <button
                      type="button"
                      onClick={deptGoToPrevMonth}
                      className="rounded-full p-0.5 text-gray-500 transition hover:bg-gray-200 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-zinc-700 dark:hover:text-white"
                      aria-label="Vorheriger Monat"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                        <path fillRule="evenodd" d="M12.79 5.23a.75.75 0 0 1 0 1.06L9.06 10l3.73 3.71a.75.75 0 1 1-1.06 1.06l-4.25-4.25a.75.75 0 0 1 0-1.06l4.25-4.25a.75.75 0 0 1 1.06 0Z" clipRule="evenodd" />
                      </svg>
                    </button>
                    <span className="px-1 text-xs font-medium text-gray-700 dark:text-gray-200">{formatMonthLabel(deptSelectedMonth)}</span>
                    <button
                      type="button"
                      onClick={deptGoToNextMonth}
                      disabled={deptIsNextMonthDisabled}
                      className="rounded-full p-0.5 text-gray-500 transition hover:bg-gray-200 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40 dark:text-gray-400 dark:hover:bg-zinc-700 dark:hover:text-white"
                      aria-label="Nächster Monat"
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                        <path fillRule="evenodd" d="M7.21 14.77a.75.75 0 0 1 0-1.06L10.94 10 7.21 6.29a.75.75 0 1 1 1.06-1.06l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.75.75 0 0 1-1.06 0Z" clipRule="evenodd" />
                      </svg>
                    </button>
                  </div>
                )}

                {deptPeriod === 'year' && (
                  <span className="ml-1 text-xs font-medium text-gray-500 dark:text-gray-400">
                    {deptSelectedMonth.split('-')[0]}
                  </span>
                )}
              </div>
            </div>
            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-400 mt-2">Zeitraum: <span className="font-medium">{deptPeriodCaption}</span></p>
              <button
                onClick={exportDeptToCSV}
                disabled={!sortedDeptStats || sortedDeptStats.length === 0}
                className="ml-auto mt-2 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 transition hover:bg-gray-50 hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-40 dark:border-zinc-700 dark:bg-zinc-800 dark:text-gray-300 dark:hover:bg-zinc-700 dark:hover:text-white"
              >
                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4">
                  <path fillRule="evenodd" d="M3 3.5A1.5 1.5 0 0 1 4.5 2h6.879a1.5 1.5 0 0 1 1.06.44l4.122 4.12A1.5 1.5 0 0 1 17 7.622V16.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 3 16.5v-13Zm10.857 5.691a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 0 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z" clipRule="evenodd" />
                </svg>
                CSV exportieren
              </button>
            </div>
          </div>
          {deptLoading ? (
            <div className="flex items-center justify-center py-12">
              <Spinner className="h-6 w-6 text-blue-500" />
            </div>
          ) : sortedDeptStats && sortedDeptStats.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500 dark:bg-zinc-800/70">
                  <tr>
                    {[
                      { key: 'department', label: 'Abteilung', right: false },
                      { key: 'user_count', label: 'Nutzer', right: true },
                      { key: 'total_audio_duration_seconds', label: 'Diktierzeit (h)', right: true },
                      { key: 'total_word_count', label: 'Wörter', right: true },
                      { key: 'total_utterances', label: 'Äußerungen', right: true },
                      { key: 'dictionary_entry_count', label: 'Wörterbuch', right: true },
                      { key: 'template_count', label: 'Bausteine', right: true },
                      { key: 'group_template_count', label: 'Gruppen-Baust.', right: true },
                    ].map((col) => (
                      <th
                        key={col.key}
                        onClick={() => handleDeptSort(col.key)}
                        className={`px-4 py-3 cursor-pointer select-none transition hover:text-gray-700 dark:hover:text-gray-300 ${col.right ? 'text-right' : ''}`}
                      >
                        <span className="inline-flex items-center gap-1">
                          {col.label}
                          {deptSortColumn === col.key && (
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 transition">
                              {deptSortDirection === 'asc' ? (
                                <path fillRule="evenodd" d="M10 17a.75.75 0 0 1-.75-.75V5.612L5.29 9.77a.75.75 0 0 1-1.08-1.04l5.25-5.5a.75.75 0 0 1 1.08 0l5.25 5.5a.75.75 0 1 1-1.08 1.04l-3.96-4.158V16.25A.75.75 0 0 1 10 17Z" clipRule="evenodd" />
                              ) : (
                                <path fillRule="evenodd" d="M10 3a.75.75 0 0 1 .75.75v10.638l3.96-4.158a.75.75 0 1 1 1.08 1.04l-5.25 5.5a.75.75 0 0 1-1.08 0l-5.25-5.5a.75.75 0 1 1 1.08-1.04l3.96 4.158V3.75A.75.75 0 0 1 10 3Z" clipRule="evenodd" />
                              )}
                            </svg>
                          )}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100 dark:divide-zinc-800">
                  {sortedDeptStats.map((dept: any) => (
                    <tr key={dept.department} className="hover:bg-gray-50 dark:hover:bg-zinc-800/50">
                      <td className="px-4 py-3 font-medium text-gray-900 dark:text-white">{dept.department}</td>
                      <td className="px-4 py-3 text-right">{formatNumber(dept.user_count)}</td>
                      <td className="px-4 py-3 text-right">{(dept.total_audio_duration_seconds / 3600).toLocaleString('de-DE', { maximumFractionDigits: 1 })} h</td>
                      <td className="px-4 py-3 text-right">{formatNumber(dept.total_word_count)}</td>
                      <td className="px-4 py-3 text-right">{formatNumber(dept.total_utterances)}</td>
                      <td className="px-4 py-3 text-right">{formatNumber(dept.dictionary_entry_count)}</td>
                      <td className="px-4 py-3 text-right">{formatNumber(dept.template_count)}</td>
                      <td className="px-4 py-3 text-right">{formatNumber(dept.group_template_count)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-4 py-8 text-center text-sm text-gray-500">
              {deptStats ? 'Keine Abteilungsdaten vorhanden. Weisen Sie Benutzern eine Abteilung zu.' : 'Fehler beim Laden.'}
            </div>
          )}
        </div>
      ) : activePeriod ? (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-6">
            <StatCard label="Aktive Nutzer" value={formatNumber(activePeriod.totals.users)} hint={activePeriod.label} color="bg-blue-500" />
            <StatCard label="Äußerungen" value={formatNumber(activePeriod.totals.utterances)} hint="Online Transkriptionen" color="bg-cyan-500" />
            <StatCard label="Wörter" value={formatNumber(activePeriod.totals.words)} hint="Transkribierter Text" color="bg-emerald-500" />
            <StatCard label="Minuten" value={formatMinutes(activePeriod.totals.minutes)} hint="Audio-Dauer" color="bg-violet-500" />
            <StatCard label="Manuelle Korrekturen" value={formatNumber(activePeriod.totals.manualCorrections)} hint="Bearbeitete Textfelder" color="bg-amber-500" />
            <StatCard label="Wörterbuch" value={formatNumber(activePeriod.totals.vocabularyEntries)} hint="Einträge" color="bg-rose-500" />
          </div>

          <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
            <BarChart data={activeTrend} metric="words" label={period === 'today' ? 'Wörter nach Nutzer' : period === 'month' ? 'Wörter pro Tag' : 'Wörter pro Monat'} period={period} caption={monthCaption} />
            <BarChart data={activeTrend} metric="minutes" label={period === 'today' ? 'Diktat-Minuten nach Nutzer' : period === 'month' ? 'Diktat-Minuten pro Tag' : 'Diktat-Minuten pro Monat'} period={period} caption={monthCaption} />
            <BarChart data={activeTrend} metric="manualCorrections" label={period === 'today' ? 'Korrekturen nach Nutzer' : period === 'month' ? 'Korrekturen pro Tag' : 'Korrekturen pro Monat'} period={period} caption={monthCaption} />
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
