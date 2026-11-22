// V2 : génération du plan de la semaine par le LLM (brouillon à valider ou modifier par l'utilisateur).
import type { Activity } from '../analysis/types';
import { db, getSettings, SESSION_KINDS, type DebriefContent, type PlannedSession, type SessionKind, type WeekPlan } from '../db';
import { currentNotebook } from '../notebook';
import { dayStart, DAYS, matchPlan, plannableDays } from '../planMatch';
import { addWeeks, DAY } from '../stats';
import { recentStats, sessionShort } from './context';
import { getApiKey } from './debrief';
import { estimateCost } from './models';
import { ParseError } from './prompt';
import { callLlm, LlmError } from './providers';


export const PLAN_SYSTEM_PROMPT = `Tu es le coach personnel d'un sportif amateur qui pratique la course à pied et la natation. Tu prépares son plan d'entraînement pour les jours indiqués de la semaine.

Tu reçois un JSON préparé par son application :
- "jours_a_planifier" : les seuls jours sur lesquels tu peux placer des séances.
- "note_de_la_semaine" : ses contraintes et envies pour cette semaine (disponibilités, déplacements, fatigue, douleur…). Elles sont prioritaires.
- "carnet_du_coach" : ses objectifs, son contexte, ses points forts et faibles.
- "statistiques_recentes" : son volume des dernières semaines et ses tendances.
- "seances_14_derniers_jours" et, si la semaine est entamée, "seances_deja_faites_cette_semaine".
- "bilan_semaine_precedente" (parfois) : ce qui était prévu et ce qui a été fait.

Règles du plan :
- Réaliste et progressif : volume hebdomadaire proche du volume récent (au plus environ +10 %), allégé si la note ou le carnet signalent fatigue, douleur ou manque de temps, ou si la semaine précédente a été peu suivie.
- Équilibré : une ou deux séances clés au maximum (qualité : seuil, fractionné, séries) et le reste en endurance facile ; jamais deux séances intenses de suite ; des jours sans séance pour récupérer (ne les liste pas).
- Cohérent avec les objectifs du carnet et avec les sports qu'il pratique réellement ces dernières semaines.
- Au plus une séance par jour, sauf si la note le demande explicitement.
- Chaque séance :
  - "titre" court (ex. « Footing facile », « 6 × 400 m », « Technique crawl ») ;
  - "description" structurée sur plusieurs lignes : « Échauffement : … », « Corps : … », « Retour au calme : … », avec des consignes concrètes ;
  - "duree_min" : durée totale prévue en minutes ;
  - "distance_km" : distance totale prévue en km (natation aussi en km, ex. 1.6), ou null si la séance se pilote au temps ;
  - "intensite" : zones cardiaques et/ou allure cible (ex. « Z2, ~6:00/km », « 2:10/100 m »).
- "resume" : 2 ou 3 phrases sur l'objectif de la semaine et sa logique, en tutoyant.
- En français. Réponds uniquement avec l'objet JSON demandé.`;

export const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    resume: { type: 'string' },
    seances: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          jour: { type: 'string', enum: [...DAYS] },
          sport: { type: 'string', enum: ['course', 'natation'] },
          type: { type: 'string', enum: [...SESSION_KINDS] },
          titre: { type: 'string' },
          description: { type: 'string' },
          duree_min: { type: 'integer' },
          distance_km: { anyOf: [{ type: 'number' }, { type: 'null' }] },
          intensite: { type: 'string' },
        },
        required: ['jour', 'sport', 'type', 'titre', 'description', 'duree_min', 'distance_km', 'intensite'],
        additionalProperties: false,
      },
    },
  },
  required: ['resume', 'seances'],
  additionalProperties: false,
} as const;

const longDay = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

export function buildPlanInput(weekStartMs: number, note: string, history: Activity[], notebook: string, debriefs: Map<string, DebriefContent>, prevPlan: WeekPlan | undefined, now = Date.now()) {
  const days = plannableDays(weekStartMs, now);
  const end = addWeeks(weekStartMs, 1);
  const past = history.filter((a) => a.startTime <= now);
  const last14 = past.filter((a) => a.startTime >= now - 14 * DAY).sort((x, y) => y.startTime - x.startTime);
  const thisWeek = past.filter((a) => a.startTime >= weekStartMs && a.startTime < end);
  let bilan: Record<string, unknown> | undefined;
  if (prevPlan) {
    const r = matchPlan(prevPlan, history, now);
    bilan = {
      statut: prevPlan.status === 'validated' ? 'validé' : 'brouillon non validé',
      seances_faites: `${r.done}/${r.total}`,
      manquees: r.matches.filter((m) => m.status === 'missed').map((m) => m.session.title),
      hors_plan: r.unplanned.length,
    };
  }
  return {
    date_du_jour: new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full' }).format(now),
    semaine: `du ${longDay.format(weekStartMs)} au ${longDay.format(end - DAY)}`,
    jours_a_planifier: days.map((d) => longDay.format(d)),
    note_de_la_semaine: note.trim() || '(aucune)',
    carnet_du_coach: notebook,
    statistiques_recentes: recentStats(now, history),
    seances_14_derniers_jours: last14.map((a) => ({ sport: a.sport === 'running' ? 'course' : 'natation', ...sessionShort(a, now, debriefs.get(a.id)) })),
    seances_deja_faites_cette_semaine: thisWeek.length ? thisWeek.map((a) => ({ sport: a.sport === 'running' ? 'course' : 'natation', ...sessionShort(a, now) })) : undefined,
    bilan_semaine_precedente: bilan,
  };
}

/** Parsing tolérant de la réponse ; seuls les jours planifiables sont gardés. */
export function parsePlanResponse(text: string, weekStartMs: number, allowedDays: number[]): { summary: string; sessions: PlannedSession[] } {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const first = t.indexOf('{'), last = t.lastIndexOf('}');
  if (first < 0 || last <= first) throw new ParseError('La réponse du modèle ne contient pas de JSON.');
  let o: { resume?: unknown; seances?: unknown };
  try { o = JSON.parse(t.slice(first, last + 1)); } catch { throw new ParseError('La réponse du modèle n’est pas un JSON valide.'); }
  const raw = Array.isArray(o.seances) ? o.seances : [];
  const sessions: PlannedSession[] = [];
  for (const r of raw as Record<string, unknown>[]) {
    const dayIdx = DAYS.indexOf(String(r.jour ?? '').toLowerCase() as (typeof DAYS)[number]);
    if (dayIdx < 0) continue;
    const date = dayStart(weekStartMs + dayIdx * DAY + 12 * 3600_000);
    if (!allowedDays.includes(date)) continue;
    const sport = String(r.sport).startsWith('nat') ? 'swimming' : 'running';
    const km = typeof r.distance_km === 'number' && r.distance_km > 0 ? r.distance_km : null;
    sessions.push({
      id: crypto.randomUUID(),
      date,
      sport,
      kind: (SESSION_KINDS as readonly string[]).includes(String(r.type)) ? (r.type as SessionKind) : 'endurance',
      title: String(r.titre ?? '').trim() || 'Séance',
      description: String(r.description ?? '').trim(),
      durationMin: typeof r.duree_min === 'number' && r.duree_min > 0 ? Math.round(r.duree_min) : null,
      // Natation : un nombre > 20 est sûrement en mètres.
      distanceM: km == null ? null : sport === 'swimming' && km > 20 ? Math.round(km) : Math.round(km * 1000),
      intensity: String(r.intensite ?? '').trim(),
    });
  }
  if (!sessions.length) throw new ParseError('Le plan reçu ne contient aucune séance exploitable.');
  sessions.sort((a, b) => a.date - b.date);
  return { summary: String(o.resume ?? '').trim(), sessions };
}

/** Génère (ou regénère) le brouillon du plan de la semaine. Lève une LlmError avec un message lisible en cas d'échec. */
export async function generatePlan(weekStartMs: number, note: string): Promise<void> {
  const settings = await getSettings();
  const provider = settings.llm.provider;
  const model = settings.llm.model[provider];
  const apiKey = await getApiKey(provider);
  if (!apiKey) throw new LlmError('Aucune clé API configurée. Ajoute-la dans les Réglages.');

  const [history, done, notebook, prevPlan, existing] = await Promise.all([
    db.activities.toArray(),
    db.debriefs.where('status').equals('done').toArray(),
    currentNotebook(),
    db.plans.get(addWeeks(weekStartMs, -1)),
    db.plans.get(weekStartMs),
  ]);
  const debriefs = new Map<string, DebriefContent>(done.filter((d) => d.content).map((d) => [d.activityId, d.content!]));
  const days = plannableDays(weekStartMs);
  if (!days.length) throw new LlmError('Cette semaine est terminée : rien à planifier.');
  const input = buildPlanInput(weekStartMs, note, history, notebook.text, debriefs, prevPlan);
  const sentJson = JSON.stringify(input);

  try {
    const res = await callLlm({
      provider, model, apiKey,
      system: PLAN_SYSTEM_PROMPT,
      user: `Voici les données pour préparer le plan :\n${sentJson}`,
      schema: PLAN_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: 10000,
    });
    const cost = estimateCost(model, res.inputTokens, res.outputTokens);
    await db.llmCalls.add({ at: Date.now(), provider, model, kind: 'plan', ok: true, inputTokens: res.inputTokens, outputTokens: res.outputTokens, costUsd: cost });
    const { summary, sessions } = parsePlanResponse(res.text, weekStartMs, days);
    await db.plans.put({
      weekStart: weekStartMs, status: 'draft', note, summary, sessions,
      createdAt: existing?.createdAt ?? Date.now(), updatedAt: Date.now(),
      provider, model, costUsd: cost, inputTokens: res.inputTokens, outputTokens: res.outputTokens, sentJson,
    });
  } catch (e) {
    if (e instanceof ParseError) throw new LlmError(`Plan inexploitable : ${e.message} Réessaie.`, true);
    if (e instanceof LlmError) {
      await db.llmCalls.add({ at: Date.now(), provider, model, kind: 'plan', ok: false, inputTokens: 0, outputTokens: 0, costUsd: 0, error: e.message });
    }
    throw e;
  }
}
