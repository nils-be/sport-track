// Affiche le JSON envoyé au LLM pour la dernière séance de samples/ (les autres servent d'historique).
// Usage : node scripts/preview-prompt.mjs
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { decodeFit } = await server.ssrLoadModule('/src/lib/fit/decode.ts');
  const { analyzeFit } = await server.ssrLoadModule('/src/lib/analysis/analyze.ts');
  const { defaultZones } = await server.ssrLoadModule('/src/lib/analysis/common.ts');
  const { buildDebriefInput } = await server.ssrLoadModule('/src/lib/llm/context.ts');
  const { SYSTEM_PROMPT } = await server.ssrLoadModule('/src/lib/llm/prompt.ts');
  const { INITIAL_NOTEBOOK } = await server.ssrLoadModule('/src/lib/notebook.ts');
  const acts = readdirSync('samples').filter((f) => f.endsWith('.fit'))
    .map((f) => analyzeFit(decodeFit(new Uint8Array(readFileSync(join('samples', f)))), defaultZones(190)).activity)
    .sort((a, b) => a.startTime - b.startTime);
  for (const a of acts) {
    const input = buildDebriefInput(a, acts, INITIAL_NOTEBOOK, new Map());
    const json = JSON.stringify(input);
    console.log(`\n===== ${a.id} : ${json.length} caractères (≈ ${Math.round((json.length + SYSTEM_PROMPT.length) / 3.2)} tokens avec la consigne)`);
    console.log(JSON.stringify(input, null, 1));
  }
} finally {
  await server.close();
}
