import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import ActivityCard, { SportBadge } from '../components/ActivityCard';
import AppBar, { AppBarAction } from '../components/AppBar';
import Icon from '../components/Icon';
import type { Activity, Sport } from '../lib/analysis/types';
import { db, type WeekPlan } from '../lib/db';
import { matchPlan } from '../lib/planMatch';
import { fmtDate, fmtDurationShort, fmtKm, fmtMeters } from '../lib/format';
import { addWeeks, volumeOf, weekStart, type Volume } from '../lib/stats';

export default function Home() {
  const recent = useLiveQuery(() => db.activities.orderBy('startTime').reverse().limit(5).toArray(), []);
  // Semaine en cours + 4 précédentes, pour la comparaison.
  const weekActs = useLiveQuery(() => db.activities.where('startTime').aboveOrEqual(addWeeks(weekStart(Date.now()), -4)).toArray(), []);
  const plan = useLiveQuery(async () => (await db.plans.get(weekStart(Date.now()))) ?? null, []);
  const lastAdvice = useLiveQuery(async () => {
    const latest = await db.activities.orderBy('startTime').reverse().limit(10).toArray();
    for (const a of latest) {
      const d = await db.debriefs.get(a.id);
      if (d?.content?.conseil) return { a, conseil: d.content.conseil };
    }
    return null;
  }, []);

  const empty = recent && recent.length === 0;

  return (
    <div className="space-y-4">
      <AppBar
        title="Sport Track"
        subtitle={new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(Date.now())}
        actions={<>
          <AppBarAction icon="book" label="Carnet du coach" to="/carnet" />
          <AppBarAction icon="settings" label="Réglages" to="/reglages" />
        </>}
      />

      {plan !== undefined && weekActs && <PlanCard plan={plan} acts={weekActs} />}

      {weekActs && !empty && <ThisWeek acts={weekActs} />}

      {lastAdvice && (
        <Link to={`/seance/${encodeURIComponent(lastAdvice.a.id)}`} className="card pressable block p-4">
          <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-accent">
            <Icon name="coach" className="size-4" /> Dernier conseil du coach
          </p>
          <p className="mt-1.5 text-[15px] leading-relaxed">{lastAdvice.conseil}</p>
          <p className="muted mt-1 text-xs">Après la séance du {fmtDate(lastAdvice.a.startTime)}</p>
        </Link>
      )}

      <section>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-semibold">Dernières séances</h2>
          {!empty && <Link to="/seances" className="text-sm text-accent">Tout voir</Link>}
        </div>
        {empty && (
          <div className="card p-6 text-center">
            <span className="mx-auto mb-3 grid size-12 place-items-center rounded-2xl bg-accent text-white dark:text-slate-950"><Icon name="plus" className="size-6" /></span>
            <p className="font-medium">Aucune séance pour l’instant</p>
            <p className="muted mt-1 text-sm">
              Touche le bouton <b>+</b> en bas pour importer un fichier .fit ou .zip exporté depuis Garmin Connect
              (menu ⋯ › « Exporter l’original »), ou « Partage » le fichier vers Sport Track.
            </p>
          </div>
        )}
        <div className="space-y-2">{recent?.map((a) => <ActivityCard key={a.id} a={a} />)}</div>
      </section>
    </div>
  );
}

/** Carte « Plan » : rappel s'il n'y a pas de plan, sinon séance du jour / prochaine séance et avancement. */
function PlanCard({ plan, acts }: { plan: WeekPlan | null; acts: Activity[] }) {
  if (!plan) {
    return (
      <Link to="/plan" className="card pressable flex items-center gap-3 p-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-accent-soft text-accent"><Icon name="calendar" /></span>
        <span className="flex-1">
          <span className="block font-semibold">Planifier ma semaine</span>
          <span className="muted block text-sm">Pas encore de plan : le coach peut te proposer tes séances.</span>
        </span>
        <Icon name="chevron" className="muted size-5" />
      </Link>
    );
  }
  if (plan.status === 'draft') {
    return (
      <Link to="/plan" className="card pressable flex items-center gap-3 p-4">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300"><Icon name="calendar" /></span>
        <span className="flex-1">
          <span className="block font-semibold">Plan en brouillon</span>
          <span className="muted block text-sm">{plan.sessions.length} séance{plan.sessions.length > 1 ? 's' : ''} proposée{plan.sessions.length > 1 ? 's' : ''} : relis-le et valide-le.</span>
        </span>
        <Icon name="chevron" className="muted size-5" />
      </Link>
    );
  }
  const review = matchPlan(plan, acts);
  const today = review.matches.filter((m) => m.status === 'today');
  const next = review.matches.find((m) => m.status === 'upcoming');
  const shown = today.length ? today : next ? [next] : [];
  return (
    <Link to="/plan" className="card pressable block p-4">
      <div className="flex items-baseline justify-between">
        <p className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-accent">
          <Icon name="calendar" className="size-4" /> {today.length ? 'Au programme aujourd’hui' : next ? 'Prochaine séance' : 'Plan de la semaine'}
        </p>
        <span className="muted text-xs">{review.done}/{review.total} faites</span>
      </div>
      {shown.length ? shown.map((m) => (
        <div key={m.session.id} className="mt-2 flex items-center gap-3">
          <SportBadge sport={m.session.sport} className="size-9" />
          <div className="min-w-0">
            <p className="font-medium leading-snug">{m.session.title}</p>
            <p className="muted text-xs first-letter:uppercase">
              {m.status === 'upcoming' ? `${dayName.format(m.session.date)} · ` : ''}
              {[m.session.durationMin ? `${m.session.durationMin} min` : null, m.session.intensity || null].filter(Boolean).join(' · ')}
            </p>
          </div>
        </div>
      )) : <p className="mt-2 text-sm">Toutes les séances prévues sont passées. Bravo pour celles réalisées !</p>}
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className="h-full rounded-full bg-accent" style={{ width: `${review.total ? (review.done / review.total) * 100 : 0}%` }} />
      </div>
    </Link>
  );
}

const dayName = new Intl.DateTimeFormat('fr-FR', { weekday: 'long' });

function ThisWeek({ acts }: { acts: Activity[] }) {
  const w0 = weekStart(Date.now());
  const thisWeek = acts.filter((a) => a.startTime >= w0);
  const before = acts.filter((a) => a.startTime < w0);
  return (
    <section className="card p-4">
      <h2 className="mb-3 font-semibold">Cette semaine</h2>
      <div className="grid grid-cols-2 gap-3">
        {(['running', 'swimming'] as Sport[]).map((sport) => (
          <SportWeek key={sport} sport={sport}
            v={volumeOf(thisWeek.filter((a) => a.sport === sport))}
            avg={volumeOf(before.filter((a) => a.sport === sport))} />
        ))}
      </div>
      <p className="muted mt-3 text-xs">Comparé à la moyenne des 4 semaines précédentes.</p>
    </section>
  );
}

function SportWeek({ sport, v, avg }: { sport: Sport; v: Volume; avg: Volume }) {
  const dist = (m: number) => (sport === 'running' ? fmtKm(m) : fmtMeters(m));
  const avgDist = avg.distanceM / 4;
  const pct = avgDist > 0 ? Math.min(100, (v.distanceM / avgDist) * 100) : v.distanceM > 0 ? 100 : 0;
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-2">
        <SportBadge sport={sport} className="size-8" />
        <span className="text-sm font-medium">{sport === 'running' ? 'Course' : 'Natation'}</span>
      </div>
      <p className="mt-2 text-xl font-semibold">{dist(v.distanceM)}</p>
      <p className="muted text-xs">
        {v.count} séance{v.count > 1 ? 's' : ''}{v.count > 0 && ` · ${fmtDurationShort(v.durationS)}`}
      </p>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
        <div className={`h-full rounded-full ${sport === 'running' ? 'bg-run' : 'bg-swim'}`} style={{ width: `${pct}%` }} />
      </div>
      <p className="muted mt-1 text-[11px]">
        {avg.count ? `moy. ${dist(avgDist)} · ${(avg.count / 4).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} séance${avg.count / 4 >= 2 ? 's' : ''}/sem.` : 'Pas d’historique récent'}
      </p>
    </div>
  );
}
