/**
 * Theme is a choice, not a reading of the OS.
 *
 * v1 defaulted to `system` and offered it as a third option. That made the
 * app's appearance change underneath people when their laptop flipped to dark
 * at sunset, and it made "which theme am I on?" a question with no answer the
 * UI could show. v2 has exactly two states, starts on light, and remembers
 * what was picked.
 */

export type Theme = 'light' | 'dark'

export const DEFAULT_THEME: Theme = 'light'

/** next-themes' default localStorage key. */
export const THEME_STORAGE_KEY = 'theme'

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark'
}

/**
 * Rewrite a stored `system` (or anything else stale) to the default before
 * next-themes reads it.
 *
 * Without this, an existing user who had picked "System" keeps that value in
 * storage; with enableSystem off, next-themes would put `class="system"` on
 * <html>, which is neither light nor dark — the app would render in light
 * tokens while the toggle and settings both showed no state at all.
 *
 * Called from main.tsx before render, so it lands ahead of the provider.
 */
export function migrateStoredTheme(): void {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    if (stored !== null && !isTheme(stored)) {
      window.localStorage.setItem(THEME_STORAGE_KEY, DEFAULT_THEME)
    }
  } catch {
    // Storage can be unavailable (private mode, blocked cookies). The provider
    // falls back to the default on its own, so there is nothing to recover.
  }
}
