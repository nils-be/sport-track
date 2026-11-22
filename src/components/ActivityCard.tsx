import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../lib/db';
import type { Activity } from '../lib/analysis/types';
import { activityTitle, fmtDate, fmtDistance, fmtDurationShort, fmtTime, mainPace } from '../lib/format';
import Icon from './Icon';

export function SportBadge({ sport, className = 'size-10' }: { sport: Activity['sport']; className?: string }) {
  const run = sport === 'running';
  return (
    <span className={`grid shrink-0 place-items-center rounded-xl ${className} ${run ? 'bg-run-soft text-run' : 'bg-swim-soft text-swim'}`}>
      <Icon name={run ? 'run' : 'swim'} className="size-5" />
    </span>
  );
}

export default function ActivityCard({ a }: { a: Activity }) {
  const d = useLiveQuery(() => db.debriefs.get(a.id), [a.id]);
  return (
    <Link to={`/seance/${encodeURIComponent(a.id)}`} className="card flex items-center gap-3 p-3 active:scale-[0.99] transition">
      <SportBadge sport={a.sport} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-2">
          <p className="truncate font-medium">{activityTitle(a)}</p>
          <p className="muted shrink-0 text-xs">{fmtDate(a.startTime)} · {fmtTime(a.startTime)}</p>
        </div>
        <div className="mt-0.5 flex gap-3 text-sm">
          <span className="font-semibold">{fmtDistance(a)}</span>
          <span>{fmtDurationShort(a.durationS)}</span>
          <span className="muted">{mainPace(a)}</span>
          {a.avgHr != null && <span className="muted hidden min-[380px]:inline">{a.avgHr} bpm</span>}
        </div>
        {d?.status === 'pending' ? (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-accent">
            <span className="size-3 animate-spin rounded-full border-2 border-accent border-t-transparent" /> Débrief en cours…
          </p>
        ) : d?.content ? (
          <p className="muted mt-1 line-clamp-2 text-[13px] leading-snug">{d.content.titre}</p>
        ) : null}
      </div>
    </Link>
  );
}
