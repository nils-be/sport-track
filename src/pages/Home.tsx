import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import ActivityCard, { SportBadge } from '../components/ActivityCard';
import Icon from '../components/Icon';
import { useImport } from '../components/ImportContext';
import type { Activity, Sport } from '../lib/analysis/types';
import { db } from '../lib/db';
import { fmtDate, fmtDurationShort, fmtKm, fmtMeters } from '../lib/format';
import { addWeeks, volumeOf, weekStart, type Volume } from '../lib/stats';

export default function Home() {
  const { openPicker } = useImport();
  const recent = useLiveQuery(() => db.activities.orderBy('startTime').reverse().limit(5).toArray(), []);
  // Semaine en cours + 4 précédentes, pour la comparaison.
  const weekActs = useLiveQuery(() => db.activities.where('startTime').aboveOrEqual(addWeeks(weekStart(Date.now()), -4)).toArray(), []);
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
    <div className="space-y-5">
      <header className="flex items-start justify-between pt-2">
        <div>
          <h1 className="text-2xl font-bold">Sport Track</h1>
          <p className="muted text-sm first-letter:uppercase">{new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(Date.now())}</p>
        </div>
        <Link to="/reglages" aria-label="Réglages" className="muted -mr-2 grid size-11 place-items-center rounded-full active:bg-slate-200 dark:active:bg-slate-800">
          <Icon name="settings" className="size-6" />
        </Link>
      </header>

      <button
        onClick={openPicker}
        className="flex h-16 w-full items-center justify-center gap-3 rounded-2xl bg-accent text-lg font-semibold text-white shadow-sm active:scale-[0.99] dark:text-slate-950"
      >
        <Icon name="upload" className="size-6" />
        Importer des séances
      </button>

      {weekActs && !empty && <ThisWeek acts={weekActs} />}

      {lastAdvice && (
        <Link to={`/seance/${encodeURIComponent(lastAdvice.a.id)}`} className="card block p-4">
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
            <p className="font-medium">Aucune séance pour l’instant</p>
            <p className="muted mt-1 text-sm">
              Dans Garmin Connect, ouvre une activité, menu ⋯ › « Exporter l’original », puis importe le fichier ici
              (ou « Partager » le fichier vers Sport Track sur Android).
            </p>
          </div>
        )}
        <div className="space-y-2">{recent?.map((a) => <ActivityCard key={a.id} a={a} />)}</div>
      </section>
    </div>
  );
}

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
