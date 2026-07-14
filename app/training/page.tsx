"use client";

import { useCallback, useEffect, useState } from 'react';
import { fetchWithDbToken } from '@/lib/fetchWithDbToken';
import Spinner from '@/components/Spinner';
import { useAuth } from '@/components/AuthProvider';

// ── Types ────────────────────────────────────────────────────────────────

interface TrainingSample {
  id: number;
  dictation_id: number;
  voxtral_raw_text: string;
  corrected_text: string;
  start_time: number;
  end_time: number;
  word_count: number;
  note?: string | null;
  marked_by?: string | null;
  created_at?: string;
  updated_at?: string;
  last_verify_text?: string | null;
  last_verify_model?: string | null;
  last_verify_at?: string | null;
  last_verify_wer?: number | null;
  last_verify_error_count?: number | null;
  // Joined dictation fields
  dictation?: {
    order_number?: string;
    username?: string;
    patient_name?: string | null;
    fachabteilung?: string | null;
    mode?: string;
    created_at?: string;
  };
}

interface TrainingStats {
  total_samples: number;
  total_audio_seconds: number;
  total_words: number;
  total_dictations_touched: number;
  last_verify_count: number;
  last_verify_avg_wer: number | null;
  last_verify_avg_error_count: number | null;
}

interface DiffSegment {
  type: 'equal' | 'insert' | 'delete';
  value: string;
}

interface VerifyResult {
  sample_id: number;
  voxtral_raw_text: string;
  corrected_text: string;
  transcription: string | null;
  transcription_error: string | null;
  wer: number | null;
  error_count: number | null;
  diff: DiffSegment[];
}

// ── Helpers ──────────────────────────────────────────────────────────────

function formatDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec <= 0) return '00:00';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function formatTime(sec: number): string {
  if (!Number.isFinite(sec)) return '--:--';
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
}

function werColor(wer: number | null | undefined): string {
  if (wer === null || wer === undefined) return 'text-gray-500';
  if (wer === 0) return 'text-green-600 dark:text-green-400 font-medium';
  if (wer <= 0.1) return 'text-green-600 dark:text-green-400';
  if (wer <= 0.3) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400 font-medium';
}

function formatPercent(value: number | null | undefined): string {
  if (value === null || value === undefined) return '–';
  return `${(value * 100).toFixed(1)}%`;
}

// ── Component ────────────────────────────────────────────────────────────

export default function TrainingView() {
  const { username } = useAuth();
  const isRoot = (username || '').toLowerCase() === 'root';

  const [stats, setStats] = useState<TrainingStats | null>(null);
  const [samples, setSamples] = useState<TrainingSample[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [verifyingAll, setVerifyingAll] = useState(false);
  const [verifyingId, setVerifyingId] = useState<number | null>(null);
  const [verifyResults, setVerifyResults] = useState<Record<number, VerifyResult>>({});
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const [filterTouchedOnly, setFilterTouchedOnly] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');

  const loadAll = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [statsRes, listRes] = await Promise.all([
        fetchWithDbToken('/api/training-samples?stats=true'),
        fetchWithDbToken('/api/training-samples'),
      ]);
      if (!statsRes.ok) throw new Error(`Stats laden fehlgeschlagen (${statsRes.status})`);
      if (!listRes.ok) throw new Error(`Liste laden fehlgeschlagen (${listRes.status})`);
      const statsJson = await statsRes.json();
      const listJson = await listRes.json();
      setStats(statsJson);
      setSamples(listJson.samples || []);
    } catch (err: any) {
      setError(err.message || 'Unbekannter Fehler');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isRoot) loadAll();
  }, [isRoot, loadAll]);

  const verifyOne = useCallback(async (id: number) => {
    try {
      setVerifyingId(id);
      setExpandedId(id);
      const res = await fetchWithDbToken('/api/training-samples/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Prüfung fehlgeschlagen (${res.status})`);
      setVerifyResults((prev) => ({ ...prev, [id]: data }));
      await loadAll();
    } catch (err: any) {
      alert(`Fehler: ${err.message}`);
    } finally {
      setVerifyingId(null);
    }
  }, [loadAll]);

  const verifyAll = useCallback(async () => {
    if (samples.length === 0) return;
    if (!confirm(`Alle ${samples.length} Markierungen prüfen? Das kann mehrere Minuten dauern.`)) return;
    try {
      setVerifyingAll(true);
      const res = await fetchWithDbToken('/api/training-samples/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `Prüfung fehlgeschlagen (${res.status})`);
      const map: Record<number, VerifyResult> = {};
      for (const r of data.results || []) map[r.sample_id] = r;
      setVerifyResults(map);
      await loadAll();
    } catch (err: any) {
      alert(`Fehler: ${err.message}`);
    } finally {
      setVerifyingAll(false);
    }
  }, [samples.length, loadAll]);

  const playSlice = useCallback(async (s: TrainingSample) => {
    try {
      const res = await fetchWithDbToken(`/api/training-samples/audio?id=${s.id}`);
      if (!res.ok) throw new Error(`Audio-Laden fehlgeschlagen (${res.status})`);
      const buf = await res.arrayBuffer();
      const blob = new Blob([buf], { type: 'audio/wav' });
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (err: any) {
      alert(`Audio-Fehler: ${err.message}`);
    }
  }, []);

  const deleteSample = useCallback(async (id: number) => {
    if (!confirm('Trainingsmarkierung löschen?')) return;
    try {
      const res = await fetchWithDbToken(`/api/training-samples?id=${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Löschen fehlgeschlagen');
      await loadAll();
    } catch (err: any) {
      alert(`Fehler: ${err.message}`);
    }
  }, [loadAll]);

  if (!isRoot) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500 p-8">
        🔒 Nur der Root-Nutzer darf auf Trainingsdaten zugreifen.
      </div>
    );
  }

  const filtered = samples.filter((s) => {
    if (filterTouchedOnly && !s.last_verify_at) return false;
    if (searchTerm.trim()) {
      const hay = `${s.voxtral_raw_text} ${s.corrected_text} ${s.dictation?.order_number || ''} ${s.dictation?.patient_name || ''} ${s.note || ''}`.toLowerCase();
      if (!hay.includes(searchTerm.trim().toLowerCase())) return false;
    }
    return true;
  });

  return (
    <div className="h-full overflow-y-auto p-4 space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-semibold">🎓 Trainingsdaten</h1>
        <div className="flex gap-2 items-center">
          {loading && <Spinner size={16} />}
          <button className="btn btn-sm btn-ghost" onClick={loadAll}>🔄 Aktualisieren</button>
          <button
            className="btn btn-sm btn-primary"
            onClick={verifyAll}
            disabled={verifyingAll || samples.length === 0}
            title="Alle Markierungen mit aktuellem Voxtral-Modell prüfen"
          >
            {verifyingAll ? <><Spinner size={14} /> Prüfe…</> : '🔬 Alle prüfen'}
          </button>
        </div>
      </div>

      {error && (
        <div className="alert alert-error text-sm">
          <span>⚠️ {error}</span>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard label="Markierungen" value={stats?.total_samples?.toString() ?? '–'} icon="🎯" />
        <StatCard label="Audio gesamt" value={formatDuration(stats?.total_audio_seconds ?? 0)} icon="⏱️" />
        <StatCard label="Wörter gesamt" value={stats?.total_words?.toString() ?? '–'} icon="📝" />
        <StatCard label="Diktate markiert" value={stats?.total_dictations_touched?.toString() ?? '–'} icon="📚" />
      </div>
      {stats && stats.last_verify_count > 0 && (
        <div className="text-sm text-gray-600 dark:text-gray-400">
          ✅ {stats.last_verify_count} mal geprüft – durchschnittliche WER: <span className={werColor(stats.last_verify_avg_wer)}>{formatPercent(stats.last_verify_avg_wer)}</span>
          {stats.last_verify_avg_error_count !== null && (
            <> (⌀ {stats.last_verify_avg_error_count.toFixed(1)} Fehler pro Abschnitt)</>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-2 flex-wrap items-center">
        <input
          type="text"
          placeholder="🔍 Suchen (Text, Nummer, Patient…)"
          className="input input-sm input-bordered flex-1 min-w-[200px]"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
        <label className="label cursor-pointer gap-2 text-sm">
          <input
            type="checkbox"
            className="checkbox checkbox-sm"
            checked={filterTouchedOnly}
            onChange={(e) => setFilterTouchedOnly(e.target.checked)}
          />
          <span>nur bereits geprüfte</span>
        </label>
      </div>

      {/* Samples list */}
      {filtered.length === 0 ? (
        <div className="text-center py-12 text-gray-500">
          {samples.length === 0
            ? 'Noch keine Trainingsmarkierungen vorhanden. Markiere Abschnitte im Archiv.'
            : 'Keine Treffer für die aktuelle Filterung.'}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map((s) => {
            const v = verifyResults[s.id];
            const werShown = v?.wer ?? s.last_verify_wer;
            const expanded = expandedId === s.id;
            return (
              <div key={s.id} className="card card-compact bg-base-100 shadow border border-gray-200 dark:border-gray-700">
                <div className="card-body">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap text-sm">
                      <span className="font-mono text-xs px-2 py-0.5 rounded bg-gray-100 dark:bg-gray-800">
                        #{s.dictation?.order_number || s.dictation_id}
                      </span>
                      {s.dictation?.patient_name && (
                        <span className="text-gray-600 dark:text-gray-400">{s.dictation.patient_name}</span>
                      )}
                      <span className="text-xs text-gray-500">·</span>
                      <span className="font-mono text-xs text-gray-600 dark:text-gray-400">
                        {formatTime(s.start_time)}–{formatTime(s.end_time)}
                      </span>
                      <span className="text-xs text-gray-500">·</span>
                      <span className="text-xs">{s.word_count} Wörter</span>
                      {s.note && (
                        <span className="ml-1 badge badge-sm badge-ghost" title="Notiz">{s.note}</span>
                      )}
                    </div>
                    <div className="flex gap-1">
                      <button className="btn btn-xs btn-outline" onClick={() => playSlice(s)} title="Audio-Abschnitt abspielen">🔊</button>
                      <button
                        className="btn btn-xs btn-outline"
                        onClick={() => verifyOne(s.id)}
                        disabled={verifyingId === s.id}
                        title="Diesen Abschnitt mit aktuellem Modell prüfen"
                      >
                        {verifyingId === s.id ? <Spinner size={12} /> : '🔬 Prüfen'}
                      </button>
                      <button
                        className="btn btn-xs btn-ghost"
                        onClick={() => setExpandedId(expanded ? null : s.id)}
                      >
                        {expanded ? '▴' : '▾'}
                      </button>
                      <button className="btn btn-xs btn-ghost text-red-500" onClick={() => deleteSample(s.id)} title="Löschen">🗑️</button>
                    </div>
                  </div>

                  {/* WER badge */}
                  {(v || s.last_verify_wer !== null) && (
                    <div className="flex items-center gap-2 text-xs flex-wrap">
                      <span className="text-gray-500 dark:text-gray-400">WER</span>
                      <span className={`font-mono font-medium ${werColor(werShown)}`}>{formatPercent(werShown)}</span>
                      {(v?.error_count ?? s.last_verify_error_count) !== null && (v?.error_count ?? s.last_verify_error_count) !== undefined && (
                        <span className="text-gray-500">
                          ({v?.error_count ?? s.last_verify_error_count} Fehler)
                        </span>
                      )}
                      {s.last_verify_at && !v && (
                        <span className="text-gray-400">· zuletzt {new Date(s.last_verify_at).toLocaleString()}</span>
                      )}
                    </div>
                  )}

                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                    <div>
                      <div className="text-gray-500 dark:text-gray-400 mb-0.5">🎤 Voxtral-Original</div>
                      <div className="rounded bg-orange-50 dark:bg-orange-900/10 p-1.5 border border-orange-200 dark:border-orange-800 whitespace-pre-wrap line-clamp-3">
                        {s.voxtral_raw_text}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500 dark:text-gray-400 mb-0.5">✓ Korrigiert</div>
                      <div className="rounded bg-green-50 dark:bg-green-900/10 p-1.5 border border-green-200 dark:border-green-800 whitespace-pre-wrap line-clamp-3">
                        {s.corrected_text}
                      </div>
                    </div>
                    <div>
                      <div className="text-gray-500 dark:text-gray-400 mb-0.5">🔬 Aktuelle Prüfung</div>
                      <div className="rounded bg-blue-50 dark:bg-blue-900/10 p-1.5 border border-blue-200 dark:border-blue-800 whitespace-pre-wrap line-clamp-3">
                        {v?.transcription || s.last_verify_text || <span className="text-gray-400 italic">Noch nicht geprüft</span>}
                      </div>
                    </div>
                  </div>

                  {/* Expanded details: full diff */}
                  {expanded && (
                    <div className="mt-2 pt-2 border-t border-gray-200 dark:border-gray-700 space-y-2 text-xs">
                      <div className="text-xs text-gray-500 dark:text-gray-400">Vollständiger Textvergleich:</div>
                      {v?.diff ? (
                        <div className="font-mono leading-relaxed bg-gray-50 dark:bg-gray-800 p-2 rounded whitespace-pre-wrap">
                          {v.diff.map((d, i) => (
                            <span
                              key={i}
                              className={
                                d.type === 'equal'
                                  ? 'text-gray-700 dark:text-gray-300'
                                  : d.type === 'insert'
                                  ? 'bg-red-200 dark:bg-red-900/60 text-red-900 dark:text-red-100 rounded'
                                  : 'bg-green-200 dark:bg-green-900/60 text-green-900 dark:text-green-100 line-through rounded'
                              }
                            >
                              {d.value}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <div className="text-gray-500 italic">
                          Keine Prüfung vorhanden. &laquo;Prüfen&raquo;-Button startet eine neue Voxtral-Transkription ohne Wörterbuch-Korrektur.
                        </div>
                      )}
                      {v?.transcription_error && (
                        <div className="text-red-600 dark:text-red-400">⚠️ {v.transcription_error}</div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: string; icon: string }) {
  return (
    <div className="stats bg-base-100 shadow border border-gray-200 dark:border-gray-700">
      <div className="stat">
        <div className="stat-title text-xs flex items-center gap-1">{icon} {label}</div>
        <div className="stat-value text-xl">{value}</div>
      </div>
    </div>
  );
}
