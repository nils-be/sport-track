import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
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
const restX = (i: number, at: number) => `translate3d(${(i - at) * 100}%,0,0)`;

/**
 * Carrousel des onglets, comme une application native : chaque onglet est un calque fixe plein écran
 * avec sa propre zone de défilement, toujours dessiné, posé à côté des autres (hors champ). Un geste ne
 * fait que déplacer ces calques (transform) : rien n'est rendu, recopié ni redessiné pendant le mouvement.
 * Chaque onglet garde naturellement sa position de défilement.
 */
export default function Layout() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const active = ROOTS.indexOf(pathname);
  /** Dernier onglet affiché : les calques restent placés autour de lui pendant qu'on est sur un autre écran. */
  const lastTab = useRef(active >= 0 ? active : HOME_TAB);
  if (active >= 0) lastTab.current = active;
  const at = lastTab.current;

  const pageEls = useRef<(HTMLDivElement | null)[]>([]);
  const pillRef = useRef<HTMLSpanElement>(null);
  /** Geste ou animation en cours. */
  const live = useRef<{ from: number; timer?: number } | null>(null);

  // Onglets montés : l'actif tout de suite, les autres dès que le navigateur est disponible.
  const [mounted, setMounted] = useState<boolean[]>(() => TABS.map((_, i) => i === at));
  useEffect(() => {
    const all = () => setMounted(TABS.map(() => true));
    if ('requestIdleCallback' in window) { const id = requestIdleCallback(all, { timeout: 2500 }); return () => cancelIdleCallback(id); }
    const t = setTimeout(all, 1200); return () => clearTimeout(t);
  }, []);
  useEffect(() => { if (active >= 0 && !mounted[active]) setMounted((m) => m.map((v, i) => v || i === active)); }, [active, mounted]);
  // Éléments stables : un changement d'onglet ne re-rend pas les écrans.
  const pages: ReactNode[] = useMemo(() => [<Coach key="c" />, <Activities key="a" />, <Progress key="p" />], []);

  const pill = () => pillRef.current;

  const begin = (from: number) => {
    live.current = { from };
    document.body.dataset.swiping = '1';
    const p = pill();
    if (p) p.style.transition = 'none';
    pageEls.current.forEach((el) => { if (el) el.style.transition = 'none'; });
  };

  const move = (dx: number) => {
    const l = live.current;
    if (!l) return;
    pageEls.current.forEach((el, i) => { if (el) el.style.transform = `translate3d(calc(${(i - l.from) * 100}% + ${dx}px),0,0)`; });
    pill()?.style.setProperty('--swipe-p', `${Math.max(-1, Math.min(1, -dx / innerWidth))}`);
  };

  /** Anime jusqu'à l'onglet `to` (ou retour à l'onglet de départ), écrans et pastille ensemble. */
  const settle = (to: number, dx: number, speed = 0) => {
    const l = live.current;
    if (!l) return;
    const remaining = Math.abs((l.from - to) * innerWidth - dx);
    let duration = 300 * Math.min(1, remaining / innerWidth) + (Math.abs(to - l.from) > 1 ? 80 : 0);
    if (speed > 0) duration = Math.min(duration, (remaining / speed) * 1.6);
    duration = remaining < 2 ? 0 : Math.max(160, Math.min(380, duration));
    if (to !== l.from) navigator.vibrate?.(5);
    const tr = duration ? `transform ${duration}ms ${EASE}` : 'none';
    pageEls.current.forEach((el, i) => {
      if (!el) return;
      el.style.transition = tr;
      el.style.transform = restX(i, to);
    });
    const p = pill();
    if (p) { p.style.transition = tr; p.style.setProperty('--swipe-p', `${to - l.from}`); }
    l.timer = window.setTimeout(() => finish(to), duration + 30);
  };

  /** Remet la pastille sous le contrôle de React, sans animation (sa position affichée est déjà la bonne). */
  const releasePill = () => {
    const p = pill();
    if (!p) return;
    p.style.removeProperty('--swipe-p');
    void p.offsetWidth; // appliqué tant que la transition est coupée
    p.style.transition = '';
    delete document.body.dataset.swiping;
  };
  /** Changement d'onglet demandé par le carrousel, en attente du rendu de React. */
  const pendingTab = useRef<number | null>(null);

  /**
   * Fin d'animation : l'onglet `to` devient l'actif. Les positions écrites à la main valent déjà celles
   * que React va écrire. Le routeur rend le changement en différé (startTransition) : la pastille n'est
   * rendue à React qu'une fois ce rendu appliqué (voir l'effet sur pathname), sinon elle sautillerait.
   */
  const finish = (to: number) => {
    const l = live.current;
    if (!l) return;
    window.clearTimeout(l.timer);
    live.current = null;
    pageEls.current.forEach((el, i) => { if (el) { el.style.transition = 'none'; el.style.transform = restX(i, to); } });
    const p = pill();
    if (p) p.style.transition = 'none';
    requestAnimationFrame(() => pageEls.current.forEach((el) => { if (el) el.style.transition = ''; }));
    if (to === l.from) { releasePill(); return; }
    pendingTab.current = to;
    navigate(TABS[to].to);
  };
  useLayoutEffect(() => {
    if (pendingTab.current == null || pendingTab.current !== active) return;
    pendingTab.current = null;
    releasePill();
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Changement d'onglet par la barre de navigation : même glissement que le geste. */
  const slideTo = (target: number) => {
    if (live.current) finish(live.current.from);
    const cur = currentTab();
    if (target === cur) return;
    if (cur < 0 || matchMedia('(prefers-reduced-motion: reduce)').matches) { navigate(TABS[target].to); return; }
    begin(cur);
    requestAnimationFrame(() => settle(target, 0));
  };

  // Geste de balayage : les calques suivent le doigt.
  const api = useRef({ begin, move, settle, finish });
  api.current = { begin, move, settle, finish };
  useEffect(() => {
    let s: { x: number; y: number; cur: number; lock: 'h' | 'v' | null; dx: number; samples: [number, number][] } | null = null;
    let frame = 0;

    const onStart = (e: TouchEvent) => {
      const el = e.target as Element | null;
      const cur = currentTab();
      s = e.touches.length === 1 && cur >= 0 && !document.body.dataset.typing && !el?.closest(NO_SWIPE)
        ? { x: e.touches[0].clientX, y: e.touches[0].clientY, cur, lock: null, dx: 0, samples: [] } : null;
    };
    const onMove = (e: TouchEvent) => {
      if (!s || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - s.x, dy = e.touches[0].clientY - s.y;
      if (!s.lock) {
        if (Math.hypot(dx, dy) < 10) return;
        s.lock = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'h' : 'v';
        if (s.lock === 'v') { s = null; return; }
        if (live.current) api.current.finish(live.current.from); // geste repris pendant une animation
        s.cur = currentTab();
        api.current.begin(s.cur);
      }
      e.preventDefault();
      const target = dx < 0 ? s.cur + 1 : s.cur - 1;
      const x = target < 0 || target >= TABS.length ? dx * 0.25 : dx; // résistance élastique aux extrémités
      s.dx = x;
      s.samples.push([e.timeStamp, dx]);
      if (s.samples.length > 12) s.samples.shift();
      // Un seul déplacement par image, quelle que soit la fréquence des événements tactiles.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => api.current.move(x));
    };
    const onEnd = (e: TouchEvent) => {
      if (!s || s.lock !== 'h') { s = null; return; }
      cancelAnimationFrame(frame);
      const { dx, cur, samples } = s;
      s = null;
      api.current.move(dx);
      // Vitesse sur les ~100 dernières ms : un geste lancé change d'onglet, un glissement lent relâché non.
      const ref = samples.find(([ts]) => e.timeStamp - ts <= 100) ?? samples[0];
      const last = samples[samples.length - 1];
      const v = ref && last ? (last[1] - ref[1]) / Math.max(last[0] - ref[0], 16) : 0; // px/ms, signée
      const target = dx < 0 ? cur + 1 : cur - 1;
      const sameWay = Math.sign(v) === Math.sign(dx) || Math.abs(v) < 0.1;
      const commit = target >= 0 && target < TABS.length && sameWay && (Math.abs(dx) > innerWidth * 0.28 || Math.abs(v) > 0.35);
      // Le style posé par move() doit être appliqué avant de lancer la transition.
      requestAnimationFrame(() => api.current.settle(commit ? target : cur, dx, Math.abs(v)));
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

  // Autres écrans (détail, réglages, carnet) : ouverture en haut de page.
  useLayoutEffect(() => {
    if (active >= 0) return;
    const top = () => window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    top();
    const raf = requestAnimationFrame(top);
    const t = window.setTimeout(top, 120);
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
        <div key={t.to} ref={(el) => { pageEls.current[i] = el; }} className="tab-page"
          style={{ transform: restX(i, at) }} data-off={active < 0 || undefined}
          aria-hidden={i === active ? undefined : true} inert={i !== active || undefined}>
          <div className="tab-scroll" data-tab-scroller={t.to}>
            <div className={PAGE_PAD}>{mounted[i] && pages[i]}</div>
          </div>
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
