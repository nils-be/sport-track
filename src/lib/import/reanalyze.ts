import { analyzeFit } from '../analysis/analyze';
import { db, getSettings } from '../db';
import { decodeFit } from '../fit/decode';

/** Réanalyse toutes les séances à partir des fichiers FIT conservés (ex. après un changement de zones). */
export async function reanalyzeAll(onProgress?: (done: number, total: number) => void, onlyIds?: string[]): Promise<number> {
  const settings = await getSettings();
  const keys = onlyIds ?? ((await db.fitFiles.toCollection().primaryKeys()) as string[]);
  let done = 0;
  for (const id of keys) {
    const f = await db.fitFiles.get(id);
    const prev = await db.activities.get(id);
    if (f && prev) {
      try {
        const { activity, streams } = analyzeFit(decodeFit(f.bytes), settings.zones);
        await db.transaction('rw', db.activities, db.streams, async () => {
          await db.activities.put({ ...activity, id, importedAt: prev.importedAt });
          if (streams) await db.streams.put({ ...streams, activityId: id });
        });
      } catch (e) {
        console.error('Réanalyse', id, e);
      }
    }
    onProgress?.(++done, keys.length);
  }
  return done;
}

/** Réanalyse les séances analysées par une version plus ancienne de l'algorithme. */
export async function reanalyzeOutdated(): Promise<number> {
  const { ANALYSIS_VERSION } = await import('../analysis/version');
  const ids = (await db.activities.filter((a) => (a.analysisVersion ?? 0) < ANALYSIS_VERSION).primaryKeys()) as string[];
  return ids.length ? reanalyzeAll(undefined, ids) : 0;
}
