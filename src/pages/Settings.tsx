import { useLiveQuery } from 'dexie-react-hooks';
import AppBar from '../components/AppBar';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import Icon from '../components/Icon';
import Segmented from '../components/Segmented';
import { defaultZones, type ZoneSettings } from '../lib/analysis/common';
import { db, DEFAULT_SETTINGS, getSettings, saveSettings, type AppSettings } from '../lib/db';
import { MODELS, modelInfo, PROVIDER_LABEL, type Provider } from '../lib/llm/models';


const KEY_HELP: Record<Provider, ReactNode> = {
  claude: <>Crée une clé sur <a className="text-accent underline" href="https://platform.claude.com/settings/keys" target="_blank" rel="noreferrer">platform.claude.com</a> (Settings › API keys).</>,
  gemini: <>Crée une clé sur <a className="text-accent underline" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">aistudio.google.com</a>. Attention : avec le niveau gratuit, Google peut utiliser tes données pour améliorer ses modèles ; ce n’est pas le cas avec la facturation activée.</>,
};

export default function Settings() {
  const settings = useLiveQuery(() => getSettings(), []);
  if (!settings) return null;
  return (
    <div className="space-y-4">
      <AppBar back="/" title="Réglages" />
      <LlmSection s={settings} />
      <GarminSection s={settings} />
      <ZonesSection s={settings} />
      <DataSection />
    </div>
  );
}

function Card({ title, children, desc }: { title: string; desc?: ReactNode; children: ReactNode }) {
  return (
    <section className="card space-y-3 p-4">
      <div>
        <h2 className="font-semibold">{title}</h2>
        {desc && <p className="muted mt-0.5 text-sm">{desc}</p>}
      </div>
      {children}
    </section>
  );
}

// ───────────────────────────────────────────────────────────── Coach IA

function LlmSection({ s }: { s: AppSettings }) {
  const provider = s.llm.provider;
  const setProvider = (p: Provider) => saveSettings({ llm: { ...s.llm, provider: p } });
  const setModel = (id: string) => saveSettings({ llm: { ...s.llm, model: { ...s.llm.model, [provider]: id } } });

  return (
    <Card title="Coach IA" desc="Le modèle qui rédige les débriefs et tient le carnet du coach.">
      <Segmented options={(['claude', 'gemini'] as const).map((p) => ({ value: p, label: PROVIDER_LABEL[p] }))} value={provider} onChange={setProvider} />

      <fieldset className="space-y-2">
        <legend className="muted mb-1 text-xs font-semibold uppercase tracking-wide">Modèle</legend>
        {MODELS.filter((m) => m.provider === provider).map((m) => (
          <label key={m.id} className={`flex cursor-pointer items-start gap-3 rounded-xl p-3 ring-1 ${s.llm.model[provider] === m.id ? 'bg-accent-soft/50 ring-accent dark:bg-accent-soft/30' : 'ring-slate-200 dark:ring-slate-700'}`}>
            <input type="radio" name="model" className="mt-1 accent-[var(--color-accent)]" checked={s.llm.model[provider] === m.id} onChange={() => setModel(m.id)} />
            <span className="text-sm">
              <span className="font-medium">{m.label}</span>
              <span className="muted block text-xs">{m.note}</span>
            </span>
          </label>
        ))}
      </fieldset>

      <ApiKeyField provider={provider} model={s.llm.model[provider]} />
    </Card>
  );
}

function ApiKeyField({ provider, model }: { provider: Provider; model: string }) {
  const stored = useLiveQuery(() => db.secrets.get(provider), [provider]);
  const [value, setValue] = useState('');
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error' | 'busy'; msg: string } | null>(null);

  useEffect(() => { setValue(''); setStatus(null); }, [provider]);

  const save = async () => {
    const key = value.trim();
    if (!key) return;
    await db.secrets.put({ id: provider, key });
    setValue('');
    setShow(false);
    await test(key);
  };
  const test = async (key = stored?.key) => {
    if (!key) return;
    setStatus({ kind: 'busy', msg: 'Test de la clé…' });
    const { testApiKey } = await import('../lib/llm/debrief');
    const err = await testApiKey(provider, model, key);
    setStatus(err ? { kind: 'error', msg: err } : { kind: 'ok', msg: `Clé valide : ${modelInfo(model)?.label} répond.` });
  };
  const remove = async () => {
    if (!confirm('Supprimer la clé enregistrée sur cet appareil ?')) return;
    await db.secrets.delete(provider);
    setStatus(null);
  };

  return (
    <div className="space-y-2">
      <p className="muted text-xs font-semibold uppercase tracking-wide">Clé API {provider === 'claude' ? 'Claude' : 'Gemini'}</p>
      {stored?.key ? (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
          <Icon name="check" className="size-4 text-green-600 dark:text-green-400" />
          <span className="flex-1">Enregistrée sur cet appareil (••••{stored.key.slice(-4)})</span>
          <button onClick={() => test()} className="h-9 rounded-lg px-3 font-medium text-accent ring-1 ring-accent/40">Tester</button>
          <button onClick={remove} className="muted h-9 px-2" aria-label="Supprimer la clé"><Icon name="trash" className="size-4" /></button>
        </div>
      ) : (
        <p className="muted text-sm">Aucune clé enregistrée.</p>
      )}
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="flex gap-2">
        <div className="relative flex-1">
          <input
            type={show ? 'text' : 'password'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={stored?.key ? 'Remplacer la clé…' : 'Colle ta clé ici'}
            autoComplete="off"
            spellCheck={false}
            className="h-11 w-full rounded-xl bg-white pr-11 pl-3 text-sm ring-1 ring-slate-300 outline-none focus:ring-2 focus:ring-accent dark:bg-slate-900 dark:ring-slate-700"
          />
          <button type="button" onClick={() => setShow(!show)} className="muted absolute top-0 right-0 grid size-11 place-items-center" aria-label={show ? 'Masquer' : 'Afficher'}>
            <Icon name={show ? 'eyeOff' : 'eye'} className="size-4" />
          </button>
        </div>
        <button type="submit" disabled={!value.trim()} className="h-11 rounded-xl bg-accent px-4 text-sm font-medium text-white disabled:opacity-40 dark:text-slate-950">
          Enregistrer
        </button>
      </form>
      {status && (
        <p className={`text-sm whitespace-pre-line ${status.kind === 'ok' ? 'text-green-700 dark:text-green-400' : status.kind === 'error' ? 'text-red-700 dark:text-red-400' : 'muted'}`}>{status.msg}</p>
      )}
      <p className="muted text-xs leading-relaxed">
        {KEY_HELP[provider]} La clé reste uniquement dans ce navigateur, n’est envoyée qu’à {provider === 'claude' ? 'Anthropic' : 'Google'} et n’est jamais incluse dans les sauvegardes.
      </p>
    </div>
  );
}

// ───────────────────────────────────────────────────────────── Garmin

const inputCls = 'h-11 w-full rounded-xl bg-white px-3 text-sm ring-1 ring-slate-300 outline-none focus:ring-2 focus:ring-accent dark:bg-slate-900 dark:ring-slate-700';

/** Secret aléatoire (32 caractères) à recopier dans le relais avec « wrangler secret put APP_SECRET ». */
function randomSecret(): string {
  const b = crypto.getRandomValues(new Uint8Array(24));
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_');
}

function GarminSection({ s }: { s: AppSettings }) {
  const stored = useLiveQuery(() => db.secrets.get('garmin'), []);
  const [url, setUrl] = useState(s.garmin?.relayUrl ?? '');
  const [secret, setSecret] = useState('');
  const [show, setShow] = useState(false);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error' | 'busy'; msg: string } | null>(null);
  const configured = !!s.garmin?.relayUrl && !!stored?.key;

  const save = async () => {
    const relayUrl = url.trim().replace(/\/+$/, '');
    if (!/^https:\/\/\S+$/.test(relayUrl) && !/^http:\/\/localhost(:\d+)?/.test(relayUrl)) {
      setStatus({ kind: 'error', msg: 'Adresse invalide : elle doit commencer par https://' });
      return;
    }
    const key = secret.trim() || stored?.key;
    if (!key) { setStatus({ kind: 'error', msg: 'Renseigne le secret partagé.' }); return; }
    await saveSettings({ garmin: { ...s.garmin, relayUrl } });
    if (secret.trim()) await db.secrets.put({ id: 'garmin', key: secret.trim() });
    setSecret('');
    setShow(false);
    setUrl(relayUrl);
    await test({ relayUrl, secret: key });
  };
  const test = async (cfg = s.garmin?.relayUrl && stored?.key ? { relayUrl: s.garmin.relayUrl, secret: stored.key } : null) => {
    if (!cfg) return;
    setStatus({ kind: 'busy', msg: 'Test de la connexion…' });
    const { testRelay } = await import('../lib/garmin');
    const err = await testRelay(cfg);
    setStatus(err ? { kind: 'error', msg: err } : { kind: 'ok', msg: 'Connexion à Garmin Connect établie.' });
  };
  const remove = async () => {
    if (!confirm('Déconnecter Garmin sur cet appareil ? (le relais Cloudflare n’est pas supprimé)')) return;
    await db.secrets.delete('garmin');
    await saveSettings({ garmin: undefined });
    setUrl('');
    setStatus(null);
  };

  return (
    <Card title="Garmin Connect" desc="Synchronise tes séances depuis Garmin Connect avec le bouton ⟳ en haut de l’écran.">
      {configured && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
          <Icon name="check" className="size-4 text-green-600 dark:text-green-400" />
          <span className="min-w-0 flex-1">
            Connecté
            <span className="muted block truncate text-xs">
              {s.garmin?.lastSyncAt ? `Dernière synchro : ${new Date(s.garmin.lastSyncAt).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' })}` : 'Jamais synchronisé'}
            </span>
          </span>
          <button onClick={() => test()} className="h-9 rounded-lg px-3 font-medium text-accent ring-1 ring-accent/40">Tester</button>
          <button onClick={remove} className="muted h-9 px-2" aria-label="Déconnecter Garmin"><Icon name="trash" className="size-4" /></button>
        </div>
      )}
      <form onSubmit={(e) => { e.preventDefault(); void save(); }} className="space-y-2">
        <label className="block text-sm">
          <span className="muted text-xs">Adresse du relais</span>
          <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://sport-track-garmin.<compte>.workers.dev"
            inputMode="url" autoComplete="off" spellCheck={false} className={`mt-1 ${inputCls}`} />
        </label>
        <label className="block text-sm">
          <span className="muted flex items-center justify-between text-xs">
            Secret partagé
            {!stored?.key && <button type="button" onClick={() => { setSecret(randomSecret()); setShow(true); }} className="font-medium text-accent">Générer</button>}
          </span>
          <span className="relative mt-1 block">
            <input type={show ? 'text' : 'password'} value={secret} onChange={(e) => setSecret(e.target.value)}
              placeholder={stored?.key ? `Enregistré (••••${stored.key.slice(-4)})` : 'Le même que APP_SECRET du relais'}
              autoComplete="off" spellCheck={false} className={`${inputCls} pr-11 ${secret ? 'font-mono' : ''}`} />
            <button type="button" onClick={() => setShow(!show)} className="muted absolute top-0 right-0 grid size-11 place-items-center" aria-label={show ? 'Masquer' : 'Afficher'}>
              <Icon name={show ? 'eyeOff' : 'eye'} className="size-4" />
            </button>
          </span>
        </label>
        <button type="submit" disabled={!url.trim() || (!secret.trim() && !stored?.key)} className="h-10 rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-40 dark:text-slate-950">
          Enregistrer et tester
        </button>
      </form>
      {status && (
        <p className={`text-sm whitespace-pre-line ${status.kind === 'ok' ? 'text-green-700 dark:text-green-400' : status.kind === 'error' ? 'text-red-700 dark:text-red-400' : 'muted'}`}>{status.msg}</p>
      )}
      <p className="muted text-xs leading-relaxed">
        Garmin n’autorise pas l’appel direct depuis un navigateur : un petit relais Cloudflare (gratuit) détient ta clé API personnelle Garmin
        et ne transmet que la liste de tes séances de course et de natation et leurs fichiers FIT. Mise en place : README du projet, section
        « Synchronisation Garmin ». Le secret partagé reste sur cet appareil et n’est jamais inclus dans les sauvegardes.
      </p>
    </Card>
  );
}

// ───────────────────────────────────────────────────────────── Zones

function ZonesSection({ s }: { s: AppSettings }) {
  const [z, setZ] = useState<ZoneSettings>(s.zones);
  const [saved, setSaved] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const dirty = JSON.stringify(z) !== JSON.stringify(s.zones);
  const bounds = [z.lowerBound, ...z.upperBounds];
  const valid = bounds.every((b, i) => Number.isFinite(b) && b > 0 && (i === 0 || b > bounds[i - 1])) && z.upperBounds[4] <= z.maxHr;

  const setBound = (i: number, v: number) => {
    if (i === 0) setZ({ ...z, lowerBound: v });
    else { const u = [...z.upperBounds] as ZoneSettings['upperBounds']; u[i - 1] = v; setZ({ ...z, upperBounds: u }); }
    setSaved(false);
  };
  const save = async () => { await saveSettings({ zones: z }); setSaved(true); };
  const reanalyze = async () => {
    const { reanalyzeAll } = await import('../lib/import/reanalyze');
    const n = await reanalyzeAll((d, t) => setProgress(`Réanalyse ${d}/${t}…`));
    setProgress(`${n} séance${n > 1 ? 's' : ''} réanalysée${n > 1 ? 's' : ''}.`);
  };

  return (
    <Card title="Fréquence cardiaque" desc="Utilisées seulement si le fichier de la montre ne contient pas ses propres zones.">
      <div className="flex items-end gap-2">
        <label className="flex-1 text-sm">
          <span className="muted text-xs">FC max (bpm)</span>
          <input type="number" inputMode="numeric" value={z.maxHr || ''} onChange={(e) => { setZ({ ...z, maxHr: Number(e.target.value) }); setSaved(false); }}
            className="mt-1 h-11 w-full rounded-xl bg-white px-3 ring-1 ring-slate-300 outline-none focus:ring-2 focus:ring-accent dark:bg-slate-900 dark:ring-slate-700" />
        </label>
        <button onClick={() => { setZ(defaultZones(z.maxHr || DEFAULT_SETTINGS.zones.maxHr)); setSaved(false); }} className="h-11 rounded-xl px-3 text-sm font-medium text-accent ring-1 ring-accent/40">
          Zones par défaut
        </button>
      </div>
      <div className="grid grid-cols-6 gap-1.5 text-center text-xs">
        {['Début Z1', 'Fin Z1', 'Fin Z2', 'Fin Z3', 'Fin Z4', 'Fin Z5'].map((l, i) => (
          <label key={l}>
            <span className="muted block">{l}</span>
            <input type="number" inputMode="numeric" value={bounds[i] || ''} onChange={(e) => setBound(i, Number(e.target.value))}
              className="mt-1 h-10 w-full rounded-lg bg-white text-center ring-1 ring-slate-300 outline-none focus:ring-2 focus:ring-accent dark:bg-slate-900 dark:ring-slate-700" />
          </label>
        ))}
      </div>
      <p className="muted text-xs">Par défaut : 50, 60, 70, 80, 90 et 100 % de la FC max.</p>
      {!valid && <p className="text-xs text-amber-600 dark:text-amber-400">Les bornes doivent être croissantes et ne pas dépasser la FC max.</p>}
      <div className="flex flex-wrap gap-2">
        <button onClick={save} disabled={!dirty || !valid} className="h-10 rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-40 dark:text-slate-950">
          {saved && !dirty ? 'Enregistré' : 'Enregistrer'}
        </button>
        <button onClick={reanalyze} className="h-10 rounded-lg px-3 text-sm font-medium text-accent ring-1 ring-accent/40">Réanalyser les séances</button>
      </div>
      {progress && <p className="muted text-xs">{progress}</p>}
    </Card>
  );
}

// ───────────────────────────────────────────────────────────── Données

function DataSection() {
  const fitSize = useLiveQuery(async () => (await import('../lib/backup')).fitFilesSize(), []);
  const count = useLiveQuery(() => db.activities.count(), []);
  const [includeFit, setIncludeFit] = useState(true);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const mo = (b: number) => `${(b / 1_048_576).toLocaleString('fr-FR', { maximumFractionDigits: 1 })} Mo`;

  const doExport = async () => {
    const { exportBackup, downloadBlob } = await import('../lib/backup');
    const { blob, fileName, sessions } = await exportBackup(includeFit);
    downloadBlob(blob, fileName);
    setMsg({ ok: true, text: `Sauvegarde exportée : ${sessions} séance${sessions > 1 ? 's' : ''}, ${mo(blob.size)}.` });
  };

  const doRestore = async (file: File) => {
    const { readBackup, restoreBackup } = await import('../lib/backup');
    try {
      const data = await readBackup(file);
      const date = new Date(data.exportedAt).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });
      if (!confirm(`Restaurer la sauvegarde du ${date} (${data.activities.length} séances) ?\n\nToutes les données actuelles seront remplacées. Tes clés API sont conservées.`)) return;
      await restoreBackup(data);
      setMsg({ ok: true, text: `Sauvegarde restaurée : ${data.activities.length} séances.${data.fitFiles ? '' : ' (sans fichiers FIT : la réanalyse ne sera pas possible pour ces séances)'}` });
    } catch (e) {
      setMsg({ ok: false, text: e instanceof Error ? e.message : 'Restauration impossible.' });
    }
  };

  const doErase = async () => {
    if (!confirm('Effacer TOUTES les données de l’application sur cet appareil (séances, débriefs, carnet, coûts, réglages et clés API) ?')) return;
    if (prompt('Cette action est définitive. Tape EFFACER pour confirmer.')?.trim().toUpperCase() !== 'EFFACER') return;
    const { eraseEverything } = await import('../lib/backup');
    await eraseEverything();
    location.reload();
  };

  return (
    <Card title="Données" desc="Tout est stocké uniquement sur cet appareil. Exporte une sauvegarde régulièrement.">
      <label className="flex items-start gap-3 text-sm">
        <input type="checkbox" checked={includeFit} onChange={(e) => setIncludeFit(e.target.checked)} className="mt-1 size-4 accent-[var(--color-accent)]" />
        <span>
          Inclure les fichiers FIT d’origine{fitSize != null && ` (≈ ${mo(fitSize * 1.37)})`}
          <span className="muted block text-xs">Nécessaires pour réanalyser les séances après restauration. Ils contiennent tes traces GPS : garde la sauvegarde en lieu sûr.</span>
        </span>
      </label>
      <div className="flex flex-wrap gap-2">
        <button onClick={doExport} disabled={!count} className="h-10 rounded-lg bg-accent px-4 text-sm font-medium text-white disabled:opacity-40 dark:text-slate-950">Exporter une sauvegarde</button>
        <button onClick={() => fileInput.current?.click()} className="h-10 rounded-lg px-3 text-sm font-medium text-accent ring-1 ring-accent/40">Restaurer…</button>
        <input ref={fileInput} type="file" accept=".json,application/json" aria-label="Fichier de sauvegarde" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) void doRestore(f); }} />
      </div>
      <p className="muted text-xs">La sauvegarde contient tout sauf tes clés API.</p>
      {msg && <p className={`text-sm ${msg.ok ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400'}`}>{msg.text}</p>}
      <div className="border-t border-slate-100 pt-3 dark:border-slate-800">
        <button onClick={doErase} className="flex h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-red-600 ring-1 ring-red-300 dark:text-red-400 dark:ring-red-900">
          <Icon name="trash" className="size-4" /> Effacer toutes les données
        </button>
      </div>
    </Card>
  );
}
