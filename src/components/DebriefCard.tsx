import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../lib/db';
import { modelInfo } from '../lib/llm/models';
import { enqueueDebriefs, useDebriefQueue } from '../lib/llm/queue';
import { fmtDate, fmtUsd } from '../lib/format';
import Icon from './Icon';

export default function DebriefCard({ activityId }: { activityId: string }) {
  const d = useLiveQuery(() => db.debriefs.get(activityId), [activityId]);
  const queue = useDebriefQueue();
  const queued = queue.running === activityId || queue.pending.includes(activityId);
  const busy = queued || d?.status === 'pending';

  const regenerate = () => {
    if (d?.status === 'done' && !confirm('Regénérer le débrief ? L’ancien sera remplacé et le carnet du coach mis à jour à nouveau.')) return;
    void enqueueDebriefs([activityId]);
  };

  return (
    <section className="card overflow-hidden">
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
        <span className="grid size-7 place-items-center rounded-full bg-accent-soft text-accent">
          <Icon name="coach" className="size-4" />
        </span>
        <h2 className="font-semibold">Débrief du coach</h2>
        {busy && <span className="ml-auto size-4 animate-spin rounded-full border-2 border-accent border-t-transparent" aria-label="En cours" />}
      </div>

      <div className="space-y-3 p-4">
        {busy && (
          <p className="muted text-sm">
            {queue.running === activityId || d?.status === 'pending' ? 'Le coach analyse ta séance…' : 'En attente (autres séances en cours de débrief)…'}
          </p>
        )}

        {!busy && d?.status === 'error' && (
          <div className="rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-300">
            <p>{d.error}</p>
            {d.error?.includes('Réglages') && <Link to="/reglages" className="mt-1 inline-block font-medium underline">Ouvrir les réglages</Link>}
          </div>
        )}

        {d?.content && (
          <div className={`space-y-3 ${busy ? 'opacity-50' : ''}`}>
            <p className="text-lg font-semibold leading-snug">{d.content.titre}</p>
            <Section title="Ce qui s’est bien passé" items={d.content.bien} tone="good" />
            <Section title="Points d’attention" items={d.content.attention} tone="warn" />
            {d.content.comparaison && (
              <div>
                <h3 className="muted mb-1 text-xs font-semibold uppercase tracking-wide">Par rapport aux séances similaires</h3>
                <p className="text-[15px] leading-relaxed">{d.content.comparaison}</p>
              </div>
            )}
            {d.content.conseil && (
              <div className="rounded-xl bg-accent-soft/60 p-3 dark:bg-accent-soft/40">
                <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-accent">Conseil pour la suite</h3>
                <p className="text-[15px] leading-relaxed">{d.content.conseil}</p>
              </div>
            )}
          </div>
        )}

        {!busy && !d?.content && d?.status !== 'error' && (
          <p className="muted text-sm">Cette séance n’a pas encore de débrief.</p>
        )}

        {!busy && (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            {d?.status === 'done' && d.costUsd != null ? (
              <p className="muted text-xs">
                {modelInfo(d.model ?? '')?.label ?? d.model} · {fmtDate(d.createdAt)} · {(d.inputTokens ?? 0) + (d.outputTokens ?? 0)} tokens · ≈ {fmtUsd(d.costUsd)}
              </p>
            ) : <span />}
            <button onClick={regenerate} className="h-9 rounded-lg px-3 text-sm font-medium text-accent ring-1 ring-accent/40">
              {d?.status === 'done' ? 'Regénérer' : d?.status === 'error' ? 'Réessayer' : 'Générer le débrief'}
            </button>
          </div>
        )}

        {d?.sentJson && !busy && (
          <details className="text-xs">
            <summary className="muted cursor-pointer">Données envoyées au coach</summary>
            <pre className="mt-2 max-h-80 overflow-auto rounded-lg bg-slate-50 p-2 text-[11px] leading-snug whitespace-pre-wrap dark:bg-slate-800/60">
              {JSON.stringify(JSON.parse(d.sentJson), null, 1)}
            </pre>
          </details>
        )}
      </div>
    </section>
  );
}

function Section({ title, items, tone }: { title: string; items: string[]; tone: 'good' | 'warn' }) {
  if (!items.length) return null;
  return (
    <div>
      <h3 className="muted mb-1 text-xs font-semibold uppercase tracking-wide">{title}</h3>
      <ul className="space-y-1.5">
        {items.map((t, i) => (
          <li key={i} className="flex gap-2 text-[15px] leading-relaxed">
            <span className={`mt-2 size-1.5 shrink-0 rounded-full ${tone === 'good' ? 'bg-green-500' : 'bg-amber-500'}`} />
            <span>{t}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
