import { lazy, Suspense, type ComponentType } from 'react';

/**
 * Page chargée à la demande, mais préchargeable : une fois le module arrivé, elle s'affiche
 * directement, sans passer par Suspense (pas d'écran vide).
 */
function preloadable(factory: () => Promise<{ default: ComponentType }>) {
  let Loaded: ComponentType | null = null;
  let pending: Promise<void> | null = null;
  const preload = () => (pending ??= factory().then((m) => { Loaded = m.default; }));
  const Lazy = lazy(() => preload().then(() => ({ default: Loaded! })));
  const Page = () => (Loaded ? <Loaded /> : <Suspense fallback={null}><Lazy /></Suspense>);
  return Object.assign(Page, { preload });
}

// Ces écrans embarquent Recharts : chargés après le démarrage, en tâche de fond.
export const ActivityDetail = preloadable(() => import('./ActivityDetail'));
export const Progress = preloadable(() => import('./Progress'));
