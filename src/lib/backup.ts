// Sauvegarde complète en JSON : tout sauf les clés API (table « secrets », jamais exportée).
import { db } from './db';

const FORMAT = 1;

interface BackupFile {
  app: 'sport-track';
  format: number;
  exportedAt: string;
  settings: unknown[];
  activities: unknown[];
  streams: unknown[];
  debriefs: unknown[];
  notebook: unknown[];
  llmCalls: unknown[];
  messages?: unknown[];
  /** Fichiers FIT d'origine, en base64 (optionnels). */
  fitFiles?: { activityId: string; fileName: string; base64: string }[];
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Taille approximative des fichiers FIT stockés (octets). */
export async function fitFilesSize(): Promise<number> {
  let n = 0;
  await db.fitFiles.each((f) => { n += f.bytes.byteLength; });
  return n;
}

export async function exportBackup(includeFit: boolean): Promise<{ blob: Blob; fileName: string; sessions: number }> {
  const [settings, activities, streams, debriefs, notebook, llmCalls, messages] = await Promise.all([
    db.settings.toArray(), db.activities.toArray(), db.streams.toArray(),
    db.debriefs.toArray(), db.notebook.toArray(), db.llmCalls.toArray(), db.messages.toArray(),
  ]);
  const data: BackupFile = {
    app: 'sport-track', format: FORMAT, exportedAt: new Date().toISOString(),
    settings, activities, streams, debriefs, notebook, llmCalls, messages,
  };
  if (includeFit) {
    data.fitFiles = (await db.fitFiles.toArray()).map((f) => ({ activityId: f.activityId, fileName: f.fileName, base64: toBase64(f.bytes) }));
  }
  const day = new Date().toISOString().slice(0, 10);
  return { blob: new Blob([JSON.stringify(data)], { type: 'application/json' }), fileName: `sport-track-sauvegarde-${day}.json`, sessions: activities.length };
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export class BackupError extends Error {}

/** Lit et vérifie une sauvegarde, sans rien modifier. */
export async function readBackup(file: File): Promise<BackupFile> {
  let data: BackupFile;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new BackupError('Ce fichier n’est pas un JSON valide.');
  }
  if (data?.app !== 'sport-track' || !Array.isArray(data.activities)) throw new BackupError('Ce fichier n’est pas une sauvegarde Sport Track.');
  if (data.format > FORMAT) throw new BackupError('Sauvegarde créée par une version plus récente de l’application.');
  return data;
}

/** Remplace toutes les données (sauf les clés API) par le contenu de la sauvegarde. */
export async function restoreBackup(data: BackupFile): Promise<void> {
  const tables = [db.settings, db.activities, db.streams, db.debriefs, db.notebook, db.llmCalls, db.messages, db.fitFiles];
  await db.transaction('rw', tables, async () => {
    for (const t of tables) await t.clear();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const put = (t: (typeof tables)[number], rows: unknown[] | undefined) => (rows?.length ? (t as any).bulkPut(rows) : Promise.resolve());
    await put(db.settings, data.settings);
    await put(db.activities, data.activities);
    await put(db.streams, data.streams);
    await put(db.debriefs, data.debriefs);
    await put(db.notebook, data.notebook);
    await put(db.llmCalls, data.llmCalls);
    await put(db.messages, data.messages);
    if (data.fitFiles?.length) {
      await db.fitFiles.bulkPut(data.fitFiles.map((f) => ({ activityId: f.activityId, fileName: f.fileName, bytes: fromBase64(f.base64) })));
    }
  });
}

/** Efface toutes les données de l'application sur cet appareil, clés API comprises. */
export async function eraseEverything(): Promise<void> {
  await db.transaction('rw', db.tables, async () => {
    for (const t of db.tables) await t.clear();
  });
}
