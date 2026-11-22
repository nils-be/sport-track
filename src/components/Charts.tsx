import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { Area, Bar, BarChart, CartesianGrid, Cell, ComposedChart, ReferenceLine, ResponsiveContainer, XAxis, YAxis } from 'recharts';
import type { ActivityStreams, SwimmingAnalysis, SwimSet } from '../lib/analysis/types';
import { fmtDuration, fmtPace, STROKE_LABEL } from '../lib/format';

export const AXIS = { fontSize: 11, fill: 'currentColor' };
const CHART_H = 190;
const MAX_POINTS = 120;

// ───────────────────────────────────────────────────────────── Carrousel

export interface Slide {
  title: string;
  /** `visible` : la diapositive est affichée (sert à effacer une lecture quand on change de graphique). */
  render: (visible: boolean) => ReactNode;
}

/** Graphiques côte à côte, un par mesure : balayage horizontal aimanté et points indicateurs. */
export function ChartCarousel({ slides }: { slides: Slide[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const onScroll = () => {
    const el = ref.current;
    if (el) setIndex(Math.round(el.scrollLeft / Math.max(el.clientWidth, 1)));
  };
  const go = (i: number) => ref.current?.scrollTo({ left: i * ref.current.clientWidth, behavior: 'smooth' });
  if (!slides.length) return null;
  return (
    <section className="card overflow-hidden">
      <div className="flex items-center justify-between px-4 pt-3.5">
        <h2 className="font-semibold">{slides[index]?.title}</h2>
        {slides.length > 1 && (
          <div className="flex items-center gap-1.5" role="tablist" aria-label="Graphiques">
            {slides.map((s, i) => (
              <button key={s.title} role="tab" aria-selected={i === index} aria-label={s.title} onClick={() => go(i)}
                className={`h-2 rounded-full transition-all duration-300 ${i === index ? 'w-5 bg-accent' : 'w-2 bg-slate-300 dark:bg-slate-600'}`} />
            ))}
          </div>
        )}
      </div>
      <div ref={ref} onScroll={onScroll} className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain">
        {slides.map((s, i) => (
          <div key={s.title} className="w-full shrink-0 snap-center px-3 pt-1 pb-3">{s.render(i === index)}</div>
        ))}
      </div>
    </section>
  );
}

// ───────────────────────────────────────────────────────────── Lecture au tap

/** Choisit l'index du point le plus proche à partir de la position horizontale (0 → 1) dans la zone de tracé. */
export type Picker = (fraction: number) => number | null;

/** Axe numérique (distance, temps) : point dont l'abscisse est la plus proche. */
export const pickNumeric = (xs: number[]): Picker => (f) => {
  if (!xs.length) return null;
  const lo = Math.min(...xs), hi = Math.max(...xs);
  const target = lo + f * (hi - lo);
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (Math.abs(xs[i] - target) < Math.abs(xs[best] - target)) best = i;
  return best;
};

/** Axe par catégories (barres) : la barre sous le doigt. */
export const pickCategory = (n: number): Picker => (f) => (n ? Math.min(n - 1, Math.max(0, Math.floor(f * n))) : null);

/**
 * Lecture des valeurs au tap : un tap dans le graphique sélectionne le point le plus proche ;
 * un tap en dehors, ou le changement de graphique, efface la lecture.
 * Le point est calculé à partir de la position du tap dans la grille (indépendant des états internes de Recharts).
 * (Pas de lecture au glissement : le glissement horizontal sert au carrousel.)
 */
export function useChartScrub(visible: boolean, pick: Picker) {
  const [index, setIndex] = useState<number | null>(null);
  const wrapper = useRef<HTMLDivElement>(null);
  useEffect(() => { if (!visible) setIndex(null); }, [visible]);
  useEffect(() => {
    if (index == null) return;
    const outside = (e: PointerEvent) => { if (!wrapper.current?.contains(e.target as Node)) setIndex(null); };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [index]);
  const onClick = (e: ReactMouseEvent) => {
    const grid = wrapper.current?.querySelector('.recharts-cartesian-grid');
    const r = grid?.getBoundingClientRect();
    if (!r || !r.width || e.clientY < r.top - 8 || e.clientY > r.bottom + 24) return;
    setIndex(pick(Math.min(1, Math.max(0, (e.clientX - r.left) / r.width))));
  };
  return { index, clear: () => setIndex(null), wrapperProps: { ref: wrapper, onClick } };
}

/** Ligne fixe au-dessus du graphique : le résumé au repos, la valeur lue après un tap. */
export function ChartReadout({ reading, summary, onClear }: { reading: ReactNode | null; summary: ReactNode; onClear: () => void }) {
  return (
    <div className="flex min-h-8 items-center justify-center gap-2 text-xs">
      {reading ? (
        <>
          <div className="msg-in flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 font-medium text-slate-900 dark:text-slate-100">{reading}</div>
          <button onClick={(e) => { e.stopPropagation(); onClear(); }} aria-label="Effacer la lecture" className="muted -my-1 grid size-7 place-items-center rounded-full">×</button>
        </>
      ) : (
        <div className="muted flex flex-wrap items-center justify-center gap-x-3">{summary}</div>
      )}
    </div>
  );
}

/** Valeur colorée pour la ligne de lecture. */
export const Val = ({ color, children }: { color: string; children: ReactNode }) => (
  <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: color }} />{children}</span>
);

export const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
};

const grid = <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" strokeOpacity={0.12} />;
const hint = <p className="muted mt-1 text-center text-[11px]">Touche le graphique pour lire une valeur · balaye pour changer</p>;

// ───────────────────────────────────────────────────────────── Course

interface RunPoint { x: number; t: number; dist: number | null; pace: number | null; hr: number | null; alt: number | null }

/** Série allégée : ~120 tranches de temps moyennées (vitesse, FC, altitude). Abscisse = temps écoulé (minutes). */
function runSeries(streams: ActivityStreams) {
  const t0 = streams.t[0] ?? 0, t1 = streams.t[streams.t.length - 1] ?? 0;
  const step = (t1 - t0) / MAX_POINTS || 1;
  const buckets: { t: number; dist: number | null; sp: number[]; hr: number[]; alt: number[] }[] = [];
  for (let i = 0; i < streams.t.length; i++) {
    const k = Math.min(MAX_POINTS - 1, Math.floor((streams.t[i] - t0) / step));
    const b = (buckets[k] ??= { t: t0 + (k + 0.5) * step, dist: null, sp: [], hr: [], alt: [] });
    if (streams.distanceM[i] != null) b.dist = streams.distanceM[i];
    if (streams.speedMs[i] != null) b.sp.push(streams.speedMs[i]!);
    if (streams.hr[i] != null) b.hr.push(streams.hr[i]!);
    if (streams.altitudeM[i] != null) b.alt.push(streams.altitudeM[i]!);
  }
  const avg = (v: number[]) => (v.length ? v.reduce((a, c) => a + c, 0) / v.length : null);
  const pts: RunPoint[] = buckets.filter(Boolean).map((b) => {
    const sp = avg(b.sp);
    return {
      x: b.t / 60,
      t: b.t,
      dist: b.dist,
      pace: sp != null && sp > 1.2 ? 1000 / sp : null,
      hr: b.hr.length ? Math.round(avg(b.hr)!) : null,
      alt: b.alt.length ? Math.round(avg(b.alt)! * 10) / 10 : null,
    };
  });
  return { pts };
}

/** Minutes → « 25′ », « 1h05 ». */
const fmtMinutes = (m: number) => {
  const r = Math.round(m);
  return r >= 60 ? `${Math.floor(r / 60)}h${String(r % 60).padStart(2, '0')}` : `${r}′`;
};

export function runSlides(streams: ActivityStreams): Slide[] {
  return [
    { title: 'Allure', render: (v) => <RunMetricChart streams={streams} metric="pace" visible={v} /> },
    { title: 'Fréquence cardiaque', render: (v) => <RunMetricChart streams={streams} metric="hr" visible={v} /> },
    ...(streams.altitudeM.some((a) => a != null) ? [{ title: 'Altitude', render: (v: boolean) => <RunMetricChart streams={streams} metric="alt" visible={v} /> }] : []),
  ];
}

const RUN_METRIC = {
  pace: { color: 'var(--color-run)', unit: '/km' },
  hr: { color: 'var(--color-z5)', unit: 'bpm' },
  alt: { color: '#64748b', unit: 'm' },
} as const;

function RunMetricChart({ streams, metric, visible }: { streams: ActivityStreams; metric: 'pace' | 'hr' | 'alt'; visible: boolean }) {
  const { pts } = useMemo(() => runSeries(streams), [streams]);
  const scrub = useChartScrub(visible, pickNumeric(pts.map((p) => p.x)));
  const { color, unit } = RUN_METRIC[metric];
  const values = pts.map((p) => p[metric]).filter((v): v is number => v != null);

  const { domain, data, avg } = useMemo(() => {
    if (metric === 'pace') {
      // Bornes robustes : marches et arrêts coupent la courbe au lieu d'écraser l'échelle.
      const lo = values.length ? Math.floor((Math.min(...values) - 5) / 15) * 15 : 180;
      const slow = values.length ? Math.min(quantile(values, 0.9), quantile(values, 0.5) * 1.35) : 465;
      const hi = Math.ceil(slow / 15) * 15 + 15;
      const data = pts.map((p) => ({ ...p, pace: p.pace != null && p.pace <= hi ? p.pace : null }));
      return { domain: [lo, hi] as [number, number], data, avg: null };
    }
    const lo = values.length ? Math.floor(Math.min(...values) - (metric === 'hr' ? 5 : 3)) : 0;
    const hi = values.length ? Math.ceil(Math.max(...values) + (metric === 'hr' ? 5 : 3)) : 1;
    const avg = values.length ? Math.round(values.reduce((a, c) => a + c, 0) / values.length) : null;
    return { domain: [lo, hi] as [number, number], data: pts, avg };
  }, [pts, metric, values]);

  const p = scrub.index != null ? data[scrub.index] : null;
  const fmt = (v: number) => (metric === 'pace' ? `${fmtPace(v)} ${unit}` : `${v} ${unit}`);
  const summary = metric === 'pace'
    ? <>Plus haut = plus rapide{values.length > 0 && <span>· max {fmtPace(Math.min(...values))} /km</span>}</>
    : <>Moyenne {avg ?? '–'} {unit} · max {values.length ? Math.max(...values) : '–'} {unit}</>;

  return (
    <div {...scrub.wrapperProps} className="text-slate-500 dark:text-slate-400">
      <ChartReadout
        onClear={scrub.clear}
        summary={summary}
        reading={p && (
          <>
            <span className="muted">{fmtDuration(p.t)}{p.dist != null ? ` · ${(p.dist / 1000).toFixed(2).replace('.', ',')} km` : ''}</span>
            <Val color={color}>{p[metric] != null ? fmt(p[metric]!) : metric === 'pace' ? 'arrêt / marche' : '–'}</Val>
          </>
        )}
      />
      <ResponsiveContainer width="100%" height={CHART_H}>
        <ComposedChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
          <defs>
            <linearGradient id={`g-${metric}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.28} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          {grid}
          <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tick={AXIS} tickLine={false} tickFormatter={fmtMinutes} minTickGap={24} />
          <YAxis reversed={metric === 'pace'} domain={domain} allowDataOverflow tick={AXIS} tickLine={false} axisLine={false} width={42}
            tickFormatter={(v: number) => (metric === 'pace' ? fmtPace(v) : `${v}`)} />
          {avg != null && <ReferenceLine y={avg} stroke={color} strokeDasharray="4 4" strokeOpacity={0.6} />}
          {p && <ReferenceLine x={p.x} stroke="currentColor" strokeOpacity={0.5} />}
          <Area dataKey={metric} type="monotone" stroke={color} strokeWidth={2} fill={`url(#g-${metric})`} baseValue={metric === 'pace' ? domain[1] : domain[0]}
            dot={false} activeDot={scrub.index != null ? { r: 4 } : false} connectNulls={false} isAnimationActive={visible} animationDuration={600} />
        </ComposedChart>
      </ResponsiveContainer>
      {hint}
    </div>
  );
}

// ───────────────────────────────────────────────────────────── Natation

const STROKE_COLOR: Record<string, string> = {
  mixed: '#f59e0b',
  freestyle: 'var(--color-swim)',
  breaststroke: '#a855f7',
  backstroke: '#14b8a6',
  butterfly: '#f43f5e',
};

/** Natation : une barre par série (circuit) — allure, SWOLF et FC. */
export function swimSlides(swim: SwimmingAnalysis): Slide[] {
  const sets = swim.sets.filter((x) => x.kind === 'swim');
  if (!sets.length) return [];
  return [
    { title: 'Allure par série', render: (v) => <SwimSetChart sets={sets} metric="pace" visible={v} /> },
    ...(sets.some((x) => x.swolf != null) ? [{ title: 'SWOLF par série', render: (v: boolean) => <SwimSetChart sets={sets} metric="swolf" visible={v} /> }] : []),
    ...(sets.some((x) => x.avgHr != null) ? [{ title: 'FC par série', render: (v: boolean) => <SwimSetChart sets={sets} metric="hr" visible={v} /> }] : []),
  ];
}

function SwimSetChart({ sets, metric, visible }: { sets: SwimSet[]; metric: 'pace' | 'swolf' | 'hr'; visible: boolean }) {
  const scrub = useChartScrub(visible, pickCategory(sets.length));
  const data = sets.map((x, i) => ({
    n: i + 1, stroke: x.stroke ?? 'unknown', dist: x.distanceM, dur: x.durationS, pace: x.pace100S,
    v: metric === 'pace' ? x.pace100S : metric === 'swolf' ? x.swolf : x.avgHr,
  }));
  const values = data.map((d) => d.v).filter((v): v is number => v != null);
  const lo = values.length ? Math.max(0, Math.floor((Math.min(...values) * 0.85) / 5) * 5) : 0;
  const avg = values.length ? values.reduce((a, c) => a + c, 0) / values.length : null;
  const strokes = [...new Set(data.map((d) => d.stroke))];
  const p = scrub.index != null ? data[scrub.index] : null;
  const fmt = (v: number) => (metric === 'pace' ? `${fmtPace(v)} /100 m` : metric === 'hr' ? `${v} bpm` : `${v}`);
  const color = (stroke: string) => (metric === 'hr' ? 'var(--color-z5)' : STROKE_COLOR[stroke] ?? '#64748b');

  return (
    <div {...scrub.wrapperProps} className="text-slate-500 dark:text-slate-400">
      <ChartReadout
        onClear={scrub.clear}
        summary={metric === 'hr' || strokes.length < 2
          ? <>Moyenne {avg != null ? fmt(Math.round(avg)) : '–'}{metric !== 'hr' && <span>· plus bas = mieux</span>}</>
          : strokes.map((st) => <Val key={st} color={color(st)}>{STROKE_LABEL[st as keyof typeof STROKE_LABEL]}</Val>)}
        reading={p && (
          <>
            <span className="muted">Série {p.n} · {p.dist} m {STROKE_LABEL[p.stroke as keyof typeof STROKE_LABEL]?.toLowerCase()}</span>
            <Val color={color(p.stroke)}>{p.v != null ? fmt(p.v) : '–'}</Val>
            <span>{fmtDuration(p.dur)}</span>
          </>
        )}
      />
      <ResponsiveContainer width="100%" height={CHART_H}>
        <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
          {grid}
          <XAxis dataKey="n" tick={AXIS} tickLine={false} interval={0} />
          <YAxis domain={[lo, 'auto']} tick={AXIS} tickLine={false} axisLine={false} width={42}
            tickFormatter={(v: number) => (metric === 'pace' ? fmtPace(v) : `${Math.round(v)}`)} />
          {avg != null && <ReferenceLine y={avg} stroke="currentColor" strokeDasharray="4 4" strokeOpacity={0.5} />}
          <Bar dataKey="v" radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={visible} animationDuration={500}>
            {data.map((d, i) => (
              <Cell key={i} fill={color(d.stroke)} fillOpacity={scrub.index == null || scrub.index === i ? 0.85 : 0.4} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <p className="muted mt-1 text-center text-[11px]">Une barre par série · touche une barre pour le détail</p>
    </div>
  );
}
