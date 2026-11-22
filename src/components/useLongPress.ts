import { useRef } from 'react';

/**
 * Appui long (≈ 500 ms) sur un élément : déclenche `onLong` avec une petite vibration.
 * Un mouvement du doigt annule (défilement) ; le tap qui suit un appui long est ignoré.
 */
export function useLongPress(onLong: () => void, delay = 500) {
  const timer = useRef<number | null>(null);
  const origin = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);
  const cancel = () => { if (timer.current) window.clearTimeout(timer.current); timer.current = null; };
  return {
    onPointerDown: (e: React.PointerEvent) => {
      fired.current = false;
      origin.current = { x: e.clientX, y: e.clientY };
      cancel();
      timer.current = window.setTimeout(() => { fired.current = true; navigator.vibrate?.(15); onLong(); }, delay);
    },
    onPointerMove: (e: React.PointerEvent) => {
      if (origin.current && Math.hypot(e.clientX - origin.current.x, e.clientY - origin.current.y) > 8) cancel();
    },
    onPointerUp: cancel,
    onPointerCancel: cancel,
    onPointerLeave: cancel,
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
    onClickCapture: (e: React.MouseEvent) => { if (fired.current) { e.stopPropagation(); e.preventDefault(); fired.current = false; } },
  };
}
