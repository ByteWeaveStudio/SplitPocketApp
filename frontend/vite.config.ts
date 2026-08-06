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
