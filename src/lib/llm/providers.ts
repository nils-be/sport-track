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
}

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

/** Erreur à afficher telle quelle à l'utilisateur. */
export class LlmError extends Error {
  constructor(message: string, readonly retryable = false) {
    super(message);
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
    if (e instanceof Anthropic.InternalServerError) throw new LlmError('Le service Claude est surchargé ou indisponible. Réessaie plus tard.', true);
    if (e instanceof Anthropic.APIConnectionError) throw new LlmError('Impossible de joindre l’API Claude (pas de connexion ?).', true);
    if (e instanceof Anthropic.APIError) throw new LlmError(`Erreur API Claude ${e.status ?? ''} : ${e.message}`, true);
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
  error?: { code?: number; message?: string; status?: string };
}

async function callGemini(req: LlmRequest): Promise<LlmResponse> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(req.model)}:generateContent`;
  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
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
  } catch {
    throw new LlmError('Impossible de joindre l’API Gemini (pas de connexion ?).', true);
  }
  let data: GeminiResponse;
  try {
    data = await res.json();
  } catch {
    throw new LlmError(`Réponse illisible de l’API Gemini (HTTP ${res.status}).`, true);
  }
  if (!res.ok || data.error) {
    const msg = data.error?.message ?? '';
    if (res.status === 400 && /api key/i.test(msg)) throw new LlmError('Clé API Gemini invalide. Vérifie-la dans les réglages.');
    if (res.status === 403) throw new LlmError('Accès refusé par l’API Gemini (clé ou projet non autorisé).');
    if (res.status === 404) throw new LlmError(`Modèle Gemini introuvable : ${req.model}.`);
    if (res.status === 429) throw new LlmError('Quota Gemini dépassé. Réessaie plus tard.', true);
    if (res.status >= 500) throw new LlmError('Le service Gemini est indisponible. Réessaie plus tard.', true);
    throw new LlmError(`Erreur API Gemini ${res.status} : ${msg}`);
  }
  if (data.promptFeedback?.blockReason) throw new LlmError(`Requête bloquée par Gemini (${data.promptFeedback.blockReason}).`);
  const cand = data.candidates?.[0];
  if (cand?.finishReason === 'MAX_TOKENS') throw new LlmError('Réponse tronquée (limite de longueur atteinte).', true);
  if (cand?.finishReason && cand.finishReason !== 'STOP') throw new LlmError(`Réponse interrompue par Gemini (${cand.finishReason}).`);
  const text = (cand?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? '').join('');
  const u = data.usageMetadata ?? {};
  return {
    text,
    inputTokens: u.promptTokenCount ?? 0,
    outputTokens: (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0),
    servedModel: data.modelVersion ?? req.model,
  };
}
