import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import AppBar from '../components/AppBar';
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
  const [openId, setOpenId] = useState<number | null>(null);

  if (!versions?.length) return null;
  const [latest, ...older] = versions;
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
    setOpenId(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const all = [...NOTEBOOK_SECTIONS, ...(sections[OTHER_SECTION] ? [{ title: OTHER_SECTION, hint: 'Autres informations.' }] : [])];

  return (
    <div className="space-y-3">
      <AppBar back="/" title="Carnet du coach" subtitle={`${filled}/${NOTEBOOK_SECTIONS.length} rubriques remplies · ${wordCount(text)} / ${MAX_WORDS} mots`} />
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

      {older.length > 0 && (
        <section className="pt-3">
          <h2 className="mb-2 font-semibold">Versions précédentes <span className="muted text-sm font-normal">({older.length}, les {MAX_VERSIONS} dernières sont gardées)</span></h2>
          <div className="space-y-2">
            {older.map((v) => (
              <div key={v.id} className="card">
                <button onClick={() => setOpenId(openId === v.id ? null : v.id!)} className="flex w-full items-center justify-between gap-2 p-3 text-left">
                  <div className="text-sm">
                    <p className="font-medium">{SOURCE_LABEL[v.source]}</p>
                    <p className="muted text-xs">{fmtDate(v.createdAt)} · {fmtTime(v.createdAt)} · {wordCount(v.text)} mots</p>
                  </div>
                  <Icon name={openId === v.id ? 'down' : 'chevron'} className="muted size-5" />
                </button>
                {openId === v.id && (
                  <div className="page-in border-t border-slate-100 p-3 dark:border-slate-800">
                    <div className="max-h-96 overflow-auto"><Markdown text={normalizeNotebook(v.text)} className="text-sm" /></div>
                    <button onClick={() => restore(v)} className="mt-3 flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-accent ring-1 ring-accent/40">
                      <Icon name="undo" className="size-4" /> Restaurer cette version
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      )}
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
