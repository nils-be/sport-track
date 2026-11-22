// Chat de suivi avec le coach : un seul fil, qui contient aussi les débriefs.
import { db, getSettings, type DebriefContent } from '../db';
import { currentNotebook, MAX_WORDS, normalizeNotebook, NOTEBOOK_STRUCTURE_PROMPT, saveNotebook, wordCount } from '../notebook';
import { DAY } from '../stats';
import { messageForLlm, recentMessages } from '../thread';
import { recentStats, sessionDetail, sessionShort } from './context';
import { getApiKey } from './debrief';
import { estimateCost } from './models';
import { callLlm, LlmError, type LlmTurn } from './providers';

const MAX_HISTORY = 30;
const HISTORY_BUDGET_CHARS = 16_000;

export const CHAT_SYSTEM_PROMPT = `Tu es le coach personnel d'un sportif amateur (course à pied et natation). Vous échangez dans un fil de discussion sur son téléphone : il te parle de ses sensations, de ses contraintes, de ses séances, et tu l'accompagnes au jour le jour. Les débriefs de ses séances, que tu as rédigés, font partie de ce fil.

Le premier message contient le contexte préparé par son application (date du jour, carnet du coach, statistiques récentes, dernières séances avec le résumé et le conseil de leur débrief, détail de la dernière séance). Ce contexte est à jour ; sers-t'en sans le recopier.

Ton style :
- En français, tutoiement, ton de coach bienveillant mais franc : tu valides les bonnes décisions, tu dis clairement quand une idée est risquée.
- Très concret : jours, allures (min/km ou /100 m), zones, cadence, structure des séances (échauffement, corps de séance, récupération, retour au calme), hydratation et récupération quand c'est utile.
- Tu peux réorganiser les prochains jours (décaler une séance, alléger, garder 48 h entre deux efforts intenses) en l'expliquant brièvement.
- Appuie-toi sur les données ; n'invente aucun chiffre. Pas de diagnostic médical : en cas de douleur inhabituelle ou persistante, recommande la prudence et un professionnel.
- Si le message contient des séances jointes ("seances_jointes" dans le contexte), réponds à sa question en t'appuyant sur leurs données ; s'il n'a rien écrit, fais-en un retour concis.
- Pose une question de suivi quand une information te manque (par exemple, où sont les courbatures).
- Lisible sur un téléphone : réponses courtes à moyennes, en markdown simple (paragraphes, **gras**, listes à puces, titres ### si la réponse est longue). Pas de tableaux, pas de LaTeX ni de formules : écris « 4 × 1 000 m à 3:58/km ».

Le carnet du coach est ta mémoire durable. Dans "carnet", renvoie sa nouvelle version complète uniquement si l'échange apporte une information durable (douleur ou blessure, fatigue, objectif, disponibilités, séance déplacée, préférence) ; sinon renvoie null. Ne dépasse pas ${MAX_WORDS} mots. Range chaque information dans la bonne rubrique (disponibilités, préférences, santé, forme du moment…).
${NOTEBOOK_STRUCTURE_PROMPT}

Réponds uniquement avec l'objet JSON demandé : "reponse" (ton message, en markdown) et "carnet" (texte complet ou null).`;

const CHAT_SCHEMA = {
  type: 'object',
  properties: {
    reponse: { type: 'string' },
    carnet: { anyOf: [{ type: 'string' }, { type: 'null' }] },
  },
  required: ['reponse', 'carnet'],
  additionalProperties: false,
};

/** Parsing tolérant : si le modèle n'a pas renvoyé de JSON, son texte devient la réponse. */
export function parseChatResponse(text: string): { reponse: string; carnet: string | null } {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const first = t.indexOf('{'), last = t.lastIndexOf('}');
  if (first >= 0 && last > first) {
    try {
      const o = JSON.parse(t.slice(first, last + 1)) as { reponse?: unknown; carnet?: unknown };
      if (typeof o.reponse === 'string' && o.reponse.trim()) {
        return { reponse: o.reponse.trim(), carnet: typeof o.carnet === 'string' && o.carnet.trim() ? o.carnet.trim() : null };
      }
    } catch { /* on retombe sur le texte brut */ }
  }
  if (!t) throw new LlmError('Le coach n’a rien répondu. Réessaie.', true);
  return { reponse: t, carnet: null };
}

/** Contexte du chat, de taille bornée quel que soit l'historique. */
async function buildChatContext(now = Date.now()) {
  const [history, done, notebook] = await Promise.all([
    db.activities.toArray(),
    db.debriefs.where('status').equals('done').toArray(),
    currentNotebook(),
  ]);
  const debriefs = new Map<string, DebriefContent>(done.filter((d) => d.content).map((d) => [d.activityId, d.content!]));
  const recent = history.filter((a) => a.startTime <= now).sort((a, b) => b.startTime - a.startTime);
  const last = recent[0];
  return {
    notebook,
    context: {
      date_du_jour: new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full', timeStyle: 'short' }).format(now),
      carnet_du_coach: notebook.text,
      statistiques_recentes: recentStats(now, history),
      dernieres_seances: recent.slice(0, 8).map((a) => ({ sport: a.sport === 'running' ? 'course' : 'natation', ...sessionShort(a, now, debriefs.get(a.id)) })),
      derniere_seance_detail: last && now - last.startTime < 10 * DAY ? sessionDetail(last) : undefined,
    },
  };
}

/** Conversation récente sous forme de tours, dans un budget de caractères (les plus récents d'abord). */
async function conversationTurns(beforeAt: number): Promise<LlmTurn[]> {
  const msgs = (await recentMessages(MAX_HISTORY * 2)).filter((m) => m.at < beforeAt).slice(-MAX_HISTORY);
  const turns: LlmTurn[] = [];
  let budget = HISTORY_BUDGET_CHARS;
  for (const m of [...msgs].reverse()) {
    const text = await messageForLlm(m);
    if (budget - text.length < 0 && turns.length) break;
    budget -= text.length;
    turns.unshift({ role: m.role === 'user' ? 'user' : 'assistant', text });
  }
  return turns;
}

/**
 * Envoie un message au coach (avec d'éventuels fichiers .fit / .zip joints) et enregistre sa réponse.
 * Les fichiers joints sont importés sans débrief automatique : le coach y répond dans le cadre du message.
 */
export async function sendChatMessage(text: string, files: File[] = []): Promise<void> {
  const clean = text.trim();
  if (!clean && !files.length) return;
  let attachments: string[] | undefined, attachmentErrors: string[] | undefined;
  if (files.length) {
    const { importFiles } = await import('../import/importFit');
    const results = await importFiles(files);
    attachments = [...new Set(results.filter((r) => r.activityId && (r.status === 'imported' || r.status === 'duplicate')).map((r) => r.activityId!))];
    attachmentErrors = results.filter((r) => r.status === 'rejected' || r.status === 'error').map((r) => `${r.fileName} : ${r.message}`);
    void import('../places').then((m) => m.resolvePlaces());
  }
  const now = Date.now();
  await db.messages.add({
    at: now, role: 'user', kind: 'chat', text: clean, status: 'done',
    attachments: attachments?.length ? attachments : undefined,
    attachmentErrors: attachmentErrors?.length ? attachmentErrors : undefined,
  });
  if (!clean && !attachments?.length) return; // rien d'exploitable à envoyer au coach
  const coachId = await db.messages.add({ at: now + 1, role: 'coach', kind: 'chat', text: '', status: 'pending' });
  await respond(coachId as number);
}

/** Relance une réponse du coach en erreur. */
export async function retryChat(coachId: number): Promise<void> {
  await db.messages.update(coachId, { status: 'pending', error: undefined });
  await respond(coachId);
}

async function respond(coachId: number): Promise<void> {
  const placeholder = await db.messages.get(coachId);
  if (!placeholder) return;
  const settings = await getSettings();
  const provider = settings.llm.provider;
  const model = settings.llm.model[provider];
  try {
    const apiKey = await getApiKey(provider);
    if (!apiKey) throw new LlmError('Aucune clé API configurée. Ajoute-la dans les Réglages.');
    const { notebook, context } = await buildChatContext();
    // Séances jointes au dernier message de l'utilisateur : détail complet pour le coach.
    const lastUser = await db.messages.where('at').below(placeholder.at).reverse().filter((m) => m.role === 'user').first();
    if (lastUser?.attachments?.length) {
      const acts = (await db.activities.bulkGet(lastUser.attachments)).filter((a) => a != null);
      (context as Record<string, unknown>).seances_jointes = acts.map((a) => sessionDetail(a!));
    }
    const turns: LlmTurn[] = [
      { role: 'user', text: `Contexte préparé par l'application (à jour, ne pas recopier) :\n${JSON.stringify(context)}` },
      ...(await conversationTurns(placeholder.at)),
    ];
    const res = await callLlm({ provider, model, apiKey, system: CHAT_SYSTEM_PROMPT, messages: turns, schema: CHAT_SCHEMA, maxTokens: 6000 });
    const cost = estimateCost(model, res.inputTokens, res.outputTokens);
    await db.llmCalls.add({ at: Date.now(), provider, model, kind: 'chat', ok: true, inputTokens: res.inputTokens, outputTokens: res.outputTokens, costUsd: cost });
    const parsed = parseChatResponse(res.text);
    await db.messages.update(coachId, { status: 'done', text: parsed.reponse, error: undefined, model, costUsd: cost, inputTokens: res.inputTokens, outputTokens: res.outputTokens });

    // Carnet : seulement si le coach l'a mis à jour et que l'utilisateur ne l'a pas modifié entre-temps.
    const latest = await currentNotebook();
    if (parsed.carnet && latest.id === notebook.id && normalizeNotebook(parsed.carnet) !== notebook.text && wordCount(parsed.carnet) <= MAX_WORDS * 1.3) {
      await saveNotebook(parsed.carnet, 'coach');
    }
  } catch (e) {
    const msg = e instanceof LlmError ? e.message : e instanceof Error ? `Erreur inattendue : ${e.message}` : 'Erreur inattendue.';
    if (!msg.startsWith('Aucune clé')) {
      await db.llmCalls.add({ at: Date.now(), provider, model, kind: 'chat', ok: false, inputTokens: 0, outputTokens: 0, costUsd: 0, error: msg });
    }
    await db.messages.update(coachId, { status: 'error', error: msg });
  }
}
