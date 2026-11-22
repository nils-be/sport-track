import type { Activity, Sport } from './analysis/types';

export const DAY = 86_400_000;

/** Lundi 0 h (heure locale) de la semaine contenant t. */
export function weekStart(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d.getTime();
}

/** Ajoute n semaines en restant à minuit local (robuste aux changements d'heure). */
export function addWeeks(t: number, n: number): number {
  const d = new Date(t);
  d.setDate(d.getDate() + n * 7);
  return d.getTime();
}

export interface Volume {
  count: number;
  distanceM: number;
  durationS: number;
}

export const volumeOf = (list: Activity[]): Volume => ({
  count: list.length,
  distanceM: list.reduce((s, a) => s + a.distanceM, 0),
  durationS: list.reduce((s, a) => s + a.durationS, 0),
});

export interface WeekVolume extends Volume {
  start: number;
}

/** Volumes hebdomadaires d'un sport sur les n dernières semaines (semaine en cours incluse), du plus ancien au plus récent. */
export function weeklyVolumes(acts: Activity[], sport: Sport, weeks: number, now = Date.now()): WeekVolume[] {
  const current = weekStart(now);
  const out: WeekVolume[] = [];
  for (let k = weeks - 1; k >= 0; k--) {
    const start = addWeeks(current, -k), end = addWeeks(start, 1);
    out.push({ start, ...volumeOf(acts.filter((a) => a.sport === sport && a.startTime >= start && a.startTime < end)) });
  }
  return out;
}

export interface RecordEntry {
  distanceM: number;
  durationS: number;
  activityId: string;
  startTime: number;
}

/** Meilleur temps sur chaque distance, toutes séances confondues. */
export function records(acts: Activity[], sport: Sport): RecordEntry[] {
  const best = new Map<number, RecordEntry>();
  for (const a of acts) {
    if (a.sport !== sport) continue;
    const efforts = sport === 'running' ? a.running?.bestEfforts : a.swimming?.bestEfforts;
    for (const e of efforts ?? []) {
      const cur = best.get(e.distanceM);
      if (!cur || e.durationS < cur.durationS) best.set(e.distanceM, { ...e, activityId: a.id, startTime: a.startTime });
    }
  }
  return [...best.values()].sort((x, y) => x.distanceM - y.distanceM);
}

/** Séance la plus longue (distance) d'un sport. */
export function longest(acts: Activity[], sport: Sport): Activity | null {
  return acts.filter((a) => a.sport === sport).reduce<Activity | null>((m, a) => (!m || a.distanceM > m.distanceM ? a : m), null);
}

// ───────────────────────────────────────────────────────────── Prédicteur de performances

/** Exposant de fatigue de Riegel : T2 = T1 × (D2 / D1)^1,06. */
export const RIEGEL_EXPONENT = 1.06;

export const PREDICT_TARGETS: Record<Sport, number[]> = {
  running: [5000, 10000, 21097, 42195],
  swimming: [100, 350, 500, 1000],
};

export interface Effort { distanceM: number; durationS: number }

/** Meilleurs efforts (par distance) des séances d'un sport dans [from, to[. */
export function effortsBetween(acts: Activity[], sport: Sport, from: number, to: number): Effort[] {
  const out: Effort[] = [];
  for (const a of acts) {
    if (a.sport !== sport || a.startTime < from || a.startTime >= to) continue;
    out.push(...((sport === 'running' ? a.running?.bestEfforts : a.swimming?.bestEfforts) ?? []));
  }
  return out;
}

/**
 * Temps prédit sur `target` mètres à partir d'efforts réalisés (formule de Riegel).
 * Seuls les efforts d'au moins 1/5 de la distance visée servent (un 1 km ne prédit pas un marathon) ;
 * à défaut, on prend l'effort le plus long. On garde la meilleure prédiction.
 */
export function predictTime(efforts: Effort[], target: number): { durationS: number; from: Effort } | null {
  if (!efforts.length) return null;
  const usable = efforts.filter((e) => e.distanceM >= target / 5);
  const longest = efforts.reduce((m, e) => (e.distanceM > m.distanceM ? e : m));
  let best: { durationS: number; from: Effort } | null = null;
  for (const e of usable.length ? usable : [longest]) {
    const t = e.durationS * (target / e.distanceM) ** RIEGEL_EXPONENT;
    if (!best || t < best.durationS) best = { durationS: t, from: e };
  }
  return best;
}

/** Évolution hebdomadaire de la prédiction (fenêtre glissante de `windowWeeks`, limitée à la période). */
export function predictionSeries(acts: Activity[], sport: Sport, target: number, weeks: number, windowWeeks = 6, now = Date.now()) {
  const periodStart = addWeeks(weekStart(now), -(weeks - 1));
  return weeklyVolumes([], sport, weeks, now).map((w) => {
    const end = addWeeks(w.start, 1);
    const from = Math.max(periodStart, addWeeks(end, -windowWeeks));
    const p = predictTime(effortsBetween(acts, sport, from, end), target);
    return { start: w.start, durationS: p ? Math.round(p.durationS) : null };
  });
}
