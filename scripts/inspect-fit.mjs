// Phase 0 : inspecte le contenu réel des fichiers FIT de samples/.
// Usage : node scripts/inspect-fit.mjs samples [--full]
// Les coordonnées GPS et les données de profil (poids, taille, âge…) sont masquées.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { Decoder, Stream } from '@garmin/fitsdk';

const target = process.argv[2] ?? 'samples';
const FULL = process.argv.includes('--full');

const SENSITIVE = /position|Lat$|Long$|^(nec|swc)|weight|height|gender|birth|serial|sleep|wake|hrv|stress|friendly_name/i;

const mask = (key, v) => {
  if (SENSITIVE.test(key)) return v === undefined || v === null ? v : '«masqué»';
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.length > 8 ? `[${v.slice(0, 8).join(', ')}, … (${v.length})]` : `[${v.join(', ')}]`;
  if (typeof v === 'number') return Math.round(v * 1000) / 1000;
  return v;
};

const files = statSync(target).isDirectory()
  ? readdirSync(target).filter((f) => extname(f).toLowerCase() === '.fit').map((f) => join(target, f))
  : [target];

const fmtDur = (s) => { if (s == null) return '-'; const r = Math.round(s); return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`; };

/** Couverture des champs d'un type de message : nb de messages où le champ est non nul + exemple. */
function fieldCoverage(mesgs) {
  const cov = {};
  for (const m of mesgs) {
    for (const [k, v] of Object.entries(m)) {
      if (v === undefined || v === null) continue;
      cov[k] ??= { n: 0, ex: mask(k, v) };
      cov[k].n++;
    }
  }
  return cov;
}

function printCoverage(name, mesgs) {
  const cov = fieldCoverage(mesgs);
  console.log(`\n  ▸ ${name} (${mesgs.length} messages)`);
  for (const [k, { n, ex }] of Object.entries(cov)) {
    const exStr = typeof ex === 'object' ? JSON.stringify(ex) : String(ex);
    console.log(`      ${k.padEnd(34)} ${String(n).padStart(5)}/${mesgs.length}   ex: ${exStr.slice(0, 70)}`);
  }
}

for (const file of files) {
  console.log('\n' + '═'.repeat(100));
  console.log(`FICHIER : ${file}`);
  console.log('═'.repeat(100));

  const stream = Stream.fromBuffer(readFileSync(file));
  const decoder = new Decoder(stream);
  console.log(`isFIT=${decoder.isFIT()}  checkIntegrity=${decoder.checkIntegrity()}`);

  const { messages, errors } = decoder.read({
    applyScaleAndOffset: true,
    expandSubFields: true,
    expandComponents: true,
    convertTypesToStrings: true,
    convertDateTimesToDates: true,
    includeUnknownData: false,
    mergeHeartRates: true,
  });
  if (errors.length) console.log('ERREURS :', errors.map((e) => e.message));

  console.log('\nTypes de messages présents :');
  for (const [k, v] of Object.entries(messages)) console.log(`  ${k.padEnd(32)} ${v.length}`);

  // --- Couverture des champs des messages clés ---
  const KEY = ['fileIdMesgs', 'sportMesgs', 'sessionMesgs', 'lapMesgs', 'lengthMesgs', 'splitMesgs',
    'splitSummaryMesgs', 'recordMesgs', 'hrZoneMesgs', 'zonesTargetMesgs', 'timeInZoneMesgs',
    'heartRateZoneMesgs', 'workoutMesgs', 'workoutStepMesgs', 'eventMesgs', 'deviceSettingsMesgs'];
  const shown = FULL ? Object.keys(messages) : KEY.filter((k) => messages[k]);
  console.log('\nChamps disponibles (non nuls / total, exemple) :');
  for (const k of shown) if (k !== 'userProfileMesgs') printCoverage(k, messages[k]);
  if (messages.userProfileMesgs) {
    console.log(`\n  ▸ userProfileMesgs : présent, champs = ${Object.keys(messages.userProfileMesgs[0]).join(', ')} (valeurs non affichées)`);
  }

  // --- Synthèse lisible ---
  const s = messages.sessionMesgs?.[0] ?? {};
  console.log('\nSYNTHÈSE SESSION :');
  console.log(`  sport=${s.sport} sub_sport=${s.subSport}  début=${mask('t', s.startTime)}`);
  console.log(`  durée=${fmtDur(s.totalTimerTime)} (écoulée ${fmtDur(s.totalElapsedTime)})  distance=${s.totalDistance} m`);
  console.log(`  FC moy/max=${s.avgHeartRate}/${s.maxHeartRate}  calories=${s.totalCalories}  D+/D-=${s.totalAscent}/${s.totalDescent}`);
  console.log(`  vitesse moy=${s.enhancedAvgSpeed ?? s.avgSpeed}  cadence moy=${s.avgRunningCadence ?? s.avgCadence}  bassin=${s.poolLength} ${s.poolLengthUnit ?? ''}`);
  console.log(`  longueurs=${s.numActiveLengths ?? '-'}  nage=${s.swimStroke ?? '-'}  SWOLF moy=${s.avgSwolf ?? '-'}  coups/longueur=${s.avgStrokeCount ?? '-'}`);

  console.log('\nTOURS :');
  for (const [i, l] of (messages.lapMesgs ?? []).entries()) {
    console.log(`  #${i + 1} dist=${l.totalDistance}m durée=${fmtDur(l.totalTimerTime)} FC=${l.avgHeartRate ?? '-'} vit=${mask('v', l.enhancedAvgSpeed ?? l.avgSpeed)} longueurs=${l.numActiveLengths ?? l.numLengths ?? '-'} nage=${l.swimStroke ?? '-'} swolf=${l.avgSwolf ?? '-'} trigger=${l.lapTrigger} intensité=${l.intensity ?? '-'}`);
  }

  if (messages.lengthMesgs?.length) {
    console.log('\nLONGUEURS (20 premières) :');
    for (const [i, l] of messages.lengthMesgs.slice(0, 20).entries()) {
      console.log(`  #${i + 1} type=${l.lengthType} nage=${l.swimStroke ?? '-'} durée=${fmtDur(l.totalTimerTime)} mouvements=${l.totalStrokes ?? '-'} cadence=${l.avgSwimmingCadence ?? '-'} FC=${l.avgHeartRate ?? '-'}`);
    }
    const types = {};
    for (const l of messages.lengthMesgs) types[`${l.lengthType}/${l.swimStroke ?? '-'}`] = (types[`${l.lengthType}/${l.swimStroke ?? '-'}`] ?? 0) + 1;
    console.log('  répartition type/nage :', types);
  }

  const rec = messages.recordMesgs ?? [];
  if (rec.length) {
    const t0 = rec[0].timestamp, t1 = rec.at(-1).timestamp;
    console.log(`\nDONNÉES PAR SECONDE : ${rec.length} points sur ${fmtDur((t1 - t0) / 1000)} (≈ ${((t1 - t0) / 1000 / rec.length).toFixed(2)} s/pt)`);
    const withHr = rec.filter((r) => r.heartRate != null).length;
    console.log(`  points avec FC : ${withHr}/${rec.length}`);
  }
}
