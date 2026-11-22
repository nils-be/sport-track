import { db, type NotebookVersion } from './db';

export const MAX_VERSIONS = 10;
export const MAX_WORDS = 1500;

export const INITIAL_NOTEBOOK = `Objectifs :
- (à compléter : ex. semi-marathon en mars, nager 2 km en continu…)

Contexte actuel (blessures, fatigue, contraintes) :
- Rien de signalé.

Points forts :
- Pas encore assez de séances pour juger.

Points faibles :
- Pas encore assez de séances pour juger.

Tendances récentes :
- Aucune pour l'instant.

Ce qui marche / ce qui ne marche pas :
- À découvrir au fil des séances.`;

export const wordCount = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);

/** Version courante du carnet (créée au premier accès). */
export async function currentNotebook(): Promise<NotebookVersion> {
  // Transaction en écriture : deux appels simultanés ne créent pas deux versions initiales.
  return db.transaction('rw', db.notebook, async () => {
    const last = await db.notebook.orderBy('id').last();
    if (last) return last;
    const v: NotebookVersion = { createdAt: Date.now(), text: INITIAL_NOTEBOOK, source: 'initial' };
    v.id = await db.notebook.add(v);
    return v;
  });
}

/** Enregistre une nouvelle version et ne garde que les 10 dernières. */
export async function saveNotebook(text: string, source: NotebookVersion['source'], activityId?: string): Promise<NotebookVersion> {
  return db.transaction('rw', db.notebook, async () => {
    const v: NotebookVersion = { createdAt: Date.now(), text: text.trim(), source, activityId };
    v.id = await db.notebook.add(v);
    const ids = (await db.notebook.orderBy('id').primaryKeys()) as number[];
    if (ids.length > MAX_VERSIONS) await db.notebook.bulkDelete(ids.slice(0, ids.length - MAX_VERSIONS));
    return v;
  });
}
