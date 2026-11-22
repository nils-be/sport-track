import { applyCorrections } from './analysis/corrections';
import type { Corrections } from './analysis/types';
import { db } from './db';

/**
 * Corrige (ou rétablit, avec `value = null`) la distance d'une série de natation (en longueurs)
 * ou d'un tour de course (en mètres), puis enregistre la séance recalculée.
 */
export async function saveCorrection(activityId: string, kind: keyof Corrections, index: number, value: number | null): Promise<void> {
  const a = await db.activities.get(activityId);
  if (!a) return;
  const c: Corrections = structuredClone(a.corrections ?? {});
  const map = { ...(c[kind] ?? {}) };
  if (value == null) delete map[index];
  else map[index] = value;
  c[kind] = map;
  await db.activities.put(applyCorrections(a, c));
}
