import { useLiveQuery } from 'dexie-react-hooks';
import AppBar, { AppBarAction } from '../components/AppBar';
import { useImport } from '../components/ImportContext';
import { useState } from 'react';
import ActivityCard from '../components/ActivityCard';
import type { Activity, Sport } from '../lib/analysis/types';
import { db } from '../lib/db';
import { fmtKm, fmtMeters, fmtMonth } from '../lib/format';
import { volumeOf, weekStart } from '../lib/stats';

type Filter = 'all' | Sport;
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Toutes' },
  { id: 'running', label: 'Course' },
  { id: 'swimming', label: 'Natation' },
];

export default function Activities() {
  const { openPicker } = useImport();
  const [filter, setFilter] = useState<Filter>(() => {
    try { return (sessionStorage.getItem('filter') as Filter) ?? 'all'; } catch { return 'all'; }
  });
  const list = useLiveQuery(async () => {
    const all = await db.activities.orderBy('startTime').reverse().toArray();
    return filter === 'all' ? all : all.filter((a) => a.sport === filter);
  }, [filter]);

  const week = useLiveQuery(() => db.activities.where('startTime').aboveOrEqual(weekStart(Date.now())).toArray(), []);
  const weekSummary = week && week.length
    ? `Cette semaine : ${[
        volumeOf(week.filter((a) => a.sport === 'running')),
        volumeOf(week.filter((a) => a.sport === 'swimming')),
      ].map((v, i) => (v.count ? (i === 0 ? fmtKm(v.distanceM) : fmtMeters(v.distanceM)) : null)).filter(Boolean).join(' · ')}`
    : 'Aucune séance cette semaine';

  const choose = (f: Filter) => {
    setFilter(f);
    try { sessionStorage.setItem('filter', f); } catch { /* stockage indisponible */ }
  };

  // Regroupement par mois.
  const groups: { month: string; items: Activity[] }[] = [];
  for (const a of list ?? []) {
    const m = fmtMonth(a.startTime);
    if (groups.at(-1)?.month !== m) groups.push({ month: m, items: [] });
    groups.at(-1)!.items.push(a);
  }

  return (
    <div className="space-y-4">
      <AppBar title="Séances" subtitle={weekSummary} actions={<AppBarAction icon="plus" label="Importer des séances" onClick={openPicker} />} />
      <div className="flex gap-2" role="tablist">
        {FILTERS.map((f) => (
          <button
            key={f.id}
            role="tab"
            aria-selected={filter === f.id}
            onClick={() => choose(f.id)}
            className={`h-10 rounded-full px-4 text-sm font-medium transition ${
              filter === f.id ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900' : 'card'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      {list && list.length === 0 && <p className="muted py-8 text-center">Aucune séance.</p>}
      {groups.map((g) => (
        <section key={g.month}>
          <h2 className="muted mb-2 text-sm font-semibold">{g.month} · {g.items.length}</h2>
          <div className="space-y-2">{g.items.map((a) => <ActivityCard key={a.id} a={a} />)}</div>
        </section>
      ))}
    </div>
  );
}
