import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      // We register the worker ourselves (src/lib/pwa.ts) so we can poll for
      // updates; disable the auto-injected registration to avoid doubling up.
      injectRegister: false,
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'L&D Energy — Floor Plan Studio',
        short_name: 'Floor Plan Studio',
        description:
          'Draw 2D floor plans with live measurements, EPC data and branded exports — works fully offline.',
        theme_color: '#0E3E36',
        background_color: '#F4F7F6',
        display: 'standalone',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2,ttf}'],
        navigateFallback: '/index.html',
        // Take control and drop stale precaches as soon as a new build's
        // worker activates, so refreshed tabs stop serving the old bundle.
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: true,
      },
    }),
  ],
  server: {
    host: true,
    port: 5173,
  },
});
