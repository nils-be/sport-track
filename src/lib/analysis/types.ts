// Modèle d'une séance analysée. Tout est calculé par le code à l'import (voir analyze.ts).
// Les dates sont stockées en millisecondes (epoch) pour rester sérialisables en JSON.

export type Sport = 'running' | 'swimming';

/** Variante de sport normalisée. */
export type SportVariant = 'road' | 'trail' | 'track' | 'treadmill' | 'pool' | 'openWater';

export interface HrZones {
  /** Bornes hautes des zones 1 à 5 (bpm). La borne basse de Z1 est `lowerBound`. */
  upperBounds: [number, number, number, number, number];
  lowerBound: number;
  maxHr: number;
  /** Temps (s) passé en zones 1 à 5. Le temps au-dessus de la FC max est compté en Z5. */
  timeInZoneS: [number, number, number, number, number];
  /** Temps (s) sous la zone 1. */
  belowZ1S: number;
  source: 'fit' | 'settings';
}

export interface LapKindInfo {
  /** Rôle du tour, déduit des fractions Garmin quand elles existent. */
  kind: 'warmup' | 'effort' | 'recovery' | 'rest' | 'cooldown' | 'steady';
}

export interface RunLap extends LapKindInfo {
  index: number;
  startOffsetS: number;
  durationS: number;
  distanceM: number;
  paceSPerKm: number | null;
  avgHr: number | null;
  maxHr: number | null;
  cadenceSpm: number | null;
  ascentM: number | null;
  descentM: number | null;
  trigger: string | null;
}

export interface KmSplit {
  km: number;
  /** Distance du segment (1000 m sauf le dernier). */
  distanceM: number;
  durationS: number;
  paceSPerKm: number;
  avgHr: number | null;
  ascentM: number | null;
}

/** Meilleur temps réalisé sur une distance donnée au cours de la séance. */
export interface BestEffort {
  distanceM: number;
  durationS: number;
}

export interface CardiacDrift {
  applicable: boolean;
  /** Raison si non applicable. */
  reason?: string;
  /** Découplage allure/FC en % (positif = la FC monte à allure égale). */
  decouplingPct?: number;
  firstHalf?: { paceSPerKm: number; avgHr: number };
  secondHalf?: { paceSPerKm: number; avgHr: number };
}

export interface RunningAnalysis {
  variant: SportVariant;
  avgPaceSPerKm: number | null;
  /** Allure ajustée à la pente (Garmin), si disponible. */
  gradeAdjustedPaceSPerKm: number | null;
  bestPaceSPerKm: number | null;
  ascentM: number | null;
  descentM: number | null;
  avgCadenceSpm: number | null;
  maxCadenceSpm: number | null;
  laps: RunLap[];
  kmSplits: KmSplit[];
  cardiacDrift: CardiacDrift;
  /** Meilleurs temps sur 1 km, 5 km, 10 km, semi, marathon (fenêtre glissante). */
  bestEfforts: BestEffort[];
  /** Vrai si la séance contient des fractions (fractionné). */
  isInterval: boolean;
  /** Résumé des blocs Garmin (échauffement, efforts, récup…), si disponible. */
  structure: { kind: LapKindInfo['kind']; count: number; distanceM: number; durationS: number }[];
}

export type SwimStroke = 'freestyle' | 'backstroke' | 'breaststroke' | 'butterfly' | 'drill' | 'mixed' | 'im' | 'unknown';

export interface SwimLength {
  index: number;
  startOffsetS: number;
  active: boolean;
  stroke: SwimStroke | null;
  durationS: number;
  strokes: number | null;
  swolf: number | null;
  pace100S: number | null;
  avgHr: number | null;
  /** Numéro de la série (index dans `sets`) à laquelle appartient la longueur. */
  setIndex: number;
  /** Longueur probablement mal détectée par la montre (trop courte par rapport aux autres). */
  suspect: boolean;
}

export interface SwimSet {
  index: number;
  kind: 'swim' | 'rest';
  startOffsetS: number;
  durationS: number;
  distanceM: number;
  lengths: number;
  stroke: SwimStroke | null;
  pace100S: number | null;
  swolf: number | null;
  strokesPerLength: number | null;
  avgHr: number | null;
  maxHr: number | null;
}

export interface SwimmingAnalysis {
  variant: SportVariant;
  poolLengthM: number | null;
  activeLengths: number | null;
  /** Temps de nage hors repos. */
  activeTimeS: number;
  restTimeS: number;
  avgPace100S: number | null;
  bestPace100S: number | null;
  avgSwolf: number | null;
  avgStrokesPerLength: number | null;
  mainStroke: SwimStroke | null;
  strokeBreakdown: { stroke: SwimStroke; lengths: number; distanceM: number }[];
  lengths: SwimLength[];
  sets: SwimSet[];
  /** Meilleurs temps sur 50/100/200/400 m en longueurs consécutives d'une même série. */
  bestEfforts: BestEffort[];
  /** Nombre de longueurs suspectes (détection de la montre douteuse). */
  suspectLengths: number;
}

/** Indicateurs supplémentaires fournis par certaines montres (affichage discret). */
export interface Extras {
  avgPowerW?: number;
  normalizedPowerW?: number;
  aerobicTE?: number;
  anaerobicTE?: number;
  avgStanceTimeMs?: number;
  avgStepLengthM?: number;
  avgVerticalRatioPct?: number;
}

export interface Activity {
  /** Clé de dédoublonnage : sport + heure de début. */
  id: string;
  sport: Sport;
  variant: SportVariant;
  name: string | null;
  startTime: number;
  importedAt: number;
  device: string | null;
  durationS: number;
  elapsedS: number;
  distanceM: number;
  avgHr: number | null;
  maxHr: number | null;
  calories: number | null;
  hrZones: HrZones | null;
  running?: RunningAnalysis;
  swimming?: SwimmingAnalysis;
  extras: Extras;
  /** Version de l'algorithme d'analyse, pour pouvoir réanalyser plus tard. */
  analysisVersion: number;
}

/** Séries temporelles allégées pour les graphiques (pas de GPS). */
export interface ActivityStreams {
  activityId: string;
  /** Pas de temps (s) entre deux points. */
  stepS: number;
  t: number[];
  distanceM: (number | null)[];
  speedMs: (number | null)[];
  hr: (number | null)[];
  altitudeM: (number | null)[];
}
