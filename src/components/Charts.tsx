import { useMemo, useRef, useState, type ReactNode } from 'react';
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ActivityStreams, SwimLength } from '../lib/analysis/types';
import { fmtDuration, fmtPace, STROKE_LABEL } from '../lib/format';

export const AXIS = { fontSize: 11, fill: 'currentColor' };

// ───────────────────────────────────────────────────────────── Lecture au doigt

interface ChartState { activeTooltipIndex?: unknown }

/**
 * Lecture des valeurs au doigt : l'index lu n'existe que pendant l'appui (ou le survol à la souris)
 * et disparaît au relâchement. Pas d'info-bulle flottante : les valeurs s'affichent dans ChartReadout.
 */
export function useChartScrub() {
  const [index, setIndex] = useState<number | null>(null);
  // Après un toucher, le navigateur émet des événements souris « de compatibilité » : on les ignore.
  const lastTouch = useRef(0);
  const read = (s: ChartState) => {
    const i = Number(s?.activeTooltipIndex);
    setIndex(Number.isFinite(i) ? i : null);
  };
  const fromTouch = (s: ChartState) => { lastTouch.current = Date.now(); read(s); };
  const fromMouse = (s: ChartState) => { if (Date.now() - lastTouch.current > 800) read(s); };
  const clear = () => setIndex(null);
  const clearTouch = () => { lastTouch.current = Date.now(); clear(); };
  return {
    index,
    /** À étaler sur le graphique Recharts. */
    chartProps: { onTouchStart: fromTouch, onTouchMove: fromTouch, onTouchEnd: clearTouch, onMouseMove: fromMouse, onMouseLeave: clear },
    /** À étaler sur le conteneur : défilement vertical libre, relâchement toujours pris en compte. */
    wrapperProps: { style: { touchAction: 'pan-y' as const }, onTouchEnd: clearTouch, onTouchCancel: clearTouch },
  };
}

/** Curseur vertical seul, sans info-bulle ; visible uniquement pendant la lecture. */
export function ScrubCursor({ active, bar = false }: { active: boolean; bar?: boolean }) {
  const cursor = bar ? { fill: 'currentColor', fillOpacity: 0.1 } : { stroke: 'currentColor', strokeOpacity: 0.5, strokeWidth: 1 };
  return <Tooltip active={active} content={() => null} cursor={cursor} isAnimationActive={false} />;
}

/** Ligne fixe au-dessus du graphique : la légende au repos, les valeurs lues pendant l'appui. */
export function ChartReadout({ reading, legend }: { reading: ReactNode | null; legend: [string, string][] }) {
  return (
    <div className="mb-1 flex min-h-9 items-center justify-center text-xs">
      {reading ? (
        <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-0.5 font-medium text-slate-900 dark:text-slate-100">{reading}</div>
      ) : (
        <Legend items={legend} />
      )}
    </div>
  );
}

export function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
      {items.map(([c, l]) => (
        <span key={l} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: c }} />
          {l}
        </span>
      ))}
    </div>
  );
}

/** Valeur colorée pour la ligne de lecture. */
export const Val = ({ color, children }: { color: string; children: ReactNode }) => (
  <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full" style={{ background: color }} />{children}</span>
);

// ───────────────────────────────────────────────────────────── Utilitaires

/** Moyenne glissante centrée, ignorant les valeurs nulles. */
function smooth(xs: (number | null)[], w: number): (number | null)[] {
  return xs.map((_, i) => {
    let s = 0, n = 0;
    for (let j = Math.max(0, i - w); j <= Math.min(xs.length - 1, i + w); j++) {
      const v = xs[j];
      if (v != null) { s += v; n++; }
    }
    return n ? s / n : null;
  });
}

export const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
};

// ───────────────────────────────────────────────────────────── Course

/** Course : allure (lissée, axe inversé) et FC, en fonction de la distance (ou du temps sur tapis sans distance). */
export function RunChart({ streams }: { streams: ActivityStreams }) {
  const scrub = useChartScrub();
  const { data, byDistance, paceDomain, hrDomain } = useMemo(() => {
    const byDistance = streams.distanceM.some((d) => d != null && d > 0);
    const speed = smooth(streams.speedMs, 3);
    const data = streams.t.map((t, i) => {
      const sp = speed[i];
      const pace = sp != null && sp > 1 ? 1000 / sp : null; // > 16:40/km = arrêt, masqué
      return {
        x: byDistance ? (streams.distanceM[i] ?? 0) / 1000 : t / 60,
        t,
        pace: pace != null && pace < 900 ? pace : null,
        hr: streams.hr[i],
      };
    });
    const paces = data.map((d) => d.pace).filter((p): p is number => p != null);
    const hrs = data.map((d) => d.hr).filter((h): h is number => h != null);
    // Bornes robustes : les marches et arrêts ne doivent pas écraser l'échelle.
    const lo = paces.length ? Math.floor((Math.min(...paces) - 5) / 15) * 15 : 180;
    const slow = paces.length ? Math.min(quantile(paces, 0.9), quantile(paces, 0.5) * 1.35) : 465;
    const hi = Math.ceil(slow / 15) * 15 + 15;
    const hrLo = hrs.length ? Math.floor((Math.min(...hrs) - 5) / 10) * 10 : 80;
    const hrHi = hrs.length ? Math.ceil((Math.max(...hrs) + 5) / 10) * 10 : 200;
    // Au-delà de la borne lente (marche, arrêt) : on coupe la courbe plutôt que de la faire plonger.
    for (const d of data) if (d.pace != null && d.pace > hi) d.pace = null;
    return { data, byDistance, paceDomain: [lo, hi] as [number, number], hrDomain: [hrLo, hrHi] as [number, number] };
  }, [streams]);

  const p = scrub.index != null ? data[scrub.index] : null;
  return (
    <div className="text-slate-500 dark:text-slate-400" {...scrub.wrapperProps}>
      <ChartReadout
        legend={[['var(--color-run)', 'Allure /km'], ['var(--color-z5)', 'FC']]}
        reading={p && (
          <>
            <span className="muted">{byDistance ? `${p.x.toFixed(2).replace('.', ',')} km` : `${Math.round(p.x)} min`} · {fmtDuration(p.t)}</span>
            <Val color="var(--color-run)">{p.pace ? `${fmtPace(p.pace)} /km` : 'arrêt / marche'}</Val>
            {p.hr != null && <Val color="var(--color-z5)">{p.hr} bpm</Val>}
          </>
        )}
      />
      <ResponsiveContainer width="100%" height={210}>
        <ComposedChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: -8 }} {...scrub.chartProps}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" strokeOpacity={0.15} />
          <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tick={AXIS} tickLine={false}
            tickFormatter={(v: number) => (byDistance ? `${Math.round(v)}` : `${Math.round(v)}′`)} unit={byDistance ? ' km' : ''} />
          <YAxis yAxisId="pace" reversed domain={paceDomain} allowDataOverflow tick={AXIS} tickLine={false} axisLine={false}
            tickFormatter={(v: number) => fmtPace(v)} width={44} />
          <YAxis yAxisId="hr" orientation="right" domain={hrDomain} tick={AXIS} tickLine={false} axisLine={false} width={34} />
          <ScrubCursor active={scrub.index != null} />
          <Line yAxisId="pace" dataKey="pace" stroke="var(--color-run)" dot={false} activeDot={false} strokeWidth={1.8} connectNulls={false} isAnimationActive={false} />
          <Line yAxisId="hr" dataKey="hr" stroke="var(--color-z5)" dot={false} activeDot={false} strokeWidth={1.2} strokeOpacity={0.8} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="mt-1 text-center text-[11px]">Glisse le doigt sur le graphique pour lire les valeurs</p>
    </div>
  );
}

// ───────────────────────────────────────────────────────────── Natation

const STROKE_COLOR: Record<string, string> = {
  freestyle: 'var(--color-swim)',
  breaststroke: '#a855f7',
  backstroke: '#14b8a6',
  butterfly: '#f43f5e',
};

/** Natation : allure au 100 m de chaque longueur active (barres) et FC moyenne de la longueur. */
export function SwimChart({ lengths }: { lengths: SwimLength[] }) {
  const scrub = useChartScrub();
  const data = lengths.filter((l) => l.active).map((l, i) => ({
    n: i + 1,
    pace: l.pace100S,
    hr: l.avgHr,
    stroke: l.stroke ?? 'unknown',
    suspect: l.suspect,
    dur: l.durationS,
    strokes: l.strokes,
    swolf: l.swolf,
  }));
  const paces = data.map((d) => d.pace).filter((p): p is number => p != null && !Number.isNaN(p));
  const lo = paces.length ? Math.max(0, Math.floor((quantile(paces, 0.05) - 15) / 15) * 15) : 60;
  const strokes = [...new Set(data.map((d) => d.stroke))];
  const p = scrub.index != null ? data[scrub.index] : null;

  return (
    <div className="text-slate-500 dark:text-slate-400" {...scrub.wrapperProps}>
      <ChartReadout
        legend={[...strokes.map((s) => [STROKE_COLOR[s] ?? '#64748b', STROKE_LABEL[s as keyof typeof STROKE_LABEL]] as [string, string]), ['var(--color-z5)', 'FC']]}
        reading={p && (
          <>
            <span className="muted">Longueur {p.n} · {STROKE_LABEL[p.stroke as keyof typeof STROKE_LABEL]}{p.suspect ? ' · suspecte' : ''}</span>
            <Val color={STROKE_COLOR[p.stroke] ?? '#64748b'}>{fmtDuration(p.dur)} ({fmtPace(p.pace)} /100 m)</Val>
            {p.swolf != null && <span>SWOLF {p.swolf}</span>}
            {p.hr != null && <Val color="var(--color-z5)">{p.hr} bpm</Val>}
          </>
        )}
      />
      <ResponsiveContainer width="100%" height={210}>
        <ComposedChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: -8 }} {...scrub.chartProps}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" strokeOpacity={0.15} />
          <XAxis dataKey="n" tick={AXIS} tickLine={false} interval="preserveStartEnd" />
          <YAxis yAxisId="pace" domain={[lo, 'auto']} tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v: number) => fmtPace(v)} width={44} />
          <YAxis yAxisId="hr" orientation="right" domain={['dataMin - 10', 'dataMax + 5']} tick={AXIS} tickLine={false} axisLine={false} width={34} />
          <ScrubCursor active={scrub.index != null} />
          <Bar yAxisId="pace" dataKey="pace" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={i} fill={STROKE_COLOR[d.stroke] ?? '#64748b'} fillOpacity={d.suspect ? 0.3 : i === scrub.index ? 1 : 0.8} />
            ))}
          </Bar>
          <Line yAxisId="hr" dataKey="hr" stroke="var(--color-z5)" dot={{ r: 2 }} activeDot={false} strokeWidth={1.2} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <p className="mt-1 text-center text-[11px]">Barre plus haute = longueur plus lente · barres pâles = longueurs suspectes</p>
    </div>
  );
}
