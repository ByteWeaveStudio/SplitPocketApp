import { create } from 'zustand'

interface NetworkState {
  /** Browser connectivity (navigator.onLine, kept fresh by initConnectivity). */
  online: boolean
  /** True while at least one write is still waiting for a server ack. */
  syncing: boolean
  /** Writes applied locally but not yet acknowledged by the server. */
  pendingCount: number
  /** Entity ids with an unacknowledged write — for row badges. */
  pendingIds: ReadonlySet<string>
  setOnline: (online: boolean) => void
  beginWrite: (id: string) => void
  endWrite: (id: string) => void
}

/**
 * Written by services/firestore.ts (trackWrite) and services/connectivity.ts;
 * read by the UI.
 *
 * Firestore applies a write to the local cache immediately and resolves its
 * promise only once the server has it, so "promise still pending" is exactly
 * the set of changes that have not synced. The same ids may be written more
 * than once before the first ack lands, so the counts are kept as a multiset
 * and an id leaves `pendingIds` only when its last write settles.
 */
const counts = new Map<string, number>()

function snapshot(): { pendingCount: number; pendingIds: ReadonlySet<string> } {
  let pendingCount = 0
  for (const n of counts.values()) pendingCount += n
  return { pendingCount, pendingIds: new Set(counts.keys()) }
}

export const useNetworkStore = create<NetworkState>()((set) => ({
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  syncing: false,
  pendingCount: 0,
  pendingIds: new Set<string>(),
  setOnline: (online) => set({ online }),
  beginWrite: (id) => {
    counts.set(id, (counts.get(id) ?? 0) + 1)
    const next = snapshot()
    set({ ...next, syncing: next.pendingCount > 0 })
  },
  endWrite: (id) => {
    const remaining = (counts.get(id) ?? 1) - 1
    if (remaining > 0) counts.set(id, remaining)
    else counts.delete(id)
    const next = snapshot()
    set({ ...next, syncing: next.pendingCount > 0 })
  },
}))
