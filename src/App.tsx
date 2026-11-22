import { lazy, Suspense } from 'react';
import { HashRouter, Route, Routes } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import Activities from './pages/Activities';
import Notebook from './pages/Notebook';
import Settings from './pages/Settings';

// Le détail embarque Recharts : chargé à la demande.
const ActivityDetail = lazy(() => import('./pages/ActivityDetail'));
const Progress = lazy(() => import('./pages/Progress'));

// HashRouter : compatible GitHub Pages sans configuration de redirection.
export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="seances" element={<Activities />} />
          <Route path="carnet" element={<Notebook />} />
          <Route path="progression" element={<Suspense fallback={null}><Progress /></Suspense>} />
          <Route path="reglages" element={<Settings />} />
          <Route path="seance/:id" element={<Suspense fallback={null}><ActivityDetail /></Suspense>} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
