import { db, getSettings, type DebriefContent } from '../db';
import { currentNotebook, MAX_WORDS, saveNotebook, wordCount } from '../notebook';
import { buildDebriefInput } from './context';
import { estimateCost, type Provider } from './models';
import { parseDebriefResponse, ParseError, RESPONSE_SCHEMA, SYSTEM_PROMPT } from './prompt';
import { callLlm, LlmError } from './providers';

const MAX_OUTPUT_TOKENS = 8000;

export async function getApiKey(provider: Provider): Promise<string | null> {
  return (await db.secrets.get(provider))?.key || null;
}

/** Message d'erreur lisible, sans jamais inclure la clé. */
function errorMessage(e: unknown): string {
  if (e instanceof LlmError) return e.message;
  if (e instanceof Error) return `Erreur inattendue : ${e.message}`;
  return 'Erreur inattendue.';
}

/** Génère (ou regénère) le débrief d'une séance et met à jour le carnet du coach. */
export async function generateDebrief(activityId: string): Promise<void> {
  const activity = await db.activities.get(activityId);
  if (!activity) return;
  const settings = await getSettings();
  const provider = settings.llm.provider;
  const model = settings.llm.model[provider];
  const apiKey = await getApiKey(provider);
  if (!apiKey) {
    await db.debriefs.put({ activityId, status: 'error', createdAt: Date.now(), error: 'Aucune clé API configurée. Ajoute-la dans les Réglages.' });
    return;
  }

  const previous = await db.debriefs.get(activityId);
  await db.debriefs.put({ ...previous, activityId, status: 'pending', createdAt: previous?.createdAt ?? Date.now() });

  const [history, done, notebook] = await Promise.all([
    db.activities.toArray(),
    db.debriefs.where('status').equals('done').toArray(),
    currentNotebook(),
  ]);
  const debriefMap = new Map<string, DebriefContent>(done.filter((d) => d.content).map((d) => [d.activityId, d.content!]));
  const input = buildDebriefInput(activity, history, notebook.text, debriefMap);
  const sentJson = JSON.stringify(input);

  try {
    const res = await callLlm({
      provider, model, apiKey,
      system: SYSTEM_PROMPT,
      user: `Voici les données de la séance à débriefer :\n${sentJson}`,
      schema: RESPONSE_SCHEMA as unknown as Record<string, unknown>,
      maxTokens: MAX_OUTPUT_TOKENS,
    });
    const cost = estimateCost(model, res.inputTokens, res.outputTokens);
    await db.llmCalls.add({ at: Date.now(), provider, model, activityId, kind: 'debrief', ok: true, inputTokens: res.inputTokens, outputTokens: res.outputTokens, costUsd: cost });

    const parsed = parseDebriefResponse(res.text);
    await db.debriefs.put({
      activityId, status: 'done', createdAt: Date.now(), content: parsed.debrief,
      provider, model, inputTokens: res.inputTokens, outputTokens: res.outputTokens, costUsd: cost, sentJson,
    });

    // Carnet : on n'écrase pas une modification faite par l'utilisateur pendant l'appel.
    const latest = await currentNotebook();
    if (parsed.carnet && latest.id === notebook.id && parsed.carnet !== notebook.text && wordCount(parsed.carnet) <= MAX_WORDS * 1.3) {
      await saveNotebook(parsed.carnet, 'coach', activityId);
    }
  } catch (e) {
    const msg = e instanceof ParseError ? `Réponse du modèle inexploitable : ${e.message}` : errorMessage(e);
    // Un appel facturé dont la réponse est illisible a déjà été journalisé ; sinon on note l'échec.
    if (!(e instanceof ParseError)) {
      await db.llmCalls.add({ at: Date.now(), provider, model, activityId, kind: 'debrief', ok: false, inputTokens: 0, outputTokens: 0, costUsd: 0, error: msg });
    }
    await db.debriefs.put({ ...previous, activityId, status: 'error', createdAt: Date.now(), error: msg, sentJson });
  }
}

/** Petit appel pour vérifier une clé. Retourne null si tout va bien, sinon le message d'erreur. */
export async function testApiKey(provider: Provider, model: string, apiKey: string): Promise<string | null> {
  try {
    const res = await callLlm({
      provider, model, apiKey,
      system: 'Tu réponds uniquement par le JSON demandé.',
      user: 'Test de connexion : renvoie {"ok": true}.',
      schema: { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'], additionalProperties: false },
      maxTokens: 1000,
    });
    const cost = estimateCost(model, res.inputTokens, res.outputTokens);
    await db.llmCalls.add({ at: Date.now(), provider, model, kind: 'test', ok: true, inputTokens: res.inputTokens, outputTokens: res.outputTokens, costUsd: cost });
    return null;
  } catch (e) {
    return errorMessage(e);
  }
}
