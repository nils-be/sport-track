import type { FitMesg, FitMessages } from '../fit/decode';
import { hrBetween, mean, ms, num, paceFromSpeed, round, type HrSample } from './common';
import type { BestEffort, CardiacDrift, KmSplit, LapKindInfo, RunLap, RunningAnalysis, SportVariant } from './types';

/** Point de la trace, en temps « chrono » (pauses retirées). */
export interface RunPoint {
  t: number; // ms réel
  activeS: number; // secondes de chrono écoulées
  dist: number | null;
  speed: number | null;
  alt: number | null;
  hr: number | null;
}

const PAUSE_GAP_S = 5;

export function runPoints(messages: FitMessages): RunPoint[] {
  const pts: RunPoint[] = [];
  let active = 0;
  let prevT: number | null = null;
  for (const r of messages.recordMesgs ?? []) {
    const t = ms(r.timestamp);
    if (t == null) continue;
    if (prevT != null) {
      const dt = (t - prevT) / 1000;
      active += dt <= PAUSE_GAP_S ? dt : 1; // un trou = pause du chrono
    }
    prevT = t;
    pts.push({
      t,
      activeS: active,
      dist: num(r.distance),
      speed: num(r.enhancedSpeed) ?? num(r.speed),
      alt: num(r.enhancedAltitude) ?? num(r.altitude),
      hr: num(r.heartRate),
    });
  }
  return pts;
}

export function runVariant(session: FitMesg): SportVariant {
  const sub = String(session.subSport ?? '');
  if (sub === 'treadmill' || sub === 'indoorRunning' || sub === 'virtualActivity') return 'treadmill';
  if (sub === 'trail') return 'trail';
  if (sub === 'track' || sub === 'indoorTrack') return 'track';
  return 'road';
}

/** Cadence FIT (cycles/min d'une jambe) → pas par minute. */
function spm(cad: unknown, frac: unknown): number | null {
  const c = num(cad);
  if (c == null || c <= 0) return null;
  return Math.round((c + (num(frac) ?? 0)) * 2);
}

const SPLIT_KIND: Record<string, LapKindInfo['kind']> = {
  intervalWarmup: 'warmup',
  intervalActive: 'effort',
  intervalRecovery: 'recovery',
  intervalRest: 'rest',
  intervalCooldown: 'cooldown',
};

interface KindSpan { start: number; end: number; kind: LapKindInfo['kind'] }

function intervalSpans(messages: FitMessages): KindSpan[] {
  const spans: KindSpan[] = [];
  for (const s of messages.splitMesgs ?? []) {
    const kind = SPLIT_KIND[String(s.splitType)];
    const start = ms(s.startTime);
    const end = ms(s.endTime) ?? (start != null && num(s.totalElapsedTime) != null ? start + s.totalElapsedTime * 1000 : null);
    if (kind && start != null && end != null) spans.push({ start, end, kind });
  }
  return spans;
}

function kindForRange(spans: KindSpan[], start: number, end: number): LapKindInfo['kind'] | null {
  const overlap = new Map<LapKindInfo['kind'], number>();
  for (const s of spans) {
    const o = Math.min(end, s.end) - Math.max(start, s.start);
    if (o > 0) overlap.set(s.kind, (overlap.get(s.kind) ?? 0) + o);
  }
  let best: LapKindInfo['kind'] | null = null, bestO = 0;
  for (const [k, o] of overlap) if (o > bestO) { best = k; bestO = o; }
  return best;
}

function buildLaps(messages: FitMessages, sessionStart: number, hr: HrSample[], spans: KindSpan[]): RunLap[] {
  const laps: RunLap[] = [];
  for (const l of messages.lapMesgs ?? []) {
    const start = ms(l.startTime) ?? sessionStart;
    const dur = num(l.totalTimerTime) ?? 0;
    const dist = num(l.totalDistance) ?? 0;
    if (dur < 1 && dist < 1) continue;
    const elapsed = num(l.totalElapsedTime) ?? dur;
    const fromRecords = hrBetween(hr, start, start + elapsed * 1000);
    laps.push({
      index: laps.length + 1,
      startOffsetS: Math.round((start - sessionStart) / 1000),
      durationS: round(dur, 1)!,
      distanceM: round(dist, 1)!,
      paceSPerKm: dist > 10 ? round((dur / dist) * 1000, 1) : null,
      avgHr: num(l.avgHeartRate) ?? fromRecords.avg,
      maxHr: num(l.maxHeartRate) ?? fromRecords.max,
      cadenceSpm: spm(l.avgRunningCadence ?? l.avgCadence, l.avgFractionalCadence),
      ascentM: num(l.totalAscent),
      descentM: num(l.totalDescent),
      trigger: l.lapTrigger ?? null,
      kind: kindForRange(spans, start, start + elapsed * 1000) ?? 'steady',
    });
  }
  return laps;
}

/**
 * Sans fractions Garmin : détecte un fractionné à partir des tours.
 * Un tour court nettement plus lent que la médiane est une récupération.
 */
function inferLapKinds(laps: RunLap[]): boolean {
  if (laps.length < 4) return false;
  const paces = laps.map((l) => l.paceSPerKm).filter((p): p is number => p != null).sort((a, b) => a - b);
  if (!paces.length) return false;
  const median = paces[Math.floor(paces.length / 2)];
  const recov = laps.filter((l) => l.durationS < 300 && (l.paceSPerKm == null || l.paceSPerKm > median * 1.3));
  if (recov.length < 3) return false;
  for (const l of laps) {
    if (recov.includes(l)) l.kind = 'recovery';
    else if (l.paceSPerKm != null && l.paceSPerKm < median * 1.05 && l.durationS < 600) l.kind = 'effort';
  }
  return true;
}

/** Interpole le chrono au passage d'une distance donnée. */
function activeAtDistance(pts: RunPoint[], d: number, from = 0): { s: number; idx: number } | null {
  for (let i = Math.max(from, 1); i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (a.dist == null || b.dist == null) continue;
    if (b.dist >= d && a.dist <= d) {
      const f = b.dist === a.dist ? 0 : (d - a.dist) / (b.dist - a.dist);
      return { s: a.activeS + f * (b.activeS - a.activeS), idx: i };
    }
  }
  return null;
}

/** Dénivelé positif avec hystérésis (filtre le bruit de l'altimètre). */
function ascent(pts: RunPoint[], from: number, to: number): number | null {
  let ref: number | null = null, up = 0;
  for (let i = from; i <= to && i < pts.length; i++) {
    const a = pts[i].alt;
    if (a == null) continue;
    if (ref == null) { ref = a; continue; }
    if (a - ref >= 2) { up += a - ref; ref = a; } else if (ref - a >= 2) ref = a;
  }
  return ref == null ? null : Math.round(up);
}

function buildKmSplits(pts: RunPoint[], totalDist: number): KmSplit[] {
  const splits: KmSplit[] = [];
  if (!pts.some((p) => p.dist != null)) return splits;
  let prev = { s: 0, idx: 0 };
  for (let k = 1; k * 1000 <= totalDist + 1; k++) {
    const cur = activeAtDistance(pts, k * 1000, prev.idx);
    if (!cur) break;
    splits.push(makeSplit(pts, k, 1000, prev, cur));
    prev = cur;
  }
  const rest = totalDist - splits.length * 1000;
  if (rest >= 100) {
    const last = { s: pts[pts.length - 1].activeS, idx: pts.length - 1 };
    if (last.s > prev.s) splits.push(makeSplit(pts, splits.length + 1, rest, prev, last));
  }
  return splits;
}

function makeSplit(pts: RunPoint[], km: number, distanceM: number, a: { s: number; idx: number }, b: { s: number; idx: number }): KmSplit {
  const hrs = pts.slice(a.idx, b.idx + 1).map((p) => p.hr).filter((h): h is number => h != null && h > 0);
  const dur = b.s - a.s;
  return {
    km,
    distanceM: Math.round(distanceM),
    durationS: round(dur, 1)!,
    paceSPerKm: round((dur / distanceM) * 1000, 1)!,
    avgHr: hrs.length ? Math.round(mean(hrs)!) : null,
    ascentM: ascent(pts, a.idx, b.idx),
  };
}

const BEST_DISTANCES = [1000, 5000, 10000, 21097, 42195];

/** Meilleur chrono sur chaque distance, par fenêtre glissante sur la distance cumulée. */
function bestEfforts(pts: RunPoint[], totalDist: number): BestEffort[] {
  const p = pts.filter((x) => x.dist != null) as (RunPoint & { dist: number })[];
  const out: BestEffort[] = [];
  for (const D of BEST_DISTANCES) {
    if (totalDist < D * 0.995 || p.length < 2) continue;
    let best = Infinity, j = 0;
    for (let i = 0; i < p.length; i++) {
      // plus petit j tel que dist[i] - dist[j] >= D : on avance j tant que la fenêtre reste ≥ D
      while (j + 1 < i && p[i].dist - p[j + 1].dist >= D) j++;
      if (p[i].dist - p[j].dist >= D) {
        const over = p[i].dist - p[j].dist;
        const t = ((p[i].activeS - p[j].activeS) * D) / over;
        if (t < best) best = t;
      }
    }
    if (Number.isFinite(best)) out.push({ distanceM: D, durationS: Math.round(best) });
  }
  return out;
}

/**
 * Dérive cardiaque (découplage allure/FC) : ratio vitesse/FC entre les deux moitiés de la séance.
 * Seulement sur un effort continu ≥ 20 min, hors 5 premières minutes, à allure régulière.
 */
function cardiacDrift(pts: RunPoint[], isInterval: boolean, variant: SportVariant): CardiacDrift {
  if (isInterval) return { applicable: false, reason: 'Séance fractionnée : la dérive cardiaque n’a de sens que sur un effort continu.' };
  const moving = pts.filter((p) => p.activeS >= 300 && p.speed != null && p.speed > 1.5 && p.hr != null && p.hr > 0);
  const dur = moving.length ? moving[moving.length - 1].activeS - moving[0].activeS : 0;
  if (dur < 20 * 60) return { applicable: false, reason: 'Effort continu trop court (moins de 20 min hors échauffement).' };

  // Régularité : coefficient de variation des vitesses moyennes par minute.
  const perMin = new Map<number, number[]>();
  for (const p of moving) {
    const k = Math.floor(p.activeS / 60);
    (perMin.get(k) ?? perMin.set(k, []).get(k)!).push(p.speed!);
  }
  const mins = [...perMin.values()].filter((v) => v.length >= 20).map((v) => mean(v)!);
  const m = mean(mins)!;
  const cv = Math.sqrt(mean(mins.map((x) => (x - m) ** 2))!) / m;
  const cvMax = variant === 'trail' ? 0.25 : 0.12;
  if (cv > cvMax) return { applicable: false, reason: 'Allure trop irrégulière pour mesurer une dérive fiable.' };

  const mid = moving[0].activeS + dur / 2;
  const half = (sel: RunPoint[]) => {
    const sp = mean(sel.map((p) => p.speed!))!;
    const hr = mean(sel.map((p) => p.hr!))!;
    return { sp, hr };
  };
  const h1 = half(moving.filter((p) => p.activeS < mid));
  const h2 = half(moving.filter((p) => p.activeS >= mid));
  const r1 = h1.sp / h1.hr, r2 = h2.sp / h2.hr;
  return {
    applicable: true,
    decouplingPct: round(((r1 - r2) / r1) * 100, 1)!,
    firstHalf: { paceSPerKm: round(1000 / h1.sp, 1)!, avgHr: Math.round(h1.hr) },
    secondHalf: { paceSPerKm: round(1000 / h2.sp, 1)!, avgHr: Math.round(h2.hr) },
  };
}

function structure(laps: RunLap[]): RunningAnalysis['structure'] {
  const map = new Map<LapKindInfo['kind'], { count: number; distanceM: number; durationS: number }>();
  for (const l of laps) {
    const e = map.get(l.kind) ?? { count: 0, distanceM: 0, durationS: 0 };
    e.count++; e.distanceM += l.distanceM; e.durationS += l.durationS;
    map.set(l.kind, e);
  }
  const order: LapKindInfo['kind'][] = ['warmup', 'effort', 'recovery', 'rest', 'steady', 'cooldown'];
  return order.filter((k) => map.has(k)).map((k) => {
    const e = map.get(k)!;
    return { kind: k, count: e.count, distanceM: Math.round(e.distanceM), durationS: Math.round(e.durationS) };
  });
}

export function analyzeRunning(messages: FitMessages, session: FitMesg, hr: HrSample[], pts: RunPoint[]): RunningAnalysis {
  const sessionStart = ms(session.startTime) ?? pts[0]?.t ?? 0;
  const variant = runVariant(session);
  const dist = num(session.totalDistance) ?? 0;
  const timer = num(session.totalTimerTime) ?? 0;

  const spans = intervalSpans(messages);
  const laps = buildLaps(messages, sessionStart, hr, spans);
  let isInterval = spans.filter((s) => s.kind === 'effort').length >= 2;
  if (!spans.length) isInterval = inferLapKinds(laps);

  const kmSplits = buildKmSplits(pts, dist);
  const fastestKm = kmSplits.filter((k) => k.distanceM === 1000).map((k) => k.paceSPerKm);

  return {
    variant,
    avgPaceSPerKm: dist > 0 ? round((timer / dist) * 1000, 1) : null,
    gradeAdjustedPaceSPerKm: round(paceFromSpeed(num(session.avgGradeAdjustedSpeed)), 1),
    bestPaceSPerKm: fastestKm.length ? Math.min(...fastestKm) : null,
    ascentM: num(session.totalAscent),
    descentM: num(session.totalDescent),
    avgCadenceSpm: spm(session.avgRunningCadence ?? session.avgCadence, session.avgFractionalCadence),
    maxCadenceSpm: spm(session.maxRunningCadence ?? session.maxCadence, session.maxFractionalCadence),
    laps,
    kmSplits,
    cardiacDrift: cardiacDrift(pts, isInterval, variant),
    bestEfforts: bestEfforts(pts, dist),
    isInterval,
    structure: structure(laps),
  };
}
