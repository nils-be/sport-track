import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useRef, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ANALYSIS_VERSION } from '../lib/analysis/version';
import { db } from '../lib/db';
import { recoverInterrupted, useDebriefQueue } from '../lib/llm/queue';
import Icon, { type IconName } from './Icon';
import { ImportProvider } from './ImportContext';

const TABS: { to: string; label: string; icon: IconName; match: (p: string) => boolean }[] = [
  { to: '/', label: 'Coach', icon: 'coach', match: (p) => p === '/' },
  { to: '/seances', label: 'Séances', icon: 'list', match: (p) => p.startsWith('/seance') },
  { to: '/progression', label: 'Progrès', icon: 'chart', match: (p) => p.startsWith('/progression') },
];

/** Écrans racines des onglets (le balayage ne fonctionne que depuis ceux-ci). */
const ROOTS = TABS.map((t) => t.to);
/** Zones où un geste horizontal a déjà un sens (graphiques, carrousels, tableaux, saisie, feuilles). */
const NO_SWIPE = '[data-noswipe], textarea, input, select, .snap-x, .recharts-wrapper, .overflow-x-auto, [role="dialog"]';

export default function Layout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  // Sens de l'animation d'entrée : depuis la droite (onglet suivant) ou la gauche (précédent).
  const [dir, setDir] = useState<'next' | 'prev' | null>(null);
  const goTab = (i: number) => {
    const cur = ROOTS.indexOf(pathname);
    if (i < 0 || i >= TABS.length || i === cur) return;
    setDir(cur < 0 || i > cur ? 'next' : 'prev');
    navigate(TABS[i].to);
  };

  // Balayage horizontal pour passer d'un onglet à l'autre.
  const start = useRef<{ x: number; y: number; t: number } | null>(null);
  useEffect(() => {
    const onStart = (e: TouchEvent) => {
      const el = e.target as Element | null;
      start.current = e.touches.length === 1 && !el?.closest(NO_SWIPE) ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now() } : null;
    };
    const onEnd = (e: TouchEvent) => {
      const s = start.current;
      start.current = null;
      const cur = ROOTS.indexOf(location.hash.replace(/^#/, '') || '/');
      if (!s || cur < 0 || document.body.dataset.typing) return;
      const dx = e.changedTouches[0].clientX - s.x, dy = e.changedTouches[0].clientY - s.y;
      if (Math.abs(dx) > 70 && Math.abs(dx) > 1.8 * Math.abs(dy) && Date.now() - s.t < 700) {
        navigator.vibrate?.(5);
        goTabRef.current(dx < 0 ? cur + 1 : cur - 1);
      }
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchend', onEnd, { passive: true });
    return () => { document.removeEventListener('touchstart', onStart); document.removeEventListener('touchend', onEnd); };
  }, []);
  const goTabRef = useRef(goTab);
  goTabRef.current = goTab;

  // Chaque écran s'ouvre en haut de page (le Coach se place lui-même en bas du fil).
  useEffect(() => { if (pathname !== '/') window.scrollTo(0, 0); }, [pathname]);

  useEffect(() => {
    void recoverInterrupted();
    // Séances analysées par une ancienne version de l'algorithme : réanalyse en tâche de fond.
    void db.activities.filter((a) => (a.analysisVersion ?? 0) < ANALYSIS_VERSION).count().then(async (n) => {
      if (!n) return;
      const { reanalyzeOutdated } = await import('../lib/import/reanalyze');
      await reanalyzeOutdated();
    });
  }, []);

  return (
    <ImportProvider>
      <main className="mx-auto min-h-dvh max-w-2xl px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))]">
        {/* La clé force l'animation d'entrée à chaque changement d'écran. */}
        <div key={pathname} className={dir === 'next' ? 'page-from-right' : dir === 'prev' ? 'page-from-left' : 'page-in'}>
          <Outlet />
        </div>
      </main>
      <FloatingNav pathname={pathname} onTab={goTab} />
    </ImportProvider>
  );
}

function FloatingNav({ pathname, onTab }: { pathname: string; onTab: (i: number) => void }) {
  const queue = useDebriefQueue();
  const pendingChat = useLiveQuery(() => db.messages.filter((m) => m.status === 'pending').count(), []);
  const active = TABS.findIndex((t) => t.match(pathname));
  const coachBusy = !!queue.running || !!pendingChat;

  return (
    <nav className="floating-nav pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto relative flex h-16 w-full max-w-xs items-center rounded-full bg-white/80 p-1.5 shadow-xl shadow-slate-900/10 ring-1 ring-slate-200/80 backdrop-blur-xl dark:bg-slate-900/80 dark:shadow-black/40 dark:ring-slate-700/70">
        {/* Pastille qui glisse sous l'onglet actif. */}
        <span
          aria-hidden="true"
          className="nav-pill absolute top-1.5 bottom-1.5 left-1.5 rounded-full bg-accent-soft"
          style={{ width: 'calc((100% - 0.75rem) / 3)', transform: `translateX(${Math.max(active, 0) * 100}%)`, opacity: active < 0 ? 0 : 1 }}
        />
        {TABS.map((t, i) => (
          <NavLink key={t.to} to={t.to} end={t.to === '/'} onClick={(e) => { e.preventDefault(); navigator.vibrate?.(5); onTab(i); }}
            className={`relative z-10 flex h-full flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[11px] transition-colors duration-300 ${i === active ? 'font-semibold text-accent' : 'text-slate-500 dark:text-slate-400'}`}>
            <span className="relative">
              <Icon name={t.icon} className={`size-[22px] transition-transform duration-300 ${i === active ? 'scale-110' : ''}`} />
              {t.to === '/' && coachBusy && <span className="absolute -top-0.5 -right-1 size-2 animate-pulse rounded-full bg-accent ring-2 ring-white dark:ring-slate-900" />}
            </span>
            {t.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
