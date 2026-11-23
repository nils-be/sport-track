import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { getSettings } from '../lib/db';
import type { ImportResult } from '../lib/import/importFit';
import { enqueueDebriefs, hasApiKey } from '../lib/llm/queue';
import Icon from './Icon';

/** Au-delà, on demande confirmation avant de débriefer (import d'un historique). */
const AUTO_DEBRIEF_MAX = 5;

/** Fichiers reçus via « Partager » sur Android, déposés en cache par le service worker. */
async function takeSharedFiles(): Promise<File[]> {
  if (!('caches' in window)) return [];
  const cache = await caches.open('shared-files');
  const files: File[] = [];
  for (const req of await cache.keys()) {
    const res = await cache.match(req);
    if (res) files.push(new File([await res.blob()], decodeURIComponent(res.headers.get('x-file-name') ?? 'partage.fit')));
    await cache.delete(req);
  }
  return files;
}

type DebriefPlan = { kind: 'none' } | { kind: 'auto'; count: number } | { kind: 'no-key' } | { kind: 'ask'; ids: string[] };

interface ImportApi {
  openPicker: () => void;
  importing: boolean;
  /** Récupère les nouvelles séances sur Garmin Connect (via le relais). */
  sync: () => void;
  syncing: boolean;
}

const Ctx = createContext<ImportApi>({ openPicker: () => {}, importing: false, sync: () => {}, syncing: false });
export const useImport = () => useContext(Ctx);

export function ImportProvider({ children }: { children: ReactNode }) {
  const input = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [results, setResults] = useState<ImportResult[] | null>(null);
  const [sheetTitle, setSheetTitle] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [plan, setPlan] = useState<DebriefPlan>({ kind: 'none' });

  /** Après un import (fichiers ou synchro) : lieux, puis débrief automatique des nouvelles séances. */
  const afterImport = useCallback(async (res: ImportResult[]) => {
    setResults(res);
    void import('../lib/places').then((m) => m.resolvePlaces());
    // Débrief automatique, une seule fois, des nouvelles séances.
    const ids = res.filter((r) => r.status === 'imported' && r.activityId).map((r) => r.activityId!);
    if (!ids.length) setPlan({ kind: 'none' });
    else if (!(await hasApiKey((await getSettings()).llm.provider))) setPlan({ kind: 'no-key' });
    else if (ids.length <= AUTO_DEBRIEF_MAX) { void enqueueDebriefs(ids); setPlan({ kind: 'auto', count: ids.length }); navigate('/'); }
    else setPlan({ kind: 'ask', ids });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const run = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setImporting(true);
    setSheetTitle(null);
    setSyncError(null);
    try {
      // Chargement différé : le décodeur FIT est lourd, inutile au démarrage.
      const { importFiles } = await import('../lib/import/importFit');
      await afterImport(await importFiles(files));
    } finally {
      setImporting(false);
    }
  }, [afterImport]);

  const syncingRef = useRef(false);
  const sync = useCallback(async () => {
    if (syncingRef.current) return;
    syncingRef.current = true;
    setSyncing(true);
    setSyncError(null);
    setProgress('Connexion à Garmin…');
    try {
      const { syncGarmin } = await import('../lib/garmin');
      const res = await syncGarmin(setProgress);
      if (!res.length) {
        // Rien de nouveau : simple confirmation, sans feuille à fermer.
        setToast('Tout est à jour');
        setTimeout(() => setToast(null), 2000);
        return;
      }
      setSheetTitle(null);
      await afterImport(res);
    } catch (e) {
      setSheetTitle('Synchronisation impossible');
      setSyncError(e instanceof Error ? e.message : 'Erreur inattendue.');
      setPlan({ kind: 'none' });
      setResults([]);
    } finally {
      syncingRef.current = false;
      setSyncing(false);
      setProgress(null);
    }
  }, [afterImport]);

  // Arrivée depuis le menu « Partager » d'Android.
  const location = useLocation();
  const navigate = useNavigate();
  const sharedHandled = useRef(false);
  useEffect(() => {
    if (sharedHandled.current || !new URLSearchParams(location.search).has('partage')) return;
    sharedHandled.current = true;
    navigate('/', { replace: true });
    void takeSharedFiles().then(run);
  }, [location.search, navigate, run]);

  return (
    <Ctx.Provider value={{ openPicker: () => input.current?.click(), importing, sync: () => void sync(), syncing }}>
      {children}
      {/* Pas d'attribut accept : Android grise parfois les .fit (type MIME inconnu). On valide nous-mêmes. */}
      <input
        ref={input}
        type="file"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          void run(files);
        }}
      />
      {importing && (
        <div className="overlay-in fixed inset-0 z-50 grid place-items-center bg-black/30 backdrop-blur-[2px]">
          <div className="card flex items-center gap-3 px-5 py-4">
            <span className="size-5 animate-spin rounded-full border-2 border-accent border-t-transparent" />
            Analyse en cours…
          </div>
        </div>
      )}
      {/* Synchro : discrète, on peut continuer à naviguer pendant ce temps. */}
      {((syncing && progress) || toast) && (
        <div className="overlay-in pointer-events-none fixed inset-x-0 top-[calc(env(safe-area-inset-top)+0.75rem)] z-50 flex justify-center px-4" role="status">
          <div className="card flex items-center gap-2.5 rounded-full px-4 py-2 text-sm shadow-lg">
            {toast
              ? <Icon name="check" className="size-4 text-green-600 dark:text-green-400" />
              : <span className="size-4 animate-spin rounded-full border-2 border-accent border-t-transparent" />}
            {toast ?? progress}
          </div>
        </div>
      )}
      {results && (
        <ResultsSheet results={results} title={sheetTitle} error={syncError} plan={plan} onPlan={setPlan}
          onClose={() => setResults(null)} onGoCoach={() => navigate('/')} />
      )}
    </Ctx.Provider>
  );
}

const STATUS = {
  imported: { icon: 'check', cls: 'text-green-600 dark:text-green-400' },
  duplicate: { icon: 'copy', cls: 'text-slate-500' },
  rejected: { icon: 'alert', cls: 'text-amber-600 dark:text-amber-400' },
  error: { icon: 'x', cls: 'text-red-600 dark:text-red-400' },
} as const;

function DebriefNotice({ plan, onPlan, onClose, onGoCoach }: { plan: DebriefPlan; onPlan: (p: DebriefPlan) => void; onClose: () => void; onGoCoach: () => void }) {
  if (plan.kind === 'none') return null;
  const box = 'mt-3 rounded-xl bg-accent-soft/60 p-3 text-sm dark:bg-accent-soft/40';
  if (plan.kind === 'auto') {
    return <p className={box}>Le coach prépare {plan.count > 1 ? 'les débriefs' : 'le débrief'} : {plan.count > 1 ? 'ils arrivent' : 'il arrive'} dans votre fil de discussion.</p>;
  }
  if (plan.kind === 'no-key') {
    return (
      <p className={box}>
        Pas de débrief : aucune clé API n’est configurée.{' '}
        <Link to="/reglages" onClick={onClose} className="font-medium text-accent underline">Ouvrir les réglages</Link>
      </p>
    );
  }
  const n = plan.ids.length;
  return (
    <div className={box}>
      <p>
        {n} nouvelles séances. Les débriefer toutes ? Elles seront traitées une par une, de la plus ancienne à la plus récente
        (environ {Math.ceil((n * 15) / 60)} min).
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        <button className="h-10 rounded-lg bg-accent px-3 font-medium text-white dark:text-slate-950"
          onClick={() => { void enqueueDebriefs(plan.ids); onPlan({ kind: 'auto', count: n }); onGoCoach(); }}>
          Toutes ({n})
        </button>
        <button className="card h-10 px-3 font-medium"
          onClick={() => {
            // Identifiant = sport-dateISO : le tri sur la date donne la séance la plus récente.
            const latest = [...plan.ids].sort((a, b) => a.slice(a.indexOf('-') + 1).localeCompare(b.slice(b.indexOf('-') + 1))).slice(-1);
            void enqueueDebriefs(latest);
            onPlan({ kind: 'auto', count: 1 });
            onGoCoach();
          }}>
          Seulement la plus récente
        </button>
        <button className="muted h-10 px-3" onClick={() => onPlan({ kind: 'none' })}>Plus tard</button>
      </div>
    </div>
  );
}

function ResultsSheet({ results, title, error, plan, onPlan, onClose, onGoCoach }: {
  results: ImportResult[]; title: string | null; error: string | null; plan: DebriefPlan;
  onPlan: (p: DebriefPlan) => void; onClose: () => void; onGoCoach: () => void;
}) {
  const ok = results.filter((r) => r.status === 'imported').length;
  return (
    <div className="overlay-in fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={onClose}>
      <div
        className="sheet-in card max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-b-none p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label="Résultat de l'import"
      >
        <h2 className="text-lg font-semibold">
          {title ?? (ok === 0 ? 'Aucune nouvelle séance' : ok === 1 ? '1 séance importée' : `${ok} séances importées`)}
        </h2>
        {error && (
          <p className="mt-2 flex gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-700 dark:bg-red-950/40 dark:text-red-300">
            <Icon name="alert" className="mt-0.5 size-4 shrink-0" />{error}
          </p>
        )}
        <ul className="mt-3 space-y-2">
          {results.map((r, i) => {
            const s = STATUS[r.status];
            return (
              <li key={i} className="flex gap-3 rounded-xl bg-slate-50 p-3 dark:bg-slate-800/60">
                <Icon name={s.icon} className={`mt-0.5 size-5 shrink-0 ${s.cls}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{r.fileName}</p>
                  <p className="muted text-sm">{r.message}</p>
                </div>
                {r.activityId && (r.status === 'imported' || r.status === 'duplicate') && (
                  <Link to={`/seance/${encodeURIComponent(r.activityId)}`} onClick={onClose} className="self-center text-sm font-medium text-accent">
                    Voir
                  </Link>
                )}
              </li>
            );
          })}
        </ul>
        <DebriefNotice plan={plan} onPlan={onPlan} onClose={onClose} onGoCoach={onGoCoach} />
        <button onClick={onClose} className="mt-4 h-12 w-full rounded-xl bg-slate-900 font-medium text-white dark:bg-slate-100 dark:text-slate-900">
          Fermer
        </button>
      </div>
    </div>
  );
}
