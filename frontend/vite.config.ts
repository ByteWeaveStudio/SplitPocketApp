import path from 'node:path'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Precache the app shell so the web app boots offline (native builds
    // already serve assets locally). Data comes from the IndexedDB cache;
    // API/Supabase requests are never intercepted.
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
        navigateFallback: 'index.html',
        // Never serve index.html for backend or Supabase auth callbacks.
        navigateFallbackDenylist: [/^\/api\//, /^\/docs/],
      },
    }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
