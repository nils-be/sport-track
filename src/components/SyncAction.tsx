import { useLiveQuery } from 'dexie-react-hooks';
import { db, getSettings } from '../lib/db';
import { AppBarAction } from './AppBar';
import { useImport } from './ImportContext';

/** Bouton « Synchroniser avec Garmin » de l'en-tête, visible une fois le relais configuré. */
export default function SyncAction() {
  const { sync, syncing } = useImport();
  const ready = useLiveQuery(async () => !!(await getSettings()).garmin?.relayUrl && !!(await db.secrets.get('garmin'))?.key, []);
  if (!ready) return null;
  return <AppBarAction icon="sync" label="Synchroniser avec Garmin" onClick={sync} spinning={syncing} />;
}
