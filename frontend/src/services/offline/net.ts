/** Connectivity helpers shared by the offline-aware services. */

export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false
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
