import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import AppBar from '../components/AppBar';
import Segmented from '../components/Segmented';
import { AXIS, ChartReadout, pickCategory, pickNumeric, useChartScrub, usePinchZoom, Val, ZoomBadge } from '../components/Charts';
import type { Activity, Sport } from '../lib/analysis/types';
import { db } from '../lib/db';
import { fmtDate, fmtDuration, fmtDurationShort, fmtKm, fmtMeters, fmtPace } from '../lib/format';
import { addWeeks, effortsBetween, longest, predictionSeries, predictTime, PREDICT_TARGETS, records, volumeOf, weeklyVolumes, weekStart } from '../lib/stats';

const PERIODS = [{ weeks: 13, label: '3 mois' }, { weeks: 26, label: '6 mois' }, { weeks: 52, label: '1 an' }];
const shortDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const targetLabel = (sport: Sport, d: number) => (sport === 'swimming' ? `${d} m` : d === 21097 ? 'Semi' : d === 42195 ? 'Marathon' : `${d / 1000} km`);
/** Allure correspondant à un temps sur une distance : /km (course) ou /100 m (natation). */
const paceOf = (sport: Sport, d: number, t: number) => (sport === 'running' ? `${fmtPace((t / d) * 1000)} /km` : `${fmtPace((t / d) * 100)} /100 m`);

export default function Progress() {
  const [sport, setSport] = useState<Sport>(() => { try { return (sessionStorage.getItem('prog-sport') as Sport) ?? 'running'; } catch { return 'running'; } });
  const [weeks, setWeeks] = useState(13);
  const all = useLiveQuery(() => db.activities.orderBy('startTime').toArray(), []);
  const choose = (s: Sport) => { setSport(s); try { sessionStorage.setItem('prog-sport', s); } catch { /* indisponible */ } };

  if (!all) return null;
  const from = addWeeks(weekStart(Date.now()), -(weeks - 1));
  const inPeriod = all.filter((a) => a.sport === sport && a.startTime >= from);
  const run = sport === 'running';
  const color = run ? 'var(--color-run)' : 'var(--color-swim)';
  const tot = volumeOf(inPeriod);

  return (
    <div className="space-y-4">
      <AppBar title="Progression" subtitle={`${tot.count} séance${tot.count > 1 ? 's' : ''} · ${run ? fmtKm(tot.distanceM) : fmtMeters(tot.distanceM)} · ${fmtDurationShort(tot.durationS)}`} />

      <div className="space-y-2">
        <Segmented options={[{ value: 'running' as Sport, label: 'Course' }, { value: 'swimming' as Sport, label: 'Natation' }]} value={sport} onChange={choose} />
        <Segmented size="sm" options={PERIODS.map((p) => ({ value: p.weeks, label: p.label }))} value={weeks} onChange={setWeeks} />
      </div>

      <Predictions key={`${sport}-${weeks}`} acts={all} sport={sport} weeks={weeks} from={from} color={color} />

      <section className="card p-4">
        <h2 className="font-semibold">Volume par semaine</h2>
        <WeeklyChart acts={all} sport={sport} weeks={weeks} color={color} />
      </section>

      <Records acts={all} sport={sport} />
    </div>
  );
}

// ───────────────────────────────────────────────────────────── Prédictions

function Predictions({ acts, sport, weeks, from, color }: { acts: Activity[]; sport: Sport; weeks: number; from: number; color: string }) {
  const targets = PREDICT_TARGETS[sport];
  const [target, setTarget] = useState(targets[0]);
  const efforts = useMemo(() => effortsBetween(acts, sport, from, Infinity), [acts, sport, from]);
  const current = targets.map((d) => ({ d, p: predictTime(efforts, d) }));
  const series = useMemo(() => predictionSeries(acts, sport, target, weeks).map((w) => ({ ...w, x: w.start })), [acts, sport, target, weeks]);
  const firstVal = series.find((s) => s.durationS != null)?.durationS ?? null;
  const sel = current.find((c) => c.d === target)?.p ?? null;
  const delta = sel && firstVal != null ? Math.round(sel.durationS - firstVal) : null;

  if (!efforts.length) {
    return (
      <section className="card p-4">
        <h2 className="font-semibold">Prédictions</h2>
        <p className="muted mt-1 text-sm">Pas encore de meilleurs efforts sur la période pour estimer tes temps.</p>
      </section>
    );
  }
  return (
    <section className="card p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold">Prédictions</h2>
        <span className="muted text-xs">sur la période</span>
      </div>
      <div className="mt-3 grid grid-cols-4 gap-1.5" data-noswipe>
        {current.map(({ d, p }) => (
          <button key={d} onClick={() => setTarget(d)}
            className={`pressable rounded-xl px-1 py-2 text-center transition-colors ${d === target ? 'bg-accent-soft ring-1 ring-accent/50' : 'bg-slate-50 dark:bg-slate-800/60'}`}>
            <span className={`block text-[11px] ${d === target ? 'font-semibold text-accent' : 'muted'}`}>{targetLabel(sport, d)}</span>
            <span className="block text-sm leading-tight font-semibold">{p ? fmtDuration(p.durationS) : '–'}</span>
          </button>
        ))}
      </div>
      {sel && (
        <div className="page-in mt-4" key={target}>
          <p className="text-3xl font-bold tracking-tight">{fmtDuration(sel.durationS)}</p>
          <p className="muted text-sm">
            {targetLabel(sport, target)} · {paceOf(sport, target, sel.durationS)}
            {delta != null && delta !== 0 && (
              <span className={delta < 0 ? 'ml-2 font-medium text-green-600 dark:text-green-400' : 'ml-2 font-medium text-amber-600 dark:text-amber-400'}>
                {delta < 0 ? '▲' : '▼'} {fmtDuration(Math.abs(delta))} depuis le début
              </span>
            )}
          </p>
          <p className="muted mt-0.5 text-xs">D'après ton meilleur {sel.from.distanceM >= 1000 ? `${sel.from.distanceM / 1000} km` : `${sel.from.distanceM} m`} ({fmtDuration(sel.from.durationS)})</p>
          <PredictionChart series={series} sport={sport} target={target} color={color} />
        </div>
      )}
      <p className="muted mt-2 text-[11px] leading-snug">
        Estimation par la formule de Riegel à partir de tes meilleurs efforts (fenêtre glissante de 6 semaines pour la courbe). Indicatif : elle suppose un entraînement adapté à la distance.
      </p>
    </section>
  );
}

function PredictionChart({ series, sport, target, color }: { series: { x: number; durationS: number | null }[]; sport: Sport; target: number; color: string }) {
  const zoom = usePinchZoom(series.length, 4);
  const view = series.slice(zoom.range[0], zoom.range[1] + 1);
  const scrub = useChartScrub(true, pickNumeric(view.map((d) => d.x)));
  useEffect(() => { scrub.clear(); }, [zoom.range[0], zoom.range[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  const vals = series.map((s) => s.durationS).filter((v): v is number => v != null);
  if (vals.length < 2) return <p className="muted mt-3 text-sm">Pas encore assez de semaines avec des efforts pour tracer une évolution.</p>;
  const pad = Math.max(10, (Math.max(...vals) - Math.min(...vals)) * 0.15);
  const domain: [number, number] = [Math.floor(Math.min(...vals) - pad), Math.ceil(Math.max(...vals) + pad)];
  const p = scrub.index != null ? view[scrub.index] : null;
  return (
    <div {...scrub.wrapperProps} className="mt-2 text-slate-500 dark:text-slate-400">
      <ChartReadout onClear={scrub.clear}
        summary={<>Évolution par semaine · plus haut = plus rapide</>}
        reading={p && (
          <>
            <span className="muted">Semaine du {shortDate.format(p.x)}</span>
            <Val color={color}>{p.durationS != null ? `${fmtDuration(p.durationS)} · ${paceOf(sport, target, p.durationS)}` : 'pas de données'}</Val>
          </>
        )} />
      <div ref={zoom.ref} style={{ touchAction: 'pan-x pan-y' }}>
        <ResponsiveContainer width="100%" height={170}>
          <ComposedChart data={view} margin={{ top: 6, right: 8, bottom: 0, left: -4 }}>
            <defs>
              <linearGradient id="g-pred" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.25} />
                <stop offset="100%" stopColor={color} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" strokeOpacity={0.12} />
            <XAxis dataKey="x" type="number" scale="time" domain={['dataMin', 'dataMax']} tick={AXIS} tickLine={false} tickFormatter={(t: number) => shortDate.format(t)} minTickGap={30} />
            <YAxis reversed domain={domain} tick={AXIS} tickLine={false} axisLine={false} width={50} tickFormatter={(v: number) => fmtDuration(v)} />
            {p && <ReferenceLine x={p.x} stroke="currentColor" strokeOpacity={0.5} />}
            <Area dataKey="durationS" type="monotone" stroke={color} strokeWidth={2.2} fill="url(#g-pred)" baseValue={domain[1]} connectNulls
              dot={{ r: 2.5, fill: color, strokeWidth: 0 }} activeDot={false} isAnimationActive animationDuration={600} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <ZoomBadge zoomed={zoom.zoomed} onReset={zoom.reset} />
    </div>
  );
}

// ───────────────────────────────────────────────────────────── Volume

function WeeklyChart({ acts, sport, weeks, color }: { acts: Activity[]; sport: Sport; weeks: number; color: string }) {
  const all = useMemo(() => weeklyVolumes(acts, sport, weeks).map((w) => ({
    label: shortDate.format(w.start),
    v: sport === 'running' ? Math.round(w.distanceM / 100) / 10 : Math.round(w.distanceM),
    count: w.count,
    dur: w.durationS,
  })), [acts, sport, weeks]);
  const zoom = usePinchZoom(all.length, 4);
  const data = all.slice(zoom.range[0], zoom.range[1] + 1);
  const scrub = useChartScrub(true, pickCategory(data.length));
  useEffect(() => { scrub.clear(); }, [zoom.range[0], zoom.range[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  const unit = sport === 'running' ? 'km' : 'm';
  const p = scrub.index != null ? data[scrub.index] : null;
  return (
    <div {...scrub.wrapperProps} className="text-slate-500 dark:text-slate-400">
      <ChartReadout onClear={scrub.clear}
        summary={<>Moyenne {(all.reduce((a, d) => a + d.v, 0) / Math.max(all.length, 1)).toLocaleString('fr-FR', { maximumFractionDigits: sport === 'running' ? 1 : 0 })} {unit} / semaine</>}
        reading={p && (
          <>
            <span className="muted">Semaine du {p.label}</span>
            <Val color={color}>{p.v.toLocaleString('fr-FR')} {unit}</Val>
            <span>{p.count} séance{p.count > 1 ? 's' : ''}{p.count ? ` · ${fmtDurationShort(p.dur)}` : ''}</span>
          </>
        )} />
      <div ref={zoom.ref} style={{ touchAction: 'pan-x pan-y' }}>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" strokeOpacity={0.12} />
            <XAxis dataKey="label" tick={AXIS} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
            <YAxis tick={AXIS} tickLine={false} axisLine={false} width={44} />
            <Bar dataKey="v" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive animationDuration={500}>
              {data.map((_, i) => <Cell key={i} fill={color} fillOpacity={scrub.index == null || scrub.index === i ? 1 : 0.45} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <ZoomBadge zoomed={zoom.zoomed} onReset={zoom.reset} />
    </div>
  );
}

const RUN_LABEL: Record<number, string> = { 1000: '1 km', 5000: '5 km', 10000: '10 km', 21097: 'Semi', 42195: 'Marathon' };

function Records({ acts, sport }: { acts: Activity[]; sport: Sport }) {
  const recs = records(acts, sport);
  const far = longest(acts, sport);
  if (!recs.length && !far) return null;
  const run = sport === 'running';
  return (
    <section className="card p-4">
      <h2 className="font-semibold">Records</h2>
      <p className="muted mb-3 text-xs">Meilleur temps sur la distance au cours d’une séance (portion la plus rapide), toutes périodes confondues.</p>
      <div className="grid grid-cols-2 gap-2 min-[420px]:grid-cols-3">
        {recs.map((r) => (
          <Link key={r.distanceM} to={`/seance/${encodeURIComponent(r.activityId)}`} className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/60">
            <p className="muted text-xs">{run ? RUN_LABEL[r.distanceM] ?? fmtKm(r.distanceM) : `${r.distanceM} m`}</p>
            <p className="text-lg font-semibold">{fmtDuration(r.durationS)}</p>
            <p className="muted text-[11px]">{run ? `${fmtPace((r.durationS / r.distanceM) * 1000)}/km` : `${fmtPace((r.durationS / r.distanceM) * 100)}/100 m`} · {fmtDate(r.startTime)}</p>
          </Link>
        ))}
        {far && (
          <Link to={`/seance/${encodeURIComponent(far.id)}`} className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/60">
            <p className="muted text-xs">Plus longue</p>
            <p className="text-lg font-semibold">{run ? fmtKm(far.distanceM) : fmtMeters(far.distanceM)}</p>
            <p className="muted text-[11px]">{fmtDate(far.startTime)}</p>
          </Link>
        )}
      </div>
    </section>
  );
}
