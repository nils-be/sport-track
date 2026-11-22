import { useEffect, useMemo, useRef, useState } from 'react';

// Carte légère : tuiles OpenStreetMap (projection Web Mercator) + tracé SVG, sans bibliothèque.
// Les tuiles sont chargées depuis tile.openstreetmap.org (le service worker les garde en cache).

const TILE = 256;
const ATTRIB = 'absolute right-1 bottom-1 rounded bg-white/75 px-1 text-[9px] leading-tight text-slate-700 dark:bg-slate-900/75 dark:text-slate-300';
const MAX_ZOOM = 17;

const project = (lat: number, lon: number, z: number): [number, number] => {
  const s = TILE * 2 ** z;
  const sin = Math.sin((lat * Math.PI) / 180);
  return [((lon + 180) / 360) * s, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s];
};

interface Props {
  route: [number, number][];
  height: number;
  /** Marge intérieure autour du tracé (px). */
  padding?: number;
  className?: string;
  color?: string;
  /** false dans un élément déjà cliquable (pas de lien imbriqué). */
  attributionLink?: boolean;
}

export default function RouteMap({ route, height, padding = 18, className = '', color = 'var(--color-run)', attributionLink = true }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(Math.round(e.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const view = useMemo(() => {
    if (!width || route.length < 2) return null;
    // Zoom le plus élevé où le tracé tient dans le cadre.
    let z = MAX_ZOOM;
    for (; z > 2; z--) {
      const pts = route.map(([la, lo]) => project(la, lo, z));
      const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
      if (Math.max(...xs) - Math.min(...xs) <= width - 2 * padding && Math.max(...ys) - Math.min(...ys) <= height - 2 * padding) break;
    }
    const pts = route.map(([la, lo]) => project(la, lo, z));
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const cx = (Math.min(...xs) + Math.max(...xs)) / 2, cy = (Math.min(...ys) + Math.max(...ys)) / 2;
    const ox = cx - width / 2, oy = cy - height / 2; // coin haut-gauche du cadre, en pixels « monde »
    const tiles: { key: string; src: string; left: number; top: number }[] = [];
    const n = 2 ** z;
    for (let tx = Math.floor(ox / TILE); tx <= Math.floor((ox + width) / TILE); tx++) {
      for (let ty = Math.floor(oy / TILE); ty <= Math.floor((oy + height) / TILE); ty++) {
        if (ty < 0 || ty >= n) continue;
        const wx = ((tx % n) + n) % n;
        tiles.push({ key: `${z}/${tx}/${ty}`, src: `https://tile.openstreetmap.org/${z}/${wx}/${ty}.png`, left: tx * TILE - ox, top: ty * TILE - oy });
      }
    }
    const path = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${(x - ox).toFixed(1)} ${(y - oy).toFixed(1)}`).join('');
    const start = [pts[0][0] - ox, pts[0][1] - oy];
    const end = [pts[pts.length - 1][0] - ox, pts[pts.length - 1][1] - oy];
    return { tiles, path, start, end };
  }, [route, width, height, padding]);

  return (
    <div ref={ref} className={`relative overflow-hidden bg-slate-200 dark:bg-slate-800 ${className}`} style={{ height }}>
      {view && (
        <>
          <div className="map-tiles absolute inset-0">
            {view.tiles.map((t) => (
              <img key={t.key} src={t.src} alt="" loading="lazy" decoding="async" draggable={false}
                className="absolute max-w-none select-none" style={{ left: t.left, top: t.top, width: TILE, height: TILE }} />
            ))}
          </div>
          <svg className="absolute inset-0" width={width} height={height} aria-hidden="true">
            <path d={view.path} fill="none" stroke="white" strokeWidth={6} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
            <path d={view.path} fill="none" stroke={color} strokeWidth={3.5} strokeLinejoin="round" strokeLinecap="round" />
            <circle cx={view.end[0]} cy={view.end[1]} r={5} fill="#0f172a" stroke="white" strokeWidth={2} />
            <circle cx={view.start[0]} cy={view.start[1]} r={5} fill="#22c55e" stroke="white" strokeWidth={2} />
          </svg>
          {attributionLink ? (
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" className={ATTRIB}>© OpenStreetMap</a>
          ) : (
            <span className={ATTRIB}>© OpenStreetMap</span>
          )}
        </>
      )}
    </div>
  );
}
