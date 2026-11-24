import { lazy, Suspense, type ComponentType } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Coach from './pages/Coach';
import Activities from './pages/Activities';
import Notebook from './pages/Notebook';
import Settings from './pages/Settings';

/**
 * Page chargée à la demande, mais préchargeable : une fois le module arrivé, elle s'affiche
 * directement, sans passer par Suspense (pas d'écran vide pendant le changement d'onglet).
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
const ActivityDetail = preloadable(() => import('./pages/ActivityDetail'));
const Progress = preloadable(() => import('./pages/Progress'));
const preloadPages = () => { void Progress.preload(); void ActivityDetail.preload(); };
if ('requestIdleCallback' in window) requestIdleCallback(preloadPages, { timeout: 3000 });
else setTimeout(preloadPages, 1500);

// HashRouter : compatible GitHub Pages sans configuration de redirection.
export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Coach />} />
          <Route path="seances" element={<Activities />} />
          <Route path="carnet" element={<Notebook />} />
          <Route path="progression" element={<Progress />} />
          <Route path="reglages" element={<Settings />} />
          <Route path="seance/:id" element={<ActivityDetail />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
