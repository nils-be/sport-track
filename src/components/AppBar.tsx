import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import Icon from './Icon';

interface Props {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Affiche un bouton retour ; la valeur est la page de repli si l'historique est vide. */
  back?: string;
  actions?: ReactNode;
}

/** En-tête collant des écrans, façon application (zone de l'encoche respectée). */
export default function AppBar({ title, subtitle, back, actions }: Props) {
  const nav = useNavigate();
  return (
    <header className="sticky top-0 z-30 -mx-4 mb-3 bg-slate-50/85 px-4 pt-[env(safe-area-inset-top)] backdrop-blur-md dark:bg-[#0b1120]/85">
      <div className="flex min-h-14 items-center gap-1">
        {back && (
          <button
            onClick={() => (history.state?.idx > 0 ? nav(-1) : nav(back, { replace: true }))}
            aria-label="Retour"
            className="pressable -ml-2 grid size-11 shrink-0 place-items-center rounded-full"
          >
            <Icon name="back" className="size-6" />
          </button>
        )}
        <div className="min-w-0 flex-1 py-2">
          <h1 className={`truncate font-bold ${back ? 'text-lg' : 'text-2xl'}`}>{title}</h1>
          {subtitle && <p className="muted truncate text-sm first-letter:uppercase">{subtitle}</p>}
        </div>
        {actions && <div className="-mr-2 flex shrink-0 items-center">{actions}</div>}
      </div>
    </header>
  );
}

/** Bouton icône rond pour les actions de l'en-tête. */
export function AppBarAction({ icon, label, onClick, to }: { icon: Parameters<typeof Icon>[0]['name']; label: string; onClick?: () => void; to?: string }) {
  const nav = useNavigate();
  return (
    <button onClick={onClick ?? (() => to && nav(to))} aria-label={label} className="pressable grid size-11 place-items-center rounded-full text-slate-600 dark:text-slate-300">
      <Icon name={icon} className="size-6" />
    </button>
  );
}
