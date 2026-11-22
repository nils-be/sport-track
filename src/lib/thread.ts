// Fil de discussion avec le coach : débriefs et échanges, dans un seul fil.
// Module léger (pas de SDK LLM) : utilisable par l'écran Coach comme par la génération des débriefs.
import { db, type ChatMessage, type DebriefContent } from './db';

/** Texte markdown d'un débrief, tel qu'il apparaît dans le fil. */
export function debriefToMarkdown(d: DebriefContent): string {
  const parts = [`**${d.titre}**`];
  if (d.bien.length) parts.push(`**Ce qui s'est bien passé**\n${d.bien.map((x) => `- ${x}`).join('\n')}`);
  if (d.attention.length) parts.push(`**Points d'attention**\n${d.attention.map((x) => `- ${x}`).join('\n')}`);
  if (d.comparaison) parts.push(`**Par rapport aux séances similaires**\n${d.comparaison}`);
  if (d.conseil) parts.push(`**Conseil pour la suite**\n${d.conseil}`);
  return parts.join('\n\n');
}

/** Crée ou met à jour le message de débrief d'une séance (un seul message par séance). */
export async function upsertDebriefMessage(activityId: string, patch: Partial<ChatMessage>): Promise<void> {
  const existing = await db.messages.where('activityId').equals(activityId).filter((m) => m.kind === 'debrief').first();
  if (existing) await db.messages.update(existing.id!, patch);
  else await db.messages.add({ at: Date.now(), role: 'coach', kind: 'debrief', text: '', activityId, status: 'pending', ...patch });
}

const dateFmt = new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });

/** Texte d'un message tel qu'il est montré au LLM (les débriefs sont annoncés comme tels). */
export async function messageForLlm(m: ChatMessage): Promise<string> {
  if (m.kind !== 'debrief' || !m.activityId) return m.text;
  const a = await db.activities.get(m.activityId);
  const label = a ? `${a.sport === 'running' ? 'course' : 'natation'} du ${dateFmt.format(a.startTime)}` : 'une séance';
  return `[Débrief de la séance de ${label}]\n${m.text}`;
}

/** Derniers messages terminés du fil, du plus ancien au plus récent. */
export async function recentMessages(limit: number, exclude?: (m: ChatMessage) => boolean): Promise<ChatMessage[]> {
  const list = await db.messages.orderBy('at').reverse()
    .filter((m) => m.status === 'done' && !!m.text && !(exclude?.(m) ?? false))
    .limit(limit).toArray();
  return list.reverse();
}

/** Conversation récente résumée en lignes courtes (pour le contexte des débriefs). */
export async function recentConversationLines(limit = 10, maxChars = 600, excludeActivityId?: string): Promise<string[]> {
  const msgs = await recentMessages(limit, (m) => m.kind === 'debrief' && m.activityId === excludeActivityId);
  const lines: string[] = [];
  for (const m of msgs) {
    const text = (await messageForLlm(m)).replace(/\s+/g, ' ').trim();
    lines.push(`${m.role === 'user' ? 'Sportif' : 'Coach'} : ${text.length > maxChars ? `${text.slice(0, maxChars)}…` : text}`);
  }
  return lines;
}
