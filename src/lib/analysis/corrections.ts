// Corrections manuelles de distance (série de natation mal détectée, tour de course faussé par le GPS).
// Absolues et idempotentes : on repart toujours des valeurs de la montre (champs « original… »).
import type { Activity, Corrections } from './types';

const round1 = (x: number) => Math.round(x * 10) / 10;

/** Applique les corrections à une séance analysée et recalcule distances et allures. */
export function applyCorrections(a: Activity, c: Corrections | undefined): Activity {
  const out: Activity = structuredClone(a);
  const baseTotal = a.originalDistanceM ?? a.distanceM;
  let delta = 0;

  if (out.swimming) {
    const s = out.swimming;
    const pool = s.poolLengthM;
    let lengthsDelta = 0;
    s.sets = s.sets.map((set) => {
      if (set.kind !== 'swim') return set;
      const origDist = set.originalDistanceM ?? set.distanceM;
      const origLengths = set.originalLengths ?? set.lengths;
      const n = c?.swimSets?.[set.index];
      const fixed = n != null && pool && n > 0 && n !== origLengths;
      const dist = fixed ? n * pool : origDist;
      delta += dist - origDist;
      lengthsDelta += (fixed ? n : origLengths) - origLengths;
      return {
        ...set,
        distanceM: dist,
        lengths: fixed ? n : origLengths,
        pace100S: dist > 0 ? round1((set.durationS / dist) * 100) : set.pace100S,
        originalDistanceM: fixed ? origDist : undefined,
        originalLengths: fixed ? origLengths : undefined,
      };
    });
    const total = baseTotal + delta;
    if (s.activeLengths != null) {
      // Nombre de longueurs de la montre = valeur actuelle moins l'effet des corrections précédentes.
      const prevEffect = a.swimming!.sets.reduce((acc, x) => acc + (x.lengths - (x.originalLengths ?? x.lengths)), 0);
      s.activeLengths = s.activeLengths - prevEffect + lengthsDelta;
    }
    s.avgPace100S = total > 0 ? round1((s.activeTimeS / total) * 100) : s.avgPace100S;
    out.distanceM = round1(total);
  }

  if (out.running) {
    const r = out.running;
    r.laps = r.laps.map((lap) => {
      const orig = lap.originalDistanceM ?? lap.distanceM;
      const m = c?.runLaps?.[lap.index];
      const fixed = m != null && m > 0 && Math.abs(m - orig) >= 1;
      const dist = fixed ? m : orig;
      delta += dist - orig;
      return {
        ...lap,
        distanceM: dist,
        paceSPerKm: dist > 10 ? round1((lap.durationS / dist) * 1000) : null,
        originalDistanceM: fixed ? orig : undefined,
      };
    });
    const total = baseTotal + delta;
    r.avgPaceSPerKm = total > 0 ? round1((out.durationS / total) * 1000) : r.avgPaceSPerKm;
    out.distanceM = round1(total);
  }

  const hasAny = !!c && (Object.keys(c.swimSets ?? {}).length > 0 || Object.keys(c.runLaps ?? {}).length > 0);
  out.corrections = hasAny ? c : undefined;
  out.originalDistanceM = delta !== 0 ? baseTotal : undefined;
  return out;
}
