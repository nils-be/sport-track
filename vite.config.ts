import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';

// base relative : fonctionne sur GitHub Pages (sous-dossier du dépôt) avec HashRouter.
export default defineConfig({
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      registerType: 'autoUpdate',
      injectRegister: 'auto',
      injectManifest: {
        globPatterns: ['**/*.{js,css,html,svg,png,webmanifest}'],
      },
      includeAssets: ['icon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        name: 'Sport Track',
        short_name: 'Sport Track',
        description: 'Suivi et débrief de mes séances de course à pied et de natation',
        lang: 'fr',
        start_url: './',
        scope: './',
        display: 'standalone',
        orientation: 'portrait',
        // Couleurs système (barre d'état, barre de navigation Android) = fond de l'app, pour une couleur unifiée.
        background_color: '#f8fafc',
        theme_color: '#f8fafc',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // « Partager » un .fit ou un .zip depuis Android vers l'application.
        // Variante sombre (Chrome Android, quand le téléphone est en mode sombre).
        ...({ user_preferences: { color_scheme_dark: { theme_color: '#0b1120', background_color: '#0b1120' } } } as object),
        share_target: {
          action: './share-target',
          method: 'POST',
          enctype: 'multipart/form-data',
          params: {
            files: [{
              name: 'files',
              accept: ['.fit', '.zip', 'application/octet-stream', 'application/zip', 'application/x-zip-compressed', 'application/vnd.ant.fit'],
            }],
          },
        },
      },
    }),
  ],
});
