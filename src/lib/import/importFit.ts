import { unzipSync } from 'fflate';
import { analyzeFit, UnsupportedSportError } from '../analysis/analyze';
import { db, getSettings } from '../db';
import { decodeFit, FitDecodeError } from '../fit/decode';

export interface ImportResult {
  fileName: string;
  status: 'imported' | 'duplicate' | 'rejected' | 'error';
  message: string;
  activityId?: string;
}

/**
 * Point d'entrée unique de l'import : un fichier FIT (octets) → séance analysée et stockée.
 * Toute source de fichiers (sélection manuelle, partage Android, synchro Garmin en V3) passe par ici.
 */
export async function importFit(bytes: Uint8Array, fileName: string): Promise<ImportResult> {
  try {
    const messages = decodeFit(bytes);
    const settings = await getSettings();
    const { activity, streams } = analyzeFit(messages, settings.zones);

    if (await db.activities.get(activity.id)) {
      return { fileName, status: 'duplicate', message: 'Séance déjà importée.', activityId: activity.id };
    }
    await db.transaction('rw', db.activities, db.streams, db.fitFiles, async () => {
      await db.activities.add(activity);
      if (streams) await db.streams.put(streams);
      await db.fitFiles.put({ activityId: activity.id, fileName, bytes });
    });
    return { fileName, status: 'imported', message: 'Séance importée.', activityId: activity.id };
  } catch (e) {
    if (e instanceof UnsupportedSportError || e instanceof FitDecodeError) {
      return { fileName, status: 'rejected', message: e.message };
    }
    console.error('Import FIT', fileName, e);
    return { fileName, status: 'error', message: 'Erreur inattendue pendant l’analyse du fichier.' };
  }
}

const isFit = (name: string) => name.toLowerCase().endsWith('.fit');
const isZip = (name: string) => name.toLowerCase().endsWith('.zip');

/** Import d'une liste de fichiers .fit et/ou .zip (exports « original » de Garmin Connect). */
export async function importFiles(files: File[]): Promise<ImportResult[]> {
  const results: ImportResult[] = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    // Détection par signature : « PK » = zip, sinon on tente le FIT.
    const zip = isZip(file.name) || (bytes[0] === 0x50 && bytes[1] === 0x4b);
    if (zip) {
      let entries: Record<string, Uint8Array>;
      try {
        entries = unzipSync(bytes, { filter: (f) => isFit(f.name) });
      } catch {
        results.push({ fileName: file.name, status: 'rejected', message: 'Archive .zip illisible.' });
        continue;
      }
      const names = Object.keys(entries);
      if (!names.length) {
        results.push({ fileName: file.name, status: 'rejected', message: 'Aucun fichier .fit dans cette archive.' });
        continue;
      }
      for (const n of names) results.push(await importFit(entries[n], `${file.name} › ${n.split('/').pop()}`));
    } else if (isFit(file.name) || bytes.length > 14) {
      results.push(await importFit(bytes, file.name));
    } else {
      results.push({ fileName: file.name, status: 'rejected', message: 'Format non reconnu (attendu : .fit ou .zip).' });
    }
  }
  return results;
}
