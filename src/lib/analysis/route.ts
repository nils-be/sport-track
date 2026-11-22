import type { FitMessages } from '../fit/decode';

/** Point du parcours : [latitude, longitude] en degrés. */
export type LatLon = [number, number];

const SEMI_TO_DEG = 180 / 2 ** 31;
const MAX_POINTS = 400;
const TOLERANCE_M = 4;

/** Distance d'un point à un segment, en mètres (projection locale équirectangulaire). */
function segDist(p: LatLon, a: LatLon, b: LatLon, kx: number, ky: number): number {
  const ax = a[1] * kx, ay = a[0] * ky, bx = b[1] * kx, by = b[0] * ky, px = p[1] * kx, py = p[0] * ky;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Simplification de Douglas-Peucker (itérative). */
function simplify(pts: LatLon[], tol: number): LatLon[] {
  if (pts.length < 3) return pts;
  const lat0 = pts[0][0] * (Math.PI / 180);
  const ky = 111_320, kx = 111_320 * Math.cos(lat0);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let best = -1, bestD = tol;
    for (let k = i + 1; k < j; k++) {
      const d = segDist(pts[k], pts[i], pts[j], kx, ky);
      if (d > bestD) { bestD = d; best = k; }
    }
    if (best >= 0) { keep[best] = 1; stack.push([i, best], [best, j]); }
  }
  return pts.filter((_, i) => keep[i]);
}

/** Parcours GPS simplifié (quelques centaines de points), ou null sans GPS (tapis, piscine). */
export function extractRoute(messages: FitMessages): LatLon[] | null {
  const pts: LatLon[] = [];
  for (const r of messages.recordMesgs ?? []) {
    const la = r.positionLat, lo = r.positionLong;
    if (typeof la !== 'number' || typeof lo !== 'number') continue;
    const lat = la * SEMI_TO_DEG, lon = lo * SEMI_TO_DEG;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180 || (lat === 0 && lon === 0)) continue;
    pts.push([lat, lon]);
  }
  if (pts.length < 10) return null;
  let tol = TOLERANCE_M;
  let out = simplify(pts, tol);
  while (out.length > MAX_POINTS) { tol *= 1.6; out = simplify(pts, tol); }
  return out.map(([a, b]) => [Math.round(a * 1e5) / 1e5, Math.round(b * 1e5) / 1e5]);
}
