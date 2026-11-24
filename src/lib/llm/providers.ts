import Anthropic from '@anthropic-ai/sdk';
import type { Provider } from './models';

export interface LlmRequest {
  provider: Provider;
  model: string;
  apiKey: string;
  system: string;
  /** Conversation : alterne user / assistant, commence et finit par user. */
  messages: LlmTurn[];
  /** Schéma JSON de la réponse attendue. */
  schema: Record<string, unknown>;
  maxTokens: number;
  /** Appelé avant chaque nouvel essai automatique (service surchargé, quota par minute…). */
  onRetry?: (info: RetryInfo) => void;
}

export interface RetryInfo {
  attempt: number;
  max: number;
  reason: string;
  delayS: number;
}

/** « Service surchargé : nouvel essai 2/4 dans 5 s… » */
export const retryLabel = (i: RetryInfo) =>
  `${i.reason.charAt(0).toUpperCase()}${i.reason.slice(1)} : nouvel essai ${i.attempt}/${i.max}${i.delayS ? ` dans ${i.delayS} s` : ''}…`;

export interface LlmTurn {
  role: 'user' | 'assistant';
  text: string;
}

/** Fusionne les tours consécutifs du même rôle et garantit un premier tour « user ». */
export function normalizeTurns(turns: LlmTurn[]): LlmTurn[] {
  const out: LlmTurn[] = [];
  for (const t of turns) {
    if (!t.text.trim()) continue;
    const last = out[out.length - 1];
    if (last && last.role === t.role) last.text += `\n\n${t.text}`;
    else out.push({ ...t });
  }
  if (out[0]?.role !== 'user') out.unshift({ role: 'user', text: '(début de la conversation)' });
  return out;
}

export interface LlmResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  /** Modèle ayant réellement répondu (peut différer en cas de repli). */
  servedModel: string;
}

/**
 * Erreur à afficher telle quelle à l'utilisateur. La première ligne résume ; les suivantes
 * (détail technique renvoyé par le service) s'affichent en plus petit.
 */
export class LlmError extends Error {
  constructor(message: string, readonly retryable = false, detail?: string) {
    super(detail ? `${message}\n${detail}` : message);
  }
}

export function callLlm(req: LlmRequest): Promise<LlmResponse> {
  return req.provider === 'claude' ? callClaude(req) : callGemini(req);
}

// ───────────────────────────────────────────────────────────── Claude

async function callClaude(req: LlmRequest): Promise<LlmResponse> {
  // Appel direct depuis le navigateur : le SDK ajoute l'en-tête
  // « anthropic-dangerous-direct-browser-access: true ». La clé ne quitte pas l'appareil autrement.
  const client = new Anthropic({ apiKey: req.apiKey, dangerouslyAllowBrowser: true, maxRetries: 2, timeout: 120_000 });
  const common = {
    model: req.model,
    max_tokens: req.maxTokens,
    system: req.system,
    messages: normalizeTurns(req.messages).map((t) => ({ role: t.role, content: t.text })),
    // Réflexion adaptative (par défaut) avec un effort bas : débrief court, coût minimal.
    output_config: {
      effort: 'low' as const,
      format: { type: 'json_schema' as const, schema: req.schema },
    },
  };
  try {
    // Sonnet 5.5 : repli automatique côté serveur si la requête est refusée par un filtre de sécurité.
    const res = req.model.startsWith('claude-sonnet')
      ? await client.beta.messages.create({ ...common, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })
      : await client.messages.create(common);

    if (res.stop_reason === 'refusal') throw new LlmError('Le modèle a refusé de répondre à cette demande.');
    if (res.stop_reason === 'max_tokens') throw new LlmError('Réponse tronquée (limite de longueur atteinte).', true);
    const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    const u = res.usage;
    return {
      text,
      inputTokens: u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0),
      outputTokens: u.output_tokens,
      servedModel: res.model,
    };
  } catch (e) {
    if (e instanceof LlmError) throw e;
    if (e instanceof Anthropic.AuthenticationError) throw new LlmError('Clé API Claude invalide. Vérifie-la dans les réglages.');
    if (e instanceof Anthropic.PermissionDeniedError) throw new LlmError('Accès refusé par l’API Claude (droits de la clé ou du compte).');
    if (e instanceof Anthropic.RateLimitError) throw new LlmError('Trop de requêtes ou crédit épuisé côté Claude. Réessaie plus tard.', true);
    if (e instanceof Anthropic.BadRequestError) throw new LlmError(`Requête refusée par l’API Claude : ${e.message}`);
    if (e instanceof Anthropic.InternalServerError) throw new LlmError('Le service Claude est surchargé ou indisponible (3 essais).', true, `HTTP ${e.status} · ${e.message.slice(0, 220)}`);
    if (e instanceof Anthropic.APIConnectionError) throw new LlmError('Impossible de joindre l’API Claude (pas de connexion ?).', true);
    if (e instanceof Anthropic.APIError) throw new LlmError(`Erreur API Claude ${e.status ?? ''}.`, true, e.message.slice(0, 220));
    throw e;
  }
}

// ───────────────────────────────────────────────────────────── Gemini

/** Le schéma Gemini n'accepte pas toujours additionalProperties : on le retire. */
function geminiSchema(s: unknown): unknown {
  if (Array.isArray(s)) return s.map(geminiSchema);
  if (s && typeof s === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s)) if (k !== 'additionalProperties') out[k] = geminiSchema(v);
    return out;
  }
  return s;
}

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; thoughtsTokenCount?: number };
  modelVersion?: string;
  error?: { code?: number; message?: string; status?: string; details?: { retryDelay?: string }[] };
}

const GEMINI_MAX_ATTEMPTS = 4;
const GEMINI_TIMEOUT_MS = 90_000;
/** Attente avant l'essai n (secondes), avec un peu d'aléa pour ne pas retomber pile sur le pic de charge. */
const backoffS = (n: number) => [2, 5, 10][n - 1] ?? 10;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Délai suggéré par Google dans une erreur 429 (RetryInfo « 12s »). */
function suggestedDelayS(data: GeminiResponse): number | null {
  for (const d of data.error?.details ?? []) {
    const m = typeof d.retryDelay === 'string' ? d.retryDelay.match(/^([\d.]+)s$/) : null;
    if (m) return Number(m[1]);
  }
  return null;
}

/** Échec d'un essai : relançable automatiquement ou non, avec le délai conseillé. */
class GeminiAttemptError extends LlmError {
  constructor(message: string, retryable: boolean, detail?: string, readonly label = '', readonly delayS?: number) {
    super(message, retryable, detail);
  }
}

async function callGemini(req: LlmRequest): Promise<LlmResponse> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await callGeminiOnce(req);
    } catch (e) {
      if (!(e instanceof GeminiAttemptError) || !e.retryable || attempt >= GEMINI_MAX_ATTEMPTS) {
        if (e instanceof GeminiAttemptError && e.retryable && attempt > 1) {
          throw new LlmError(`${e.message.split('\n')[0].replace(/\.$/, '')} (${attempt} essais).`, true, e.message.split('\n').slice(1).join('\n') || undefined);
        }
        throw e;
      }
      const delayS = Math.min(30, e.delayS ?? backoffS(attempt) * (0.8 + Math.random() * 0.4));
      req.onRetry?.({ attempt: attempt + 1, max: GEMINI_MAX_ATTEMPTS, reason: e.label, delayS: Math.round(delayS) });
      await sleep(delayS * 1000);
    }
  }
}

async function callGeminiOnce(req: LlmRequest): Promise<LlmResponse> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      // Clé dans l'en-tête plutôt que dans l'URL (évite qu'elle apparaisse dans des journaux).
      headers: { 'content-type': 'application/json', 'x-goog-api-key': req.apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: req.system }] },
        contents: normalizeTurns(req.messages).map((t) => ({ role: t.role === 'assistant' ? 'model' : 'user', parts: [{ text: t.text }] })),
        generationConfig: {
          responseMimeType: 'application/json',
          responseJsonSchema: geminiSchema(req.schema),
          maxOutputTokens: req.maxTokens,
          thinkingConfig: { thinkingLevel: 'LOW' },
        },
      }),
    });
  } catch (e) {
    if (e instanceof DOMException && e.name === 'TimeoutError') {
      throw new GeminiAttemptError('Gemini n’a pas répondu à temps.', true, `Pas de réponse au bout de ${GEMINI_TIMEOUT_MS / 1000} s.`, 'pas de réponse');
    }
    if (!navigator.onLine) throw new LlmError('Pas de connexion internet.', true);
    throw new GeminiAttemptError('Impossible de joindre l’API Gemini.', true, 'Connexion interrompue ou réseau instable.', 'connexion interrompue');
  }
  let data: GeminiResponse;
  try {
    data = await res.json();
  } catch {
    throw new GeminiAttemptError(`Réponse illisible de l’API Gemini (HTTP ${res.status}).`, res.status >= 500, undefined, `erreur ${res.status}`);
  }
  if (!res.ok || data.error) {
    const msg = data.error?.message ?? '';
    const code = `HTTP ${res.status}${data.error?.status ? ` ${data.error.status}` : ''}`;
    const detail = `${code}${msg ? ` · Google : « ${msg.length > 220 ? msg.slice(0, 220) + '…' : msg} »` : ''}`;
    if (res.status === 400 && /api key/i.test(msg)) throw new LlmError('Clé API Gemini invalide. Vérifie-la dans les Réglages.', false, detail);
    if (res.status === 403) throw new LlmError('Accès refusé par l’API Gemini (clé ou projet non autorisé).', false, detail);
    if (res.status === 404) throw new LlmError(`Modèle Gemini introuvable : ${req.model}.`, false, detail);
    if (res.status === 429) {
      // Quota par minute : on attend ce que Google demande. Quota journalier : inutile d'insister.
      const daily = /per.?day|daily/i.test(msg);
      const delay = suggestedDelayS(data);
      throw new GeminiAttemptError(
        daily ? 'Quota journalier Gemini atteint. Réessaie demain, ou change de modèle dans les Réglages.' : 'Trop de requêtes vers Gemini.',
        !daily && (delay == null || delay <= 30), detail, 'trop de requêtes', delay ?? undefined,
      );
    }
    if (res.status >= 500) {
      const overloaded = res.status === 503 || /overload|unavailable|high demand/i.test(msg);
      throw new GeminiAttemptError(
        overloaded ? 'Gemini est surchargé en ce moment.' : 'Erreur interne du service Gemini.',
        true, `${detail}\nCe n’est pas lié à l’app ni à ta clé. Si ça se répète, essaie l’autre modèle Gemini ou Claude (Réglages).`,
        overloaded ? 'service surchargé' : `erreur ${res.status}`,
      );
    }
    throw new LlmError(`Erreur API Gemini ${res.status}.`, false, detail);
  }
  if (data.promptFeedback?.blockReason) throw new LlmError(`Requête bloquée par Gemini (${data.promptFeedback.blockReason}).`);
  const cand = data.candidates?.[0];
  if (!cand) throw new GeminiAttemptError('Gemini a renvoyé une réponse vide.', true, undefined, 'réponse vide');
  if (cand.finishReason === 'MAX_TOKENS') throw new LlmError('Réponse tronquée (limite de longueur atteinte).', true);
  if (cand.finishReason && cand.finishReason !== 'STOP') throw new LlmError(`Réponse interrompue par Gemini (${cand.finishReason}).`);
  const text = (cand.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('');
  if (!text.trim()) throw new GeminiAttemptError('Gemini a renvoyé une réponse vide.', true, undefined, 'réponse vide');
  const u = data.usageMetadata ?? {};
  return {
    text,
    inputTokens: u.promptTokenCount ?? 0,
    outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
    servedModel: data.modelVersion ?? req.model,
  };
}
