import { Link } from 'react-router-dom';
import { blockLabel, dayPart, effortBlockData, sessionKind } from '../lib/analysis/summary';
import type { Activity } from '../lib/analysis/types';
import { fmtDate, fmtDistance, fmtDuration, fmtPace, fmtTime, STROKE_LABEL, VARIANT_LABEL } from '../lib/format';
import Icon from './Icon';
import RouteMap from './RouteMap';

export function SportBadge({ sport, className = 'size-10' }: { sport: Activity['sport']; className?: string }) {
  const run = sport === 'running';
  return (
    <span className={`grid shrink-0 place-items-center rounded-xl ${className} ${run ? 'bg-run-soft text-run' : 'bg-swim-soft text-swim'}`}>
      <Icon name={run ? 'run' : 'swim'} className="size-5" />
    </span>
  );
}

function Big({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="min-w-0">
      <p className="muted text-[11px] uppercase tracking-wide">{label}</p>
      <p className="truncate text-lg leading-tight font-semibold">{value}{unit && <span className="muted ml-0.5 text-xs font-normal">{unit}</span>}</p>
    </div>
  );
}

/** Aperçu d'une séance dans la liste, inspiré d'un fil d'activités : type, chiffres clés, structure, parcours. */
export default function ActivityCard({ a }: { a: Activity }) {
  const run = a.sport === 'running';
  const tags: string[] = [];
  if (a.running?.isInterval) tags.push(...effortBlockData(a.running.laps).filter((b) => b.count > 1 || b.distanceM >= 400).slice(0, 2).map(blockLabel));
  if (a.running?.ascentM != null && a.running.ascentM >= 30) tags.push(`D+ ${a.running.ascentM} m`);
  if (a.swimming) {
    const sets = a.swimming.sets.filter((s) => s.kind === 'swim').length;
    if (sets) tags.push(`${sets} série${sets > 1 ? 's' : ''}`);
    if (a.swimming.poolLengthM) tags.push(`bassin ${a.swimming.poolLengthM} m`);
    if (a.swimming.mainStroke) tags.push(STROKE_LABEL[a.swimming.mainStroke]);
  }
  if (a.avgHr) tags.push(`FC ${a.avgHr}`);

  return (
    <Link to={`/seance/${encodeURIComponent(a.id)}`} className="card pressable block overflow-hidden">
      <div className="p-3.5 pb-3">
        <div className="flex items-center gap-3">
          <SportBadge sport={a.sport} className="size-9" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{sessionKind(a)} <span className="muted font-normal">· {dayPart(a.startTime)}</span></p>
            <p className="muted truncate text-xs first-letter:uppercase">
              {fmtDate(a.startTime)} · {fmtTime(a.startTime)} · {VARIANT_LABEL[a.variant]}
            </p>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <Big label="Distance" value={fmtDistance(a).replace(/ (km|m)$/, '')} unit={run ? 'km' : 'm'} />
          <Big label="Allure" value={fmtPace(run ? a.running?.avgPaceSPerKm : a.swimming?.avgPace100S)} unit={run ? '/km' : '/100m'} />
          <Big label="Durée" value={fmtDuration(a.durationS)} />
        </div>
        {tags.length > 0 && (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {tags.map((t) => (
              <span key={t} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 dark:bg-slate-800 dark:text-slate-300">{t}</span>
            ))}
          </div>
        )}
      </div>
      {a.route && a.route.length > 1 && <RouteMap route={a.route} height={140} attributionLink={false} />}
    </Link>
  );
}
