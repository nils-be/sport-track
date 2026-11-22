import type { FitMesg, FitMessages } from '../fit/decode';
import type { HrZones } from './types';

export const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

export const round = (v: number | null, digits = 0): number | null => {
  if (v == null) return null;
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

export const ms = (d: unknown): number | null =>
  d instanceof Date ? d.getTime() : typeof d === 'number' ? d : null;

export const mean = (xs: number[]): number | null =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;

/** Allure (s/km) à partir d'une vitesse (m/s). */
export const paceFromSpeed = (speed: number | null): number | null =>
  speed != null && speed > 0.3 ? 1000 / speed : null;

export interface HrSample {
  t: number; // ms
  hr: number;
}

export function hrSamples(messages: FitMessages): HrSample[] {
  const out: HrSample[] = [];
  for (const r of messages.recordMesgs ?? []) {
    const t = ms(r.timestamp);
    const hr = num(r.heartRate);
    if (t != null && hr != null && hr > 0) out.push({ t, hr });
  }
  return out;
}

/** FC moyenne et max sur un intervalle [start, end[ en ms. */
export function hrBetween(samples: HrSample[], start: number, end: number): { avg: number | null; max: number | null } {
  let sum = 0, n = 0, max = 0;
  for (const s of samples) {
    if (s.t < start) continue;
    if (s.t >= end) break;
    sum += s.hr; n++; if (s.hr > max) max = s.hr;
  }
  return n ? { avg: Math.round(sum / n), max } : { avg: null, max: null };
}

export interface ZoneSettings {
  maxHr: number;
  /** Bornes hautes Z1..Z5 en bpm, plus la borne basse de Z1. */
  lowerBound: number;
  upperBounds: [number, number, number, number, number];
}

/** Zones par défaut à partir de la FC max : 50/60/70/80/90/100 %. */
export function defaultZones(maxHr: number): ZoneSettings {
  const p = (x: number) => Math.round(maxHr * x);
  return { maxHr, lowerBound: p(0.5), upperBounds: [p(0.6), p(0.7), p(0.8), p(0.9), maxHr] };
}

function zonesFromRecords(samples: HrSample[], z: ZoneSettings, source: HrZones['source']): HrZones {
  const time: [number, number, number, number, number] = [0, 0, 0, 0, 0];
  let below = 0;
  for (let i = 0; i < samples.length; i++) {
    // Durée attribuée à l'échantillon : écart avec le suivant, plafonné (pauses).
    const dt = i + 1 < samples.length ? Math.min((samples[i + 1].t - samples[i].t) / 1000, 10) : 1;
    const hr = samples[i].hr;
    if (hr < z.lowerBound) { below += dt; continue; }
    let k = z.upperBounds.findIndex((b) => hr <= b);
    if (k < 0) k = 4;
    time[k] += dt;
  }
  return {
    upperBounds: z.upperBounds,
    lowerBound: z.lowerBound,
    maxHr: z.maxHr,
    timeInZoneS: time.map((v) => Math.round(v)) as HrZones['timeInZoneS'],
    belowZ1S: Math.round(below),
    source,
  };
}

/**
 * Zones cardiaques. Priorité :
 * 1. temps par zone de la session fourni par la montre (avec ses bornes) ;
 * 2. bornes du fichier appliquées à la FC seconde par seconde ;
 * 3. zones des réglages.
 *
 * Sémantique Garmin : hrZoneHighBoundary = [haut Z0, haut Z1, …, haut Z5] (6 valeurs),
 * timeInHrZone = [Z0, Z1, …, Z5, au-dessus] (7 valeurs).
 */
export function computeHrZones(messages: FitMessages, samples: HrSample[], settings: ZoneSettings): HrZones | null {
  const tiz = messages.timeInZoneMesgs ?? [];
  const withBounds = tiz.find((m) => Array.isArray(m.hrZoneHighBoundary) && m.hrZoneHighBoundary.length >= 6);
  const session = tiz.find((m) => m.referenceMesg === 'session' && Array.isArray(m.timeInHrZone));

  let fitZones: ZoneSettings | null = null;
  if (withBounds) {
    const b = (withBounds.hrZoneHighBoundary as number[]).map(Number);
    if (b.slice(0, 6).every((x) => Number.isFinite(x) && x > 0)) {
      fitZones = {
        maxHr: num(withBounds.maxHeartRate) ?? b[5],
        lowerBound: b[0],
        upperBounds: [b[1], b[2], b[3], b[4], b[5]],
      };
    }
  }

  if (fitZones && session) {
    const t = (session.timeInHrZone as number[]).map((x) => num(x) ?? 0);
    return {
      upperBounds: fitZones.upperBounds,
      lowerBound: fitZones.lowerBound,
      maxHr: fitZones.maxHr,
      timeInZoneS: [t[1], t[2], t[3], t[4], t[5] + (t[6] ?? 0)].map((v) => Math.round(v)) as HrZones['timeInZoneS'],
      belowZ1S: Math.round(t[0]),
      source: 'fit',
    };
  }
  if (!samples.length) return null;
  if (fitZones) return zonesFromRecords(samples, fitZones, 'fit');
  return zonesFromRecords(samples, settings, 'settings');
}

/** Résumé lisible du nom de la montre (« fr955 » → « Forerunner 955 »). */
export function deviceName(fileId: FitMesg | undefined): string | null {
  const p = fileId?.garminProduct ?? fileId?.product;
  if (p == null) return null;
  const s = String(p);
  const m = s.match(/^fr(\d+\w*)/i);
  return m ? `Forerunner ${m[1]}` : s;
}
