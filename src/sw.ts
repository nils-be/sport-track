/// <reference lib="webworker" />
// Service worker : cache de l'application (consultation hors ligne) + réception des fichiers
// partagés depuis Android (Web Share Target). Les appels aux API LLM ne sont jamais mis en cache.
import { clientsClaim } from 'workbox-core';
import { cleanupOutdatedCaches, precacheAndRoute } from 'workbox-precaching';

declare const self: ServiceWorkerGlobalScope & { __WB_MANIFEST: (string | { url: string; revision: string | null })[] };

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

export const SHARE_CACHE = 'shared-files';

// Tuiles de carte OpenStreetMap : cache local (consultation hors ligne), limité pour rester sobre.
const TILE_CACHE = 'osm-tiles';
const MAX_TILES = 600;

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.hostname !== 'tile.openstreetmap.org') return;
  event.respondWith((async () => {
    const cache = await caches.open(TILE_CACHE);
    const hit = await cache.match(event.request);
    if (hit) return hit;
    const res = await fetch(event.request);
    if (res.ok) {
      await cache.put(event.request, res.clone());
      const keys = await cache.keys();
      if (keys.length > MAX_TILES) await Promise.all(keys.slice(0, keys.length - MAX_TILES).map((k) => cache.delete(k)));
    }
    return res;
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'POST' || !url.pathname.endsWith('/share-target')) return;
  event.respondWith((async () => {
    const form = await event.request.formData();
    const cache = await caches.open(SHARE_CACHE);
    let i = 0;
    for (const f of form.getAll('files')) {
      if (!(f instanceof File)) continue;
      // Stockage temporaire : l'application les lit puis vide ce cache.
      await cache.put(`shared/${Date.now()}-${i++}`, new Response(f, { headers: { 'x-file-name': encodeURIComponent(f.name) } }));
    }
    return Response.redirect(new URL('./#/seances?partage=1', self.registration.scope).href, 303);
  })());
});
