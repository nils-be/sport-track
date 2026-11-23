// Synchronisation avec Garmin Connect, via le relais Cloudflare (dossier relay/).
// L'API personnelle de Garmin refuse les appels directs depuis un navigateur ; le relais détient la clé Garmin,
// l'app ne connaît que son adresse et un secret partagé. Les fichiers récupérés passent par importFit, comme un import manuel.
import { unzipSync } from 'fflate';
import { db, getSettings, saveSettings } from './db';
import { fmtDate } from './format';
import { importFit, type ImportResult } from './import/importFit';

const DAY = 86_400_000;
/** Première synchro : on remonte jusqu'à 30 jours. Ensuite, depuis la dernière séance connue (avec 2 jours de marge). */
const FIRST_SYNC_DAYS = 30;
const MARGIN_DAYS = 2;
const PAGE = 50;
const MAX_PAGES = 4;

export interface GarminConfig { relayUrl: string; secret: string }

interface RemoteActivity {
  id: number;
  name: string | null;
  type: string;
  startGmt: string | null;
  distanceM: number | null;
  durationS: number | null;
}

export class GarminSyncError extends Error {}

export async function getGarminConfig(): Promise<GarminConfig | null> {
  const [s, secret] = await Promise.all([getSettings(), db.secrets.get('garmin')]);
  const relayUrl = s.garmin?.relayUrl?.trim();
  return relayUrl && secret?.key ? { relayUrl, secret: secret.key } : null;
}

const normalizeUrl = (u: string) => u.trim().replace(/\/+$/, '');

async function relay(cfg: GarminConfig, path: string): Promise<Response> {
  let res: Response;
  try {
    res = await fetch(normalizeUrl(cfg.relayUrl) + path, { headers: { 'X-App-Secret': cfg.secret }, cache: 'no-store' });
  } catch {
    throw new GarminSyncError('Relais Garmin injoignable. Vérifie ta connexion et l’adresse du relais.');
  }
  if (!res.ok) {
    let msg = `Le relais a répondu ${res.status}.`;
    try { msg = (await res.json()).error ?? msg; } catch { if (res.status === 403) msg = 'Origine refusée par le relais (ALLOWED_ORIGINS).'; }
    throw new GarminSyncError(msg);
  }
  return res;
}

/** Vérifie la configuration du relais : renvoie un message d'erreur, ou null si tout va bien. */
export async function testRelay(cfg: GarminConfig): Promise<string | null> {
  try {
    await relay(cfg, '/activities?limit=1');
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Échec du test.';
  }
}

const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);
/** « 2026-11-20 16:38:00 » (GMT) → horodatage. */
const parseGmt = (s: string | null) => (s ? Date.parse(s.replace(' ', 'T') + 'Z') : NaN);

/** Séance déjà présente (import manuel ou synchro précédente) : même départ à 2 minutes près. */
async function alreadyHave(startTime: number): Promise<boolean> {
  if (!Number.isFinite(startTime)) return false;
  return (await db.activities.where('startTime').between(startTime - 120_000, startTime + 120_000, true, true).count()) > 0;
}

/** Récupère les nouvelles séances course/natation sur Garmin Connect et les importe. */
export async function syncGarmin(onProgress?: (text: string) => void): Promise<ImportResult[]> {
  const cfg = await getGarminConfig();
  if (!cfg) throw new GarminSyncError('Synchronisation Garmin non configurée (Réglages › Garmin Connect).');

  const latest = await db.activities.orderBy('startTime').last();
  const since = latest ? latest.startTime - MARGIN_DAYS * DAY : Date.now() - FIRST_SYNC_DAYS * DAY;

  onProgress?.('Recherche des nouvelles séances…');
  const remote: RemoteActivity[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const q = new URLSearchParams({ start: isoDay(since), end: isoDay(Date.now() + DAY), offset: String(page * PAGE), limit: String(PAGE) });
    const data: { activities: RemoteActivity[]; count: number } = await (await relay(cfg, `/activities?${q}`)).json();
    remote.push(...data.activities);
    if (data.count < PAGE) break;
  }

  const todo: RemoteActivity[] = [];
  for (const a of remote) if (!(await alreadyHave(parseGmt(a.startGmt)))) todo.push(a);
  todo.sort((x, y) => parseGmt(x.startGmt) - parseGmt(y.startGmt));

  const results: ImportResult[] = [];
  for (const [i, a] of todo.entries()) {
    const start = parseGmt(a.startGmt);
    const label = `${a.name || 'Séance Garmin'}${Number.isFinite(start) ? ` · ${fmtDate(start)}` : ''}`;
    onProgress?.(`Téléchargement ${i + 1}/${todo.length}…`);
    try {
      const bytes = new Uint8Array(await (await relay(cfg, `/activities/${a.id}/fit`)).arrayBuffer());
      const zip = bytes[0] === 0x50 && bytes[1] === 0x4b;
      const fits = zip ? Object.values(unzipSync(bytes, { filter: (f) => f.name.toLowerCase().endsWith('.fit') })) : [bytes];
      if (!fits.length) { results.push({ fileName: label, status: 'rejected', message: 'Aucun fichier .fit reçu de Garmin.' }); continue; }
      for (const f of fits) results.push(await importFit(f, label));
    } catch (e) {
      results.push({ fileName: label, status: 'error', message: e instanceof Error ? e.message : 'Téléchargement impossible.' });
    }
  }

  const s = await getSettings();
  if (s.garmin) await saveSettings({ garmin: { ...s.garmin, lastSyncAt: Date.now() } });
  return results;
}
