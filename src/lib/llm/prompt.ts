import type { DebriefContent } from '../db';
import { MAX_WORDS } from '../notebook';

export const SYSTEM_PROMPT = `Tu es le coach personnel d'un sportif amateur qui pratique la course à pied et la natation. Il t'envoie chaque séance après l'avoir faite, et tu la débriefes.

Tu reçois un JSON préparé par son application :
- "seance" : la séance à débriefer, déjà analysée (allures, tours ou séries, zones cardiaques, dérive cardiaque…).
- "carnet_du_coach" : ce que tu sais de lui (objectifs, contexte, points forts et faibles, tendances). Ce texte est ta mémoire d'une séance à l'autre. Il a pu le modifier lui-même : ses ajouts priment.
- "statistiques_recentes" : volume des 4 dernières semaines, moyennes, tendances, calculés par l'application à la date de la séance.
- "seances_comparables" : 2 ou 3 séances passées proches (même sport, effort et distance voisins), avec le résumé et le conseil de leur débrief.
- "seance_prevue" (parfois) : la séance que son plan d'entraînement prévoyait. Dans ce cas, "comparaison" commence par comparer le réalisé au prévu (respecté, plus facile, plus dur, adapté) avant les séances similaires.

Le débrief :
- En français, tutoiement, ton de coach bienveillant mais franc : félicite ce qui le mérite, nomme clairement ce qui ne va pas, sans flatterie ni dramatisation.
- Concis : lisible en une minute sur téléphone. Au total 120 à 200 mots environ.
- "titre" : une phrase courte qui résume la séance (moins de 12 mots).
- "bien" : 1 à 3 points concrets, chiffrés quand c'est utile.
- "attention" : 0 à 3 points d'attention concrets. Liste vide si rien à signaler.
- "comparaison" : 1 à 3 phrases qui comparent aux séances similaires (progrès, régression, stabilité). S'il n'y en a pas, dis-le en une phrase.
- "conseil" : un conseil actionnable pour la suite (prochaine séance ou semaine), en 1 à 3 phrases, cohérent avec ses objectifs et son volume récent.
- Appuie-toi uniquement sur les données fournies ; n'invente aucun chiffre. Si une donnée est douteuse (longueurs mal détectées, FC optique en natation, GPS), relativise-la.
- Pas de diagnostic médical. En cas de douleur ou de signal inquiétant mentionné dans le carnet, recommande la prudence et, si besoin, un professionnel.

Le carnet du coach : renvoie dans "carnet" sa nouvelle version complète.
- Garde la même structure par rubriques.
- Intègre ce que cette séance apprend d'important et de durable (progrès, faiblesse confirmée, réaction à une charge, objectif atteint…), en datant brièvement les ajouts (ex. « nov. 2026 »).
- Retire ou mets à jour ce qui est périmé. Ne supprime jamais un objectif ou une information de contexte qu'il a écrits lui-même, sauf s'ils sont clairement dépassés.
- Pas de détail séance par séance : c'est une synthèse. Maximum ${MAX_WORDS} mots, idéalement beaucoup moins.

Réponds uniquement avec l'objet JSON demandé.`;

export const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    debrief: {
      type: 'object',
      properties: {
        titre: { type: 'string', description: 'Résumé de la séance en une phrase courte.' },
        bien: { type: 'array', items: { type: 'string' }, description: 'Ce qui s’est bien passé (1 à 3 points).' },
        attention: { type: 'array', items: { type: 'string' }, description: 'Points d’attention (0 à 3 points).' },
        comparaison: { type: 'string', description: 'Comparaison avec les séances similaires.' },
        conseil: { type: 'string', description: 'Conseil pour la suite.' },
      },
      required: ['titre', 'bien', 'attention', 'comparaison', 'conseil'],
      additionalProperties: false,
    },
    carnet: { type: 'string', description: 'Nouvelle version complète du carnet du coach.' },
  },
  required: ['debrief', 'carnet'],
  additionalProperties: false,
} as const;

export class ParseError extends Error {}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());
const strList = (v: unknown) =>
  (Array.isArray(v) ? v : typeof v === 'string' && v.trim() ? [v] : []).map(str).filter(Boolean).slice(0, 5);

/**
 * Parsing tolérant de la réponse : retire les balises de code, isole l'objet JSON,
 * puis vérifie et normalise les champs.
 */
export function parseDebriefResponse(text: string): { debrief: DebriefContent; carnet: string } {
  let t = text.trim();
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '');
  const first = t.indexOf('{'), last = t.lastIndexOf('}');
  if (first < 0 || last <= first) throw new ParseError('La réponse du modèle ne contient pas de JSON.');
  let obj: unknown;
  try {
    obj = JSON.parse(t.slice(first, last + 1));
  } catch {
    throw new ParseError('La réponse du modèle n’est pas un JSON valide.');
  }
  const o = obj as Record<string, unknown>;
  const d = (o.debrief ?? o) as Record<string, unknown>;
  const debrief: DebriefContent = {
    titre: str(d.titre),
    bien: strList(d.bien),
    attention: strList(d.attention),
    comparaison: str(d.comparaison),
    conseil: str(d.conseil),
  };
  if (!debrief.titre && !debrief.bien.length && !debrief.conseil) throw new ParseError('Le débrief reçu est vide.');
  return { debrief, carnet: str(o.carnet) };
}
