// File d'attente des débriefs. Module léger : le code d'appel LLM (SDK) n'est chargé qu'au premier débrief.
import { useSyncExternalStore } from 'react';
import { db } from '../db';
import type { Provider } from './models';

interface QueueState {
  running: string | null;
  pending: string[];
  /** Nombre de débriefs terminés depuis le début de la série en cours. */
  done: number;
}

let state: QueueState = { running: null, pending: [], done: 0 };
const listeners = new Set<() => void>();
const emit = (s: QueueState) => { state = s; listeners.forEach((l) => l()); };

export async function hasApiKey(provider: Provider): Promise<boolean> {
  return !!(await db.secrets.get(provider))?.key;
}

/** Ajoute des séances à débriefer, traitées une par une de la plus ancienne à la plus récente (le carnet évolue dans l'ordre). */
export async function enqueueDebriefs(ids: string[]): Promise<void> {
  const known = new Set([...state.pending, ...(state.running ? [state.running] : [])]);
  const fresh = ids.filter((id) => !known.has(id));
  if (!fresh.length) return;
  const acts = await db.activities.bulkGet([...state.pending, ...fresh]);
  const sorted = acts.filter((a) => a != null).sort((a, b) => a!.startTime - b!.startTime).map((a) => a!.id);
  // Affichage immédiat de l'état « en cours » sur les cartes.
  for (const id of fresh) {
    const prev = await db.debriefs.get(id);
    await db.debriefs.put({ ...prev, activityId: id, status: 'pending', createdAt: prev?.createdAt ?? Date.now() });
  }
  emit({ ...state, pending: sorted });
  if (!state.running) void processQueue();
}

async function processQueue(): Promise<void> {
  const { generateDebrief } = await import('./debrief');
  while (state.pending.length) {
    const [next, ...rest] = state.pending;
    emit({ ...state, running: next, pending: rest });
    try {
      await generateDebrief(next);
    } catch (e) {
      console.error('Débrief', e);
    }
    emit({ ...state, done: state.done + 1 });
  }
  emit({ running: null, pending: [], done: 0 });
}

export function useDebriefQueue(): QueueState {
  return useSyncExternalStore((l) => { listeners.add(l); return () => { listeners.delete(l); }; }, () => state);
}

/** Au démarrage : un débrief resté « en cours » a été interrompu (application fermée). */
export async function recoverInterrupted(): Promise<void> {
  if (state.running || state.pending.length) return;
  await db.debriefs.where('status').equals('pending')
    .modify({ status: 'error', error: 'Débrief interrompu (application fermée pendant la génération). Relance-le.' });
}
