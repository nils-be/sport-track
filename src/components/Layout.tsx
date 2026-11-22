import { useEffect } from 'react';
import { NavLink, Outlet } from 'react-router-dom';
import { recoverInterrupted, useDebriefQueue } from '../lib/llm/queue';
import Icon, { type IconName } from './Icon';
import { ImportProvider, useImport } from './ImportContext';

const NAV_LEFT: { to: string; label: string; icon: IconName }[] = [
  { to: '/', label: 'Accueil', icon: 'home' },
  { to: '/seances', label: 'Séances', icon: 'list' },
];
const NAV_RIGHT: { to: string; label: string; icon: IconName }[] = [
  { to: '/progression', label: 'Progrès', icon: 'chart' },
  { to: '/carnet', label: 'Carnet', icon: 'book' },
];

export default function Layout() {
  useEffect(() => { void recoverInterrupted(); }, []);
  return (
    <ImportProvider>
      <QueueBanner />
      <div className="mx-auto min-h-dvh max-w-2xl px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-28">
        <Outlet />
      </div>
      <BottomNav />
    </ImportProvider>
  );
}

/** Bandeau discret pendant la génération de plusieurs débriefs. */
function QueueBanner() {
  const q = useDebriefQueue();
  if (!q.running) return null;
  const total = q.done + 1 + q.pending.length;
  return (
    <div className="fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 flex justify-center px-4 pb-2">
      <div className="flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-xs text-white shadow-lg dark:bg-slate-100 dark:text-slate-900">
        <span className="size-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
        Débrief en cours{total > 1 ? ` (${q.done + 1}/${total})` : '…'}
      </div>
    </div>
  );
}

function NavItem({ to, label, icon }: { to: string; label: string; icon: IconName }) {
  return (
    <NavLink
      to={to}
      end={to === '/'}
      className={({ isActive }) => `flex flex-1 flex-col items-center justify-center gap-0.5 text-[11px] ${isActive ? 'text-accent font-semibold' : 'muted'}`}
    >
      <Icon name={icon} />
      {label}
    </NavLink>
  );
}

function BottomNav() {
  const { openPicker } = useImport();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/90 pb-[env(safe-area-inset-bottom)] backdrop-blur dark:border-slate-800 dark:bg-[#0b1120]/90">
      <div className="mx-auto flex h-16 max-w-2xl items-stretch">
        {NAV_LEFT.map((n) => <NavItem key={n.to} {...n} />)}
        <button onClick={openPicker} className="flex flex-1 items-center justify-center" aria-label="Importer des séances">
          <span className="grid size-12 place-items-center rounded-2xl bg-accent text-white shadow-md active:scale-95 dark:text-slate-950">
            <Icon name="upload" className="size-6" />
          </span>
        </button>
        {NAV_RIGHT.map((n) => <NavItem key={n.to} {...n} />)}
      </div>
    </nav>
  );
}
