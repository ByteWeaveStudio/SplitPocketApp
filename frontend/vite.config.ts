import { copyFileSync } from 'node:fs'
import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

/**
 * GitHub Pages has no rewrite rules, so a cold load of /groups/abc is a 404
 * rather than the app. Pages does serve 404.html for any unmatched path, so
 * shipping a copy of index.html under that name turns its error page into the
 * SPA entry point and react-router takes it from there.
 *
 * Listed after VitePWA so the file is written once the service worker has
 * already globbed the build — the precache should hold index.html, not a
 * byte-identical twin of it.
 */
function spaFallback(): Plugin {
  return {
    name: 'splitpocket:spa-fallback-404',
    apply: 'build',
    closeBundle() {
      const dist = path.resolve(import.meta.dirname, 'dist')
      copyFileSync(path.join(dist, 'index.html'), path.join(dist, '404.html'))
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Precache the app shell so the web app boots offline (native builds
    // already serve assets locally). Data comes from Firestore's own
    // persistent cache; Firebase requests are never intercepted.
    VitePWA({
      registerType: 'autoUpdate',
      manifest: {
        name: 'SplitPocket',
        short_name: 'SplitPocket',
        description: 'Track personal spending and split shared expenses with friends.',
        theme_color: '#f8f8f5',
        background_color: '#f8f8f5',
        display: 'standalone',
        icons: [
          {
            src: 'favicon.svg',
            sizes: 'any',
            type: 'image/svg+xml',
            purpose: 'any',
          },
          // Android's installer ignores SVG icons, so ship raster too.
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          // Maskable is a separate drawing, not the same art tagged twice: the
          // launcher crops to a shape of its choosing, so this one is
          // full-bleed green with the mark inside the safe circle.
          {
            src: 'pwa-maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2}'],
        globIgnores: ['404.html'],
        navigateFallback: 'index.html',
      },
    }),
    spaFallback(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
