import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AppBar, { AppBarAction } from '../components/AppBar';
import Icon from '../components/Icon';
import Markdown from '../components/Markdown';
import { db, type NotebookVersion } from '../lib/db';
import { fmtDate, fmtTime } from '../lib/format';
import {
  buildNotebook, currentNotebook, MAX_VERSIONS, MAX_WORDS, normalizeNotebook, NOTEBOOK_SECTIONS, OTHER_SECTION,
  parseNotebook, saveNotebook, wordCount,
} from '../lib/notebook';

const SOURCE_LABEL: Record<NotebookVersion['source'], string> = {
  initial: 'Version initiale',
  coach: 'Mis à jour par le coach',
  user: 'Modifié par toi',
  restore: 'Version restaurée',
};

export default function Notebook() {
  useEffect(() => { void currentNotebook(); }, []); // crée la version initiale au premier passage
  const versions = useLiveQuery(() => db.notebook.orderBy('id').reverse().toArray(), []);
  const [editing, setEditing] = useState<string | null>(null);
  const [history, setHistory] = useState(false);

  if (!versions?.length) return null;
  const [latest] = versions;
  const text = normalizeNotebook(latest.text);
  const sections = parseNotebook(text);
  const filled = NOTEBOOK_SECTIONS.filter((s) => sections[s.title]).length;

  const saveSection = async (title: string, value: string) => {
    const next = buildNotebook({ ...sections, [title]: value });
    if (next !== text) await saveNotebook(next, 'user');
    setEditing(null);
  };
  const restore = async (v: NotebookVersion) => {
    if (!confirm(`Restaurer la version du ${fmtDate(v.createdAt)} ? La version actuelle reste dans l’historique.`)) return;
    await saveNotebook(v.text, 'restore');
    setHistory(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const all = [...NOTEBOOK_SECTIONS, ...(sections[OTHER_SECTION] ? [{ title: OTHER_SECTION, hint: 'Autres informations.' }] : [])];

  return (
    <div className="space-y-3">
      <AppBar back="/" title="Carnet du coach" subtitle={`${filled}/${NOTEBOOK_SECTIONS.length} rubriques remplies · ${wordCount(text)} / ${MAX_WORDS} mots`}
        actions={versions.length > 1 ? <AppBarAction icon="history" label="Historique des versions" onClick={() => setHistory(true)} /> : undefined} />
      <p className="muted -mt-2 text-sm">
        Ce que le coach sait de toi pour cadrer tes séances. Il le complète au fil des débriefs et de vos échanges ; tu peux modifier chaque rubrique.
      </p>
      <p className="muted text-xs">
        {SOURCE_LABEL[latest.source]} · {fmtDate(latest.createdAt)} {fmtTime(latest.createdAt)}
        {latest.activityId && <> · <Link className="text-accent" to={`/seance/${encodeURIComponent(latest.activityId)}`}>séance</Link></>}
      </p>

      {all.map((s, i) => (
        <Section key={s.title} index={i} title={s.title} hint={s.hint} value={sections[s.title] ?? ''}
          editing={editing === s.title} onEdit={() => setEditing(s.title)} onCancel={() => setEditing(null)}
          onSave={(v) => saveSection(s.title, v)} />
      ))}

      {history && <HistorySheet versions={versions} onRestore={restore} onClose={() => setHistory(false)} />}
    </div>
  );
}

interface SectionProps {
  index: number;
  title: string;
  hint: string;
  value: string;
  editing: boolean;
  onEdit: () => void;
  onCancel: () => void;
  onSave: (v: string) => void;
}

function Section({ index, title, hint, value, editing, onEdit, onCancel, onSave }: SectionProps) {
  const [draft, setDraft] = useState(value);
  useEffect(() => { if (editing) setDraft(value || '- '); }, [editing, value]);
  const empty = !value.trim();
  return (
    <section className="card msg-in p-4" style={{ animationDelay: `${index * 30}ms` }}>
      <div className="flex items-start justify-between gap-2">
        <h2 className="font-semibold">{title}</h2>
        {!editing && (
          <button onClick={onEdit} aria-label={`Modifier : ${title}`} className="pressable -mt-1 -mr-1 grid size-9 place-items-center rounded-full text-accent">
            <Icon name="edit" className="size-4" />
          </button>
        )}
      </div>
      {editing ? (
        <div className="mt-2">
          <p className="muted mb-2 text-xs">{hint} Une idée par ligne, commençant par « - ».</p>
          <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={Math.max(4, draft.split('\n').length + 1)} autoFocus
            className="w-full rounded-xl bg-slate-50 p-3 leading-relaxed ring-1 ring-slate-200 outline-none focus:ring-2 focus:ring-accent dark:bg-slate-800/60 dark:ring-slate-700" />
          <div className="mt-2 flex justify-end gap-2">
            <button onClick={onCancel} className="muted h-10 px-3">Annuler</button>
            <button onClick={() => onSave(draft.split('\n').filter((l) => l.trim() && l.trim() !== '-').join('\n'))}
              className="h-10 rounded-lg bg-accent px-4 font-medium text-white dark:text-slate-950">Enregistrer</button>
          </div>
        </div>
      ) : empty ? (
        <button onClick={onEdit} className="muted mt-1 w-full text-left text-sm italic">{hint}</button>
      ) : (
        <Markdown text={value} className="mt-1" />
      )}
    </section>
  );
}

// ───────────────────────────────────────────────────────────── Historique

const SOURCE: Record<NotebookVersion['source'], { who: string; icon: 'coach' | 'user' | 'undo' | 'sparkle'; cls: string }> = {
  coach: { who: 'Le coach', icon: 'coach', cls: 'bg-accent-soft text-accent' },
  user: { who: 'Toi', icon: 'user', cls: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200' },
  restore: { who: 'Restauration', icon: 'undo', cls: 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300' },
  initial: { who: 'Création du carnet', icon: 'sparkle', cls: 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400' },
};

function relative(t: number): string {
  const min = Math.round((Date.now() - t) / 60_000);
  if (min < 1) return 'à l’instant';
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const d = Math.round(h / 24);
  return d < 7 ? `il y a ${d} j` : fmtDate(t);
}

/** Rubriques qui diffèrent entre deux versions. */
function changedSections(next: string, prev: string | null): string[] {
  const a = parseNotebook(normalizeNotebook(next)), b = prev ? parseNotebook(normalizeNotebook(prev)) : {};
  return [...NOTEBOOK_SECTIONS.map((s) => s.title), OTHER_SECTION].filter((t) => (a[t] ?? '') !== (b[t] ?? ''));
}

function HistorySheet({ versions, onRestore, onClose }: { versions: NotebookVersion[]; onRestore: (v: NotebookVersion) => void; onClose: () => void }) {
  const [selected, setSelected] = useState<number | null>(null);
  const items = versions.map((v, i) => ({ v, prev: versions[i + 1] ?? null, changes: changedSections(v.text, versions[i + 1]?.text ?? null) }));
  const sel = selected != null ? items[selected] : null;

  return (
    <div className="overlay-in fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div className="sheet-in card flex max-h-[85dvh] w-full max-w-lg flex-col rounded-b-none sm:rounded-2xl" onClick={(e) => e.stopPropagation()}
        role="dialog" aria-label="Historique du carnet">
        <div className="flex items-center gap-2 border-b border-slate-100 px-4 pt-3 pb-3 dark:border-slate-800">
          {sel ? (
            <button onClick={() => setSelected(null)} aria-label="Retour à l’historique" className="pressable -ml-1 grid size-9 place-items-center rounded-full"><Icon name="back" /></button>
          ) : <span className="mx-auto mb-1 h-1 w-10 rounded-full bg-slate-300 sm:hidden dark:bg-slate-700" />}
          {sel && <h2 className="flex-1 font-semibold">{SOURCE[sel.v.source].who} · {relative(sel.v.createdAt)}</h2>}
        </div>

        <div className="overflow-y-auto px-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {!sel ? (
            <>
              <h2 className="pt-3 text-lg font-semibold">Historique du carnet</h2>
              <p className="muted mb-3 text-xs">Les {MAX_VERSIONS} dernières versions. Touche une version pour voir ce qu’elle a changé.</p>
              <ol className="relative">
                {items.map(({ v, changes }, i) => {
                  const src = SOURCE[v.source];
                  return (
                    <li key={v.id} className="msg-in relative flex gap-3 pb-4" style={{ animationDelay: `${i * 25}ms` }}>
                      {i < items.length - 1 && <span className="absolute top-9 bottom-0 left-[17px] w-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />}
                      <span className={`relative z-10 grid size-9 shrink-0 place-items-center rounded-full ${src.cls}`}><Icon name={src.icon} className="size-4" /></span>
                      <button onClick={() => setSelected(i)} className="pressable min-w-0 flex-1 rounded-xl px-2 py-1 text-left active:bg-slate-50 dark:active:bg-slate-800/50">
                        <p className="text-sm font-medium">
                          {src.who}
                          {i === 0 && <span className="ml-2 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-semibold text-accent">Actuelle</span>}
                        </p>
                        <p className="muted text-xs">{relative(v.createdAt)} · {fmtTime(v.createdAt)}</p>
                        {changes.length > 0 && v.source !== 'initial' && (
                          <div className="mt-1.5 flex flex-wrap gap-1">
                            {changes.slice(0, 4).map((c) => (
                              <span key={c} className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600 dark:bg-slate-800 dark:text-slate-300">{c}</span>
                            ))}
                            {changes.length > 4 && <span className="muted text-[11px]">+{changes.length - 4}</span>}
                          </div>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ol>
            </>
          ) : (
            <div className="page-in space-y-3 pt-3">
              {sel.v.source === 'initial' || !sel.changes.length ? (
                <Markdown text={normalizeNotebook(sel.v.text)} className="text-sm" />
              ) : (
                sel.changes.map((title) => {
                  const now = parseNotebook(normalizeNotebook(sel.v.text))[title];
                  const before = sel.prev ? parseNotebook(normalizeNotebook(sel.prev.text))[title] : undefined;
                  return (
                    <section key={title} className="rounded-xl bg-slate-50 p-3 dark:bg-slate-800/50">
                      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
                      {before && (
                        <div className="mb-2 border-l-2 border-red-300 pl-2 opacity-70 dark:border-red-800">
                          <p className="muted mb-0.5 text-[10px] font-semibold uppercase tracking-wide">Avant</p>
                          <Markdown text={before} className="text-sm line-through decoration-red-400/60" />
                        </div>
                      )}
                      <div className="border-l-2 border-green-400 pl-2 dark:border-green-700">
                        <p className="muted mb-0.5 text-[10px] font-semibold uppercase tracking-wide">Dans cette version</p>
                        {now ? <Markdown text={now} className="text-sm" /> : <p className="muted text-sm italic">(vide)</p>}
                      </div>
                    </section>
                  );
                })
              )}
              {selected !== 0 && (
                <button onClick={() => onRestore(sel.v)} className="pressable flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-accent font-medium text-white dark:text-slate-950">
                  <Icon name="undo" className="size-4" /> Restaurer cette version
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
