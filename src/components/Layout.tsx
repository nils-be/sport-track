import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { ANALYSIS_VERSION } from '../lib/analysis/version';
import { db } from '../lib/db';
import { recoverInterrupted, useDebriefQueue } from '../lib/llm/queue';
import Icon, { type IconName } from './Icon';
import { ImportProvider, useImport } from './ImportContext';

const TABS: { to: string; label: string; icon: IconName; match: (p: string) => boolean }[] = [
  { to: '/', label: 'Coach', icon: 'coach', match: (p) => p === '/' },
  { to: '/seances', label: 'Séances', icon: 'list', match: (p) => p.startsWith('/seance') },
  { to: '/progression', label: 'Progrès', icon: 'chart', match: (p) => p.startsWith('/progression') },
];

export default function Layout() {
  const { pathname } = useLocation();
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
        <div key={pathname} className="page-in">
          <Outlet />
        </div>
      </main>
      <FloatingNav pathname={pathname} />
    </ImportProvider>
  );
}

function FloatingNav({ pathname }: { pathname: string }) {
  const { openPicker } = useImport();
  const queue = useDebriefQueue();
  const pendingChat = useLiveQuery(() => db.messages.filter((m) => m.status === 'pending').count(), []);
  const active = TABS.findIndex((t) => t.match(pathname));
  const coachBusy = !!queue.running || !!pendingChat;

  return (
    <nav className="floating-nav fixed inset-x-0 bottom-0 z-40 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
      <div className="mx-auto flex max-w-md items-center gap-3">
        <div className="relative flex h-16 flex-1 items-center rounded-full bg-white/80 p-1.5 shadow-xl shadow-slate-900/10 ring-1 ring-slate-200/80 backdrop-blur-xl dark:bg-slate-900/80 dark:shadow-black/40 dark:ring-slate-700/70">
          {/* Pastille qui glisse sous l'onglet actif. */}
          <span
            aria-hidden="true"
            className="nav-pill absolute top-1.5 bottom-1.5 left-1.5 rounded-full bg-accent-soft"
            style={{ width: 'calc((100% - 0.75rem) / 3)', transform: `translateX(${Math.max(active, 0) * 100}%)`, opacity: active < 0 ? 0 : 1 }}
          />
          {TABS.map((t, i) => (
            <NavLink key={t.to} to={t.to} end={t.to === '/'}
              className={`relative z-10 flex h-full flex-1 flex-col items-center justify-center gap-0.5 rounded-full text-[11px] transition-colors duration-300 ${i === active ? 'font-semibold text-accent' : 'text-slate-500 dark:text-slate-400'}`}>
              <span className="relative">
                <Icon name={t.icon} className={`size-[22px] transition-transform duration-300 ${i === active ? 'scale-110' : ''}`} />
                {t.to === '/' && coachBusy && <span className="absolute -top-0.5 -right-1 size-2 animate-pulse rounded-full bg-accent ring-2 ring-white dark:ring-slate-900" />}
              </span>
              {t.label}
            </NavLink>
          ))}
        </div>
        <button
          onClick={() => { navigator.vibrate?.(8); openPicker(); }}
          aria-label="Importer des séances"
          className="grid size-16 shrink-0 place-items-center rounded-full bg-accent text-white shadow-xl shadow-accent/30 transition-transform duration-150 active:scale-90 dark:text-slate-950"
        >
          <Icon name="plus" className="size-7" />
        </button>
      </div>
    </nav>
  );
}
