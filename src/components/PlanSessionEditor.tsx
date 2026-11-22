import { useState, type ReactNode } from 'react';
import type { Activity } from '../lib/analysis/types';
import { SESSION_KINDS, type PlannedSession } from '../lib/db';
import { activityTitle, fmtDistance, fmtTime, KIND_LABEL } from '../lib/format';
import { weekDays } from '../lib/planMatch';

const dayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'short' });
const field = 'mt-1 h-11 w-full rounded-xl bg-white px-3 ring-1 ring-slate-300 outline-none focus:ring-2 focus:ring-accent dark:bg-slate-900 dark:ring-slate-700';

interface Props {
  session: PlannedSession;
  weekStart: number;
  /** Séances réelles de la semaine, pour l'association manuelle. */
  weekActivities: Activity[];
  isNew: boolean;
  onSave: (s: PlannedSession) => void;
  onDelete: () => void;
  onClose: () => void;
}

/** Feuille du bas pour créer ou modifier une séance prévue. */
export default function PlanSessionEditor({ session, weekStart, weekActivities, isNew, onSave, onDelete, onClose }: Props) {
  const [s, setS] = useState<PlannedSession>(session);
  const set = <K extends keyof PlannedSession>(k: K, v: PlannedSession[K]) => setS({ ...s, [k]: v });
  const swim = s.sport === 'swimming';
  const linkValue = s.linkedActivityId === undefined ? 'auto' : s.linkedActivityId === null ? 'none' : s.linkedActivityId;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div className="card max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-b-none p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()} role="dialog" aria-label={isNew ? 'Nouvelle séance' : 'Modifier la séance'}>
        <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-slate-300 dark:bg-slate-700" />
        <h2 className="mb-3 text-lg font-semibold">{isNew ? 'Nouvelle séance' : 'Modifier la séance'}</h2>

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800">
            {(['running', 'swimming'] as const).map((sp) => (
              <button key={sp} onClick={() => set('sport', sp)}
                className={`h-10 rounded-lg text-sm font-medium ${s.sport === sp ? 'bg-white shadow-sm dark:bg-slate-700' : 'muted'}`}>
                {sp === 'running' ? 'Course' : 'Natation'}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Jour">
              <select value={s.date} onChange={(e) => set('date', Number(e.target.value))} className={field}>
                {weekDays(weekStart).map((d) => <option key={d} value={d}>{dayFmt.format(d)}</option>)}
              </select>
            </Field>
            <Field label="Type">
              <select value={s.kind} onChange={(e) => set('kind', e.target.value as PlannedSession['kind'])} className={field}>
                {SESSION_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
            </Field>
          </div>

          <Field label="Titre">
            <input value={s.title} onChange={(e) => set('title', e.target.value)} className={field} placeholder="Ex. Footing facile" />
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Field label="Durée (min)">
              <input type="number" inputMode="numeric" value={s.durationMin ?? ''} className={field}
                onChange={(e) => set('durationMin', e.target.value ? Number(e.target.value) : null)} />
            </Field>
            <Field label={swim ? 'Distance (m)' : 'Distance (km)'}>
              <input type="number" inputMode="decimal" step={swim ? 50 : 0.1} className={field}
                value={s.distanceM == null ? '' : swim ? s.distanceM : s.distanceM / 1000}
                onChange={(e) => {
                  const v = e.target.value ? Number(e.target.value.replace(',', '.')) : null;
                  set('distanceM', v == null ? null : swim ? Math.round(v) : Math.round(v * 1000));
                }} />
            </Field>
          </div>

          <Field label="Intensité">
            <input value={s.intensity} onChange={(e) => set('intensity', e.target.value)} className={field} placeholder="Ex. Z2, ~6:00/km" />
          </Field>

          <Field label="Contenu">
            <textarea value={s.description} onChange={(e) => set('description', e.target.value)} rows={5}
              className="mt-1 w-full rounded-xl bg-white p-3 leading-relaxed ring-1 ring-slate-300 outline-none focus:ring-2 focus:ring-accent dark:bg-slate-900 dark:ring-slate-700"
              placeholder={'Échauffement : …\nCorps : …\nRetour au calme : …'} />
          </Field>

          {!isNew && (
            <Field label="Séance réalisée associée">
              <select value={linkValue} className={field}
                onChange={(e) => set('linkedActivityId', e.target.value === 'auto' ? undefined : e.target.value === 'none' ? null : e.target.value)}>
                <option value="auto">Automatique (même sport, même jour)</option>
                <option value="none">Aucune</option>
                {weekActivities.filter((a) => a.sport === s.sport).map((a) => (
                  <option key={a.id} value={a.id}>{dayFmt.format(a.startTime)} {fmtTime(a.startTime)} · {activityTitle(a)} · {fmtDistance(a)}</option>
                ))}
              </select>
            </Field>
          )}
        </div>

        <div className="mt-5 flex items-center gap-2">
          {!isNew && <button onClick={onDelete} className="h-11 rounded-xl px-3 text-sm font-medium text-red-600 dark:text-red-400">Supprimer</button>}
          <span className="flex-1" />
          <button onClick={onClose} className="muted h-11 px-3">Annuler</button>
          <button onClick={() => onSave({ ...s, title: s.title.trim() || 'Séance' })}
            className="h-11 rounded-xl bg-accent px-5 font-medium text-white dark:text-slate-950">Enregistrer</button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="muted text-xs">{label}</span>
      {children}
    </label>
  );
}
