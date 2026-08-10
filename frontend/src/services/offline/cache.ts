import { CACHE_STORE, OUTBOX_STORE, idbRequest } from '@/services/offline/db'
import { isNetworkError, isOffline, markOnline } from '@/services/offline/net'
import type { Id } from '@/types'

/**
 * Last-known server results, one entry per query. Keys embed the user id so
 * a different account on the same device never reads someone else's data
 * (the whole store is also wiped on sign-out).
 */
export const cacheKeys = {
  expensesMonth: (userId: Id, month: string) => `expenses:${userId}:${month}`,
  // Deliberately not under the `expenses:` prefix: patchMonthCaches walks that
  // prefix expecting one month per entry, and a multi-month range would be
  // rewritten as if it were one.
  expensesRange: (userId: Id, from: string, to: string) =>
    `expense-range:${userId}:${from}:${to}`,
  categories: (userId: Id) => `categories:${userId}`,
  groups: (userId: Id) => `groups:${userId}`,
  myBalances: (userId: Id) => `my-balances:${userId}`,
  groupExpenses: (userId: Id, groupId: Id) => `group-expenses:${userId}:${groupId}`,
  groupSettlements: (userId: Id, groupId: Id) => `group-settlements:${userId}:${groupId}`,
  groupBalances: (userId: Id, groupId: Id) => `group-balances:${userId}:${groupId}`,
  recentActivity: (userId: Id) => `recent:${userId}`,
}

export async function readCache<T>(key: string): Promise<T | null> {
  try {
    const value = await idbRequest(CACHE_STORE, 'readonly', (store) => store.get(key))
    return (value as T | undefined) ?? null
  } catch {
    return null
  }
}

export async function writeCache(key: string, value: unknown): Promise<void> {
  try {
    await idbRequest(CACHE_STORE, 'readwrite', (store) => store.put(value, key))
  } catch {
    // Caching is best-effort; the app keeps working without it.
  }
}

/** All cache keys currently stored (used to patch every cached month at once). */
export async function listCacheKeys(prefix: string): Promise<string[]> {
  try {
    const keys = await idbRequest(CACHE_STORE, 'readonly', (store) => store.getAllKeys())
    return (keys ?? []).filter((key): key is string => typeof key === 'string' && key.startsWith(prefix))
  } catch {
    return []
  }
}

/**
 * Network-first read: on success the result is cached; when the request
 * fails because we're offline (or the network dropped), the last cached
 * result is served instead. Errors that reached the server still throw.
 */
export async function cachedFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  try {
    const value = await fetcher()
    markOnline()
    await writeCache(key, value)
    return value
  } catch (error) {
    if (isOffline() || isNetworkError(error)) {
      const cached = await readCache<T>(key)
      if (cached !== null) return cached
    }
    throw error
  }
}

/** Wipes cache and outbox — called on sign-out so no data crosses accounts. */
export async function clearOfflineData(): Promise<void> {
  try {
    await idbRequest(CACHE_STORE, 'readwrite', (store) => store.clear())
    await idbRequest(OUTBOX_STORE, 'readwrite', (store) => store.clear())
  } catch {
    // Best-effort; keys are user-scoped as a second line of defense.
  }
}
