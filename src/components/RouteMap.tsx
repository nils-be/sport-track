import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Cartes légères : tuiles OpenStreetMap (projection Web Mercator) + tracé SVG, sans bibliothèque.
// Les tuiles sont chargées depuis tile.openstreetmap.org (le service worker les garde en cache).

const TILE = 256;
const MIN_ZOOM = 3;
const MAX_ZOOM = 18;
const ATTRIB = 'absolute right-1 bottom-1 rounded bg-white/80 px-1 text-[9px] leading-tight text-slate-700 dark:bg-slate-900/80 dark:text-slate-300';

/** Coordonnées « monde » normalisées (0 → 1) d'un point lat/lon. */
const toWorld = (lat: number, lon: number): [number, number] => {
  const sin = Math.sin((lat * Math.PI) / 180);
  return [(lon + 180) / 360, 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)];
};

/** Vue de carte : zoom (éventuellement fractionnaire) et centre en coordonnées monde normalisées. */
interface View { z: number; cx: number; cy: number }

/** Vue qui cadre le tracé dans un rectangle w × h avec une marge. */
function fitView(world: [number, number][], w: number, h: number, padding: number, maxZoom = 17): View {
  const xs = world.map((p) => p[0]), ys = world.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  const spanX = Math.max(maxX - minX, 1e-9), spanY = Math.max(maxY - minY, 1e-9);
  const z = Math.log2(Math.min((w - 2 * padding) / (spanX * TILE), (h - 2 * padding) / (spanY * TILE)));
  return { z: Math.max(MIN_ZOOM, Math.min(maxZoom, z)), cx: (minX + maxX) / 2, cy: (minY + maxY) / 2 };
}

/** Tuiles et tracé à l'écran pour une vue donnée. */
function layout(view: View, world: [number, number][], w: number, h: number) {
  const tz = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(view.z)));
  const scale = 2 ** (view.z - tz);
  const n = 2 ** tz;
  const size = TILE * scale;
  const cpx = view.cx * n * TILE * scale, cpy = view.cy * n * TILE * scale;
  const ox = cpx - w / 2, oy = cpy - h / 2;
  const tiles: { key: string; src: string; left: number; top: number; size: number }[] = [];
  for (let tx = Math.floor(ox / size); tx <= Math.floor((ox + w) / size); tx++) {
    for (let ty = Math.floor(oy / size); ty <= Math.floor((oy + h) / size); ty++) {
      if (ty < 0 || ty >= n) continue;
      const wx = ((tx % n) + n) % n;
      tiles.push({ key: `${tz}/${tx}/${ty}`, src: `https://tile.openstreetmap.org/${tz}/${wx}/${ty}.png`, left: tx * size - ox, top: ty * size - oy, size });
    }
  }
  const ws = TILE * 2 ** view.z;
  const pts = world.map(([x, y]) => [(x - view.cx) * ws + w / 2, (y - view.cy) * ws + h / 2] as const);
  const path = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
  return { tiles, path, start: pts[0], end: pts[pts.length - 1] };
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return { ref, ...size };
}

/** Fond de carte + tracé, pour une vue donnée. */
function MapLayer({ view, world, w, h, color, children }: { view: View; world: [number, number][]; w: number; h: number; color: string; children?: ReactNode }) {
  const l = useMemo(() => layout(view, world, w, h), [view, world, w, h]);
  return (
    <>
      <div className="map-tiles absolute inset-0">
        {l.tiles.map((t) => (
          <img key={t.key} src={t.src} alt="" loading="lazy" decoding="async" draggable={false}
            className="absolute max-w-none select-none" style={{ left: t.left, top: t.top, width: t.size, height: t.size }} />
        ))}
      </div>
      <svg className="pointer-events-none absolute inset-0" width={w} height={h} aria-hidden="true">
        <path d={l.path} fill="none" stroke="white" strokeWidth={6} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
        <path d={l.path} fill="none" stroke={color} strokeWidth={3.5} strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={l.end[0]} cy={l.end[1]} r={5} fill="#0f172a" stroke="white" strokeWidth={2} />
        <circle cx={l.start[0]} cy={l.start[1]} r={5} fill="#22c55e" stroke="white" strokeWidth={2} />
      </svg>
      {children}
    </>
  );
}

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

/** Aperçu de parcours (statique). Un tap ouvre la carte interactive en plein écran. */
export default function RouteMap({ route, height, padding = 18, className = '', color = 'var(--color-run)', attributionLink = true }: Props) {
  const { ref, w } = useWidth<HTMLDivElement>();
  const [open, setOpen] = useState(false);
  const world = useMemo(() => route.map(([la, lo]) => toWorld(la, lo)), [route]);
  const view = useMemo(() => (w ? fitView(world, w, height, padding) : null), [world, w, height, padding]);

  return (
    <>
      <div ref={ref} className={`relative cursor-zoom-in overflow-hidden bg-slate-200 dark:bg-slate-800 ${className}`} style={{ height }}
        role="button" aria-label="Ouvrir la carte"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}>
        {view && (
          <MapLayer view={view} world={world} w={w} h={height} color={color}>
            {attributionLink
              ? <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className={ATTRIB}>© OpenStreetMap</a>
              : <span className={ATTRIB}>© OpenStreetMap</span>}
            <span className="absolute top-2 right-2 grid size-8 place-items-center rounded-full bg-white/85 text-slate-700 shadow dark:bg-slate-900/85 dark:text-slate-200">
              <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" /></svg>
            </span>
          </MapLayer>
        )}
      </div>
      {/* Portail : la carte plein écran sort de la carte de séance (lien, animations) ; les clics n'y remontent pas. */}
      {open && createPortal(<MapViewer world={world} color={color} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}

/** Carte plein écran : glisser pour se déplacer, pincer / double tap / molette / boutons pour zoomer. */
function MapViewer({ world, color, onClose }: { world: [number, number][]; color: string; onClose: () => void }) {
  const { ref, w, h } = useWidth<HTMLDivElement>();
  const [view, setView] = useState<View | null>(null);
  const fit = () => w && h && setView(fitView(world, w, h, 48, MAX_ZOOM));
  useEffect(() => { if (w && h && !view) fit(); }, [w, h]); // eslint-disable-line react-hooks/exhaustive-deps

  // Zoom en gardant fixe le point de l'écran (sx, sy).
  const zoomAt = (v: View, dz: number, sx: number, sy: number): View => {
    const z = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, v.z + dz));
    const ws0 = TILE * 2 ** v.z, ws1 = TILE * 2 ** z;
    const wx = v.cx + (sx - w / 2) / ws0, wy = v.cy + (sy - h / 2) / ws0;
    return { z, cx: wx - (sx - w / 2) / ws1, cy: wy - (sy - h / 2) / ws1 };
  };

  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const lastTap = useRef(0);
  const local = (e: { clientX: number; clientY: number }) => {
    const r = ref.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const p = local(e);
    pointers.current.set(e.pointerId, p);
    if (pointers.current.size === 1) {
      const now = Date.now();
      if (now - lastTap.current < 280 && view) { setView(zoomAt(view, 1, p.x, p.y)); lastTap.current = 0; } else lastTap.current = now;
    }
  };
  const onMove = (e: React.PointerEvent) => {
    if (!view || !pointers.current.has(e.pointerId)) return;
    const prev = [...pointers.current.values()];
    const p = local(e);
    const before = pointers.current.get(e.pointerId)!;
    pointers.current.set(e.pointerId, p);
    const now = [...pointers.current.values()];
    if (now.length === 1) {
      const ws = TILE * 2 ** view.z;
      setView({ ...view, cx: view.cx - (p.x - before.x) / ws, cy: view.cy - (p.y - before.y) / ws });
    } else if (now.length >= 2) {
      const d0 = Math.hypot(prev[0].x - prev[1].x, prev[0].y - prev[1].y);
      const d1 = Math.hypot(now[0].x - now[1].x, now[0].y - now[1].y);
      const m0 = { x: (prev[0].x + prev[1].x) / 2, y: (prev[0].y + prev[1].y) / 2 };
      const m1 = { x: (now[0].x + now[1].x) / 2, y: (now[0].y + now[1].y) / 2 };
      const ws = TILE * 2 ** view.z;
      const panned = { ...view, cx: view.cx - (m1.x - m0.x) / ws, cy: view.cy - (m1.y - m0.y) / ws };
      setView(d0 > 0 ? zoomAt(panned, Math.log2(d1 / d0), m1.x, m1.y) : panned);
    }
  };
  const onUp = (e: React.PointerEvent) => { pointers.current.delete(e.pointerId); };
  const onWheel = (e: React.WheelEvent) => { if (view) { const p = local(e); setView(zoomAt(view, -e.deltaY * 0.0025, p.x, p.y)); } };
  const btn = 'pressable grid size-11 place-items-center rounded-full bg-white/90 text-slate-800 shadow-lg dark:bg-slate-900/90 dark:text-slate-100';

  return (
    <div className="overlay-in fixed inset-0 z-[60] bg-slate-200 dark:bg-slate-900" role="dialog" aria-label="Carte du parcours"
      onClick={(e) => e.stopPropagation()} data-noswipe>
      <div ref={ref} className="absolute inset-0 touch-none overflow-hidden" onPointerDown={onDown} onPointerMove={onMove}
        onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}>
        {view && w > 0 && <MapLayer view={view} world={world} w={w} h={h} color={color} />}
      </div>
      <div className="absolute top-0 left-0 flex w-full items-center justify-between p-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
        <button onClick={onClose} aria-label="Fermer la carte" className={btn}>
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
        </button>
      </div>
      <div className="absolute right-3 bottom-[max(2rem,calc(env(safe-area-inset-bottom)+1.5rem))] flex flex-col gap-2">
        <button aria-label="Zoomer" className={btn} onClick={() => view && setView(zoomAt(view, 1, w / 2, h / 2))}><span className="text-2xl leading-none">+</span></button>
        <button aria-label="Dézoomer" className={btn} onClick={() => view && setView(zoomAt(view, -1, w / 2, h / 2))}><span className="text-2xl leading-none">−</span></button>
        <button aria-label="Recentrer sur le parcours" className={btn} onClick={fit}>
          <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><circle cx="12" cy="12" r="3" /><path d="M12 2v3M12 19v3M2 12h3M19 12h3" /></svg>
        </button>
      </div>
      <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noreferrer"
        className="absolute bottom-[max(0.5rem,env(safe-area-inset-bottom))] left-2 rounded bg-white/85 px-1.5 text-[10px] text-slate-700 dark:bg-slate-900/85 dark:text-slate-300">© OpenStreetMap</a>
    </div>
  );
}
