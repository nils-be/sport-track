// Prépare le JSON compact envoyé au LLM. Jamais de données seconde par seconde :
// uniquement des indicateurs calculés, de taille à peu près constante quel que soit l'historique.
import type { Activity, RunLap } from '../analysis/types';
import type { DebriefContent, PlannedSession } from '../db';
import { fmtDuration, fmtPace, LAP_KIND_LABEL, STROKE_LABEL, VARIANT_LABEL } from '../format';
import { addWeeks, DAY, weekStart } from '../stats';

const r1 = (x: number) => Math.round(x * 10) / 10;
const r2 = (x: number) => Math.round(x * 100) / 100;
const km = (m: number) => r2(m / 1000);

const dateFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
const shortDate = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });

const sportLabel = (a: Activity) => (a.sport === 'running' ? 'course' : 'natation');

function zonesSummary(a: Activity) {
  const z = a.hrZones;
  if (!z) return undefined;
  const total = z.timeInZoneS.reduce((s, x) => s + x, 0) + z.belowZ1S || 1;
  return {
    source: z.source === 'fit' ? 'montre' : 'réglages',
    fc_max_reference: z.maxHr,
    bornes: `Z1 ${z.lowerBound}-${z.upperBounds[0]}, Z2 -${z.upperBounds[1]}, Z3 -${z.upperBounds[2]}, Z4 -${z.upperBounds[3]}, Z5 -${z.upperBounds[4]}`,
    minutes: Object.fromEntries(z.timeInZoneS.map((t, i) => [`Z${i + 1}`, Math.round(t / 60)])),
    pourcentages: Object.fromEntries(z.timeInZoneS.map((t, i) => [`Z${i + 1}`, Math.round((t / total) * 100)])),
  };
}

/** Résumé détaillé de la séance à débriefer. */
export function sessionDetail(a: Activity) {
  const base = {
    date: dateFmt.format(a.startTime),
    sport: sportLabel(a),
    type: VARIANT_LABEL[a.variant],
    duree: fmtDuration(a.durationS),
    duree_ecoulee: a.elapsedS - a.durationS > 60 ? fmtDuration(a.elapsedS) : undefined,
    fc_moy: a.avgHr ?? undefined,
    fc_max: a.maxHr ?? undefined,
    calories: a.calories ?? undefined,
    zones_cardiaques: zonesSummary(a),
  };

  if (a.running) {
    const r = a.running;
    const laps = r.laps.slice(0, 40).map((l) =>
      [`#${l.index}`, l.kind !== 'steady' ? LAP_KIND_LABEL[l.kind] : null, `${l.distanceM >= 1000 ? `${km(l.distanceM)} km` : `${Math.round(l.distanceM)} m`}`,
        fmtDuration(l.durationS), l.paceSPerKm ? `${fmtPace(l.paceSPerKm)}/km` : null, l.avgHr ? `FC ${l.avgHr}` : null,
        l.cadenceSpm ? `cad ${l.cadenceSpm}` : null].filter(Boolean).join(' '));
    return {
      ...base,
      distance_km: km(a.distanceM),
      allure_moy: `${fmtPace(r.avgPaceSPerKm)}/km`,
      allure_ajustee_pente: r.gradeAdjustedPaceSPerKm ? `${fmtPace(r.gradeAdjustedPaceSPerKm)}/km` : undefined,
      denivele: r.ascentM != null ? `+${r.ascentM} m / -${r.descentM ?? 0} m` : undefined,
      cadence_pas_min: r.avgCadenceSpm ?? undefined,
      fractionne: r.isInterval,
      structure: r.isInterval
        ? r.structure.map((s) => `${s.kind === 'steady' ? 'continu' : LAP_KIND_LABEL[s.kind]} : ${s.count} × (${km(s.distanceM)} km en ${fmtDuration(s.durationS)})`)
        : undefined,
      blocs_effort: r.isInterval ? effortBlocks(r.laps) : undefined,
      tours: r.laps.length > 1 ? laps : undefined,
      tours_tronques: r.laps.length > 40 ? `${r.laps.length - 40} tours supplémentaires non listés` : undefined,
      km: r.kmSplits.slice(0, 45).map((k) => `${k.km}: ${fmtPace(k.paceSPerKm)}${k.avgHr ? ` FC ${k.avgHr}` : ''}${k.ascentM ? ` +${k.ascentM}m` : ''}${k.distanceM !== 1000 ? ` (${k.distanceM} m)` : ''}`),
      derive_cardiaque: r.cardiacDrift.applicable
        ? { decouplage_pct: r.cardiacDrift.decouplingPct, premiere_moitie: `${fmtPace(r.cardiacDrift.firstHalf!.paceSPerKm)}/km FC ${r.cardiacDrift.firstHalf!.avgHr}`, seconde_moitie: `${fmtPace(r.cardiacDrift.secondHalf!.paceSPerKm)}/km FC ${r.cardiacDrift.secondHalf!.avgHr}` }
        : `non applicable (${r.cardiacDrift.reason})`,
      meilleurs_temps: Object.fromEntries(r.bestEfforts.map((b) => [effortLabel(b.distanceM), fmtDuration(b.durationS)])),
      autres: a.extras.aerobicTE ? { training_effect_aerobie: a.extras.aerobicTE, training_effect_anaerobie: a.extras.anaerobicTE } : undefined,
    };
  }

  const s = a.swimming!;
  return {
    ...base,
    distance_m: Math.round(a.distanceM),
    bassin_m: s.poolLengthM ?? undefined,
    temps_nage: fmtDuration(s.activeTimeS),
    temps_repos: fmtDuration(s.restTimeS),
    allure_moy_100m: fmtPace(s.avgPace100S),
    swolf_moy: s.avgSwolf ?? undefined,
    mouvements_par_longueur: s.avgStrokesPerLength ?? undefined,
    nages: Object.fromEntries(s.strokeBreakdown.map((b) => [STROKE_LABEL[b.stroke], `${b.distanceM} m`])),
    series: s.sets.map((x) => x.kind === 'rest'
      ? `repos ${fmtDuration(x.durationS)}`
      : [`${x.distanceM} m`, x.stroke ? STROKE_LABEL[x.stroke] : null, fmtDuration(x.durationS), x.pace100S ? `${fmtPace(x.pace100S)}/100m` : null,
        x.swolf ? `swolf ${x.swolf}` : null, x.avgHr ? `FC ${x.avgHr}` : null].filter(Boolean).join(' ')).slice(0, 60),
    longueurs_suspectes: s.suspectLengths || undefined,
    note_donnees: s.suspectLengths ? 'Certaines longueurs ont été mal détectées par la montre (distance d’une série possiblement surestimée).' : undefined,
    meilleurs_temps: Object.fromEntries(s.bestEfforts.map((b) => [`${b.distanceM} m`, fmtDuration(b.durationS)])),
  };
}

/** Regroupe les efforts consécutifs de distance voisine : « 12 × 306 m à 3:36/km (FC 168) ». */
export function effortBlocks(laps: RunLap[]): string[] {
  const blocks: RunLap[][] = [];
  for (const l of laps.filter((x) => x.kind === 'effort')) {
    const cur = blocks[blocks.length - 1];
    if (cur && Math.abs(l.distanceM - cur[0].distanceM) <= 0.25 * cur[0].distanceM) cur.push(l);
    else blocks.push([l]);
  }
  return blocks.map((b) => {
    const d = b.reduce((s, l) => s + l.distanceM, 0), t = b.reduce((s, l) => s + l.durationS, 0);
    const hrs = b.filter((l) => l.avgHr).map((l) => l.avgHr!);
    const avgD = d / b.length;
    const dist = avgD >= 950 ? `${r2(avgD / 1000)} km` : `${Math.round(avgD)} m`;
    const paces = b.map((l) => l.paceSPerKm).filter((p): p is number => p != null);
    const range = b.length > 1 && paces.length ? ` (de ${fmtPace(Math.max(...paces))} à ${fmtPace(Math.min(...paces))})` : '';
    return `${b.length} × ${dist} à ${fmtPace((t / d) * 1000)}/km${range}${hrs.length ? `, FC moy ${Math.round(hrs.reduce((s, x) => s + x, 0) / hrs.length)}` : ''}`;
  });
}

const effortLabel = (d: number) => (d === 21097 ? 'semi' : d === 42195 ? 'marathon' : `${d / 1000} km`);

/** Résumé court d'une séance passée comparable. */
export function sessionShort(a: Activity, ref: number, debrief?: DebriefContent) {
  const common = {
    date: shortDate.format(a.startTime),
    il_y_a_jours: Math.round((ref - a.startTime) / DAY),
    type: VARIANT_LABEL[a.variant],
    duree: fmtDuration(a.durationS),
    fc_moy: a.avgHr ?? undefined,
  };
  const prev = debrief ? { resume_debrief: debrief.titre, conseil_donne: debrief.conseil } : {};
  if (a.running) {
    return {
      ...common,
      distance_km: km(a.distanceM),
      allure_moy: `${fmtPace(a.running.avgPaceSPerKm)}/km`,
      fractionne: a.running.isInterval || undefined,
      blocs_effort: a.running.isInterval ? effortBlocks(a.running.laps).join(' ; ') : undefined,
      derive_cardiaque_pct: a.running.cardiacDrift.decouplingPct,
      ...prev,
    };
  }
  const s = a.swimming!;
  return {
    ...common,
    distance_m: Math.round(a.distanceM),
    allure_moy_100m: fmtPace(s.avgPace100S),
    swolf_moy: s.avgSwolf ?? undefined,
    series: s.sets.filter((x) => x.kind === 'swim').length,
    ...prev,
  };
}

/** Les 2-3 séances passées les plus proches : même sport, même type d'effort, distance voisine, récentes. */
export function comparableSessions(a: Activity, history: Activity[], n = 3): Activity[] {
  const interval = (x: Activity) => x.running?.isInterval ?? false;
  return history
    .filter((h) => h.id !== a.id && h.sport === a.sport && h.startTime < a.startTime && a.startTime - h.startTime < 365 * DAY && h.distanceM > 0)
    .map((h) => {
      let score = Math.abs(Math.log(h.distanceM / Math.max(a.distanceM, 1))) * 3;
      if (interval(h) !== interval(a)) score += 2;
      if (h.variant !== a.variant) score += 0.5;
      score += (a.startTime - h.startTime) / (120 * DAY);
      return { h, score };
    })
    .sort((x, y) => x.score - y.score)
    .slice(0, n)
    .map((x) => x.h);
}

function volume(list: Activity[]) {
  return {
    seances: list.length,
    distance_km: km(list.reduce((s, x) => s + x.distanceM, 0)),
    duree: fmtDuration(list.reduce((s, x) => s + x.durationS, 0)),
  };
}

/**
 * Statistiques récentes à une date de référence : la date de la séance débriefée (current),
 * ou aujourd'hui pour la planification.
 */
export function recentStats(ref: number, history: Activity[], current?: Activity) {
  const past = history.filter((h) => h.startTime <= ref && h.id !== current?.id).concat(current ? [current] : []);
  const w0 = weekStart(ref);

  const semaines = [3, 2, 1, 0].map((k) => {
    const start = addWeeks(w0, -k), end = addWeeks(start, 1);
    const inWeek = past.filter((h) => h.startTime >= start && h.startTime < end);
    return {
      semaine: `${shortDate.format(start)} – ${shortDate.format(end - DAY)}${k === 0 ? ' (en cours)' : ''}`,
      course: volume(inWeek.filter((h) => h.sport === 'running')),
      natation: volume(inWeek.filter((h) => h.sport === 'swimming')),
    };
  });

  const avgWeekly = (sport: Activity['sport']) => {
    const list = past.filter((h) => h.sport === sport && h.startTime >= addWeeks(w0, -12) && h.startTime < w0);
    return { seances: r1(list.length / 12), distance_km: r1(list.reduce((s, x) => s + x.distanceM, 0) / 12 / 1000) };
  };

  const window = (from: number, to: number) => past.filter((h) => h.startTime >= ref - from * DAY && h.startTime < ref - to * DAY);
  const recent = window(28, 0), before = window(56, 28);

  const runTrend = (list: Activity[]) => {
    const easy = list.filter((h) => h.running && !h.running.isInterval && h.running.avgPaceSPerKm);
    if (!easy.length) return null;
    const d = easy.reduce((s, h) => s + h.distanceM, 0), t = easy.reduce((s, h) => s + h.durationS, 0);
    const hr = easy.filter((h) => h.avgHr).map((h) => h.avgHr!);
    return { seances: easy.length, allure_moy: `${fmtPace((t / d) * 1000)}/km`, fc_moy: hr.length ? Math.round(hr.reduce((s, x) => s + x, 0) / hr.length) : undefined };
  };
  const swimTrend = (list: Activity[]) => {
    const sw = list.filter((h) => h.swimming?.avgPace100S);
    if (!sw.length) return null;
    const pace = sw.reduce((s, h) => s + h.swimming!.avgPace100S!, 0) / sw.length;
    const swolfs = sw.filter((h) => h.swimming!.avgSwolf).map((h) => h.swimming!.avgSwolf!);
    return { seances: sw.length, allure_moy_100m: fmtPace(pace), swolf_moy: swolfs.length ? Math.round(swolfs.reduce((s, x) => s + x, 0) / swolfs.length) : undefined };
  };

  const lastSame = current ? past.filter((h) => h.sport === current.sport && h.id !== current.id).sort((x, y) => y.startTime - x.startTime)[0] : undefined;
  const lastAny = past.filter((h) => h.id !== current?.id).sort((x, y) => y.startTime - x.startTime)[0];
  const intense7d = past.filter((h) => h.startTime > ref - 7 * DAY && h.hrZones)
    .reduce((s, h) => s + h.hrZones!.timeInZoneS[3] + h.hrZones!.timeInZoneS[4], 0);

  return {
    volume_4_dernieres_semaines: semaines,
    moyenne_hebdo_12_semaines_precedentes: { course: avgWeekly('running'), natation: avgWeekly('swimming') },
    tendance_course_endurance: { '4_dernieres_semaines': runTrend(recent), '4_semaines_avant': runTrend(before) },
    tendance_natation: { '4_dernieres_semaines': swimTrend(recent), '4_semaines_avant': swimTrend(before) },
    jours_depuis_seance_precedente: lastAny ? r1((ref - lastAny.startTime) / DAY) : null,
    jours_depuis_meme_sport: current ? (lastSame ? r1((ref - lastSame.startTime) / DAY) : null) : undefined,
    minutes_z4_z5_7_derniers_jours: Math.round(intense7d / 60),
    nb_seances_en_base: past.length - (current ? 1 : 0),
  };
}

export interface DebriefInput {
  date_du_jour: string;
  seance: ReturnType<typeof sessionDetail>;
  carnet_du_coach: string;
  statistiques_recentes: ReturnType<typeof recentStats>;
  seances_comparables: ReturnType<typeof sessionShort>[];
  seance_prevue?: ReturnType<typeof plannedSummary>;
}

/** Résumé d'une séance prévue (plan validé), pour comparer au réalisé. */
export function plannedSummary(s: PlannedSession) {
  return {
    jour: new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' }).format(s.date),
    sport: s.sport === 'running' ? 'course' : 'natation',
    type: s.kind,
    titre: s.title,
    description: s.description,
    duree_min: s.durationMin ?? undefined,
    distance: s.distanceM ? (s.sport === 'running' ? `${km(s.distanceM)} km` : `${Math.round(s.distanceM)} m`) : undefined,
    intensite: s.intensity || undefined,
  };
}

export function buildDebriefInput(a: Activity, history: Activity[], notebook: string, debriefs: Map<string, DebriefContent>, planned: PlannedSession | null = null, now = Date.now()): DebriefInput {
  return {
    date_du_jour: new Intl.DateTimeFormat('fr-FR', { dateStyle: 'full' }).format(now),
    seance: sessionDetail(a),
    carnet_du_coach: notebook,
    statistiques_recentes: recentStats(a.startTime, history, a),
    seances_comparables: comparableSessions(a, history).map((h) => sessionShort(h, a.startTime, debriefs.get(h.id))),
    seance_prevue: planned ? plannedSummary(planned) : undefined,
  };
}
