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
export interface DatedEffort extends Effort { startTime: number; activityId: string }

/** Tous les meilleurs efforts d'un sport, datés (l'historique complet, pas seulement la période affichée). */
export function datedEfforts(acts: Activity[], sport: Sport): DatedEffort[] {
  const out: DatedEffort[] = [];
  for (const a of acts) {
    if (a.sport !== sport) continue;
    for (const e of (sport === 'running' ? a.running?.bestEfforts : a.swimming?.bestEfforts) ?? []) {
      out.push({ distanceM: e.distanceM, durationS: e.durationS, startTime: a.startTime, activityId: a.id });
    }
  }
  return out;
}

/**
 * Perte de forme supposée selon l'ancienneté d'un effort : aucune pendant 3 semaines, puis environ
 * 0,5 % par semaine, plafonnée à 8 %. La prédiction glisse donc de quelques secondes au plus d'un jour
 * à l'autre, au lieu de sauter quand un bon effort sort d'une fenêtre fixe.
 */
const GRACE_DAYS = 21;
const DECAY_PER_DAY = 0.005 / 7;
const MAX_DECAY = 0.08;
export const agePenalty = (ageDays: number) => Math.min(MAX_DECAY, Math.max(0, ageDays - GRACE_DAYS) * DECAY_PER_DAY);

export interface Prediction { durationS: number; from: DatedEffort; penalty: number }

/**
 * Temps prédit sur `target` mètres à la date `at` (formule de Riegel sur les efforts antérieurs,
 * corrigée de leur ancienneté). Seuls les efforts d'au moins 1/5 de la distance visée servent
 * (un 1 km ne prédit pas un marathon) ; à défaut, on prend l'effort le plus long. On garde la meilleure.
 */
export function predictTime(all: DatedEffort[], target: number, at = Date.now()): Prediction | null {
  const efforts = all.filter((e) => e.startTime <= at);
  if (!efforts.length) return null;
  const usable = efforts.filter((e) => e.distanceM >= target / 5);
  const longest = efforts.reduce((m, e) => (e.distanceM > m.distanceM ? e : m));
  let best: Prediction | null = null;
  for (const e of usable.length ? usable : [longest]) {
    const penalty = agePenalty((at - e.startTime) / DAY);
    const t = e.durationS * (target / e.distanceM) ** RIEGEL_EXPONENT * (1 + penalty);
    if (!best || t < best.durationS) best = { durationS: t, from: e, penalty };
  }
  return best;
}

/** Évolution hebdomadaire de la prédiction (évaluée en fin de semaine, ou maintenant pour la semaine en cours). */
export function predictionSeries(efforts: DatedEffort[], sport: Sport, target: number, weeks: number, now = Date.now()) {
  return weeklyVolumes([], sport, weeks, now).map((w) => {
    const p = predictTime(efforts, target, Math.min(addWeeks(w.start, 1) - 1, now));
    return { start: w.start, durationS: p ? Math.round(p.durationS) : null };
  });
}
