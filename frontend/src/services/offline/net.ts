/** Connectivity helpers shared by the offline-aware services. */

import { useNetworkStore } from '@/stores/network-store'

/**
 * Our best guess, not a fact.
 *
 * navigator.onLine is only ever a hint: it reports whether the machine has a
 * network interface, not whether anything is reachable, and DevTools' offline
 * throttle pins it to false while every request would still succeed. It is
 * used to pick the wording of a failure and to bias a decision — never to
 * refuse a request outright, because a stuck `false` would then wedge the
 * whole app with no way back.
 */
export function isOffline(): boolean {
  return !useNetworkStore.getState().online
}

/**
 * A request came back, so we are online whatever the browser claimed.
 *
 * This is the recovery path: connectivity is proven by evidence rather than
 * asserted by a flag, so one successful call clears a false offline state and
 * the banner with it.
 */
export function markOnline(): void {
  const { online, setOnline } = useNetworkStore.getState()
  if (!online) setOnline(true)
}

export const OFFLINE_MESSAGE = 'You’re offline. Connect to the internet and try again.'
export const UNREACHABLE_MESSAGE = 'Couldn’t reach the server. Check your connection and try again.'

/**
 * Best-effort check for "the request never reached the server".
 * Covers fetch TypeErrors, the browser-specific messages supabase-js folds
 * into its error objects, and our own offline errors after services rewrap
 * them with friendlier text.
 */
export function isNetworkError(error: unknown): boolean {
  if (error instanceof TypeError) return true
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' && error !== null && 'message' in error
        ? String((error as { message: unknown }).message)
        : String(error)
  return /failed to fetch|load failed|networkerror|network request failed|fetch failed|you.re offline|reach the server/i.test(
    message,
  )
}
