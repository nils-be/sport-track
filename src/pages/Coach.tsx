import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { SportBadge } from '../components/ActivityCard';
import AppBar, { AppBarAction } from '../components/AppBar';
import Icon from '../components/Icon';
import Markdown from '../components/Markdown';
import SyncAction from '../components/SyncAction';
import { db, getSettings, type ChatMessage } from '../lib/db';
import { activityTitle, fmtDistance } from '../lib/format';
import { enqueueDebriefs, useDebriefQueue } from '../lib/llm/queue';

const dayFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

function dayLabel(t: number): string {
  const d = new Date(t); d.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const diff = Math.round((today.getTime() - d.getTime()) / 86_400_000);
  if (diff === 0) return 'Aujourd’hui';
  if (diff === 1) return 'Hier';
  return dayFmt.format(t);
}

/** Le fil défile dans sa propre zone (onglet du carrousel, voir Layout). */
const onCoach = () => location.hash.replace(/^#/, '').split('?')[0] === '/coach';
const scroller = () => document.querySelector<HTMLElement>('[data-tab-scroller="/coach"]');
const atBottom = () => { const s = scroller(); return !s || s.clientHeight + s.scrollTop >= s.scrollHeight - 160; };
/** En bas du fil : en douceur si on le regarde, instantanément sinon (on le retrouvera en bas). */
const scrollToBottom = (smooth = true) =>
  requestAnimationFrame(() => { const s = scroller(); s?.scrollTo({ top: s.scrollHeight, behavior: smooth && onCoach() ? 'smooth' : 'auto' }); });

/** Masque la barre de navigation pendant la saisie (clavier ouvert), en restant en bas du fil si on y était. */
const setTyping = (on: boolean) => {
  const stick = atBottom();
  if (on) document.body.dataset.typing = '1';
  else delete document.body.dataset.typing;
  if (stick) setTimeout(() => scrollToBottom(false), 280);
};

export default function Coach() {
  const messages = useLiveQuery(() => db.messages.orderBy('at').toArray(), []);
  const hasKey = useLiveQuery(async () => {
    const s = await getSettings();
    return !!(await db.secrets.get(s.llm.provider))?.key;
  }, []);
  const queue = useDebriefQueue();
  const first = useRef(true);

  // Le fil s'ouvre en bas ; chaque nouveau message y ramène en douceur.
  useLayoutEffect(() => {
    if (!messages) return;
    scrollToBottom(!first.current);
    first.current = false;
  }, [messages?.length, messages?.[messages.length - 1]?.status]);
  // Clavier qui s'ouvre / se ferme : la fenêtre change de hauteur.
  useEffect(() => {
    const onResize = () => { if (atBottom()) scrollToBottom(false); };
    window.visualViewport?.addEventListener('resize', onResize);
    return () => window.visualViewport?.removeEventListener('resize', onResize);
  }, []);
  useEffect(() => () => setTyping(false), []);

  const waiting = !!messages?.some((m) => m.status === 'pending') || !!queue.running;

  return (
    <div className="pb-16">
      <AppBar
        title="Coach"
        subtitle={waiting ? 'écrit…' : 'Ton suivi d’entraînement'}
        actions={<>
          <SyncAction />
          <AppBarAction icon="book" label="Carnet du coach" to="/carnet" />
          <AppBarAction icon="settings" label="Réglages" to="/reglages" />
        </>}
      />

      {hasKey === false && (
        <Link to="/reglages" className="card pressable mb-3 flex items-center gap-3 p-3 text-sm">
          <Icon name="alert" className="size-5 shrink-0 text-amber-500" />
          <span className="flex-1">Ajoute ta clé API dans les Réglages pour que le coach puisse te répondre.</span>
          <Icon name="chevron" className="muted size-4" />
        </Link>
      )}

      <div className="space-y-3">
        {messages?.length === 0 && (
          <CoachBubble>
            <Markdown text={'Salut ! Je suis ton coach.\n\n- Joins une séance avec le bouton **+** (et ta question si tu veux), ou importe-la depuis l’onglet Séances : je t’en fais le débrief ici.\n- Écris-moi quand tu veux : sensations, courbatures, séance à décaler, objectif…\n\nJe garde en mémoire tes séances et nos échanges.'} />
          </CoachBubble>
        )}
        {messages?.map((m, i) => (
          <div key={m.id}>
            {(i === 0 || dayLabel(messages[i - 1].at) !== dayLabel(m.at)) && (
              <p className="muted my-4 text-center text-xs font-medium first-letter:uppercase">{dayLabel(m.at)}</p>
            )}
            {m.role === 'user' ? <UserBubble m={m} /> : <CoachMessage m={m} />}
          </div>
        ))}
      </div>

      <Composer disabled={!hasKey} busy={!!messages?.some((m) => m.kind === 'chat' && m.status === 'pending')} />
    </div>
  );
}

function CoachBubble({ children }: { children: ReactNode }) {
  return (
    <div className="msg-in flex items-end gap-2 pr-6">
      <span className="grid size-7 shrink-0 place-items-center rounded-full bg-accent text-white dark:text-slate-950">
        <Icon name="coach" className="size-4" />
      </span>
      <div className="card min-w-0 flex-1 rounded-bl-md px-4 py-3">{children}</div>
    </div>
  );
}

function TypingDots({ label }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="typing-dots flex gap-1" aria-label="Le coach écrit"><i /><i /><i /></span>
      {label && <span className="muted text-sm">{label}</span>}
    </div>
  );
}

function SessionChip({ activityId }: { activityId: string }) {
  const a = useLiveQuery(() => db.activities.get(activityId), [activityId]);
  if (!a) return null;
  return (
    <Link to={`/seance/${encodeURIComponent(a.id)}`} className="pressable mb-3 flex items-center gap-2.5 rounded-xl bg-slate-50 p-2 pr-3 dark:bg-slate-800/70">
      <SportBadge sport={a.sport} className="size-8" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium">{activityTitle(a)} · {fmtDistance(a)}</span>
        <span className="muted block text-xs first-letter:uppercase">{dayFmt.format(a.startTime)}</span>
      </span>
      <Icon name="chevron" className="muted size-4" />
    </Link>
  );
}

function CoachMessage({ m }: { m: ChatMessage }) {
  const retry = async () => {
    if (m.kind === 'debrief' && m.activityId) void enqueueDebriefs([m.activityId]);
    else if (m.id != null) {
      const { retryChat } = await import('../lib/llm/chat');
      void retryChat(m.id);
    }
  };
  return (
    <CoachBubble>
      {m.kind === 'debrief' && m.activityId && <SessionChip activityId={m.activityId} />}
      {m.status === 'pending' && !m.text && <TypingDots label={m.progress ?? (m.kind === 'debrief' ? 'J’analyse ta séance…' : undefined)} />}
      {m.text && <div className={m.status === 'pending' ? 'opacity-50' : ''}><Markdown text={m.text} /></div>}
      {m.status === 'error' && (
        <div className="mt-1 space-y-2">
          <ErrorText text={m.error ?? 'Erreur inattendue.'} />
          <div className="flex gap-2">
            <button onClick={retry} className="pressable h-9 rounded-lg px-3 text-sm font-medium text-accent ring-1 ring-accent/40">Réessayer</button>
            {m.error?.includes('Réglages') && <Link to="/reglages" className="pressable flex h-9 items-center rounded-lg px-3 text-sm font-medium text-accent">Réglages</Link>}
          </div>
        </div>
      )}
      {m.status === 'done' && <p className="muted mt-1.5 text-right text-[11px]">{timeFmt.format(m.at)}</p>}
    </CoachBubble>
  );
}

/** Erreur : la première ligne résume, la suite (code et message du service) s'affiche en détail. */
function ErrorText({ text }: { text: string }) {
  const [head, ...rest] = text.split('\n');
  return (
    <div className="flex gap-2 rounded-xl bg-red-50 p-2.5 dark:bg-red-950/40">
      <Icon name="alert" className="mt-0.5 size-4 shrink-0 text-red-600 dark:text-red-400" />
      <div className="min-w-0 text-sm">
        <p className="font-medium text-red-700 dark:text-red-300">{head}</p>
        {rest.map((l) => <p key={l} className="selectable mt-0.5 text-xs break-words text-red-700/75 dark:text-red-300/75">{l}</p>)}
      </div>
    </div>
  );
}

function UserBubble({ m }: { m: ChatMessage }) {
  return (
    <div className="msg-in flex flex-col items-end gap-1.5 pl-10">
      {m.attachments?.map((id) => (
        <div key={id} className="w-full max-w-xs"><SessionChip activityId={id} /></div>
      ))}
      {m.attachmentErrors?.map((e) => (
        <p key={e} className="max-w-xs rounded-xl bg-amber-50 px-3 py-1.5 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">{e}</p>
      ))}
      {m.text && (
        <div className="selectable max-w-full rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-white dark:text-slate-950">
          {m.text}
          <span className="mt-1 block text-right text-[11px] opacity-70">{timeFmt.format(m.at)}</span>
        </div>
      )}
    </div>
  );
}

function Composer({ disabled, busy }: { disabled: boolean; busy: boolean }) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [sending, setSending] = useState(false);
  const ref = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  // Hauteur automatique (5 lignes maximum).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  const canSend = (!!text.trim() || files.length > 0) && !disabled && !busy && !sending;
  const send = async () => {
    if (!canSend) return;
    const t = text.trim(), f = files;
    setText(''); setFiles([]); setSending(true);
    navigator.vibrate?.(6);
    try {
      const { sendChatMessage } = await import('../lib/llm/chat');
      await sendChatMessage(t, f);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="composer fixed inset-x-0 z-30 px-3">
      <div className="mx-auto max-w-2xl rounded-3xl bg-white/90 p-1.5 shadow-lg ring-1 ring-slate-200/80 backdrop-blur-xl dark:bg-slate-900/90 dark:ring-slate-700/80">
        {files.length > 0 && (
          <div className="flex flex-wrap gap-1.5 px-1 pt-1 pb-1.5" data-noswipe>
            {files.map((f, i) => (
              <span key={`${f.name}-${i}`} className="msg-in flex max-w-full items-center gap-1.5 rounded-full bg-accent-soft py-1 pr-1 pl-2.5 text-xs font-medium text-accent">
                <Icon name="link" className="size-3.5 shrink-0" />
                <span className="truncate">{f.name}</span>
                <button onClick={() => setFiles(files.filter((_, k) => k !== i))} aria-label={`Retirer ${f.name}`}
                  className="grid size-5 shrink-0 place-items-center rounded-full bg-white/70 dark:bg-slate-900/60">
                  <Icon name="x" className="size-3" />
                </button>
              </span>
            ))}
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <button onClick={() => { navigator.vibrate?.(8); fileInput.current?.click(); }} aria-label="Joindre une séance"
            className="grid size-10 shrink-0 place-items-center rounded-full bg-slate-100 text-accent transition-transform active:scale-90 dark:bg-slate-800">
            <Icon name="plus" className="size-5" />
          </button>
          {/* Pas d'attribut accept : Android grise parfois les .fit (type MIME inconnu). */}
          <input ref={fileInput} type="file" multiple className="hidden" aria-label="Fichiers à joindre"
            onChange={(e) => { const add = Array.from(e.target.files ?? []); e.target.value = ''; if (add.length) setFiles([...files, ...add]); }} />
          <textarea
            ref={ref}
            rows={1}
            value={text}
            disabled={disabled}
            enterKeyHint="send"
            onChange={(e) => setText(e.target.value)}
            onFocus={() => setTyping(true)}
            onBlur={() => setTyping(false)}
            onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(); } }}
            placeholder={disabled ? 'Clé API requise (Réglages)' : files.length ? 'Ajoute un message (facultatif)…' : 'Écris au coach…'}
            className="max-h-36 min-h-10 flex-1 resize-none bg-transparent py-2 leading-snug outline-none placeholder:text-slate-400"
          />
          <button onClick={send} disabled={!canSend} aria-label="Envoyer"
            className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-white transition-all active:scale-90 disabled:scale-90 disabled:opacity-30 dark:text-slate-950">
            {sending ? <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" /> : <Icon name="send" className="size-5" />}
          </button>
        </div>
      </div>
    </div>
  );
}
