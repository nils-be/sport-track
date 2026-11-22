import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { SportBadge } from '../components/ActivityCard';
import AppBar, { AppBarAction } from '../components/AppBar';
import Icon from '../components/Icon';
import Markdown from '../components/Markdown';
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

const atBottom = () => window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 160;
const scrollToBottom = (smooth = true) =>
  requestAnimationFrame(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: smooth ? 'smooth' : 'auto' }));

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
            <Markdown text={'Salut ! Je suis ton coach.\n\n- Importe une séance avec le bouton **+** : je t’en fais le débrief ici.\n- Écris-moi quand tu veux : sensations, courbatures, séance à décaler, objectif…\n\nJe garde en mémoire tes séances et nos échanges.'} />
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
      {m.status === 'pending' && !m.text && <TypingDots label={m.kind === 'debrief' ? 'J’analyse ta séance…' : undefined} />}
      {m.text && <div className={m.status === 'pending' ? 'opacity-50' : ''}><Markdown text={m.text} /></div>}
      {m.status === 'error' && (
        <div className="mt-1 space-y-2">
          <p className="text-sm text-red-700 dark:text-red-400">{m.error}</p>
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

function UserBubble({ m }: { m: ChatMessage }) {
  return (
    <div className="msg-in flex justify-end pl-10">
      <div className="selectable max-w-full rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-white dark:text-slate-950">
        {m.text}
        <span className="mt-1 block text-right text-[11px] opacity-70">{timeFmt.format(m.at)}</span>
      </div>
    </div>
  );
}

function Composer({ disabled, busy }: { disabled: boolean; busy: boolean }) {
  const [text, setText] = useState('');
  const ref = useRef<HTMLTextAreaElement>(null);
  // Hauteur automatique (5 lignes maximum).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 140)}px`;
  }, [text]);

  const send = async () => {
    const t = text.trim();
    if (!t || disabled || busy) return;
    setText('');
    navigator.vibrate?.(6);
    const { sendChatMessage } = await import('../lib/llm/chat');
    await sendChatMessage(t);
  };

  return (
    <div className="composer fixed inset-x-0 z-30 px-3">
      <div className="mx-auto flex max-w-2xl items-end gap-2 rounded-3xl bg-white/90 p-1.5 pl-4 shadow-lg ring-1 ring-slate-200/80 backdrop-blur-xl dark:bg-slate-900/90 dark:ring-slate-700/80">
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
          placeholder={disabled ? 'Clé API requise (Réglages)' : 'Écris au coach…'}
          className="max-h-36 min-h-10 flex-1 resize-none bg-transparent py-2 leading-snug outline-none placeholder:text-slate-400"
        />
        <button onClick={send} disabled={!text.trim() || disabled || busy} aria-label="Envoyer"
          className="grid size-10 shrink-0 place-items-center rounded-full bg-accent text-white transition-all active:scale-90 disabled:scale-90 disabled:opacity-30 dark:text-slate-950">
          <Icon name="send" className="size-5" />
        </button>
      </div>
    </div>
  );
}
