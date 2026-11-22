// Nom de la ville d'une séance, à partir de son point de départ GPS (les fichiers Garmin ne le contiennent pas).
// Géocodage inverse par Nominatim (OpenStreetMap), en respectant ses règles d'usage :
// une requête par séance au plus, une par seconde maximum, résultat gardé ; position arrondie (~100 m).
import { db } from './db';

const ENDPOINT = 'https://nominatim.openstreetmap.org/reverse';
let running = false;

async function reverse(lat: number, lon: number): Promise<string | null> {
  const url = `${ENDPOINT}?format=jsonv2&zoom=10&addressdetails=1&accept-language=fr&lat=${lat.toFixed(3)}&lon=${lon.toFixed(3)}`;
  const res = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Nominatim ${res.status}`);
  const data = (await res.json()) as { address?: Record<string, string> };
  const a = data.address ?? {};
  return a.city ?? a.town ?? a.village ?? a.municipality ?? a.city_district ?? a.county ?? null;
}

/** Cherche la ville des séances qui n'en ont pas encore (en tâche de fond, sans bloquer). */
export async function resolvePlaces(): Promise<void> {
  if (running || !navigator.onLine) return;
  running = true;
  try {
    const todo = await db.activities.filter((a) => a.place === undefined && !!a.route?.length).toArray();
    todo.sort((x, y) => y.startTime - x.startTime); // les plus récentes d'abord
    for (const a of todo) {
      const [lat, lon] = a.route![0];
      let place: string | null;
      try {
        place = await reverse(lat, lon);
      } catch {
        return; // hors ligne ou service indisponible : on réessaiera plus tard
      }
      await db.activities.update(a.id, { place });
      await new Promise((r) => setTimeout(r, 1100));
    }
  } finally {
    running = false;
  }
}
