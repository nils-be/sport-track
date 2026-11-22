import type { FitMessages } from '../fit/decode';
import { computeHrZones, deviceName, hrSamples, ms, num, round, type ZoneSettings } from './common';
import { analyzeRunning, runPoints } from './running';
import { extractRoute } from './route';
import { analyzeSwimming } from './swimming';
import type { Activity, ActivityStreams, Extras, Sport } from './types';
import { ANALYSIS_VERSION } from './version';

export { ANALYSIS_VERSION };


export class UnsupportedSportError extends Error {}

const SPORT_LABELS: Record<string, string> = {
  cycling: 'vélo', walking: 'marche', hiking: 'randonnée', training: 'renforcement / cardio',
  fitnessEquipment: 'appareil de fitness', generic: 'activité générique', multisport: 'multisport',
  transition: 'transition', rowing: 'aviron', yoga: 'yoga', strengthTraining: 'renforcement',
};

/** Pas de temps des séries stockées pour les graphiques. */
const STREAM_STEP_S = 5;

export interface AnalysisResult {
  activity: Activity;
  streams: ActivityStreams | null;
}

export function analyzeFit(messages: FitMessages, zoneSettings: ZoneSettings): AnalysisResult {
  const fileType = messages.fileIdMesgs?.[0]?.type;
  if (fileType && fileType !== 'activity') {
    throw new UnsupportedSportError(`Ce fichier n'est pas une activité (type : ${fileType}).`);
  }
  const session = messages.sessionMesgs?.[0];
  if (!session) throw new UnsupportedSportError('Aucune séance trouvée dans ce fichier.');
  if ((messages.sessionMesgs?.length ?? 0) > 1) {
    throw new UnsupportedSportError('Les séances multisports ne sont pas prises en charge.');
  }

  const rawSport = String(session.sport ?? messages.sportMesgs?.[0]?.sport ?? 'generic');
  if (rawSport !== 'running' && rawSport !== 'swimming') {
    const label = SPORT_LABELS[rawSport] ?? rawSport;
    throw new UnsupportedSportError(`Sport non pris en charge : ${label}. Seules la course à pied et la natation sont acceptées.`);
  }
  const sport = rawSport as Sport;

  const startTime = ms(session.startTime) ?? ms(messages.recordMesgs?.[0]?.timestamp);
  if (startTime == null) throw new UnsupportedSportError('Heure de début introuvable dans le fichier.');

  const hr = hrSamples(messages);
  const hrZones = computeHrZones(messages, hr, zoneSettings);

  const extras: Extras = {};
  const set = <K extends keyof Extras>(k: K, v: number | null) => { if (v != null && v > 0) extras[k] = v; };
  set('avgPowerW', num(session.avgPower));
  set('normalizedPowerW', num(session.normalizedPower));
  set('aerobicTE', num(session.totalTrainingEffect));
  set('anaerobicTE', num(session.totalAnaerobicTrainingEffect));
  set('avgStanceTimeMs', num(session.avgStanceTime));
  set('avgStepLengthM', round(num(session.avgStepLength) != null ? session.avgStepLength / 1000 : null, 2));
  set('avgVerticalRatioPct', num(session.avgVerticalRatio));

  const base = {
    id: `${sport}-${new Date(startTime).toISOString()}`,
    sport,
    name: messages.sportMesgs?.[0]?.name ?? session.sportProfileName ?? null,
    startTime,
    importedAt: Date.now(),
    device: deviceName(messages.fileIdMesgs?.[0]),
    durationS: round(num(session.totalTimerTime) ?? 0, 1)!,
    elapsedS: round(num(session.totalElapsedTime) ?? 0, 1)!,
    distanceM: round(num(session.totalDistance) ?? 0, 1)!,
    avgHr: num(session.avgHeartRate),
    maxHr: num(session.maxHeartRate),
    calories: num(session.totalCalories),
    hrZones,
    extras,
    route: extractRoute(messages),
    analysisVersion: ANALYSIS_VERSION,
  };

  if (sport === 'running') {
    const pts = runPoints(messages);
    const running = analyzeRunning(messages, session, hr, pts);
    const activity: Activity = { ...base, variant: running.variant, running };
    return { activity, streams: buildStreams(activity.id, pts.map((p) => ({ ...p, t: (p.t - startTime) / 1000 }))) };
  }

  const swimming = analyzeSwimming(messages, session, hr);
  const activity: Activity = { ...base, variant: swimming.variant, swimming };
  const pts = hr.map((h) => ({ t: (h.t - startTime) / 1000, hr: h.hr, dist: null, speed: null, alt: null }));
  return { activity, streams: buildStreams(activity.id, pts) };
}

interface StreamPoint { t: number; dist: number | null; speed: number | null; alt: number | null; hr: number | null }

/** Moyennes par tranche de STREAM_STEP_S secondes (temps réel depuis le début). */
function buildStreams(activityId: string, pts: StreamPoint[]): ActivityStreams | null {
  if (!pts.length) return null;
  const s: ActivityStreams = { activityId, stepS: STREAM_STEP_S, t: [], distanceM: [], speedMs: [], hr: [], altitudeM: [] };
  const avg = (xs: (number | null)[], digits: number) => {
    const v = xs.filter((x): x is number => x != null);
    return v.length ? round(v.reduce((a, b) => a + b, 0) / v.length, digits) : null;
  };
  let bucket: StreamPoint[] = [];
  let key = Math.floor(pts[0].t / STREAM_STEP_S);
  const flush = () => {
    if (!bucket.length) return;
    s.t.push(key * STREAM_STEP_S);
    s.distanceM.push(round(bucket[bucket.length - 1].dist, 1));
    s.speedMs.push(avg(bucket.map((b) => b.speed), 3));
    s.hr.push(avg(bucket.map((b) => b.hr), 0));
    s.altitudeM.push(avg(bucket.map((b) => b.alt), 1));
    bucket = [];
  };
  for (const p of pts) {
    const k = Math.floor(p.t / STREAM_STEP_S);
    if (k !== key) { flush(); key = k; }
    bucket.push(p);
  }
  flush();
  return s;
}
