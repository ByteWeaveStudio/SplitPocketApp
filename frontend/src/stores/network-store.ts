import { create } from 'zustand'

interface NetworkState {
  /** Browser connectivity (navigator.onLine, kept fresh by initSync). */
  online: boolean
  /** True while the outbox is being replayed against the server. */
  syncing: boolean
  /** Queued offline changes waiting to sync. */
  pendingCount: number
  /** Entity ids (expenses, categories) with a queued change — for row badges. */
  pendingIds: ReadonlySet<string>
  setOnline: (online: boolean) => void
  setSyncing: (syncing: boolean) => void
  setPending: (count: number, ids: ReadonlySet<string>) => void
}

/** Written by services/offline (initSync + outbox); read by the UI. */
export const useNetworkStore = create<NetworkState>()((set) => ({
  online: typeof navigator === 'undefined' ? true : navigator.onLine,
  syncing: false,
  pendingCount: 0,
  pendingIds: new Set<string>(),
  setOnline: (online) => set({ online }),
  setSyncing: (syncing) => set({ syncing }),
  setPending: (pendingCount, pendingIds) => set({ pendingCount, pendingIds }),
}))
