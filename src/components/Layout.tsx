import { useEffect } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { db } from '../lib/db';
import { ANALYSIS_VERSION } from '../lib/analysis/version';
import { recoverInterrupted, useDebriefQueue } from '../lib/llm/queue';
import Icon, { type IconName } from './Icon';
import { ImportProvider, useImport } from './ImportContext';

const TABS_LEFT: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Accueil', icon: 'home' },
  { to: '/plan', label: 'Plan', icon: 'calendar' },
];
const TABS_RIGHT: { to: string; label: string; icon: IconName }[] = [
  { to: '/seances', label: 'Séances', icon: 'list' },
  { to: '/progression', label: 'Progrès', icon: 'chart' },
];

export default function Layout() {
  const { pathname } = useLocation();
  // Chaque écran s'ouvre en haut de page, comme dans une application.
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);

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
      <QueueBanner />
      <main className="mx-auto min-h-dvh max-w-2xl px-4 pb-[calc(6.5rem+env(safe-area-inset-bottom))]">
        <Outlet />
      </main>
      <BottomNav />
    </ImportProvider>
  );
}

/** Bandeau discret pendant la génération de débriefs. */
function QueueBanner() {
  const q = useDebriefQueue();
  if (!q.running) return null;
  const total = q.done + 1 + q.pending.length;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(5.25rem+env(safe-area-inset-bottom))] z-30 flex justify-center px-4">
      <div className="flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-xs text-white shadow-lg dark:bg-slate-100 dark:text-slate-900">
        <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
        Débrief en cours{total > 1 ? ` (${q.done + 1}/${total})` : '…'}
      </div>
    </div>
  );
}

function Tab({ to, label, icon }: { to: string; label: string; icon: IconName }) {
  return (
    <NavLink to={to} end={to === '/'} className="flex flex-1 flex-col items-center justify-center gap-1">
      {({ isActive }) => (
        <>
          <span className={`grid h-8 w-14 place-items-center rounded-full transition-colors ${isActive ? 'bg-accent-soft text-accent' : 'text-slate-500 dark:text-slate-400'}`}>
            <Icon name={icon} className="size-[22px]" />
          </span>
          <span className={`text-[11px] leading-none ${isActive ? 'font-semibold text-slate-900 dark:text-slate-100' : 'muted'}`}>{label}</span>
        </>
      )}
    </NavLink>
  );
}

function BottomNav() {
  const { openPicker } = useImport();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200/80 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md dark:border-slate-800 dark:bg-[#0f172a]/95">
      <div className="mx-auto flex h-[4.5rem] max-w-2xl items-stretch">
        {TABS_LEFT.map((t) => <Tab key={t.to} {...t} />)}
        <div className="flex flex-1 items-center justify-center">
          <button
            onClick={() => { navigator.vibrate?.(8); openPicker(); }}
            aria-label="Importer des séances"
            className="grid size-14 -translate-y-3 place-items-center rounded-2xl bg-accent text-white shadow-lg shadow-accent/30 transition-transform active:scale-95 dark:text-slate-950"
          >
            <Icon name="plus" className="size-7" />
          </button>
        </div>
        {TABS_RIGHT.map((t) => <Tab key={t.to} {...t} />)}
      </div>
    </nav>
  );
}
