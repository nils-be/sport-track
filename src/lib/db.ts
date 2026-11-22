import Dexie, { type EntityTable } from 'dexie';
import type { Activity, ActivityStreams, Sport } from './analysis/types';
import { defaultZones, type ZoneSettings } from './analysis/common';
import { DEFAULT_MODEL, type Provider } from './llm/models';

/** Fichier FIT d'origine, conservé localement pour pouvoir réanalyser si l'algorithme évolue. */
export interface StoredFitFile {
  activityId: string;
  fileName: string;
  bytes: Uint8Array;
}

export interface AppSettings {
  id: 'main';
  zones: ZoneSettings;
  llm: {
    provider: Provider;
    model: Record<Provider, string>;
  };
}

export const DEFAULT_SETTINGS: AppSettings = {
  id: 'main',
  zones: defaultZones(190),
  llm: { provider: 'claude', model: { ...DEFAULT_MODEL } },
};

/** Clés API : table à part, jamais exportée dans les sauvegardes. */
export interface Secret {
  id: Provider;
  key: string;
}

export interface DebriefContent {
  titre: string;
  bien: string[];
  attention: string[];
  comparaison: string;
  conseil: string;
}

export interface Debrief {
  activityId: string;
  status: 'done' | 'error' | 'pending';
  createdAt: number;
  content?: DebriefContent;
  error?: string;
  provider?: Provider;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  costUsd?: number;
  /** JSON exact envoyé au LLM (transparence). */
  sentJson?: string;
}

export interface NotebookVersion {
  id?: number;
  createdAt: number;
  text: string;
  source: 'initial' | 'coach' | 'user' | 'restore';
  /** Séance dont le débrief a produit cette version. */
  activityId?: string;
}

export const SESSION_KINDS = ['footing', 'endurance', 'sortie_longue', 'tempo', 'fractionne', 'recup', 'technique', 'series'] as const;
export type SessionKind = (typeof SESSION_KINDS)[number];

/** Séance prévue dans un plan hebdomadaire. */
export interface PlannedSession {
  id: string;
  /** Jour prévu (minuit local, ms). */
  date: number;
  sport: Sport;
  kind: SessionKind;
  title: string;
  description: string;
  durationMin: number | null;
  distanceM: number | null;
  intensity: string;
  /** Lien manuel vers une séance réelle (null = délier explicitement ; absent = association automatique). */
  linkedActivityId?: string | null;
}

/** Plan d'une semaine (lundi → dimanche). */
export interface WeekPlan {
  /** Lundi 0 h (ms). */
  weekStart: number;
  status: 'draft' | 'validated';
  note: string;
  summary: string;
  sessions: PlannedSession[];
  createdAt: number;
  updatedAt: number;
  provider?: Provider;
  model?: string;
  costUsd?: number;
  inputTokens?: number;
  outputTokens?: number;
  sentJson?: string;
}

export interface LlmCall {
  id?: number;
  at: number;
  provider: Provider;
  model: string;
  activityId?: string;
  kind: 'debrief' | 'test' | 'plan';
  ok: boolean;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  error?: string;
}

class SportDB extends Dexie {
  activities!: EntityTable<Activity, 'id'>;
  streams!: EntityTable<ActivityStreams, 'activityId'>;
  fitFiles!: EntityTable<StoredFitFile, 'activityId'>;
  settings!: EntityTable<AppSettings, 'id'>;
  secrets!: EntityTable<Secret, 'id'>;
  debriefs!: EntityTable<Debrief, 'activityId'>;
  notebook!: EntityTable<NotebookVersion, 'id'>;
  llmCalls!: EntityTable<LlmCall, 'id'>;
  plans!: EntityTable<WeekPlan, 'weekStart'>;

  constructor() {
    super('sport-track');
    this.version(1).stores({
      activities: 'id, startTime, sport, [sport+startTime]',
      streams: 'activityId',
      fitFiles: 'activityId',
      settings: 'id',
    });
    this.version(2).stores({
      secrets: 'id',
      debriefs: 'activityId, status',
      notebook: '++id, createdAt',
      llmCalls: '++id, at',
    });
    this.version(3).stores({
      plans: 'weekStart, status',
    });
  }
}

export const db = new SportDB();

export async function getSettings(): Promise<AppSettings> {
  const s = await db.settings.get('main');
  // Fusion avec les valeurs par défaut (réglages créés par une version antérieure).
  return { ...DEFAULT_SETTINGS, ...s, llm: { ...DEFAULT_SETTINGS.llm, ...s?.llm, model: { ...DEFAULT_SETTINGS.llm.model, ...s?.llm?.model } } };
}

export async function saveSettings(patch: Partial<Omit<AppSettings, 'id'>>): Promise<void> {
  const cur = await getSettings();
  await db.settings.put({ ...cur, ...patch, id: 'main' });
}

export async function deleteActivity(id: string): Promise<void> {
  await db.transaction('rw', [db.activities, db.streams, db.fitFiles, db.debriefs], async () => {
    await db.activities.delete(id);
    await db.streams.delete(id);
    await db.fitFiles.delete(id);
    await db.debriefs.delete(id);
  });
}
