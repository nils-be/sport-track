import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import { flushSync } from 'react-dom';
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
  const pageRef = useRef<HTMLDivElement>(null);
  const pillRef = useRef<HTMLSpanElement>(null);
  /** Vrai pendant le rendu d'un changement d'onglet : l'écran est animé par slideTo, pas par la classe CSS. */
  const tabNav = useRef(false);
  const transition = useRef<{ finish: () => void } | null>(null);

  /** Variables du geste, posées sur l'écran et la pastille uniquement. */
  const setSwipe = (x: number | null, p = 0) => {
    const page = pageRef.current, pill = pillRef.current;
    if (x == null) {
      delete document.body.dataset.swiping;
      page?.style.removeProperty('--swipe-x');
      pill?.style.removeProperty('--swipe-p');
      return;
    }
    document.body.dataset.swiping = '1';
    page?.style.setProperty('--swipe-x', `${x}px`);
    pill?.style.setProperty('--swipe-p', `${p}`);
  };

  /**
   * Change d'onglet comme un carrousel : une copie figée de l'écran actuel sort d'un côté pendant que
   * le nouvel écran entre de l'autre, collé à elle. `fromDx` : décalage déjà parcouru au doigt.
   */
  const slideTo = (target: number, fromDx = 0, speed = 0) => {
    const cur = ROOTS.indexOf(location.hash.replace(/^#/, '') || '/');
    if (target < 0 || target >= TABS.length || target === cur) { setSwipe(null); return; }
    transition.current?.finish();
    const page = pageRef.current;
    const w = innerWidth;
    const forward = cur < 0 || target > cur;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

    let ghost: HTMLDivElement | null = null;
    if (page && cur >= 0 && !reduce) {
      const r = page.getBoundingClientRect();
      ghost = document.createElement('div');
      ghost.className = 'swipe-ghost';
      ghost.setAttribute('aria-hidden', 'true');
      const copy = page.cloneNode(true) as HTMLElement;
      copy.removeAttribute('style');
      Object.assign(copy.style, { left: `${r.left - fromDx}px`, width: `${r.width}px`, top: `${r.top + scrollY}px`, transform: `translateX(${fromDx}px)` });
      ghost.appendChild(copy);
      document.body.appendChild(ghost);
      ghost.scrollTop = scrollY; // les en-têtes collants restent en place dans la copie
    }

    setSwipe(null);
    tabNav.current = true;
    flushSync(() => navigate(TABS[target].to));
    if (!ghost || !page) return;

    // Durée : proportionnelle au chemin restant, raccourcie si le geste était rapide.
    const exitTo = forward ? -w : w;
    const remaining = Math.abs(exitTo - fromDx);
    let duration = 320 * (remaining / w);
    if (speed > 0) duration = Math.min(duration, (remaining / speed) * 1.6);
    duration = Math.max(170, Math.min(320, duration));
    const opts: KeyframeAnimationOptions = { duration, easing: 'cubic-bezier(0.2, 0.75, 0.25, 1)' };
    document.body.dataset.swipeAnim = '1';
    const out = ghost.firstElementChild!.animate([{ transform: `translateX(${fromDx}px)` }, { transform: `translateX(${exitTo}px)` }], opts);
    const inn = page.animate([{ transform: `translateX(${(forward ? w : -w) + fromDx}px)` }, { transform: 'none' }], opts);
    const done = () => {
      ghost!.remove();
      delete document.body.dataset.swipeAnim;
      transition.current = null;
    };
    transition.current = { finish: () => { out.finish(); inn.finish(); done(); } };
    inn.onfinish = done;
  };

  // Balayage progressif entre onglets : l'écran et la pastille de navigation suivent le doigt.
  const slideRef = useRef(slideTo);
  slideRef.current = slideTo;
  const setSwipeRef = useRef(setSwipe);
  setSwipeRef.current = setSwipe;
  useEffect(() => {
    let s: { x: number; y: number; cur: number; lock: 'h' | 'v' | null; dx: number; samples: [number, number][] } | null = null;
    let frame = 0;
    let settling = false;

    const onStart = (e: TouchEvent) => {
      const el = e.target as Element | null;
      const cur = ROOTS.indexOf(location.hash.replace(/^#/, '') || '/');
      s = !settling && e.touches.length === 1 && cur >= 0 && !document.body.dataset.typing && !el?.closest(NO_SWIPE)
        ? { x: e.touches[0].clientX, y: e.touches[0].clientY, cur, lock: null, dx: 0, samples: [] } : null;
    };
    const onMove = (e: TouchEvent) => {
      if (!s || e.touches.length !== 1) return;
      const dx = e.touches[0].clientX - s.x, dy = e.touches[0].clientY - s.y;
      if (!s.lock) {
        if (Math.hypot(dx, dy) < 10) return;
        s.lock = Math.abs(dx) > Math.abs(dy) * 1.2 ? 'h' : 'v';
        if (s.lock === 'v') { s = null; return; }
        transition.current?.finish();
      }
      e.preventDefault();
      const target = dx < 0 ? s.cur + 1 : s.cur - 1;
      const edge = target < 0 || target >= TABS.length;
      const x = edge ? dx * 0.25 : dx; // résistance élastique au premier / dernier onglet
      s.dx = x;
      s.samples.push([e.timeStamp, dx]);
      if (s.samples.length > 12) s.samples.shift();
      // Un seul rendu par image, quelle que soit la fréquence des événements tactiles.
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setSwipeRef.current(x, edge ? 0 : Math.max(-1, Math.min(1, -x / innerWidth))));
    };
    const onEnd = (e: TouchEvent) => {
      if (!s || s.lock !== 'h') { s = null; return; }
      cancelAnimationFrame(frame);
      const { dx, cur, samples } = s;
      s = null;
      // Vitesse sur les ~100 dernières ms : un geste lancé change d'onglet, un glissement lent relâché non.
      const ref = samples.find(([ts]) => e.timeStamp - ts <= 100) ?? samples[samples.length - 1];
      const last = samples[samples.length - 1];
      const speed = ref && last ? Math.abs(last[1] - ref[1]) / Math.max(last[0] - ref[0], 16) : 0;
      const target = dx < 0 ? cur + 1 : cur - 1;
      const towards = samples.length < 2 || Math.sign(last[1] - (samples[samples.length - 2]?.[1] ?? 0)) !== Math.sign(-dx) || speed < 0.1;
      const commit = target >= 0 && target < TABS.length && towards && (Math.abs(dx) > innerWidth * 0.28 || speed > 0.4);
      if (commit) { navigator.vibrate?.(5); slideRef.current(target, dx, speed); return; }
      // Retour en place, animé.
      const page = pageRef.current;
      settling = true;
      setSwipeRef.current(null);
      const back = page?.animate([{ transform: `translateX(${dx}px)` }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' });
      if (back) back.onfinish = () => { settling = false; }; else settling = false;
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
      setSwipeRef.current(null);
    };
  }, []);
  useEffect(() => { tabNav.current = false; }, [pathname]);

  // Chaque écran s'ouvre en haut de page (le Coach se place lui-même en bas du fil).
  // « instant » annule un défilement animé en cours ; on recommence une fois le contenu chargé.
  useLayoutEffect(() => {
    if (pathname === '/') return;
    const top = () => window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    top();
    const raf = requestAnimationFrame(top);
    const t = window.setTimeout(top, 120);
    return () => { cancelAnimationFrame(raf); window.clearTimeout(t); };
  }, [pathname]);

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
  }, []);

  return (
    <ImportProvider>
      <main className="mx-auto min-h-dvh max-w-2xl px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))]">
        {/* La clé force l'animation d'entrée à chaque changement d'écran. */}
        {/* Enveloppe déplacée pendant un balayage (transform appliqué seulement pendant le geste). */}
        <div ref={pageRef} className="swipe-page">
          <div key={pathname} className={tabNav.current ? '' : 'page-in'}>
            <Outlet />
          </div>
        </div>
      </main>
      <FloatingNav pathname={pathname} onTab={(i) => slideTo(i)} pillRef={pillRef} />
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
