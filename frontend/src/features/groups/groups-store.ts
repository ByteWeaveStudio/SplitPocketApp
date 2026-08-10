import { create } from 'zustand'

import { getMyBalances, listGroups } from '@/features/groups/groups-service'
import type { GroupWithMembers, MyGroupBalance } from '@/features/groups/types'

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

interface GroupsState {
  /** Every group I'm in, archived included — the page filters. */
  groups: GroupWithMembers[]
  /** My net per group, from the API — keyed by groupId. */
  netByGroup: Record<string, MyGroupBalance>
  /** Set when the group list loaded but the balances API didn't answer. */
  balancesUnavailable: boolean
  showArchived: boolean
  status: LoadStatus
  error: string | null
  setShowArchived: (showArchived: boolean) => void
  load: () => Promise<void>
  refresh: () => Promise<void>
  reset: () => void
}

const initial = {
  groups: [] as GroupWithMembers[],
  netByGroup: {} as Record<string, MyGroupBalance>,
  balancesUnavailable: false,
  showArchived: false,
  status: 'idle' as LoadStatus,
  error: null,
}

export const useGroupsStore = create<GroupsState>()((set, get) => ({
  ...initial,

  setShowArchived: (showArchived) => set({ showArchived }),

  load: async () => {
    if (get().status === 'loading') return
    set({ status: 'loading', error: null })
    // The two halves come from different backends: the list is a Supabase read,
    // the nets are a Python API call. Settled separately so an API outage costs
    // the amounts, not the page — losing the list to a balances failure reads
    // to the user as "my groups are gone".
    const [listed, netted] = await Promise.allSettled([listGroups(), getMyBalances()])

    if (listed.status === 'rejected') {
      const error = listed.reason
      set({
        status: 'error',
        error: error instanceof Error ? error.message : 'Load failed.',
      })
      return
    }

    const balances = netted.status === 'fulfilled' ? netted.value : []
    set({
      groups: listed.value,
      netByGroup: Object.fromEntries(balances.map((b) => [b.groupId, b])),
      balancesUnavailable: netted.status === 'rejected',
      status: 'ready',
    })
  },

  refresh: async () => {
    set({ status: 'idle' })
    await get().load()
  },

  // showArchived is a view preference, not loaded data — resetting it on
  // sign-out is right, resetting it on every refresh would not be.
  reset: () => set({ ...initial }),
}))

/**
 * Live groups first, each ordered by how recently anything happened in it;
 * archived ones (when shown) sink to the bottom, since they are history rather
 * than a to-do list.
 */
export function sortGroups(
  groups: GroupWithMembers[],
  netByGroup: Record<string, MyGroupBalance>,
  showArchived: boolean,
): GroupWithMembers[] {
  const activityOf = (group: GroupWithMembers) =>
    netByGroup[group.id]?.lastActivityAt ?? group.createdAt
  return groups
    .filter((group) => showArchived || group.archivedAt === null)
    .sort((a, b) => {
      const archivedDelta = Number(a.archivedAt !== null) - Number(b.archivedAt !== null)
      if (archivedDelta !== 0) return archivedDelta
      return activityOf(b).localeCompare(activityOf(a))
    })
}
