import { db, type NotebookVersion } from './db';

export const MAX_VERSIONS = 10;
export const MAX_WORDS = 1500;

/**
 * Rubriques fixes du carnet du coach, dans l'ordre. Le texte est stocké en markdown
 * (« ## Rubrique » suivi de puces) : lisible par le LLM et éditable rubrique par rubrique dans l'app.
 * Pas de données de santé générale (poids, sommeil, VFC…) : seulement ce qui sert à cadrer les séances.
 */
export const NOTEBOOK_SECTIONS = [
  { title: 'Profil', hint: 'Âge, années de pratique, niveau, autres sports pratiqués.' },
  { title: 'Objectifs', hint: 'Objectif principal (épreuve, date, chrono visé), objectifs secondaires.' },
  { title: 'Disponibilités et contraintes', hint: 'Jours possibles, durée max par séance, lieux (route, piste, trail, piscine 25/50 m), matériel.' },
  { title: 'Préférences', hint: 'Séances appréciées ou à éviter, moment de la journée, consignes en allures, zones ou sensations.' },
  { title: 'Repères d’entraînement', hint: 'Allures de référence (footing, seuil, 5 km / VMA), zones FC, allure au 100 m, records.' },
  { title: 'Santé et blessures', hint: 'Antécédents, douleurs actuelles, précautions à prendre.' },
  { title: 'Forme du moment', hint: 'Fatigue, courbatures, séance décalée, contexte (entrées datées).' },
  { title: 'Points forts et axes de progrès', hint: 'Ce qui va bien, ce qui est à travailler.' },
  { title: 'Ce qui marche / ce qui ne marche pas', hint: 'Séances, charges ou habitudes qui réussissent ou non.' },
] as const;

export const OTHER_SECTION = 'Autres notes';
const EMPTY = '- (à compléter)';

/** Anciens intitulés (V1–V3) → rubrique actuelle, pour convertir les carnets existants. */
const LEGACY: Record<string, { title: string; prefix?: string }> = {
  'objectifs': { title: 'Objectifs' },
  'contexte actuel (blessures, fatigue, contraintes)': { title: 'Forme du moment' },
  'contexte actuel': { title: 'Forme du moment' },
  'points forts': { title: 'Points forts et axes de progrès' },
  'points faibles': { title: 'Points forts et axes de progrès', prefix: 'À travailler : ' },
  'tendances récentes': { title: 'Forme du moment', prefix: 'Tendance : ' },
  'ce qui marche / ce qui ne marche pas': { title: 'Ce qui marche / ce qui ne marche pas' },
};

const norm = (s: string) => s.toLowerCase().replace(/[’']/g, '\'').replace(/\s*:\s*$/, '').trim();
const KNOWN = new Map<string, string>(NOTEBOOK_SECTIONS.map((s) => [norm(s.title), s.title]));

/** Ligne sans information (texte par défaut des anciens carnets ou rubrique vide). */
const isPlaceholderLine = (l: string) => /^\s*-?\s*(\(à compléter[^)]*\)|pas encore assez de séances pour juger|aucune pour l['’]instant|à découvrir au fil des séances|rien de signalé)\.?\s*$/i.test(l);

/**
 * Découpe le carnet en rubriques. Accepte le format actuel (« ## Rubrique ») et l'ancien (« Rubrique : »).
 * Les rubriques inconnues sont rangées dans « Autres notes ».
 */
export function parseNotebook(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  let current = OTHER_SECTION;
  let prefix = '';
  const push = (sec: string, line: string) => { out[sec] = out[sec] ? `${out[sec]}\n${line}` : line; };
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const h = raw.match(/^\s*#{1,6}\s+(.+?)\s*$/) ?? raw.match(/^\s*([^-•*\d][^:]{2,70}?)\s*:\s*$/);
    if (h) {
      const key = norm(h[1]);
      const known = KNOWN.get(key);
      const legacy = LEGACY[key];
      if (known || legacy) { current = known ?? legacy.title; prefix = known ? '' : legacy.prefix ?? ''; continue; }
      if (raw.trim().startsWith('#')) { current = OTHER_SECTION; prefix = ''; push(current, `**${h[1]}**`); continue; }
    }
    if (!raw.trim() || isPlaceholderLine(raw)) continue;
    push(current, prefix ? raw.replace(/^(\s*[-•*]\s*)/, `$1${prefix}`) : raw);
  }
  for (const k of Object.keys(out)) out[k] = out[k].trim();
  return out;
}

/** Reconstruit le texte du carnet dans l'ordre des rubriques (rubrique vide = « (à compléter) »). */
export function buildNotebook(sections: Record<string, string>): string {
  const parts = NOTEBOOK_SECTIONS.map((s) => `## ${s.title}\n${sections[s.title]?.trim() || EMPTY}`);
  if (sections[OTHER_SECTION]?.trim()) parts.push(`## ${OTHER_SECTION}\n${sections[OTHER_SECTION].trim()}`);
  return parts.join('\n\n');
}

/** Normalise n'importe quel texte de carnet vers la structure actuelle. */
export const normalizeNotebook = (text: string) => buildNotebook(parseNotebook(text));

export const INITIAL_NOTEBOOK = buildNotebook({});

/** Description de la structure, pour les consignes du coach. */
export const NOTEBOOK_STRUCTURE_PROMPT = `Le carnet est en markdown, avec exactement ces rubriques, dans cet ordre, chacune introduite par « ## » :
${NOTEBOOK_SECTIONS.map((s) => `- ## ${s.title} : ${s.hint}`).join('\n')}
(et éventuellement « ## ${OTHER_SECTION} » pour le reste). Sous chaque rubrique, des puces courtes. Garde « - (à compléter) » si tu ne sais rien. Complète « Repères d’entraînement » avec les allures et records observés dans les données. Date brièvement les entrées de « Forme du moment » et retire celles qui sont périmées.`;

export const wordCount = (t: string) => (t.trim() ? t.trim().split(/\s+/).length : 0);

/** Version courante du carnet (créée au premier accès ; un ancien format est converti à la volée). */
export async function currentNotebook(): Promise<NotebookVersion> {
  // Transaction en écriture : deux appels simultanés ne créent pas deux versions initiales.
  return db.transaction('rw', db.notebook, async () => {
    const last = await db.notebook.orderBy('id').last();
    if (last) return { ...last, text: normalizeNotebook(last.text) };
    const v: NotebookVersion = { createdAt: Date.now(), text: INITIAL_NOTEBOOK, source: 'initial' };
    v.id = await db.notebook.add(v);
    return v;
  });
}

/** Enregistre une nouvelle version (normalisée) et ne garde que les 10 dernières. */
export async function saveNotebook(text: string, source: NotebookVersion['source'], activityId?: string): Promise<NotebookVersion> {
  return db.transaction('rw', db.notebook, async () => {
    const v: NotebookVersion = { createdAt: Date.now(), text: normalizeNotebook(text), source, activityId };
    v.id = await db.notebook.add(v);
    const ids = (await db.notebook.orderBy('id').primaryKeys()) as number[];
    if (ids.length > MAX_VERSIONS) await db.notebook.bulkDelete(ids.slice(0, ids.length - MAX_VERSIONS));
    return v;
  });
}
