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

  // Balayage progressif entre onglets : l'écran et la pastille de navigation suivent le doigt.
  const goTabRef = useRef(goTab);
  goTabRef.current = goTab;
  useEffect(() => {
    const root = document.documentElement, body = document.body;
    const setVars = (x: number, p: number) => {
      root.style.setProperty('--swipe-x', `${x}px`);
      root.style.setProperty('--swipe-o', `${1 - Math.min(Math.abs(x) / innerWidth, 1) * 0.5}`);
      root.style.setProperty('--swipe-p', `${p}`);
    };
    const clear = () => {
      delete body.dataset.swiping; delete body.dataset.swipeAnim;
      root.style.removeProperty('--swipe-x'); root.style.removeProperty('--swipe-o'); root.style.removeProperty('--swipe-p');
    };
    let s: { x: number; y: number; t: number; cur: number; lock: 'h' | 'v' | null; dx: number; samples: [number, number][] } | null = null;
    let animating = false;

    const onStart = (e: TouchEvent) => {
      const el = e.target as Element | null;
      const cur = ROOTS.indexOf(location.hash.replace(/^#/, '') || '/');
      s = !animating && e.touches.length === 1 && cur >= 0 && !document.body.dataset.typing && !el?.closest(NO_SWIPE)
        ? { x: e.touches[0].clientX, y: e.touches[0].clientY, t: Date.now(), cur, lock: null, dx: 0, samples: [] } : null;
    };
    const onMove = (e: TouchEvent) => {
      if (!s || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - s.x, dy = e.touches[0].clientY - s.y;
      if (!s.lock) {
        if (Math.hypot(dx, dy) < 10) return;
        s.lock = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'h' : 'v';
        if (s.lock === 'v') { s = null; return; }
        body.dataset.swiping = '1';
      }
      e.preventDefault();
      const target = dx < 0 ? s.cur + 1 : s.cur - 1;
      const edge = target < 0 || target >= TABS.length;
      const x = edge ? dx * 0.25 : dx; // résistance élastique au premier / dernier onglet
      s.dx = x;
      s.samples.push([Date.now(), dx]);
      if (s.samples.length > 12) s.samples.shift();
      setVars(x, edge ? 0 : Math.max(-1, Math.min(1, -x / innerWidth)));
    };
    const onEnd = () => {
      if (!s || s.lock !== 'h') { s = null; return; }
      const { dx, cur, samples } = s;
      s = null;
      // Vitesse sur les ~100 dernières ms : un geste lancé change d'onglet, un glissement lent relâché non.
      const now = Date.now();
      const ref = samples.find(([ts]) => now - ts <= 100) ?? samples[samples.length - 1];
      const lastX = samples[samples.length - 1]?.[1] ?? 0;
      const speed = ref ? Math.abs(lastX - ref[1]) / Math.max(now - ref[0], 16) : 0;
      const target = dx < 0 ? cur + 1 : cur - 1;
      const commit = target >= 0 && target < TABS.length && (Math.abs(dx) > innerWidth * 0.28 || speed > 0.45);
      animating = true;
      body.dataset.swipeAnim = '1';
      requestAnimationFrame(() => {
        if (commit) setVars(dx < 0 ? -innerWidth : innerWidth, dx < 0 ? 1 : -1);
        else setVars(0, 0);
      });
      setTimeout(() => {
        if (commit) { navigator.vibrate?.(5); goTabRef.current(target); }
        // Le nouvel écran entre avec sa propre animation ; on retire le décalage juste après.
        requestAnimationFrame(() => { clear(); animating = false; });
      }, 210);
    };
    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd, { passive: true });
    document.addEventListener('touchcancel', onEnd, { passive: true });
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
      clear();
    };
  }, []);

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
        {/* Enveloppe déplacée pendant un balayage (transform appliqué seulement pendant le geste). */}
        <div className="swipe-page">
          <div key={pathname} className={dir === 'next' ? 'page-from-right' : dir === 'prev' ? 'page-from-left' : 'page-in'}>
            <Outlet />
          </div>
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
          style={{ width: 'calc((100% - 0.75rem) / 3)', transform: `translateX(calc((${Math.max(active, 0)} + var(--swipe-p, 0)) * 100%))`, opacity: active < 0 ? 0 : 1 }}
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
