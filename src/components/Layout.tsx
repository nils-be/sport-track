import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { flushSync } from 'react-dom';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { ANALYSIS_VERSION } from '../lib/analysis/version';
import { db } from '../lib/db';
import { recoverInterrupted, useDebriefQueue } from '../lib/llm/queue';
import Activities from '../pages/Activities';
import Coach from '../pages/Coach';
import { Progress } from '../pages/lazyPages';
import Icon, { type IconName } from './Icon';
import { ImportProvider } from './ImportContext';

const TABS: { to: string; label: string; icon: IconName; match: (p: string) => boolean }[] = [
  { to: '/coach', label: 'Coach', icon: 'coach', match: (p) => p === '/coach' },
  { to: '/seances', label: 'Séances', icon: 'list', match: (p) => p.startsWith('/seance') },
  { to: '/progression', label: 'Progrès', icon: 'chart', match: (p) => p.startsWith('/progression') },
];
const HOME_TAB = 1;

/** Écrans racines des onglets (le balayage ne fonctionne que depuis ceux-ci). */
const ROOTS = TABS.map((t) => t.to);
/** Zones où un geste horizontal a déjà un sens (graphiques, carrousels, tableaux, saisie, feuilles). */
const NO_SWIPE = '[data-noswipe], textarea, input, select, .snap-x, .recharts-wrapper, .overflow-x-auto, [role="dialog"]';
const PAGE_PAD = 'mx-auto min-h-dvh max-w-2xl px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))]';
const EASE = 'cubic-bezier(0.2, 0.75, 0.25, 1)';

const currentTab = () => ROOTS.indexOf(location.hash.replace(/^#/, '').split('?')[0] || '/');

/**
 * Carrousel des onglets. Les trois écrans restent montés : l'actif est dans le flux normal de la page
 * (défilement de la fenêtre), les autres attendent hors champ. Pendant un geste, les écrans concernés
 * deviennent des « fenêtres » fixes (position de défilement conservée) déplacées en transform seulement :
 * rien n'est rendu ni copié pendant l'animation, d'où la fluidité.
 */
export default function Layout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const active = ROOTS.indexOf(pathname);
  const activeRef = useRef(active);
  activeRef.current = active;

  const pageEls = useRef<(HTMLDivElement | null)[]>([]);
  const pillRef = useRef<HTMLSpanElement>(null);
  /** Position de défilement mémorisée par onglet (le Coach, lui, s'ouvre toujours en bas du fil). */
  const scrolls = useRef<number[]>(TABS.map(() => 0));
  /** Geste ou animation en cours : écrans « vivants » et position de départ. */
  const live = useRef<{ from: number; pages: number[]; anim: boolean } | null>(null);
  /** Changement d'onglet piloté par le carrousel : le défilement est déjà réglé. */
  const sliding = useRef(false);

  // Onglets montés : l'actif tout de suite, les autres dès que le navigateur est disponible.
  const [mounted, setMounted] = useState<boolean[]>(() => TABS.map((_, i) => i === (active >= 0 ? active : HOME_TAB)));
  useEffect(() => {
    const all = () => setMounted(TABS.map(() => true));
    if ('requestIdleCallback' in window) { const id = requestIdleCallback(all, { timeout: 2500 }); return () => cancelIdleCallback(id); }
    const t = setTimeout(all, 1200); return () => clearTimeout(t);
  }, []);
  useEffect(() => { if (active >= 0 && !mounted[active]) setMounted((m) => m.map((v, i) => v || i === active)); }, [active, mounted]);
  // Éléments stables : un changement d'onglet ne re-rend pas les écrans.
  const pages: ReactNode[] = useMemo(() => [<Coach key="c" />, <Activities key="a" />, <Progress key="p" />], []);

  /** Position d'arrivée d'un onglet : la mémorisée, sauf le Coach qu'on rejoint en bas du fil. */
  const scrollTarget = (i: number, el: HTMLElement | null, from: number) =>
    i === 0 && i !== from ? (el?.scrollHeight ?? 0) : scrolls.current[i];

  /** Passe les écrans `pages` en fenêtres fixes, positionnées autour de l'onglet `from`. */
  const goLive = (from: number, pages: number[]) => {
    scrolls.current[from] = scrollY;
    document.body.dataset.swiping = '1';
    for (const i of pages) {
      const el = pageEls.current[i];
      if (!el) continue;
      el.dataset.live = '1';
      el.style.transform = `translate3d(${(i - from) * innerWidth}px,0,0)`;
      el.scrollTop = scrollTarget(i, el, from);
    }
    live.current = { from, pages, anim: false };
  };

  const moveLive = (dx: number) => {
    const l = live.current;
    if (!l) return;
    for (const i of l.pages) {
      const el = pageEls.current[i];
      if (el) el.style.transform = `translate3d(${(i - l.from) * innerWidth + dx}px,0,0)`;
    }
    pillRef.current?.style.setProperty('--swipe-p', `${Math.max(-1, Math.min(1, -dx / innerWidth))}`);
  };

  /** Fin du geste : anime jusqu'à l'onglet `to` (ou retour), puis remet l'écran choisi dans le flux. */
  const settle = (to: number, speed = 0) => {
    const l = live.current;
    if (!l) return;
    l.anim = true;
    const first = pageEls.current[l.pages[0]];
    const curX = first ? new DOMMatrixReadOnly(getComputedStyle(first).transform).m41 - (l.pages[0] - l.from) * innerWidth : 0;
    const remaining = Math.abs((l.from - to) * innerWidth - curX);
    let duration = 300 * Math.min(1, remaining / innerWidth) + (Math.abs(to - l.from) > 1 ? 80 : 0);
    if (speed > 0) duration = Math.min(duration, (remaining / speed) * 1.6);
    duration = remaining < 2 ? 0 : Math.max(160, Math.min(380, duration));

    if (to !== l.from) {
      // La pastille rejoint l'onglet en même temps que les écrans.
      document.body.dataset.swipeAnim = '1';
      pillRef.current?.style.setProperty('--swipe-p', `${to - l.from}`);
      navigator.vibrate?.(5);
    }
    for (const i of l.pages) {
      const el = pageEls.current[i];
      if (!el) continue;
      el.style.transition = duration ? `transform ${duration}ms ${EASE}` : '';
      el.style.transform = `translate3d(${(i - to) * innerWidth}px,0,0)`;
    }
    window.setTimeout(() => finish(to), duration + 20);
  };

  const finish = (to: number) => {
    const l = live.current;
    if (!l) return;
    live.current = null;
    if (to !== l.from) {
      sliding.current = true;
      flushSync(() => navigate(TABS[to].to)); // l'écran cible devient l'actif (dans le flux)
    }
    for (const i of l.pages) {
      const el = pageEls.current[i];
      if (!el) continue;
      delete el.dataset.live;
      el.style.transition = '';
      el.style.transform = '';
    }
    delete document.body.dataset.swiping;
    delete document.body.dataset.swipeAnim;
    pillRef.current?.style.removeProperty('--swipe-p');
    window.scrollTo({ top: to === 0 && to !== l.from ? document.documentElement.scrollHeight : scrolls.current[to], left: 0, behavior: 'instant' });
  };

  /** Changement d'onglet par la barre de navigation : même glissement que le geste. */
  const slideTo = (target: number) => {
    const cur = currentTab();
    if (target === cur) return;
    if (cur < 0 || matchMedia('(prefers-reduced-motion: reduce)').matches) { navigate(TABS[target].to); return; }
    if (live.current) finish(live.current.from);
    const lo = Math.min(cur, target), hi = Math.max(cur, target);
    goLive(cur, TABS.map((_, i) => i).filter((i) => i >= lo && i <= hi && mounted[i]));
    requestAnimationFrame(() => settle(target));
  };

  // Geste de balayage : l'écran courant et ses voisins suivent le doigt.
  const api = useRef({ goLive, moveLive, settle });
  api.current = { goLive, moveLive, settle };
  useEffect(() => {
    let s: { x: number; y: number; cur: number; lock: 'h' | 'v' | null; dx: number; samples: [number, number][] } | null = null;
    let frame = 0;

    const onStart = (e: TouchEvent) => {
      const el = e.target as Element | null;
      const cur = currentTab();
      s = !live.current && e.touches.length === 1 && cur >= 0 && !document.body.dataset.typing && !el?.closest(NO_SWIPE)
        ? { x: e.touches[0].clientX, y: e.touches[0].clientY, cur, lock: null, dx: 0, samples: [] } : null;
    };
    const onMove = (e: TouchEvent) => {
      if (!s || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - s.x, dy = e.touches[0].clientY - s.y;
      if (!s.lock) {
        if (Math.hypot(dx, dy) < 10) return;
        s.lock = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'h' : 'v';
        if (s.lock === 'v') { s = null; return; }
        api.current.goLive(s.cur, [s.cur - 1, s.cur, s.cur + 1].filter((i) => i >= 0 && i < TABS.length));
      }
      e.preventDefault();
      const target = dx < 0 ? s.cur + 1 : s.cur - 1;
      const x = target < 0 || target >= TABS.length ? dx * 0.25 : dx; // résistance élastique aux extrémités
      s.dx = x;
      s.samples.push([e.timeStamp, dx]);
      if (s.samples.length > 12) s.samples.shift();
      // Un seul déplacement par image, quelle que soit la fréquence des événements tactiles.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => api.current.moveLive(x));
    };
    const onEnd = (e: TouchEvent) => {
      if (!s || s.lock !== 'h') { s = null; return; }
      cancelAnimationFrame(frame);
      const { dx, cur, samples } = s;
      s = null;
      api.current.moveLive(dx);
      // Vitesse sur les ~100 dernières ms : un geste lancé change d'onglet, un glissement lent relâché non.
      const ref = samples.find(([ts]) => e.timeStamp - ts <= 100) ?? samples[0];
      const last = samples[samples.length - 1];
      const v = ref && last ? (last[1] - ref[1]) / Math.max(last[0] - ref[0], 16) : 0; // px/ms, signée
      const target = dx < 0 ? cur + 1 : cur - 1;
      const sameWay = Math.sign(v) === Math.sign(dx) || Math.abs(v) < 0.1;
      const commit = target >= 0 && target < TABS.length && sameWay && (Math.abs(dx) > innerWidth * 0.28 || Math.abs(v) > 0.35);
      api.current.settle(commit ? target : cur, Math.abs(v));
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
      cancelAnimationFrame(frame);
    };
  }, []);

  // Défilement mémorisé de l'onglet actif.
  useEffect(() => {
    const onScroll = () => { if (activeRef.current >= 0 && !live.current) scrolls.current[activeRef.current] = scrollY; };
    addEventListener('scroll', onScroll, { passive: true });
    return () => removeEventListener('scroll', onScroll);
  }, []);

  // Arrivée sur un écran sans passer par le carrousel : onglet → sa position mémorisée (Coach : en bas),
  // autre écran → en haut. « instant » annule un défilement animé en cours.
  useLayoutEffect(() => {
    if (sliding.current) { sliding.current = false; return; }
    const y = () => (active === 0 ? document.documentElement.scrollHeight : active > 0 ? scrolls.current[active] : 0);
    const go = () => window.scrollTo({ top: y(), left: 0, behavior: 'instant' });
    go();
    const raf = requestAnimationFrame(go);
    const t = window.setTimeout(go, 120);
    return () => { cancelAnimationFrame(raf); window.clearTimeout(t); };
  }, [pathname]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    void recoverInterrupted();
    // Villes des séances pas encore localisées (réseau requis).
    void import('../lib/places').then((m) => m.resolvePlaces());
    // Séances analysées par une ancienne version de l'algorithme : réanalyse en tâche de fond.
    void db.activities.filter((a) => (a.analysisVersion ?? 0) < ANALYSIS_VERSION).count().then(async (n) => {
      if (!n) return;
      const { reanalyzeOutdated } = await import('../lib/import/reanalyze');
      await reanalyzeOutdated();
    });
    void import('../pages/lazyPages').then((m) => m.ActivityDetail.preload());
  }, []);

  return (
    <ImportProvider>
      {TABS.map((t, i) => (
        <div key={t.to} ref={(el) => { pageEls.current[i] = el; }} className={`tab-page ${i === active ? '' : 'tab-idle'}`}
          aria-hidden={i === active ? undefined : true} inert={i !== active || undefined}>
          <div className={PAGE_PAD}>{mounted[i] && pages[i]}</div>
        </div>
      ))}
      {active < 0 && (
        <main className={PAGE_PAD}>
          {/* La clé force l'animation d'entrée à chaque changement d'écran. */}
          <div key={pathname} className="page-in"><Outlet /></div>
        </main>
      )}
      <FloatingNav pathname={pathname} onTab={slideTo} pillRef={pillRef} />
    </ImportProvider>
  );
}

function FloatingNav({ pathname, onTab, pillRef }: { pathname: string; onTab: (i: number) => void; pillRef: RefObject<HTMLSpanElement | null> }) {
  const queue = useDebriefQueue();
  const pendingChat = useLiveQuery(() => db.messages.filter((m) => m.status === 'pending').count(), []);
  const active = TABS.findIndex((t) => t.match(pathname));
  const coachBusy = !!queue.running || !!pendingChat;

  return (
    <nav className="floating-nav pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
      <div className="pointer-events-auto relative flex h-16 w-full max-w-xs items-center rounded-full bg-white/80 p-1.5 shadow-xl shadow-slate-900/10 ring-1 ring-slate-200/80 backdrop-blur-xl dark:bg-slate-900/80 dark:shadow-black/40 dark:ring-slate-700/70">
        {/* Pastille qui glisse sous l'onglet actif. */}
        <span
          ref={pillRef}
          aria-hidden="true"
          className="nav-pill absolute top-1.5 bottom-1.5 left-1.5 rounded-full bg-accent-soft"
          style={{ width: 'calc((100% - 0.75rem) / 3)', transform: `translateX(calc((${Math.max(active, 0)} + var(--swipe-p, 0)) * 100%))`, opacity: active < 0 ? 0 : 1 }}
        />
        {TABS.map((t, i) => (
          <NavLink key={t.to} to={t.to} onClick={(e) => { e.preventDefault(); navigator.vibrate?.(5); onTab(i); }}
            className={`relative z-10 flex h-full flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[11px] transition-colors duration-300 ${i === active ? 'font-semibold text-accent' : 'text-slate-500 dark:text-slate-400'}`}>
            <span className="relative">
              <Icon name={t.icon} className={`size-[22px] transition-transform duration-300 ${i === active ? 'scale-110' : ''}`} />
              {i === 0 && coachBusy && <span className="absolute -top-0.5 -right-1 size-2 animate-pulse rounded-full bg-accent ring-2 ring-white dark:ring-slate-900" />}
            </span>
            {t.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
