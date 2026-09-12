import { FirebaseError } from 'firebase/app'
import { Timestamp } from 'firebase/firestore'
import { toast } from 'sonner'

import { useNetworkStore } from '@/stores/network-store'
import type { ISODateString } from '@/types'

export const OFFLINE_MESSAGE = 'You’re offline — this will sync when you’re back.'

/** Browser connectivity. A hint, not a fact: see initConnectivity. */
export function isOffline(): boolean {
  return typeof navigator !== 'undefined' && !navigator.onLine
}

export function isFirebaseError(error: unknown): error is FirebaseError {
  return error instanceof FirebaseError
}

/** Firestore's code for "the rules said no" — a bug or a stale membership. */
export function isPermissionError(error: unknown): boolean {
  return isFirebaseError(error) && error.code === 'permission-denied'
}

/** True for failures that mean "the network, not the request, is the problem". */
export function isNetworkError(error: unknown): boolean {
  return (
    isFirebaseError(error) &&
    (error.code === 'unavailable' || error.code === 'deadline-exceeded')
  )
}

export function friendlyFirestoreMessage(error: unknown, fallback: string): string {
  if (isPermissionError(error)) return 'You don’t have access to that.'
  if (isNetworkError(error)) return OFFLINE_MESSAGE
  if (isFirebaseError(error)) return error.message
  if (error instanceof Error) return error.message
  return fallback
}

/**
 * Register a write as in-flight and let it finish in the background.
 *
 * Firestore applies a write to the local cache straight away but resolves its
 * promise only when the server acknowledges it — which, offline, is never.
 * Awaiting one would make adding an expense block on the network, the one
 * thing the product promises it never does. So callers fire the write, return
 * their optimistic result immediately, and hand the promise here: it drives
 * the pending badges and surfaces a rejection as a toast rather than an
 * unhandled rejection.
 */
export function trackWrite(id: string, work: Promise<unknown>, describe: string): void {
  useNetworkStore.getState().beginWrite(id)
  void work
    .catch((error: unknown) => {
      // An offline write is not a failure — it is queued and will land.
      if (isNetworkError(error)) return
      toast.error(`Couldn’t ${describe}. ${friendlyFirestoreMessage(error, 'Please try again.')}`)
    })
    .finally(() => {
      useNetworkStore.getState().endWrite(id)
    })
}

// ---------------------------------------------------------------------------
// Timestamp conversion
//
// The domain types are all ISO strings (see types/domain.ts). Firestore hands
// back Timestamps for server-set fields, and null for a serverTimestamp() that
// the local cache has not yet had confirmed — so every read goes through here.
// ---------------------------------------------------------------------------

export function toIso(value: unknown): ISODateString {
  if (value instanceof Timestamp) return value.toDate().toISOString()
  if (typeof value === 'string') return value
  if (value instanceof Date) return value.toISOString()
  // serverTimestamp() not yet resolved locally: treat as "just now" so newly
  // created rows sort to the top instead of vanishing to the bottom.
  return new Date().toISOString()
}

export function toIsoOrNull(value: unknown): ISODateString | null {
  if (value === null || value === undefined) return null
  return toIso(value)
}
