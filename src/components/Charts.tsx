import { useMemo } from 'react';
import { Bar, CartesianGrid, Cell, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ActivityStreams, SwimLength } from '../lib/analysis/types';
import { fmtDuration, fmtPace, STROKE_LABEL } from '../lib/format';

const AXIS = { fontSize: 11, fill: 'currentColor' };
const tooltipStyle = {
  contentStyle: { background: 'var(--tt-bg)', border: '1px solid var(--tt-border)', borderRadius: 12, fontSize: 12 },
  labelStyle: { color: 'inherit', fontWeight: 600 },
};

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

const quantile = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(q * (s.length - 1))))];
};

/** Course : allure (lissée, axe inversé) et FC, en fonction de la distance (ou du temps sur tapis sans distance). */
export function RunChart({ streams }: { streams: ActivityStreams }) {
  const { data, byDistance, paceDomain, hrDomain } = useMemo(() => {
    const byDistance = streams.distanceM.some((d) => d != null && d > 0);
    const speed = smooth(streams.speedMs, 3);
    const data = streams.t.map((t, i) => {
      const sp = speed[i];
      const pace = sp != null && sp > 1 ? 1000 / sp : null; // > 16:40/km = arrêt, masqué
      return {
        x: byDistance ? (streams.distanceM[i] ?? 0) / 1000 : t / 60,
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

  return (
    <div className="text-slate-500 dark:text-slate-400">
      <ResponsiveContainer width="100%" height={210}>
        <ComposedChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" strokeOpacity={0.15} />
          <XAxis dataKey="x" type="number" domain={['dataMin', 'dataMax']} tick={AXIS} tickLine={false}
            tickFormatter={(v: number) => (byDistance ? `${Math.round(v)}` : `${Math.round(v)}′`)} unit={byDistance ? ' km' : ''} />
          <YAxis yAxisId="pace" reversed domain={paceDomain} allowDataOverflow tick={AXIS} tickLine={false} axisLine={false}
            tickFormatter={(v: number) => fmtPace(v)} width={44} />
          <YAxis yAxisId="hr" orientation="right" domain={hrDomain} tick={AXIS} tickLine={false} axisLine={false} width={34} />
          <Tooltip {...tooltipStyle}
            labelFormatter={(v) => (byDistance ? `${Number(v).toFixed(2).replace('.', ',')} km` : `${Math.round(Number(v))} min`)}
            formatter={(v, name) => (name === 'Allure' ? [`${fmtPace(Number(v))} /km`, name] : [`${v} bpm`, name])} />
          <Line yAxisId="pace" dataKey="pace" name="Allure" stroke="var(--color-run)" dot={false} strokeWidth={1.8} connectNulls={false} isAnimationActive={false} />
          <Line yAxisId="hr" dataKey="hr" name="FC" stroke="var(--color-z5)" dot={false} strokeWidth={1.2} strokeOpacity={0.8} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <Legend items={[['var(--color-run)', 'Allure /km'], ['var(--color-z5)', 'FC']]} />
    </div>
  );
}

const STROKE_COLOR: Record<string, string> = {
  freestyle: 'var(--color-swim)',
  breaststroke: '#a855f7',
  backstroke: '#14b8a6',
  butterfly: '#f43f5e',
};

/** Natation : allure au 100 m de chaque longueur active (barres) et FC moyenne de la longueur. */
export function SwimChart({ lengths }: { lengths: SwimLength[] }) {
  const data = lengths.filter((l) => l.active).map((l, i) => ({
    n: i + 1,
    pace: l.pace100S,
    hr: l.avgHr,
    stroke: l.stroke ?? 'unknown',
    suspect: l.suspect,
    dur: l.durationS,
  }));
  const paces = data.map((d) => d.pace).filter((p): p is number => p != null && !Number.isNaN(p));
  const lo = paces.length ? Math.max(0, Math.floor((quantile(paces, 0.05) - 15) / 15) * 15) : 60;
  const strokes = [...new Set(data.map((d) => d.stroke))];

  return (
    <div className="text-slate-500 dark:text-slate-400">
      <ResponsiveContainer width="100%" height={210}>
        <ComposedChart data={data} margin={{ top: 8, right: 0, bottom: 0, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="currentColor" strokeOpacity={0.15} />
          <XAxis dataKey="n" tick={AXIS} tickLine={false} interval="preserveStartEnd" />
          <YAxis yAxisId="pace" domain={[lo, 'auto']} tick={AXIS} tickLine={false} axisLine={false} tickFormatter={(v: number) => fmtPace(v)} width={44} />
          <YAxis yAxisId="hr" orientation="right" domain={['dataMin - 10', 'dataMax + 5']} tick={AXIS} tickLine={false} axisLine={false} width={34} />
          <Tooltip {...tooltipStyle}
            labelFormatter={(v, p) => {
              const d = p?.[0]?.payload;
              return `Longueur ${v}${d ? ` · ${STROKE_LABEL[d.stroke as keyof typeof STROKE_LABEL]} · ${fmtDuration(d.dur)}` : ''}${d?.suspect ? ' · suspecte' : ''}`;
            }}
            formatter={(v, name) => (name === 'Allure' ? [`${fmtPace(Number(v))} /100 m`, name] : [`${v} bpm`, name])} />
          <Bar yAxisId="pace" dataKey="pace" name="Allure" radius={[3, 3, 0, 0]} isAnimationActive={false}>
            {data.map((d, i) => (
              <Cell key={i} fill={STROKE_COLOR[d.stroke] ?? '#64748b'} fillOpacity={d.suspect ? 0.3 : 0.85} />
            ))}
          </Bar>
          <Line yAxisId="hr" dataKey="hr" name="FC" stroke="var(--color-z5)" dot={{ r: 2 }} strokeWidth={1.2} isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
      <Legend items={[...strokes.map((s) => [STROKE_COLOR[s] ?? '#64748b', STROKE_LABEL[s as keyof typeof STROKE_LABEL]] as [string, string]), ['var(--color-z5)', 'FC']]} />
      <p className="mt-1 text-center text-[11px]">Barre plus haute = longueur plus lente · barres pâles = longueurs suspectes</p>
    </div>
  );
}

function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="mt-1 flex flex-wrap justify-center gap-x-4 gap-y-1 text-xs">
      {items.map(([c, l]) => (
        <span key={l} className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full" style={{ background: c }} />
          {l}
        </span>
      ))}
    </div>
  );
}
