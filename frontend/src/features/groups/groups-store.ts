import { create } from 'zustand'

import { getMyBalances, listGroups } from '@/features/groups/groups-service'
import type { GroupWithMembers, MyGroupBalance } from '@/features/groups/types'

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

interface GroupsState {
  groups: GroupWithMembers[]
  /** My net per group, from the API — keyed by groupId. */
  netByGroup: Record<string, MyGroupBalance>
  status: LoadStatus
  error: string | null
  load: () => Promise<void>
  refresh: () => Promise<void>
  reset: () => void
}

export const useGroupsStore = create<GroupsState>()((set, get) => ({
  groups: [],
  netByGroup: {},
  status: 'idle',
  error: null,

  load: async () => {
    if (get().status === 'loading') return
    set({ status: 'loading', error: null })
    try {
      const [groups, balances] = await Promise.all([listGroups(), getMyBalances()])
      set({
        groups,
        netByGroup: Object.fromEntries(balances.map((b) => [b.groupId, b])),
        status: 'ready',
      })
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : 'Load failed.',
      })
    }
  },

  refresh: async () => {
    set({ status: 'idle' })
    await get().load()
  },

  reset: () => set({ groups: [], netByGroup: {}, status: 'idle', error: null }),
}))
