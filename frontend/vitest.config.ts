import path from 'node:path'
import { defineConfig } from 'vitest/config'

// Deliberately not reusing vite.config.ts: tests don't need the React,
// Tailwind, or PWA plugins — only the "@" alias.
export default defineConfig({
  test: {
    environment: 'node',
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
})
