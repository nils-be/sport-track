import { HashRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import Layout from './components/Layout';
import Notebook from './pages/Notebook';
import Settings from './pages/Settings';
import { ActivityDetail } from './pages/lazyPages';

/** Accueil : l'écran Séances (en gardant les paramètres, ex. « ?partage=1 » du menu Partager). */
function Home() {
  const { search } = useLocation();
  return <Navigate to={{ pathname: '/seances', search }} replace />;
}

// HashRouter : compatible GitHub Pages sans configuration de redirection.
// Les trois onglets (Coach, Séances, Progrès) sont rendus par Layout, toujours montés (carrousel).
export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          <Route path="coach" element={null} />
          <Route path="seances" element={null} />
          <Route path="progression" element={null} />
          <Route path="carnet" element={<Notebook />} />
          <Route path="reglages" element={<Settings />} />
          <Route path="seance/:id" element={<ActivityDetail />} />
          <Route path="*" element={<Home />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}
