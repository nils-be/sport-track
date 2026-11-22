import { useRef, useState } from 'react';
import { fmtDuration, fmtPace } from '../lib/format';
import Icon from './Icon';

interface Props {
  title: string;
  /** Natation : on corrige un nombre de longueurs ; course : une distance en mètres. */
  mode: 'lengths' | 'meters';
  poolLengthM?: number | null;
  durationS: number;
  /** Valeur de la montre (longueurs ou mètres). */
  original: number;
  /** Valeur actuelle (corrigée ou non). */
  current: number;
  onSave: (value: number | null) => void;
  onClose: () => void;
}

/** Petite feuille pour corriger la distance d'une série ou d'un tour. */
export default function CorrectionSheet({ title, mode, poolLengthM, durationS, original, current, onSave, onClose }: Props) {
  const [v, setV] = useState(current);
  // Le fond ne ferme la feuille que si le geste y a commencé : le relâchement d'un appui long
  // (qui a ouvert la feuille sous le doigt) ne doit pas la refermer aussitôt.
  const downOnBackdrop = useRef(false);
  const step = mode === 'lengths' ? 1 : 10;
  const dist = mode === 'lengths' ? v * (poolLengthM ?? 0) : v;
  const origDist = mode === 'lengths' ? original * (poolLengthM ?? 0) : original;
  const pace = dist > 0 ? (mode === 'lengths' ? (durationS / dist) * 100 : (durationS / dist) * 1000) : null;
  const unit = mode === 'lengths' ? '/100 m' : '/km';
  const changed = v !== original;

  return (
    <div className="overlay-in fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center"
      onPointerDown={(e) => { downOnBackdrop.current = e.target === e.currentTarget; }}
      onClick={(e) => { if (e.target === e.currentTarget && downOnBackdrop.current) onClose(); downOnBackdrop.current = false; }}>
      <div className="sheet-in card w-full max-w-lg rounded-b-none p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-700" />
        <h2 className="text-lg font-semibold">{title}</h2>
        <p className="muted text-sm">
          Montre : {mode === 'lengths' ? `${original} longueur${original > 1 ? 's' : ''} · ${origDist} m` : `${Math.round(original)} m`} en {fmtDuration(durationS)}
        </p>

        <div className="mt-5 flex items-center justify-center gap-5">
          <button onClick={() => setV(Math.max(step, v - step))} aria-label="Moins" className="pressable grid size-12 place-items-center rounded-full bg-slate-100 text-2xl dark:bg-slate-800">−</button>
          <div className="min-w-32 text-center">
            {mode === 'lengths' ? (
              <>
                <p className="text-3xl font-bold">{v}</p>
                <p className="muted text-sm">longueur{v > 1 ? 's' : ''} · {dist} m</p>
              </>
            ) : (
              <>
                <input type="number" inputMode="numeric" value={v} onChange={(e) => setV(Math.max(1, Number(e.target.value) || 0))}
                  className="w-28 bg-transparent text-center text-3xl font-bold outline-none" aria-label="Distance en mètres" />
                <p className="muted text-sm">mètres</p>
              </>
            )}
          </div>
          <button onClick={() => setV(v + step)} aria-label="Plus" className="pressable grid size-12 place-items-center rounded-full bg-slate-100 text-2xl dark:bg-slate-800">+</button>
        </div>
        <p className="mt-3 text-center text-sm">Allure : <b>{fmtPace(pace)} {unit}</b></p>

        <div className="mt-5 flex items-center gap-2">
          {current !== original && (
            <button onClick={() => onSave(null)} className="flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-slate-600 dark:text-slate-300">
              <Icon name="undo" className="size-4" /> Valeur montre
            </button>
          )}
          <span className="flex-1" />
          <button onClick={onClose} className="muted h-11 px-3">Annuler</button>
          <button onClick={() => onSave(changed ? v : null)} className="h-11 rounded-xl bg-accent px-5 font-medium text-white dark:text-slate-950">Enregistrer</button>
        </div>
        <p className="muted mt-3 text-xs">La distance et l’allure de la séance sont recalculées. Pense à regénérer le débrief si besoin.</p>
      </div>
    </div>
  );
}
