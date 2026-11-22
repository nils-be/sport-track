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

// ───────────────────────────────────────────────────────────── Zoom à deux doigts

/**
 * Zoom horizontal au pincement : renvoie la plage d'index visible [début, fin].
 * Une fois zoomé, un doigt fait glisser la vue ; double tap = vue complète.
 * Sans zoom, un doigt laisse passer le défilement (carrousel, page).
 */
export function usePinchZoom(n: number, minSpan = 6) {
  const full: [number, number] = [0, Math.max(0, n - 1)];
  const [range, setRange] = useState<[number, number]>(full);
  const rangeRef = useRef(range);
  rangeRef.current = range;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { setRange([0, Math.max(0, n - 1)]); }, [n]);

  useEffect(() => {
    const el = ref.current;
    if (!el || n < 3) return;
    const span = (r: [number, number]) => r[1] - r[0];
    const isZoomed = () => span(rangeRef.current) < n - 1;
    const box = () => (el.querySelector('.recharts-cartesian-grid') ?? el).getBoundingClientRect();
    const clampRange = (a: number, sp: number): [number, number] => {
      const s2 = Math.max(Math.min(minSpan, n - 1), Math.min(n - 1, sp));
      const a2 = Math.max(0, Math.min(n - 1 - s2, a));
      return [Math.round(a2), Math.round(a2 + s2)];
    };
    let pinch: { d0: number; frac: number; r0: [number, number] } | null = null;
    let pan: { x0: number; y0: number; r0: [number, number]; locked: boolean | null } | null = null;
    let lastTap = 0;
    const dist = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

    const onStart = (e: TouchEvent) => {
      const r = box();
      if (e.touches.length === 2) {
        const cx = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        pinch = { d0: dist(e.touches), frac: Math.min(1, Math.max(0, (cx - r.left) / r.width)), r0: rangeRef.current };
        pan = null;
        e.preventDefault();
      } else if (e.touches.length === 1) {
        const now = Date.now();
        if (now - lastTap < 300 && isZoomed()) { setRange([0, n - 1]); lastTap = 0; return; }
        lastTap = now;
        pan = isZoomed() ? { x0: e.touches[0].clientX, y0: e.touches[0].clientY, r0: rangeRef.current, locked: null } : null;
      }
    };
    const onMove = (e: TouchEvent) => {
      const r = box();
      if (pinch && e.touches.length === 2) {
        e.preventDefault();
        const sp0 = span(pinch.r0);
        const sp = sp0 * (pinch.d0 / Math.max(dist(e.touches), 1));
        const anchor = pinch.r0[0] + pinch.frac * sp0;
        setRange(clampRange(anchor - pinch.frac * sp, sp));
      } else if (pan && e.touches.length === 1) {
        const dx = e.touches[0].clientX - pan.x0, dy = e.touches[0].clientY - pan.y0;
        if (pan.locked == null && Math.hypot(dx, dy) > 6) pan.locked = Math.abs(dx) > Math.abs(dy);
        if (!pan.locked) return; // geste vertical : on laisse défiler la page
        e.preventDefault();
        const sp = span(pan.r0);
        setRange(clampRange(pan.r0[0] - (dx / r.width) * sp, sp));
      }
    };
    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinch = null;
      if (e.touches.length === 0) pan = null;
    };
    el.addEventListener('touchstart', onStart, { passive: false });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, [n, minSpan]);

  const zoomed = range[1] - range[0] < n - 1;
  return { ref, range, zoomed, reset: () => setRange([0, Math.max(0, n - 1)]) };
}

/** Rappel discret du zoom, avec retour à la vue complète. */
export function ZoomBadge({ zoomed, onReset }: { zoomed: boolean; onReset: () => void }) {
  if (!zoomed) return <p className="muted mt-1 text-center text-[11px]">Touche pour lire une valeur · pince pour zoomer</p>;
  return (
    <div className="mt-1 flex items-center justify-center gap-2 text-[11px]">
      <span className="muted">Zoom · glisse pour te déplacer</span>
      <button onClick={(e) => { e.stopPropagation(); onReset(); }} className="rounded-full bg-accent-soft px-2 py-0.5 font-medium text-accent">Réinitialiser</button>
    </div>
  );
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

// ───────────────────────────────────────────────────────────── Course

interface RunPoint { x: number; t: number; dist: number | null; pace: number | null; hr: number | null; alt: number | null }

/**
 * Série allégée : ~120 tranches de temps moyennées (vitesse, FC, altitude), abscisse = temps écoulé (minutes).
 * `range` = plage d'index de la trace (5 s par point) : en zoom, les 120 tranches couvrent la fenêtre visible,
 * ce qui révèle le détail au lieu d'agrandir une courbe grossière.
 */
function runSeries(streams: ActivityStreams, range: [number, number] = [0, streams.t.length - 1]) {
  const [i0, i1] = range;
  const t0 = streams.t[i0] ?? 0, t1 = streams.t[i1] ?? 0;
  const step = (t1 - t0) / MAX_POINTS || 1;
  const buckets: { t: number; dist: number | null; sp: number[]; hr: number[]; alt: number[] }[] = [];
  for (let i = i0; i <= i1; i++) {
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
  // Zoom sur la trace complète (un point toutes les 5 s) ; au moins ~2 min visibles.
  const zoom = usePinchZoom(streams.t.length, 24);
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

  const view = useMemo(() => {
    if (!zoom.zoomed) return data;
    const zoomedPts = runSeries(streams, zoom.range).pts;
    return metric === 'pace' ? zoomedPts.map((p) => ({ ...p, pace: p.pace != null && p.pace <= domain[1] ? p.pace : null })) : zoomedPts;
  }, [zoom.zoomed, zoom.range, streams, data, metric, domain]);
  const scrub = useChartScrub(visible, pickNumeric(view.map((d) => d.x)));
  useEffect(() => { scrub.clear(); }, [zoom.range[0], zoom.range[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  const p = scrub.index != null ? view[scrub.index] : null;
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
      <div ref={zoom.ref} style={{ touchAction: 'pan-x pan-y' }}>
      <ResponsiveContainer width="100%" height={CHART_H}>
        <ComposedChart data={view} margin={{ top: 6, right: 8, bottom: 0, left: -8 }}>
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
      </div>
      <ZoomBadge zoomed={zoom.zoomed} onReset={zoom.reset} />
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
  const zoom = usePinchZoom(sets.length, 3);
  const all = sets.map((x, i) => ({
    n: i + 1, stroke: x.stroke ?? 'unknown', dist: x.distanceM, dur: x.durationS, pace: x.pace100S,
    v: metric === 'pace' ? x.pace100S : metric === 'swolf' ? x.swolf : x.avgHr,
  }));
  const data = all.slice(zoom.range[0], zoom.range[1] + 1);
  const scrub = useChartScrub(visible, pickCategory(data.length));
  useEffect(() => { scrub.clear(); }, [zoom.range[0], zoom.range[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  const values = all.map((d) => d.v).filter((v): v is number => v != null);
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
      <div ref={zoom.ref} style={{ touchAction: 'pan-x pan-y' }}>
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
      </div>
      <ZoomBadge zoomed={zoom.zoomed} onReset={zoom.reset} />
    </div>
  );
}
