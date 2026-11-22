import { useLiveQuery } from 'dexie-react-hooks';
import AppBar from '../components/AppBar';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../components/Icon';
import { db, type NotebookVersion } from '../lib/db';
import { fmtDate, fmtTime } from '../lib/format';
import { currentNotebook, MAX_VERSIONS, MAX_WORDS, saveNotebook, wordCount } from '../lib/notebook';

const SOURCE_LABEL: Record<NotebookVersion['source'], string> = {
  initial: 'Version initiale',
  coach: 'Mis à jour par le coach',
  user: 'Modifié par toi',
  restore: 'Version restaurée',
};

export default function Notebook() {
  useEffect(() => { void currentNotebook(); }, []); // crée la version initiale au premier passage
  const versions = useLiveQuery(() => db.notebook.orderBy('id').reverse().toArray(), []);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [openId, setOpenId] = useState<number | null>(null);

  if (!versions?.length) return null;
  const [current, ...older] = versions;
  const words = wordCount(editing ? draft : current.text);

  const save = async () => {
    if (draft.trim() !== current.text) await saveNotebook(draft, 'user');
    setEditing(false);
  };
  const restore = async (v: NotebookVersion) => {
    if (!confirm(`Restaurer la version du ${fmtDate(v.createdAt)} ? La version actuelle reste dans l’historique.`)) return;
    await saveNotebook(v.text, 'restore');
    setOpenId(null);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="space-y-4">
      <AppBar back="/" title="Carnet du coach" />
      <p className="muted -mt-2 text-sm">Ce que le coach sait de toi. Il le met à jour après chaque débrief, et tu peux le modifier (objectifs, douleurs, contraintes…).</p>

      <section className="card p-4">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div className="text-xs">
            <p className="font-medium">{SOURCE_LABEL[current.source]}</p>
            <p className="muted">
              {fmtDate(current.createdAt)} · {fmtTime(current.createdAt)}
              {current.activityId && <> · <Link className="text-accent" to={`/seance/${encodeURIComponent(current.activityId)}`}>séance</Link></>}
            </p>
          </div>
          {!editing && (
            <button onClick={() => { setDraft(current.text); setEditing(true); }} className="flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-medium text-accent ring-1 ring-accent/40">
              <Icon name="edit" className="size-4" /> Modifier
            </button>
          )}
        </div>

        {editing ? (
          <>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="min-h-[60vh] w-full rounded-xl bg-slate-50 p-3 text-[15px] leading-relaxed outline-none ring-1 ring-slate-200 focus:ring-2 focus:ring-accent dark:bg-slate-800/60 dark:ring-slate-700"
              autoFocus
            />
            <div className="mt-3 flex items-center justify-between gap-2">
              <WordCount words={words} />
              <div className="flex gap-2">
                <button onClick={() => setEditing(false)} className="muted h-10 px-3">Annuler</button>
                <button onClick={save} className="h-10 rounded-lg bg-accent px-4 font-medium text-white dark:text-slate-950">Enregistrer</button>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="selectable text-[15px] leading-relaxed whitespace-pre-wrap">{current.text}</div>
            <div className="mt-3"><WordCount words={words} /></div>
          </>
        )}
      </section>

      {older.length > 0 && (
        <section>
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
                  <div className="border-t border-slate-100 p-3 dark:border-slate-800">
                    <div className="max-h-96 overflow-auto text-sm leading-relaxed whitespace-pre-wrap">{v.text}</div>
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

function WordCount({ words }: { words: number }) {
  const over = words > MAX_WORDS;
  return (
    <p className={`text-xs ${over ? 'text-amber-600 dark:text-amber-400' : 'muted'}`}>
      {words} / {MAX_WORDS} mots{over && ' : trop long, le coach le raccourcira'}
    </p>
  );
}
