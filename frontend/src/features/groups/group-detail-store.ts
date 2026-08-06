import { create } from 'zustand'

import {
  getGroupBalances,
  listGroupExpenses,
  listGroups,
  listSettlements,
} from '@/features/groups/groups-service'
import type {
  GroupBalances,
  GroupExpense,
  GroupSettlement,
  GroupWithMembers,
} from '@/features/groups/types'
import type { Id } from '@/types'

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

interface GroupDetailState {
  groupId: Id | null
  group: GroupWithMembers | null
  expenses: GroupExpense[]
  settlements: GroupSettlement[]
  balances: GroupBalances | null
  status: LoadStatus
  error: string | null
  load: (groupId: Id) => Promise<void>
  /** Re-fetches everything for the current group (after any mutation). */
  refresh: () => Promise<void>
  reset: () => void
}

export const useGroupDetailStore = create<GroupDetailState>()((set, get) => ({
  groupId: null,
  group: null,
  expenses: [],
  settlements: [],
  balances: null,
  status: 'idle',
  error: null,

  load: async (groupId) => {
    set({ groupId, status: 'loading', error: null })
    try {
      // listGroups is RLS-filtered; membership checks happen server-side.
      const [groups, expenses, settlements, balances] = await Promise.all([
        listGroups(),
        listGroupExpenses(groupId),
        listSettlements(groupId),
        getGroupBalances(groupId),
      ])
      if (get().groupId !== groupId) return
      const group = groups.find((g) => g.id === groupId) ?? null
      if (!group) {
        set({ status: 'error', error: 'Group not found — it may have been deleted.' })
        return
      }
      set({ group, expenses, settlements, balances, status: 'ready' })
    } catch (error) {
      if (get().groupId !== groupId) return
      set({
        status: 'error',
        error: error instanceof Error ? error.message : 'Load failed.',
      })
    }
  },

  refresh: async () => {
    const { groupId } = get()
    if (groupId) await get().load(groupId)
  },

  reset: () =>
    set({
      groupId: null,
      group: null,
      expenses: [],
      settlements: [],
      balances: null,
      status: 'idle',
      error: null,
    }),
}))
