// Résumés courts d'une séance, partagés par l'interface et le contexte du coach.
import { fmtPace } from '../format';
import type { Activity, RunLap } from './types';

export interface EffortBlock {
  count: number;
  /** Distance moyenne d'une répétition (m). */
  distanceM: number;
  paceSPerKm: number;
  slowestPace: number | null;
  fastestPace: number | null;
  avgHr: number | null;
}

/** Regroupe les efforts consécutifs de distance voisine (ex. 12 × 300 m, puis 4 × 1 km). */
export function effortBlockData(laps: RunLap[]): EffortBlock[] {
  const blocks: RunLap[][] = [];
  for (const l of laps.filter((x) => x.kind === 'effort')) {
    const cur = blocks[blocks.length - 1];
    if (cur && Math.abs(l.distanceM - cur[0].distanceM) <= 0.25 * cur[0].distanceM) cur.push(l);
    else blocks.push([l]);
  }
  return blocks.map((b) => {
    const d = b.reduce((s, l) => s + l.distanceM, 0), t = b.reduce((s, l) => s + l.durationS, 0);
    const hrs = b.filter((l) => l.avgHr).map((l) => l.avgHr!);
    const paces = b.map((l) => l.paceSPerKm).filter((p): p is number => p != null);
    return {
      count: b.length,
      distanceM: d / b.length,
      paceSPerKm: (t / d) * 1000,
      slowestPace: paces.length > 1 ? Math.max(...paces) : null,
      fastestPace: paces.length > 1 ? Math.min(...paces) : null,
      avgHr: hrs.length ? Math.round(hrs.reduce((s, x) => s + x, 0) / hrs.length) : null,
    };
  });
}

const repDist = (m: number) => (m >= 950 ? `${(Math.round(m / 100) / 10).toString().replace('.', ',')} km` : `${Math.round(m / 10) * 10} m`);

/** Libellé compact d'un bloc : « 12 × 300 m à 3:35 ». */
export const blockLabel = (b: EffortBlock) => `${b.count} × ${repDist(b.distanceM)} à ${fmtPace(b.paceSPerKm)}`;

/** Type de séance lisible pour retrouver une séance d'un coup d'œil. */
export function sessionKind(a: Activity): string {
  if (a.sport === 'swimming') return a.variant === 'openWater' ? 'Eau libre' : 'Natation';
  const r = a.running;
  if (r?.isInterval) return 'Fractionné';
  if (a.variant === 'treadmill') return 'Tapis';
  if (a.variant === 'track') return 'Piste';
  if (a.variant === 'trail') return 'Trail';
  if (a.distanceM >= 15000 || a.durationS >= 80 * 60) return 'Sortie longue';
  if (r?.avgPaceSPerKm && a.hrZones && a.hrZones.timeInZoneS[3] + a.hrZones.timeInZoneS[4] > a.durationS * 0.5) return 'Course rapide';
  return 'Footing';
}

/** Moment de la journée (« matin », « midi », « soir »). */
export function dayPart(t: number): string {
  const h = new Date(t).getHours();
  return h < 11 ? 'matin' : h < 14 ? 'midi' : h < 18 ? 'après-midi' : 'soir';
}
