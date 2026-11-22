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
