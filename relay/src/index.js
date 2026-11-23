// Relais Garmin Connect (Cloudflare Worker) pour Sport Track.
//
// L'API personnelle de Garmin refuse les appels depuis un navigateur (CORS) : ce relais s'en charge.
// - La clé API personnelle Garmin reste ici, en secret (GARMIN_API_KEY), jamais dans l'app.
// - Il l'échange contre un jeton d'accès (valable 24 h), gardé en mémoire et renouvelé 1 h avant expiration.
// - Il n'accepte que les requêtes de l'app (secret partagé APP_SECRET + origine autorisée).
// - Il ne transmet que deux appels, en lecture : la liste des séances course/natation, et le fichier
//   d'origine d'une séance. Rien d'autre (ni santé, ni sommeil, ni poids…).

const GARMIN = 'https://personal.connectapi.garmin.com';
const TOKEN_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';
const SEARCH_PATH = '/activitylist-service/activities/search/activities';
const DOWNLOAD_PATH = '/download-service/files/activity/';
const REFRESH_MARGIN_S = 3600;
const MAX_LIMIT = 50;

/** Types d'activité Garmin acceptés (course et natation, toutes variantes). */
const SPORT_TYPE = /run|swim/i;

let cached = null; // { token, exp } — partagé entre les requêtes d'une même instance

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function jwtExp(token) {
  try {
    const p = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(p + '='.repeat((4 - (p.length % 4)) % 4))).exp;
  } catch {
    return Date.now() / 1000 + 3600; // format inattendu : on le garde une heure
  }
}

async function accessToken(env, force = false) {
  if (!force && cached && cached.exp - Date.now() / 1000 > REFRESH_MARGIN_S) return cached.token;
  if (!env.GARMIN_API_KEY) throw new HttpError(500, 'Secret GARMIN_API_KEY absent du relais.');
  const res = await fetch(GARMIN + TOKEN_PATH, {
    method: 'POST',
    headers: { Accept: '*/*', Authorization: `ApiKey ${env.GARMIN_API_KEY}` },
  });
  if (res.status === 401 || res.status === 403) throw new HttpError(502, 'Clé API Garmin refusée : elle a peut-être expiré. Crée-en une nouvelle dans Garmin Connect.');
  if (!res.ok) throw new HttpError(502, `Garmin a refusé la demande de jeton (${res.status}).`);
  const token = (await res.text()).trim();
  cached = { token, exp: jwtExp(token) };
  return token;
}

/** Appel Garmin authentifié ; un 401 déclenche un seul renouvellement du jeton. */
async function garmin(env, path, accept) {
  for (const force of [false, true]) {
    const res = await fetch(GARMIN + path, {
      headers: { Accept: accept, Authorization: `Bearer ${await accessToken(env, force)}` },
    });
    if (res.status === 401 && !force) { cached = null; continue; }
    if (res.status === 429) throw new HttpError(429, 'Garmin limite le nombre de requêtes : réessaie plus tard.');
    if (!res.ok) throw new HttpError(502, `Garmin a répondu ${res.status}.`);
    return res;
  }
}

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);

async function listActivities(env, url) {
  const start = url.searchParams.get('start');
  const end = url.searchParams.get('end');
  const offset = Math.max(0, Number(url.searchParams.get('offset')) || 0);
  const limit = Math.min(MAX_LIMIT, Math.max(1, Number(url.searchParams.get('limit')) || 20));
  if ((start && !isDate(start)) || (end && !isDate(end))) throw new HttpError(400, 'Date invalide (attendu : AAAA-MM-JJ).');
  const q = new URLSearchParams({ start: String(offset), limit: String(limit) });
  if (start) q.set('startDate', start);
  if (end) q.set('endDate', end);
  const raw = await (await garmin(env, `${SEARCH_PATH}?${q}`, 'application/json')).json();
  const list = Array.isArray(raw) ? raw : (raw?.activityList ?? raw?.activities ?? []);
  // On ne renvoie que le strict nécessaire, et seulement course / natation.
  const activities = list
    .map((a) => ({
      id: a.activityId,
      name: a.activityName ?? null,
      type: a.activityType?.typeKey ?? null,
      startGmt: a.startTimeGMT ?? null,
      distanceM: a.distance ?? null,
      durationS: a.duration ?? null,
    }))
    .filter((a) => a.id && a.type && SPORT_TYPE.test(a.type));
  return Response.json({ activities, count: list.length, offset, limit });
}

async function downloadFit(env, id) {
  const res = await garmin(env, DOWNLOAD_PATH + id, 'application/zip, application/x-zip-compressed, application/octet-stream');
  return new Response(res.body, { headers: { 'Content-Type': res.headers.get('Content-Type') ?? 'application/zip' } });
}

/** Comparaison en temps constant du secret partagé. */
function sameSecret(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

function cors(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!origin || !allowed.includes(origin)) return null;
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'X-App-Secret',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

export default {
  async fetch(request, env) {
    const corsHeaders = cors(request.headers.get('Origin'), env);
    if (!corsHeaders) return new Response('Origine non autorisée', { status: 403 });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

    let res;
    try {
      if (request.method !== 'GET') throw new HttpError(405, 'Méthode non autorisée.');
      if (!sameSecret(request.headers.get('X-App-Secret'), env.APP_SECRET)) throw new HttpError(401, 'Secret de l’app incorrect.');
      const url = new URL(request.url);
      const fit = url.pathname.match(/^\/activities\/(\d{1,20})\/fit$/);
      if (url.pathname === '/activities') res = await listActivities(env, url);
      else if (fit) res = await downloadFit(env, fit[1]);
      else throw new HttpError(404, 'Chemin inconnu.');
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      res = Response.json({ error: e instanceof HttpError ? e.message : 'Erreur interne du relais.' }, { status });
    }
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(corsHeaders)) out.headers.set(k, v);
    out.headers.set('Cache-Control', 'no-store');
    return out;
  },
};
