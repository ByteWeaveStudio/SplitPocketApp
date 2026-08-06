/**
 * Minimal promise wrapper around IndexedDB for the offline layer.
 *
 * Two object stores:
 * - `cache`  — last-known server results, keyed by strings from `cache-keys`.
 * - `outbox` — queued mutations, keyed by an auto-incrementing `seq` so
 *   replay order matches the order the user made the changes.
 *
 * If IndexedDB is unavailable (old browsers, some private modes) everything
 * degrades to a no-op: reads return `undefined`, writes are dropped, and the
 * app behaves exactly as it did before offline support.
 */

const DB_NAME = 'splitpocket-offline'
const DB_VERSION = 1

export const CACHE_STORE = 'cache'
export const OUTBOX_STORE = 'outbox'

let dbPromise: Promise<IDBDatabase | null> | null = null

function openDb(): Promise<IDBDatabase | null> {
  dbPromise ??= new Promise((resolve) => {
    if (typeof indexedDB === 'undefined') {
      resolve(null)
      return
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(CACHE_STORE)) {
        db.createObjectStore(CACHE_STORE)
      }
      if (!db.objectStoreNames.contains(OUTBOX_STORE)) {
        db.createObjectStore(OUTBOX_STORE, { keyPath: 'seq', autoIncrement: true })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => resolve(null)
  })
  return dbPromise
}

/** Runs one request in its own transaction; `undefined` when IDB is unavailable. */
export async function idbRequest<T>(
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T | undefined> {
  const db = await openDb()
  if (!db) return undefined
  return new Promise((resolve, reject) => {
    const request = operation(db.transaction(storeName, mode).objectStore(storeName))
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error as Error)
  })
}
