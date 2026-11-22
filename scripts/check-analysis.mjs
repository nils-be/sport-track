// Lance l'analyse de l'app sur les fichiers de samples/ et affiche le résultat (sans GPS).
// Usage : node scripts/check-analysis.mjs [fichier.fit] [--json]
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const { decodeFit } = await server.ssrLoadModule('/src/lib/fit/decode.ts');
  const { analyzeFit } = await server.ssrLoadModule('/src/lib/analysis/analyze.ts');
  const { defaultZones } = await server.ssrLoadModule('/src/lib/analysis/common.ts');
  const arg = process.argv.slice(2).find((a) => !a.startsWith('--'));
  const files = arg ? [arg] : readdirSync('samples').filter((f) => f.endsWith('.fit')).map((f) => join('samples', f));
  for (const f of files) {
    console.log(`\n===== ${f}`);
    const t0 = performance.now();
    const { activity, streams } = analyzeFit(decodeFit(new Uint8Array(readFileSync(f))), defaultZones(190));
    console.log(`analyse en ${Math.round(performance.now() - t0)} ms, ${streams?.t.length ?? 0} points de graphique`);
    if (process.argv.includes('--json')) { console.log(JSON.stringify(activity, null, 1)); continue; }
    const { running, swimming, ...rest } = activity;
    console.log(rest);
    if (running) {
      const { laps, kmSplits, ...r } = running;
      console.log(r);
      console.log('tours :', laps.map((l) => `${l.index}:${l.kind}:${Math.round(l.distanceM)}m@${l.paceSPerKm ?? '-'}`).join(' '));
      console.log('km :', kmSplits.map((k) => `${k.km}:${k.paceSPerKm}s/${k.avgHr}bpm/+${k.ascentM}`).join(' '));
    }
    if (swimming) {
      const { lengths, sets, ...s } = swimming;
      console.log(s);
      console.log('séries :'); for (const x of sets) console.log('  ', JSON.stringify(x));
      console.log('longueurs 1-6 :', lengths.slice(0, 6));
    }
  }
} finally {
  await server.close();
}
