import type { Activity, SportVariant, SwimStroke } from './analysis/types';

const pad = (n: number) => String(n).padStart(2, '0');

/** 3725 → « 1:02:05 », 425 → « 7:05 ». */
export function fmtDuration(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s)) return '–';
  const r = Math.round(s);
  const h = Math.floor(r / 3600), m = Math.floor((r % 3600) / 60), sec = r % 60;
  return h ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
}

/** Durée longue lisible : « 1 h 07 », « 52 min ». */
export function fmtDurationShort(s: number | null | undefined): string {
  if (s == null) return '–';
  const m = Math.round(s / 60);
  return m >= 60 ? `${Math.floor(m / 60)} h ${pad(m % 60)}` : `${m} min`;
}

/** Allure en s → « 5:12 » (sans unité). */
export function fmtPace(s: number | null | undefined): string {
  if (s == null || !Number.isFinite(s) || s <= 0) return '–';
  const r = Math.round(s);
  return `${Math.floor(r / 60)}:${pad(r % 60)}`;
}

const nf1 = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });

export function fmtKm(m: number | null | undefined): string {
  return m == null ? '–' : `${nf1.format(m / 1000)} km`;
}
export function fmtMeters(m: number | null | undefined): string {
  return m == null ? '–' : `${nf0.format(m)} m`;
}
/** Distance adaptée au sport : km pour la course, m pour la natation. */
export function fmtDistance(a: Pick<Activity, 'sport' | 'distanceM'>): string {
  return a.sport === 'swimming' ? fmtMeters(a.distanceM) : fmtKm(a.distanceM);
}
export const fmtNum = (v: number | null | undefined, unit = '') => (v == null ? '–' : `${nf0.format(v)}${unit ? ` ${unit}` : ''}`);

const dateFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' });
const dateLongFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const timeFmt = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });
const monthFmt = new Intl.DateTimeFormat('fr-FR', { month: 'long', year: 'numeric' });

export const fmtDate = (t: number) => dateFmt.format(t);
export const fmtDateLong = (t: number) => dateLongFmt.format(t);
export const fmtTime = (t: number) => timeFmt.format(t);
export const fmtMonth = (t: number) => {
  const s = monthFmt.format(t);
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const VARIANT_LABEL: Record<SportVariant, string> = {
  road: 'Course',
  trail: 'Trail',
  track: 'Piste',
  treadmill: 'Tapis',
  pool: 'Piscine',
  openWater: 'Eau libre',
};

export const STROKE_LABEL: Record<SwimStroke, string> = {
  freestyle: 'Crawl',
  backstroke: 'Dos',
  breaststroke: 'Brasse',
  butterfly: 'Papillon',
  drill: 'Éducatif',
  mixed: 'Mixte',
  im: '4 nages',
  unknown: 'Inconnue',
};

export const LAP_KIND_LABEL = {
  warmup: 'Échauff.',
  effort: 'Effort',
  recovery: 'Récup',
  rest: 'Repos',
  cooldown: 'Retour calme',
  steady: '',
} as const;

/** Titre d'une séance : « Course · 11,60 km ». */
export function activityTitle(a: Activity): string {
  const base = a.sport === 'swimming' ? `Natation ${VARIANT_LABEL[a.variant].toLowerCase()}` : VARIANT_LABEL[a.variant];
  const tag = a.running?.isInterval ? ' · fractionné' : '';
  return `${base}${tag}`;
}

/** Allure principale formatée avec son unité. */
export function mainPace(a: Activity): string {
  if (a.sport === 'swimming') return `${fmtPace(a.swimming?.avgPace100S)} /100 m`;
  return `${fmtPace(a.running?.avgPaceSPerKm)} /km`;
}

/** Coût en dollars : « 0,0013 $ » pour les petits montants, « 1,24 $ » sinon. */
export function fmtUsd(x: number | null | undefined): string {
  if (x == null) return '–';
  const digits = x === 0 ? 2 : x < 0.01 ? 4 : x < 1 ? 3 : 2;
  return `${new Intl.NumberFormat('fr-FR', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(x)} $`;
}
