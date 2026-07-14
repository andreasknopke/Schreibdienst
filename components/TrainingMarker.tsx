"use client";

import { useCallback, useEffect, useMemo, useState } from 'react';
import { fetchWithDbToken } from '@/lib/fetchWithDbToken';
import { extractCorrectedSliceForTimeRange } from '@/lib/anchorMatching';
import { useAuth } from './AuthProvider';
import Spinner from './Spinner';

// ── Types ────────────────────────────────────────────────────────────────

interface SegmentWord {
  word: string;
  start: number;
  end: number;
}
interface Segment {
  start: number;
  end: number;
  text: string;
  words?: SegmentWord[];
}

interface TrainingSample {
  id: number;
  dictation_id: number;
  voxtral_raw_text: string;
  corrected_text: string;
  start_time: number;
  end_time: number;
  word_count: number;
  note?: string | null;
  last_verify_text?: string | null;
  last_verify_model?: string | null;
  last_verify_at?: string | null;
  last_verify_wer?: number | null;
  last_verify_error_count?: number | null;
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

interface Props {
  dictationId: number;
  segments: Segment[];
  /** whole corrected text of the dictation (prefill for new sample) */
  defaultCorrectedText: string;
  /** allow navigation: jump audio to a timestamp */
  onSeek?: (seconds: number) => void;
}

interface DraftState {
  startTime: number;
  endTime: number;
  voxtralRaw: string;
  corrected: string;
  note: string;
  editId: number | null;
}

export default function TrainingMarker({
  dictationId,
  segments,
  defaultCorrectedText,
  onSeek,
}: Props) {
  const { username, getAuthHeader } = useAuth();
  const isRoot = (username || '').toLowerCase() === 'root';

  // Wrapper: fetchWithDbToken already injects X-DB-Token, but root-only API
  // routes additionally require `Authorization: Basic ...` (see getAuthenticatedRoot).
  const authFetch = (url: string, opts: RequestInit = {}) =>
    fetchWithDbToken(url, {
      ...opts,
      headers: { ...opts.headers, Authorization: getAuthHeader() },
    });

  const [samples, setSamples] = useState<TrainingSample[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showModal, setShowModal] = useState(false);
  const [draft, setDraft] = useState<DraftState | null>(null);
  const [saving, setSaving] = useState(false);
  const [verifyingId, setVerifyingId] = useState<number | null>(null);
  const [verifyResults, setVerifyResults] = useState<Record<number, VerifyResult>>({});

  // Flatten words for selection
  const flatWords = useMemo<SegmentWord[]>(() => {
    const out: SegmentWord[] = [];
    for (const s of segments) {
      if (s.words && s.words.length > 0) {
        for (const w of s.words) {
          if (typeof w.start === 'number' && typeof w.end === 'number') {
            out.push(w);
          }
        }
      }
    }
    return out;
  }, [segments]);

  const hasTimedWords = flatWords.length > 0;

  const loadSamples = useCallback(async () => {
    if (!dictationId) return;
    try {
      setLoading(true);
      setError(null);
      const res = await authFetch(`/api/training-samples?dictationId=${dictationId}`);
      if (!res.ok) throw new Error(`Laden fehlgeschlagen (${res.status})`);
      const data = await res.json();
      setSamples(data.samples || []);
    } catch (err: any) {
      setError(err.message || 'Unbekannter Fehler');
    } finally {
      setLoading(false);
    }
  }, [dictationId]);

  useEffect(() => {
    if (isRoot) loadSamples();
  }, [isRoot, loadSamples]);

  // ── Handlers ──────────────────────────────────────────────────────────

  const startNewDraft = useCallback(() => {
    if (!hasTimedWords) {
      // No timestamped words → fall back to numerical entry
      setDraft({
        startTime: 0,
        endTime: 0,
        voxtralRaw: '',
        corrected: defaultCorrectedText.slice(0, 200),
        note: '',
        editId: null,
      });
    } else {
      // Default window = first ~5 timestamped words.
      const startTime = flatWords[0].start;
      const endTime = flatWords[Math.min(flatWords.length - 1, 4)].end;
      prefillDraftFromRange(startTime, endTime, null);
    }
    setShowModal(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flatWords, hasTimedWords, defaultCorrectedText]);

  /**
   * Build a draft with voxtralRaw + corrected auto-filled from the [startTime, endTime] window:
   *   - voxtralRaw = joined words from segments within the window (what voxtral produced)
   *   - corrected  = matching section of the FINAL corrected manuscript (Ziel)
   * If `editId` is null a new draft is created; otherwise an existing one is populated.
   * Falls back to defaultCorrectedText[0..200] when anchor matching finds no overlap
   * (e.g. empty corrected text or wildly mismatched transcripts).
   */
  const prefillDraftFromRange = useCallback(
    (startTime: number, endTime: number, editId: number | null, note = '') => {
      // Guard against inverted ranges: keep canonical [lo, hi].
      const lo = Math.min(startTime, endTime);
      const hi = Math.max(startTime, endTime);
      const voxtralSlice = flatWords
        .filter((x) => x.start >= lo - 0.001 && x.end <= hi + 0.001)
        .map((x) => x.word)
        .join(' ');
      const correctedSlice =
        extractCorrectedSliceForTimeRange(segments, defaultCorrectedText, lo, hi) ||
        defaultCorrectedText.slice(0, 200);
      setDraft({
        startTime: lo,
        endTime: hi,
        voxtralRaw: voxtralSlice,
        corrected: correctedSlice,
        note,
        editId,
      });
    },
    [flatWords, segments, defaultCorrectedText]
  );

  const editExisting = useCallback(
    (s: TrainingSample) => {
      setDraft({
        startTime: s.start_time,
        endTime: s.end_time,
        voxtralRaw: s.voxtral_raw_text,
        corrected: s.corrected_text,
        note: s.note || '',
        editId: s.id,
      });
      setShowModal(true);
    },
    []
  );

  const deleteSample = useCallback(
    async (id: number) => {
      if (!confirm('Trainingsmarkierung wirklich löschen?')) return;
      try {
        const res = await authFetch(`/api/training-samples?id=${id}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('Löschen fehlgeschlagen');
        await loadSamples();
      } catch (err: any) {
        alert(`Fehler: ${err.message}`);
      }
    },
    [loadSamples]
  );

  const saveDraft = useCallback(async () => {
    if (!draft) return;
    if (!draft.voxtralRaw.trim() || !draft.corrected.trim()) {
      alert('Voxtral-Originaltext und korrigierter Text sind erforderlich.');
      return;
    }
    if (!(draft.endTime > draft.startTime)) {
      alert('End-Zeit muss nach der Start-Zeit liegen.');
      return;
    }
    try {
      setSaving(true);
      const body = {
        dictation_id: dictationId,
        voxtral_raw_text: draft.voxtralRaw,
        corrected_text: draft.corrected,
        start_time: draft.startTime,
        end_time: draft.endTime,
        note: draft.note || undefined,
      };
      const res = await authFetch('/api/training-samples', {
        method: draft.editId ? 'PATCH' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: draft.editId ? JSON.stringify({ id: draft.editId, ...body }) : JSON.stringify(body),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || `Speichern fehlgeschlagen (${res.status})`);
      }
      setShowModal(false);
      setDraft(null);
      await loadSamples();
    } catch (err: any) {
      alert(`Fehler: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }, [draft, dictationId, loadSamples]);

  const verifyOne = useCallback(
    async (id: number) => {
      try {
        setVerifyingId(id);
        const res = await authFetch('/api/training-samples/verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || `Prüfung fehlgeschlagen (${res.status})`);
        setVerifyResults((prev) => ({ ...prev, [id]: data }));
        await loadSamples();
      } catch (err: any) {
        alert(`Fehler bei der Prüfung: ${err.message}`);
      } finally {
        setVerifyingId(null);
      }
    },
    [loadSamples]
  );

  const playSlice = useCallback(async (s: TrainingSample) => {
    try {
      const res = await authFetch(`/api/training-samples/audio?id=${s.id}`);
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

  // ── Render ────────────────────────────────────────────────────────────

  if (!isRoot) return null;

  return (
    <div className="border-t border-gray-200 dark:border-gray-700 pt-3 mt-3 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-2">
          🎯<span>Trainingsdaten ({samples.length})</span>
        </div>
        <div className="flex items-center gap-2">
          {loading && <Spinner size={14} />}
          <button className="btn btn-xs btn-primary" onClick={startNewDraft} title="Abschnitt fürs Training markieren">
            ➕ Für Training markieren
          </button>
        </div>
      </div>

      {error && <div className="text-sm text-red-600 dark:text-red-400">⚠️ {error}</div>}

      {!hasTimedWords && (
        <div className="text-xs text-amber-600 dark:text-amber-400">
          ℹ️ Keine Wort-Zeitstempel vorhanden. Zeitbereich muss manuell eingetragen werden.
        </div>
      )}

      {/* Existing marks */}
      {samples.length > 0 && (
        <div className="space-y-2">
          {samples.map((s) => {
            const v = verifyResults[s.id];
            const werShown = v?.wer ?? s.last_verify_wer;
            return (
              <div
                key={s.id}
                className="rounded-lg border border-gray-200 dark:border-gray-700 p-2 text-sm space-y-1"
              >
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="font-mono text-xs text-gray-600 dark:text-gray-400">
                    {formatTime(s.start_time)} – {formatTime(s.end_time)}
                    <span className="ml-2 text-gray-500">·</span>
                    <span className="ml-1">{s.word_count} Wörter</span>
                    {s.last_verify_at && (
                      <>
                        <span className="ml-2 text-gray-500">·</span>
                        <span className="ml-1">zuletzt geprüft {werColor(werShown)}({formatPercent(werShown)})</span>
                      </>
                    )}
                  </div>
                  <div className="flex gap-1">
                    <button className="btn btn-xs btn-outline" onClick={() => playSlice(s)} title="Audio-Abschnitt abspielen">🔊</button>
                    {onSeek && (
                      <button className="btn btn-xs btn-outline" onClick={() => onSeek(s.start_time)} title="Im Player dorthin springen">⏯</button>
                    )}
                    <button
                      className="btn btn-xs btn-outline"
                      onClick={() => verifyOne(s.id)}
                      disabled={verifyingId === s.id}
                      title="Mit aktuellem Voxtral-Modell prüfen (ohne Wörterbuch)"
                    >
                      {verifyingId === s.id ? <Spinner size={12} /> : '🔬'}
                    </button>
                    <button className="btn btn-xs btn-outline" onClick={() => editExisting(s)} title="Bearbeiten">✏️</button>
                    <button className="btn btn-xs btn-outline" onClick={() => deleteSample(s.id)} title="Löschen">🗑️</button>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                  <div>
                    <div className="text-gray-500 dark:text-gray-400 mb-0.5">🎤 Voxtral-Original</div>
                    <div className="rounded bg-orange-50 dark:bg-orange-900/10 p-1.5 border border-orange-200 dark:border-orange-800 whitespace-pre-wrap">
                      {s.voxtral_raw_text}
                    </div>
                  </div>
                  <div>
                    <div className="text-gray-500 dark:text-gray-400 mb-0.5">✓ Korrigiert</div>
                    <div className="rounded bg-green-50 dark:bg-green-900/10 p-1.5 border border-green-200 dark:border-green-800 whitespace-pre-wrap">
                      {s.corrected_text}
                    </div>
                  </div>
                </div>

                {v && (
                  <div className="rounded border border-blue-200 dark:border-blue-800 p-1.5 text-xs space-y-1 bg-blue-50 dark:bg-blue-900/10">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-blue-700 dark:text-blue-300">🔬 Aktuelle Prüfung</span>
                      {v.wer !== null && (
                        <>
                          <span>WER</span>
                          <span className={werColor(v.wer)}>{formatPercent(v.wer)}</span>
                          {v.error_count !== null && (
                            <span className="text-gray-500">({v.error_count} Fehler)</span>
                          )}
                        </>
                      )}
                    </div>
                    {v.transcription_error ? (
                      <div className="text-red-600 dark:text-red-400">⚠️ {v.transcription_error}</div>
                    ) : (
                      <div>
                        <span className="text-gray-500 dark:text-gray-400">Erkannt:</span>{' '}
                        <span className="whitespace-pre-wrap">{v.transcription}</span>
                      </div>
                    )}
                    {v.diff && v.diff.length > 0 && (
                      <div className="font-mono leading-relaxed">
                        {v.diff.map((d, i) => (
                          <span
                            key={i}
                            className={
                              d.type === 'equal'
                                ? 'text-gray-600 dark:text-gray-400'
                                : d.type === 'insert'
                                ? 'bg-red-200 dark:bg-red-900/60 text-red-900 dark:text-red-100 rounded'
                                : 'bg-green-200 dark:bg-green-900/60 text-green-900 dark:text-green-100 line-through rounded'
                            }
                          >
                            {d.value}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {samples.length === 0 && !loading && (
        <div className="text-xs text-gray-400">Noch keine Trainingsmarkierungen für dieses Diktat.</div>
      )}

      {/* Modal */}
      {showModal && draft && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowModal(false)} />
          <div className="card relative z-10 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="card-body space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="font-medium">
                  {draft.editId ? '✏️ Trainingsmarkierung bearbeiten' : '🎯 Neue Trainingsmarkierung'}
                </h3>
                <button className="text-gray-500 hover:text-gray-700 text-xl" onClick={() => setShowModal(false)}>✕</button>
              </div>

              {/* Time range + voxtral picker */}
              <div className="space-y-2">
                <div className="flex items-end gap-2 flex-wrap">
                  <label className="text-xs">
                    <span className="block text-gray-500 dark:text-gray-400 mb-0.5">Start (Sek.)</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="input input-sm input-bordered w-28"
                      value={draft.startTime}
                      onChange={(e) => setDraft({ ...draft, startTime: parseFloat(e.target.value) || 0 })}
                    />
                  </label>
                  <label className="text-xs">
                    <span className="block text-gray-500 dark:text-gray-400 mb-0.5">Ende (Sek.)</span>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="input input-sm input-bordered w-28"
                      value={draft.endTime}
                      onChange={(e) => setDraft({ ...draft, endTime: parseFloat(e.target.value) || 0 })}
                    />
                  </label>
                  {onSeek && (
                    <>
                      <button
                        className="btn btn-xs btn-outline"
                        onClick={() => onSeek(draft.startTime)}
                        title="Start im Player anhören"
                      >▶ Start</button>
                      <button
                        className="btn btn-xs btn-outline"
                        onClick={() => onSeek(Math.max(0, draft.endTime - 1))}
                        title="Ende im Player anhören"
                      >▶ Ende</button>
                    </>
                  )}
                </div>

                {hasTimedWords && (
                  <div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mb-1">
                      Wortauswahl (klick = Bereich anpassen). Klick vor/hinter dem Bereich vergrößert; Klick innerhalb des Bereichs verschiebt die nähere Grenze. Voxtral-Original und korrigierter Zieltext werden automatisch passend zum Zeitbereich übernommen.
                    </div>
                    <div className="max-h-44 overflow-y-auto rounded border border-gray-200 dark:border-gray-700 p-2 text-sm leading-relaxed bg-gray-50 dark:bg-gray-800 flex flex-wrap gap-0.5">
                      {flatWords.map((w, i) => {
                        const inRange =
                          w.start >= draft.startTime - 0.001 && w.end <= draft.endTime + 0.001;
                        return (
                          <button
                            key={i}
                            onClick={() => {
                              if (i === 0) return;
                              const wordEnd = flatWords[i].end;
                              const wordStart = flatWords[i].start;
                              let newStart = draft.startTime;
                              let newEnd = draft.endTime;
                              if (wordEnd < draft.startTime - 0.001) {
                                // Word entirely before range → extend start leftward.
                                newStart = wordStart;
                              } else if (wordStart > draft.endTime + 0.001) {
                                // Word entirely after range → extend end rightward.
                                newEnd = wordEnd;
                              } else {
                                // Word inside range → move the NEARER boundary
                                // to this word. Left half moves start (rightward),
                                // right half moves end (leftward), so clicks on
                                // the tail shrink the end rather than extend it.
                                const mid = (draft.startTime + draft.endTime) / 2;
                                if (wordStart < mid) {
                                  newStart = wordStart;
                                } else {
                                  newEnd = wordEnd;
                                }
                              }
                              prefillDraftFromRange(newStart, newEnd, draft.editId, draft.note);
                            }}
                            title={`${w.start.toFixed(2)}–${w.end.toFixed(2)}s`}
                            className={`px-1 rounded hover:bg-blue-100 dark:hover:bg-blue-900 ${
                              inRange
                                ? 'bg-blue-200 dark:bg-blue-900 text-blue-900 dark:text-blue-100'
                                : 'text-gray-700 dark:text-gray-300'
                            }`}
                          >
                            {w.word}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <label className="text-xs block">
                  <span className="text-gray-500 dark:text-gray-400 mb-0.5 flex items-center justify-between gap-2">
                    <span>🎤 Voxtral-Original (was das Modell gemacht hat)</span>
                    <button
                      className="btn btn-xs btn-ghost"
                      onClick={() => prefillDraftFromRange(draft.startTime, draft.endTime, draft.editId, draft.note)}
                      title="Voxtral-Original und korrigierten Zieltext aus dem aktuellen Zeitbereich neu übernehmen (überschreibt manuelle Eingaben)"
                    >🔄 Aus Zeitbereich neu laden</button>
                  </span>
                  <textarea
                    className="textarea textarea-bordered w-full text-sm font-mono"
                    rows={3}
                    value={draft.voxtralRaw}
                    onChange={(e) => setDraft({ ...draft, voxtralRaw: e.target.value })}
                  />
                </label>

                <label className="text-xs block">
                  <span className="text-gray-500 dark:text-gray-400 mb-0.5 block">
                    ✓ Korrigierter Text (Ziel) – wird automatisch aus dem finalen Manuskript für den gewählten Zeitbereich übernommen
                  </span>
                  <textarea
                    className="textarea textarea-bordered w-full text-sm"
                    rows={4}
                    value={draft.corrected}
                    onChange={(e) => setDraft({ ...draft, corrected: e.target.value })}
                  />
                </label>

                <label className="text-xs block">
                  <span className="text-gray-500 dark:text-gray-400 mb-0.5 block">Notiz (optional)</span>
                  <input
                    type="text"
                    className="input input-sm input-bordered w-full"
                    placeholder="z.B. Fremdwort, Halluzination, Zahl"
                    value={draft.note}
                    onChange={(e) => setDraft({ ...draft, note: e.target.value })}
                  />
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                <button className="btn btn-sm btn-ghost" onClick={() => setShowModal(false)}>Abbrechen</button>
                <button className="btn btn-sm btn-primary" disabled={saving} onClick={saveDraft}>
                  {saving ? <Spinner size={14} /> : (draft.editId ? '💾 Speichern' : '🎯 Markierung anlegen')}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
