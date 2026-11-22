import { useLiveQuery } from 'dexie-react-hooks';
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, XAxis, YAxis } from 'recharts';
import AppBar from '../components/AppBar';
import { AXIS, ChartCarousel, ChartReadout, pickCategory, pickNumeric, useChartScrub, Val } from '../components/Charts';
import type { Activity, Sport } from '../lib/analysis/types';
import { db } from '../lib/db';
import { fmtDate, fmtDuration, fmtDurationShort, fmtKm, fmtMeters, fmtPace } from '../lib/format';
import { longest, records, volumeOf, weeklyVolumes } from '../lib/stats';

const PERIODS = [{ weeks: 13, label: '3 mois' }, { weeks: 26, label: '6 mois' }, { weeks: 52, label: '1 an' }];
const shortDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

export default function Progress() {
  const [sport, setSport] = useState<Sport>(() => { try { return (sessionStorage.getItem('prog-sport') as Sport) ?? 'running'; } catch { return 'running'; } });
  const [weeks, setWeeks] = useState(13);
  const all = useLiveQuery(() => db.activities.orderBy('startTime').toArray(), []);
  const choose = (s: Sport) => { setSport(s); try { sessionStorage.setItem('prog-sport', s); } catch { /* indisponible */ } };

  if (!all) return null;
  const from = Date.now() - weeks * 7 * 86_400_000;
  const inPeriod = all.filter((a) => a.sport === sport && a.startTime >= from);
  const run = sport === 'running';
  const color = run ? 'var(--color-run)' : 'var(--color-swim)';
  const tot = volumeOf(inPeriod);

  return (
    <div className="space-y-4">
      <AppBar title="Progression" />

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          {(['running', 'swimming'] as Sport[]).map((s) => (
            <button key={s} onClick={() => choose(s)}
              className={`h-10 rounded-full px-4 text-sm font-medium ${sport === s ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'card'}`}>
              {s === 'running' ? 'Course' : 'Natation'}
            </button>
          ))}
        </div>
        <div className="flex rounded-lg bg-slate-100 p-0.5 text-sm dark:bg-slate-800">
          {PERIODS.map((p) => (
            <button key={p.weeks} onClick={() => setWeeks(p.weeks)}
              className={`rounded-md px-2.5 py-1.5 ${weeks === p.weeks ? 'bg-white font-medium shadow-sm dark:bg-slate-700' : 'muted'}`}>{p.label}</button>
          ))}
        </div>
      </div>

      <p className="muted px-1 text-sm">
        {tot.count} séance{tot.count > 1 ? 's' : ''} · <b className="text-slate-900 dark:text-slate-100">{run ? fmtKm(tot.distanceM) : fmtMeters(tot.distanceM)}</b> · {fmtDurationShort(tot.durationS)}
      </p>

      <ChartCarousel key={`${sport}-${weeks}`} slides={[
        { title: 'Volume par semaine', render: (v) => <WeeklyChart acts={all} sport={sport} weeks={weeks} color={color} visible={v} /> },
        { title: 'Évolution de l’allure', render: (v) => <PaceChart acts={inPeriod} sport={sport} color={color} visible={v} /> },
      ]} />

      <Records acts={all} sport={sport} />
    </div>
  );
}

function WeeklyChart({ acts, sport, weeks, color, visible }: { acts: Activity[]; sport: Sport; weeks: number; color: string; visible: boolean }) {
  const data = useMemo(() => weeklyVolumes(acts, sport, weeks).map((w) => ({
    label: shortDate.format(w.start),
    v: sport === 'running' ? Math.round(w.distanceM / 100) / 10 : Math.round(w.distanceM),
    count: w.count,
    dur: w.durationS,
  })), [acts, sport, weeks]);
  const scrub = useChartScrub(visible, pickCategory(data.length));
  const unit = sport === 'running' ? 'km' : 'm';
  const p = scrub.index != null ? data[scrub.index] : null;
  return (
    <div {...scrub.wrapperProps} className="text-slate-500 dark:text-slate-400">
      <ChartReadout
        onClear={scrub.clear}
        summary={<>Moyenne {(data.reduce((a, d) => a + d.v, 0) / Math.max(data.length, 1)).toLocaleString('fr-FR', { maximumFractionDigits: sport === 'running' ? 1 : 0 })} {unit} / semaine</>}
        reading={p && (
          <>
            <span className="muted">Semaine du {p.label}</span>
            <Val color={color}>{p.v.toLocaleString('fr-FR')} {unit}</Val>
            <span>{p.count} séance{p.count > 1 ? 's' : ''}{p.count ? ` · ${fmtDurationShort(p.dur)}` : ''}</span>
          </>
        )}
      />
      <ResponsiveContainer width="100%" height={190}>
        <BarChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -12 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" strokeOpacity={0.15} />
          <XAxis dataKey="label" tick={AXIS} tickLine={false} interval="preserveStartEnd" minTickGap={24} />
          <YAxis tick={AXIS} tickLine={false} axisLine={false} width={44} />
          <Bar dataKey="v" radius={[4, 4, 0, 0]} isAnimationActive={false}>
            {data.map((_, i) => <Cell key={i} fill={color} fillOpacity={scrub.index == null || scrub.index === i ? 1 : 0.45} />)}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function PaceChart({ acts, sport, color, visible }: { acts: Activity[]; sport: Sport; color: string; visible: boolean }) {
  const data = useMemo(() => {
    const pts = acts
      .map((a) => ({ t: a.startTime, pace: sport === 'running' ? (a.running?.isInterval ? null : a.running?.avgPaceSPerKm) : a.swimming?.avgPace100S, dist: a.distanceM }))
      .filter((p): p is { t: number; pace: number; dist: number } => p.pace != null && p.pace > 0);
    return pts.map((p, i) => {
      const win = pts.slice(Math.max(0, i - 3), i + 1);
      return { ...p, trend: win.reduce((s, x) => s + x.pace, 0) / win.length };
    });
  }, [acts, sport]);
  const scrub = useChartScrub(visible, pickNumeric(data.map((d) => d.t)));

  if (data.length < 2) return <p className="muted py-6 text-center text-sm">Pas encore assez de séances sur la période.</p>;
  const paces = data.map((d) => d.pace);
  const lo = Math.floor((Math.min(...paces) - 10) / 15) * 15, hi = Math.ceil((Math.max(...paces) + 10) / 15) * 15;
  const unit = sport === 'running' ? '/km' : '/100 m';
  const p = scrub.index != null ? data[scrub.index] : null;
  return (
    <div {...scrub.wrapperProps} className="text-slate-500 dark:text-slate-400">
      <ChartReadout
        onClear={scrub.clear}
        summary={<>{sport === 'running' ? 'Sorties continues' : 'Allure au 100 m'} · ligne = tendance · plus haut = plus rapide</>}
        reading={p && (
          <>
            <span className="muted">{fmtDate(p.t)} · {sport === 'running' ? `${(p.dist / 1000).toFixed(1).replace('.', ',')} km` : `${Math.round(p.dist)} m`}</span>
            <Val color={color}>{fmtPace(p.pace)} {unit}</Val>
            <span>tendance {fmtPace(p.trend)} {unit}</span>
          </>
        )}
      />
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" strokeOpacity={0.15} />
          <XAxis dataKey="t" type="number" scale="time" domain={['dataMin', 'dataMax']} tick={AXIS} tickLine={false} tickFormatter={(t: number) => shortDate.format(t)} minTickGap={30} />
          <YAxis reversed domain={[lo, hi]} tick={AXIS} tickLine={false} axisLine={false} width={44} tickFormatter={(v: number) => fmtPace(v)} />
          {p && <ReferenceLine x={p.t} stroke="currentColor" strokeOpacity={0.5} />}
          <Scatter dataKey="pace" fill={color} isAnimationActive={false} />
          <Line dataKey="trend" stroke={color} strokeWidth={2} dot={false} activeDot={false} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
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
