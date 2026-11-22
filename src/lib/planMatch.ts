// Comparaison prévu / réalisé : associe chaque séance prévue à une séance réelle de la semaine.
import type { Activity, Sport } from './analysis/types';
import type { PlannedSession, WeekPlan } from './db';
import { addWeeks, DAY } from './stats';

export type MatchStatus = 'done' | 'shifted' | 'missed' | 'today' | 'upcoming';

export interface SessionMatch {
  session: PlannedSession;
  status: MatchStatus;
  activity?: Activity;
}

export interface PlanReview {
  matches: SessionMatch[];
  /** Séances réelles de la semaine qui ne correspondent à aucune séance prévue. */
  unplanned: Activity[];
  done: number;
  total: number;
  volume: Record<Sport, { plannedM: number; doneM: number; plannedMin: number; doneMin: number }>;
}

/** Minuit local du jour contenant t. */
export function dayStart(t: number): number {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export const DAYS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'] as const;

/** Les 7 jours (minuit local) de la semaine commençant à weekStartMs. Robuste aux changements d'heure. */
export function weekDays(weekStartMs: number): number[] {
  return Array.from({ length: 7 }, (_, i) => dayStart(weekStartMs + i * DAY + 12 * 3600_000));
}

/** Jours planifiables : toute la semaine si elle est à venir, sinon d'aujourd'hui à dimanche. */
export function plannableDays(weekStartMs: number, now = Date.now()): number[] {
  const today = dayStart(now);
  return weekDays(weekStartMs).filter((d) => d >= today);
}

const dayDiff = (a: number, b: number) => Math.round((dayStart(a) - dayStart(b)) / DAY);

/** Plus la séance réelle ressemble à la séance prévue (durée, distance), plus le score est bas. */
function distanceScore(s: PlannedSession, a: Activity): number {
  let score = 0;
  if (s.durationMin) score += Math.abs(Math.log(Math.max(a.durationS / 60, 1) / s.durationMin));
  if (s.distanceM) score += Math.abs(Math.log(Math.max(a.distanceM, 1) / s.distanceM));
  return score;
}

export function matchPlan(plan: WeekPlan, activities: Activity[], now = Date.now()): PlanReview {
  const end = addWeeks(plan.weekStart, 1);
  const weekActs = activities.filter((a) => a.startTime >= plan.weekStart && a.startTime < end);
  const used = new Set<string>();
  const found = new Map<string, { activity: Activity; shift: number }>();

  // 1. Liens manuels.
  for (const s of plan.sessions) {
    if (!s.linkedActivityId) continue;
    const a = activities.find((x) => x.id === s.linkedActivityId);
    if (a) { found.set(s.id, { activity: a, shift: dayDiff(a.startTime, s.date) }); used.add(a.id); }
  }
  // 2. Même sport, même jour ; puis 3. même sport à ±1 jour.
  for (const maxShift of [0, 1]) {
    for (const s of [...plan.sessions].sort((x, y) => x.date - y.date)) {
      if (found.has(s.id) || s.linkedActivityId === null) continue;
      const candidates = weekActs
        .filter((a) => !used.has(a.id) && a.sport === s.sport && Math.abs(dayDiff(a.startTime, s.date)) <= maxShift)
        .sort((x, y) => distanceScore(s, x) - distanceScore(s, y));
      const a = candidates[0];
      if (a) { found.set(s.id, { activity: a, shift: dayDiff(a.startTime, s.date) }); used.add(a.id); }
    }
  }

  const today = dayStart(now);
  const matches: SessionMatch[] = [...plan.sessions].sort((x, y) => x.date - y.date).map((s) => {
    const f = found.get(s.id);
    if (f) return { session: s, status: f.shift === 0 ? 'done' : 'shifted', activity: f.activity };
    const d = dayStart(s.date);
    return { session: s, status: d < today ? 'missed' : d === today ? 'today' : 'upcoming' };
  });

  const volume: PlanReview['volume'] = {
    running: { plannedM: 0, doneM: 0, plannedMin: 0, doneMin: 0 },
    swimming: { plannedM: 0, doneM: 0, plannedMin: 0, doneMin: 0 },
  };
  for (const s of plan.sessions) {
    volume[s.sport].plannedM += s.distanceM ?? 0;
    volume[s.sport].plannedMin += s.durationMin ?? 0;
  }
  for (const a of weekActs) {
    volume[a.sport].doneM += a.distanceM;
    volume[a.sport].doneMin += a.durationS / 60;
  }

  return {
    matches,
    unplanned: weekActs.filter((a) => !used.has(a.id)),
    done: matches.filter((m) => m.status === 'done' || m.status === 'shifted').length,
    total: matches.length,
    volume,
  };
}

/** Séance prévue (plan validé) à laquelle correspond une séance réelle, s'il y en a une. */
export function plannedSessionFor(activityId: string, plan: WeekPlan | undefined, activities: Activity[]): PlannedSession | null {
  if (!plan || plan.status !== 'validated') return null;
  return matchPlan(plan, activities).matches.find((m) => m.activity?.id === activityId)?.session ?? null;
}
