import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { SportBadge } from '../components/ActivityCard';
import AppBar from '../components/AppBar';
import Icon from '../components/Icon';
import PlanSessionEditor from '../components/PlanSessionEditor';
import { db, getSettings, type PlannedSession, type WeekPlan } from '../lib/db';
import { activityTitle, fmtDistance, fmtDurationShort, fmtKm, fmtMeters, fmtUsd, KIND_LABEL } from '../lib/format';
import { estimateCost, modelInfo } from '../lib/llm/models';
import { dayStart, matchPlan, plannableDays, weekDays, type MatchStatus, type SessionMatch } from '../lib/planMatch';
import { addWeeks, weekStart } from '../lib/stats';

const dayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const shortFmt = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

const STATUS: Record<MatchStatus, { label: string; cls: string }> = {
  done: { label: 'Fait', cls: 'bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300' },
  shifted: { label: 'Fait (décalé)', cls: 'bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300' },
  missed: { label: 'Manqué', cls: 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-300' },
  today: { label: 'Aujourd’hui', cls: 'bg-accent-soft text-accent' },
  upcoming: { label: 'À venir', cls: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-300' },
};

/** Estimation affichée avant génération (≈ 3 500 tokens envoyés, 2 500 reçus). */
const PLAN_IN = 3500, PLAN_OUT = 2500;

export default function Plan() {
  const current = weekStart(Date.now());
  const [week, setWeek] = useState(current);
  // undefined = chargement, null = pas de plan pour cette semaine.
  const plan = useLiveQuery(async () => (await db.plans.get(week)) ?? null, [week]);
  const activities = useLiveQuery(() => db.activities.where('startTime').between(addWeeks(week, -1), addWeeks(week, 2)).toArray(), [week]);
  const settings = useLiveQuery(() => getSettings(), []);
  const [editing, setEditing] = useState<{ s: PlannedSession; isNew: boolean } | null>(null);

  const isPast = addWeeks(week, 1) <= dayStart(Date.now());
  const label = week === current ? 'Cette semaine' : week === addWeeks(current, 1) ? 'Semaine prochaine' : week === addWeeks(current, -1) ? 'Semaine dernière' : `Semaine du ${shortFmt.format(week)}`;
  const review = useMemo(() => (plan && activities ? matchPlan(plan, activities) : null), [plan, activities]);
  const weekActivities = (activities ?? []).filter((a) => a.startTime >= week && a.startTime < addWeeks(week, 1));

  const save = async (p: WeekPlan) => db.plans.put({ ...p, updatedAt: Date.now() });
  const saveSession = async (s: PlannedSession) => {
    if (!plan) return;
    const sessions = editing?.isNew ? [...plan.sessions, s] : plan.sessions.map((x) => (x.id === s.id ? s : x));
    await save({ ...plan, sessions: sessions.sort((a, b) => a.date - b.date) });
    setEditing(null);
  };
  const deleteSession = async (id: string) => {
    if (!plan) return;
    await save({ ...plan, sessions: plan.sessions.filter((x) => x.id !== id) });
    setEditing(null);
  };
  const newSession = (): PlannedSession => ({
    id: crypto.randomUUID(), date: plannableDays(week)[0] ?? week, sport: 'running', kind: 'footing',
    title: '', description: '', durationMin: 45, distanceM: null, intensity: '',
  });

  return (
    <div className="space-y-4">
      <AppBar title="Plan" subtitle={`${shortFmt.format(week)} – ${shortFmt.format(addWeeks(week, 1) - 86_400_000)}`} />

      <div className="flex items-center justify-between rounded-2xl bg-slate-100 p-1 dark:bg-slate-800/70">
        <button onClick={() => setWeek(addWeeks(week, -1))} aria-label="Semaine précédente" className="pressable grid size-10 place-items-center rounded-xl"><Icon name="back" /></button>
        <span className="text-sm font-semibold">{label}</span>
        <button onClick={() => setWeek(addWeeks(week, 1))} disabled={week >= addWeeks(current, 1)} aria-label="Semaine suivante"
          className="pressable grid size-10 place-items-center rounded-xl disabled:opacity-30"><Icon name="chevron" /></button>
      </div>

      {plan === null && (
        isPast
          ? <p className="muted py-10 text-center text-sm">Aucun plan pour cette semaine.</p>
          : <PlanForm week={week} model={settings ? settings.llm.model[settings.llm.provider] : null} onManual={() => save({
              weekStart: week, status: 'draft', note: '', summary: '', sessions: [], createdAt: Date.now(), updatedAt: Date.now(),
            })} />
      )}

      {plan && review && (
        <>
          <section className="card p-4">
            <div className="flex items-center justify-between gap-2">
              <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${plan.status === 'validated' ? 'bg-green-100 text-green-800 dark:bg-green-950/60 dark:text-green-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'}`}>
                {plan.status === 'validated' ? 'Plan validé' : 'Brouillon'}
              </span>
              {plan.costUsd != null && <span className="muted text-xs">{modelInfo(plan.model ?? '')?.label} · ≈ {fmtUsd(plan.costUsd)}</span>}
            </div>
            {plan.summary && <p className="selectable mt-3 text-[15px] leading-relaxed">{plan.summary}</p>}
            {plan.note && <p className="muted mt-2 text-xs">Ta note : « {plan.note} »</p>}
          </section>

          {plan.status === 'validated' && <ReviewCard review={review} />}

          <section className="space-y-3">
            {weekDays(week).map((d) => {
              const ms = review.matches.filter((m) => dayStart(m.session.date) === d);
              const isToday = d === dayStart(Date.now());
              return (
                <div key={d}>
                  <h3 className={`mb-1.5 text-sm font-semibold first-letter:uppercase ${isToday ? 'text-accent' : 'muted'}`}>
                    {dayFmt.format(d)}{isToday && ' · aujourd’hui'}
                  </h3>
                  {ms.length === 0
                    ? <p className="muted pl-1 text-xs">Repos</p>
                    : <div className="space-y-2">{ms.map((m) => (
                        <SessionCard key={m.session.id} m={m} validated={plan.status === 'validated'}
                          onEdit={() => setEditing({ s: m.session, isNew: false })} />
                      ))}</div>}
                </div>
              );
            })}
          </section>

          {plan.status === 'validated' && review.unplanned.length > 0 && (
            <section>
              <h3 className="muted mb-1.5 text-sm font-semibold">Hors plan</h3>
              <div className="space-y-2">
                {review.unplanned.map((a) => (
                  <Link key={a.id} to={`/seance/${encodeURIComponent(a.id)}`} className="card pressable flex items-center gap-3 p-3 text-sm">
                    <SportBadge sport={a.sport} className="size-8" />
                    <span className="flex-1">{activityTitle(a)} · {fmtDistance(a)}</span>
                    <span className="muted text-xs">{shortFmt.format(a.startTime)}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}

          <div className="flex flex-wrap gap-2 pt-1">
            {plan.status === 'draft' && plan.sessions.length > 0 && (
              <button onClick={() => save({ ...plan, status: 'validated' })} className="pressable h-12 flex-1 rounded-xl bg-accent font-semibold text-white dark:text-slate-950">
                Valider le plan
              </button>
            )}
            {!isPast && (
              <button onClick={() => setEditing({ s: newSession(), isNew: true })} className="pressable flex h-12 items-center gap-1.5 rounded-xl px-4 font-medium text-accent ring-1 ring-accent/40">
                <Icon name="plus" className="size-5" /> Séance
              </button>
            )}
          </div>
          <div className="flex flex-wrap justify-center gap-x-4 gap-y-2 pb-2 text-sm">
            {plan.status === 'validated' && (
              <button onClick={() => save({ ...plan, status: 'draft' })} className="muted">Repasser en brouillon</button>
            )}
            {!isPast && plan.status === 'draft' && <RegenerateButton plan={plan} />}
            <button onClick={() => { if (confirm('Supprimer le plan de cette semaine ?')) void db.plans.delete(week); }} className="text-red-600 dark:text-red-400">
              Supprimer le plan
            </button>
          </div>
        </>
      )}

      {editing && plan && (
        <PlanSessionEditor session={editing.s} isNew={editing.isNew} weekStart={week} weekActivities={weekActivities}
          onSave={saveSession} onDelete={() => deleteSession(editing.s.id)} onClose={() => setEditing(null)} />
      )}
    </div>
  );
}

// ───────────────────────────────────────────────────────────── Génération

function usePlanGeneration() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (week: number, note: string) => {
    setBusy(true); setError(null);
    try {
      const { generatePlan } = await import('../lib/llm/plan');
      await generatePlan(week, note);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Erreur inattendue.');
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function PlanForm({ week, model, onManual }: { week: number; model: string | null; onManual: () => void }) {
  const [note, setNote] = useState('');
  const gen = usePlanGeneration();
  const days = plannableDays(week);
  return (
    <section className="card space-y-3 p-4">
      <div className="flex items-center gap-2">
        <span className="grid size-8 place-items-center rounded-full bg-accent-soft text-accent"><Icon name="sparkle" className="size-4" /></span>
        <h2 className="font-semibold">Planifier ma semaine</h2>
      </div>
      <p className="muted text-sm">
        Le coach prépare {days.length === 7 ? 'ta semaine' : `les ${days.length} jours restants`} à partir de ton carnet, de tes séances récentes et de ta note.
      </p>
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} disabled={gen.busy}
        placeholder="Ta note pour la semaine (facultatif) : dispo lundi, mercredi et samedi ; déplacement jeudi ; genou un peu sensible…"
        className="w-full rounded-xl bg-slate-50 p-3 leading-relaxed ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-accent dark:bg-slate-800/60 dark:ring-slate-700" />
      {gen.error && (
        <p className="rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-300">
          {gen.error} {gen.error.includes('Réglages') && <Link to="/reglages" className="font-medium underline">Ouvrir les réglages</Link>}
        </p>
      )}
      <button onClick={() => gen.run(week, note)} disabled={gen.busy}
        className="pressable flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent font-semibold text-white disabled:opacity-60 dark:text-slate-950">
        {gen.busy
          ? <><span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> Le coach prépare ta semaine…</>
          : <>Planifier avec le coach{model && <span className="text-xs font-normal opacity-80">≈ {fmtUsd(estimateCost(model, PLAN_IN, PLAN_OUT))}</span>}</>}
      </button>
      <button onClick={onManual} disabled={gen.busy} className="muted w-full text-center text-sm">Ou créer le plan moi-même</button>
    </section>
  );
}

function RegenerateButton({ plan }: { plan: WeekPlan }) {
  const gen = usePlanGeneration();
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState(plan.note);
  useEffect(() => setNote(plan.note), [plan.note]);
  if (!open) return <button onClick={() => setOpen(true)} className="text-accent">Regénérer avec le coach</button>;
  return (
    <div className="card w-full space-y-2 p-3 text-left">
      <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} disabled={gen.busy} placeholder="Note pour le coach (ex. moins de natation, séance clé samedi)…"
        className="w-full rounded-xl bg-slate-50 p-3 ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-accent dark:bg-slate-800/60 dark:ring-slate-700" />
      {gen.error && <p className="text-sm text-red-700 dark:text-red-400">{gen.error}</p>}
      <div className="flex justify-end gap-2">
        <button onClick={() => setOpen(false)} disabled={gen.busy} className="muted h-10 px-3">Annuler</button>
        <button onClick={async () => { await gen.run(plan.weekStart, note); setOpen(false); }} disabled={gen.busy}
          className="flex h-10 items-center gap-2 rounded-lg bg-accent px-4 font-medium text-white disabled:opacity-60 dark:text-slate-950">
          {gen.busy && <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
          {gen.busy ? 'En cours…' : 'Regénérer'}
        </button>
      </div>
    </div>
  );
}

// ───────────────────────────────────────────────────────────── Affichage

function SessionCard({ m, validated, onEdit }: { m: SessionMatch; validated: boolean; onEdit: () => void }) {
  const [open, setOpen] = useState(false);
  const s = m.session;
  const meta = [KIND_LABEL[s.kind], s.durationMin ? `${s.durationMin} min` : null,
    s.distanceM ? (s.sport === 'running' ? fmtKm(s.distanceM) : fmtMeters(s.distanceM)) : null].filter(Boolean).join(' · ');
  return (
    <div className="card overflow-hidden">
      <button onClick={() => setOpen(!open)} className="flex w-full items-start gap-3 p-3 text-left">
        <SportBadge sport={s.sport} className="size-9" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium leading-snug">{s.title}</p>
            {validated && <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${STATUS[m.status].cls}`}>{STATUS[m.status].label}</span>}
          </div>
          <p className="muted text-xs">{meta}</p>
          {s.intensity && <p className="mt-0.5 text-xs font-medium text-accent">{s.intensity}</p>}
        </div>
      </button>
      {open && (
        <div className="border-t border-slate-100 px-3 pt-2 pb-3 dark:border-slate-800">
          {s.description && <p className="selectable text-sm leading-relaxed whitespace-pre-line">{s.description}</p>}
          {m.activity && (
            <Link to={`/seance/${encodeURIComponent(m.activity.id)}`} className="mt-2 flex items-center gap-2 rounded-xl bg-slate-50 p-2.5 text-sm dark:bg-slate-800/60">
              <Icon name="link" className="size-4 text-accent" />
              <span className="flex-1">Réalisé : {activityTitle(m.activity)} · {fmtDistance(m.activity)} · {fmtDurationShort(m.activity.durationS)}</span>
              <Icon name="chevron" className="muted size-4" />
            </Link>
          )}
          <button onClick={onEdit} className="mt-2 flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-accent ring-1 ring-accent/40">
            <Icon name="edit" className="size-4" /> Modifier
          </button>
        </div>
      )}
    </div>
  );
}

function ReviewCard({ review }: { review: ReturnType<typeof matchPlan> }) {
  const pct = review.total ? Math.round((review.done / review.total) * 100) : 0;
  return (
    <section className="card p-4">
      <div className="flex items-baseline justify-between">
        <h2 className="font-semibold">Bilan de la semaine</h2>
        <span className="text-sm"><b className="text-lg">{review.done}</b>/{review.total} séances</span>
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
        {(['running', 'swimming'] as const).filter((sp) => review.volume[sp].plannedM || review.volume[sp].doneM || review.volume[sp].plannedMin).map((sp) => {
          const v = review.volume[sp];
          const dist = (m: number) => (sp === 'running' ? fmtKm(m) : fmtMeters(m));
          return (
            <div key={sp} className="rounded-xl bg-slate-50 p-2.5 dark:bg-slate-800/60">
              <p className="muted text-xs">{sp === 'running' ? 'Course' : 'Natation'} · fait / prévu</p>
              <p className="font-medium">{dist(v.doneM)} <span className="muted font-normal">/ {v.plannedM ? dist(v.plannedM) : '–'}</span></p>
              <p className="muted text-xs">{fmtDurationShort(v.doneMin * 60)} / {v.plannedMin ? fmtDurationShort(v.plannedMin * 60) : '–'}</p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
