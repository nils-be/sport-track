import type { FitMesg, FitMessages } from '../fit/decode';
import { hrBetween, mean, ms, num, round, type HrSample } from './common';
import type { BestEffort, SportVariant, SwimLength, SwimmingAnalysis, SwimSet, SwimStroke } from './types';

const STROKES: SwimStroke[] = ['freestyle', 'backstroke', 'breaststroke', 'butterfly', 'drill', 'mixed', 'im'];
const stroke = (v: unknown): SwimStroke | null =>
  v == null ? null : STROKES.includes(v as SwimStroke) ? (v as SwimStroke) : 'unknown';

export function swimVariant(session: FitMesg): SportVariant {
  const sub = String(session.subSport ?? '');
  if (sub === 'openWater') return 'openWater';
  if (sub === 'lapSwimming' || num(session.poolLength)) return 'pool';
  return 'openWater';
}

/** Nage dominante d'un ensemble de longueurs (« mixed » si plusieurs nages). */
function dominantStroke(lengths: SwimLength[]): SwimStroke | null {
  const set = new Set(lengths.filter((l) => l.active && l.stroke).map((l) => l.stroke!));
  if (set.size === 0) return null;
  return set.size === 1 ? [...set][0] : 'mixed';
}

function bestEfforts(sets: SwimSet[], lengths: SwimLength[], pool: number | null): BestEffort[] {
  if (!pool) return [];
  const out: BestEffort[] = [];
  for (const D of [50, 100, 200, 400]) {
    const n = D / pool;
    if (!Number.isInteger(n)) continue;
    let best = Infinity;
    for (const s of sets) {
      if (s.kind !== 'swim') continue;
      const ls = lengths.filter((l) => l.setIndex === s.index && l.active);
      for (let i = 0; i + n <= ls.length; i++) {
        const win = ls.slice(i, i + n);
        if (win.some((l) => l.suspect)) continue;
        const t = win.reduce((a, l) => a + l.durationS, 0);
        if (t < best) best = t;
      }
    }
    if (Number.isFinite(best)) out.push({ distanceM: D, durationS: round(best, 1)! });
  }
  return out;
}

/**
 * Une longueur nettement plus courte (temps ET mouvements) que la médiane de sa nage
 * est probablement une longueur coupée en deux par la détection automatique de la montre.
 */
function flagSuspectLengths(lengths: SwimLength[]): void {
  const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s[Math.floor(s.length / 2)]; };
  const byStroke = new Map<string, SwimLength[]>();
  for (const l of lengths) if (l.active) (byStroke.get(l.stroke ?? '?') ?? byStroke.set(l.stroke ?? '?', []).get(l.stroke ?? '?')!).push(l);
  for (const ls of byStroke.values()) {
    if (ls.length < 4) continue;
    const mDur = median(ls.map((l) => l.durationS));
    const counts = ls.map((l) => l.strokes).filter((x): x is number => x != null);
    const mStr = counts.length ? median(counts) : null;
    for (const l of ls) {
      const short = l.durationS < 0.65 * mDur;
      const fewStrokes = mStr == null || l.strokes == null || l.strokes < 0.65 * mStr;
      if (short && fewStrokes) l.suspect = true;
    }
  }
}

export function analyzeSwimming(messages: FitMessages, session: FitMesg, hr: HrSample[]): SwimmingAnalysis {
  const sessionStart = ms(session.startTime) ?? 0;
  const variant = swimVariant(session);
  const pool = variant === 'pool' ? num(session.poolLength) : null;
  const timer = num(session.totalTimerTime) ?? 0;
  const dist = num(session.totalDistance) ?? 0;

  // --- Longueurs ---
  const rawLengths = messages.lengthMesgs ?? [];
  const lengths: SwimLength[] = rawLengths.map((l, i) => {
    const start = ms(l.startTime) ?? sessionStart;
    const dur = num(l.totalTimerTime) ?? 0;
    const active = l.lengthType === 'active';
    const strokes = active ? num(l.totalStrokes) : null;
    return {
      index: i + 1,
      startOffsetS: Math.round((start - sessionStart) / 1000),
      active,
      stroke: active ? stroke(l.swimStroke) : null,
      durationS: round(dur, 1)!,
      strokes,
      swolf: active && strokes != null ? Math.round(dur + strokes) : null,
      pace100S: active && pool ? round((dur / pool) * 100, 1) : null,
      avgHr: hrBetween(hr, start, start + dur * 1000).avg,
      setIndex: -1,
      suspect: false,
    };
  });
  flagSuspectLengths(lengths);

  // --- Séries (tours) : nage ou repos. Les tours vides de < 5 s (fin de séance) sont ignorés. ---
  const sets: SwimSet[] = [];
  for (const lap of messages.lapMesgs ?? []) {
    const dur = num(lap.totalTimerTime) ?? 0;
    const d = num(lap.totalDistance) ?? 0;
    if (d < 1 && dur < 5) continue;
    const start = ms(lap.startTime) ?? sessionStart;
    const first = num(lap.firstLengthIndex);
    const nLen = num(lap.numLengths) ?? 0;
    const kind: SwimSet['kind'] = d >= 1 ? 'swim' : 'rest';

    // Deux repos consécutifs sont fusionnés.
    const prev = sets[sets.length - 1];
    if (kind === 'rest' && prev?.kind === 'rest') {
      prev.durationS = round(prev.durationS + dur, 1)!;
      continue;
    }
    const idx = sets.length;
    const own = first != null ? lengths.slice(first, first + nLen) : [];
    own.forEach((l) => (l.setIndex = idx));
    const act = own.filter((l) => l.active);
    const activeTime = act.reduce((a, l) => a + l.durationS, 0) || dur;
    const h = hrBetween(hr, start, start + (num(lap.totalElapsedTime) ?? dur) * 1000);
    const swolfs = act.map((l) => l.swolf).filter((x): x is number => x != null);
    const strokeCounts = act.map((l) => l.strokes).filter((x): x is number => x != null);
    sets.push({
      index: idx,
      kind,
      startOffsetS: Math.round((start - sessionStart) / 1000),
      durationS: round(kind === 'swim' ? activeTime : dur, 1)!,
      distanceM: Math.round(d),
      lengths: act.length || (num(lap.numActiveLengths) ?? 0),
      stroke: kind === 'swim' ? (dominantStroke(own) ?? stroke(lap.swimStroke)) : null,
      pace100S: kind === 'swim' && d > 0 ? round((activeTime / d) * 100, 1) : null,
      swolf: kind === 'swim' ? (num(lap.avgSwolf) || (swolfs.length ? Math.round(mean(swolfs)!) : null)) : null,
      strokesPerLength: kind === 'swim' ? (num(lap.avgStrokesPerLength) ?? round(mean(strokeCounts), 1)) : null,
      avgHr: num(lap.avgHeartRate) ?? h.avg,
      maxHr: num(lap.maxHeartRate) ?? h.max,
    });
  }

  // Longueurs de repos (idle) non rattachées : on les associe à la série qui couvre leur début.
  for (const l of lengths) {
    if (l.setIndex >= 0) continue;
    const covers = (x: SwimSet) => l.startOffsetS >= x.startOffsetS - 1 && l.startOffsetS < x.startOffsetS + x.durationS;
    const s = sets.find((x) => x.kind === 'rest' && covers(x)) ?? sets.find(covers);
    if (s) l.setIndex = s.index;
  }

  // --- Synthèse ---
  const active = lengths.filter((l) => l.active);
  const activeTimeS = num(session.activeTime) ?? (active.length ? active.reduce((a, l) => a + l.durationS, 0) : timer);
  const breakdown = new Map<SwimStroke, { lengths: number; distanceM: number }>();
  for (const l of active) {
    const k = l.stroke ?? 'unknown';
    const e = breakdown.get(k) ?? { lengths: 0, distanceM: 0 };
    e.lengths++; e.distanceM += pool ?? 0;
    breakdown.set(k, e);
  }
  const strokeBreakdown = [...breakdown.entries()]
    .map(([s, e]) => ({ stroke: s, ...e }))
    .sort((a, b) => b.lengths - a.lengths);
  const swolfs = active.map((l) => l.swolf).filter((x): x is number => x != null);
  const strokesPL = active.map((l) => l.strokes).filter((x): x is number => x != null);
  const paces = active.filter((l) => !l.suspect).map((l) => l.pace100S).filter((x): x is number => x != null);

  return {
    variant,
    poolLengthM: pool,
    activeLengths: num(session.numActiveLengths) ?? (active.length || null),
    activeTimeS: round(activeTimeS, 1)!,
    restTimeS: round(Math.max(0, timer - activeTimeS), 1)!,
    avgPace100S: dist > 0 ? round((activeTimeS / dist) * 100, 1) : null,
    bestPace100S: paces.length ? Math.min(...paces) : null,
    avgSwolf: num(session.avgSwolf) || (swolfs.length ? Math.round(mean(swolfs)!) : null),
    avgStrokesPerLength: num(session.avgStrokesPerLength) ?? round(mean(strokesPL), 1),
    mainStroke: strokeBreakdown[0]?.stroke ?? stroke(session.swimStroke),
    strokeBreakdown,
    lengths,
    sets,
    bestEfforts: bestEfforts(sets, lengths, pool),
    suspectLengths: active.filter((l) => l.suspect).length,
  };
}
