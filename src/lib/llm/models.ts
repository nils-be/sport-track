// ─────────────────────────────────────────────────────────────────────────────
// Fichier unique des modèles LLM et de leurs tarifs. À mettre à jour ici seulement.
// Tarifs en dollars US par million de tokens, vérifiés le 22/11/2026 :
//   Claude : https://platform.claude.com/docs/en/about-claude/pricing
//   Gemini : https://aistudio.google.com/docs/pricing (tarif payant ; sorties = réponse + réflexion)
// ─────────────────────────────────────────────────────────────────────────────

export type Provider = 'claude' | 'gemini';

export interface ModelInfo {
  id: string;
  label: string;
  provider: Provider;
  /** $ / million de tokens d'entrée. */
  inputPerM: number;
  /** $ / million de tokens de sortie (réflexion comprise). */
  outputPerM: number;
  /** Tarif majoré au-delà d'une taille de prompt (ex. Haiku 5.5 > 100 000 tokens). */
  longPrompt?: { aboveTokens: number; inputPerM: number; outputPerM: number };
  /** Changement de tarif programmé. */
  priceChange?: { from: string; inputPerM: number; outputPerM: number };
  note?: string;
}

export const MODELS: ModelInfo[] = [
  {
    id: 'claude-haiku-5-5',
    label: 'Claude Haiku 5.5',
    provider: 'claude',
    inputPerM: 0.1,
    outputPerM: 0.5,
    longPrompt: { aboveTokens: 100_000, inputPerM: 0.5, outputPerM: 2.5 },
    note: 'Rapide (recommandé)',
  },
  {
    id: 'claude-sonnet-5-5',
    label: 'Claude Sonnet 5.5',
    provider: 'claude',
    inputPerM: 2,
    outputPerM: 10,
    note: 'Analyse plus fine, un peu plus lent',
  },
  {
    id: 'gemini-3.5-flash-lite',
    label: 'Gemini 3.5 Flash-Lite',
    provider: 'gemini',
    inputPerM: 0.3,
    outputPerM: 2.5,
    note: 'Rapide (recommandé)',
  },
  {
    id: 'gemini-4-hydrogen',
    label: 'Gemini 4 Hydrogen',
    provider: 'gemini',
    inputPerM: 1.5,
    outputPerM: 7.5,
    note: 'Plus récent et plus capable',
  },
];

export const DEFAULT_MODEL: Record<Provider, string> = {
  claude: 'claude-haiku-5-5',
  gemini: 'gemini-3.5-flash-lite',
};

export const PROVIDER_LABEL: Record<Provider, string> = { claude: 'Claude (Anthropic)', gemini: 'Gemini (Google)' };

export const modelInfo = (id: string): ModelInfo | undefined => MODELS.find((m) => m.id === id);

/** Coût estimé d'un appel, en dollars. */
export function estimateCost(modelId: string, inputTokens: number, outputTokens: number, at = new Date()): number {
  const m = modelInfo(modelId);
  if (!m) return 0;
  let inP = m.inputPerM, outP = m.outputPerM;
  if (m.priceChange && at >= new Date(m.priceChange.from)) { inP = m.priceChange.inputPerM; outP = m.priceChange.outputPerM; }
  if (m.longPrompt && inputTokens > m.longPrompt.aboveTokens) { inP = m.longPrompt.inputPerM; outP = m.longPrompt.outputPerM; }
  return (inputTokens * inP + outputTokens * outP) / 1_000_000;
}
