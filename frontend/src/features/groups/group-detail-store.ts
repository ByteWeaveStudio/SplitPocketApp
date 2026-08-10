import { create } from 'zustand'

import {
  getGroupBalances,
  listActivity,
  listGroupExpenses,
  listGroups,
  listSettlements,
} from '@/features/groups/groups-service'
import type {
  ActivityEntry,
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
  activity: ActivityEntry[]
  /** Cursor for the next page; null once the feed is exhausted. */
  activityBefore: string | null
  activityLoading: boolean
  status: LoadStatus
  error: string | null
  load: (groupId: Id) => Promise<void>
  /** Re-fetches everything for the current group (after any mutation). */
  refresh: () => Promise<void>
  loadMoreActivity: () => Promise<void>
  reset: () => void
}

const initial = {
  groupId: null,
  group: null,
  expenses: [] as GroupExpense[],
  settlements: [] as GroupSettlement[],
  balances: null,
  activity: [] as ActivityEntry[],
  activityBefore: null,
  activityLoading: false,
  status: 'idle' as LoadStatus,
  error: null,
}

export const useGroupDetailStore = create<GroupDetailState>()((set, get) => ({
  ...initial,

  load: async (groupId) => {
    set({ groupId, status: 'loading', error: null })
    try {
      // listGroups is RLS-filtered; membership checks happen server-side.
      // The feed is settled separately: it is a nice-to-have panel, and an
      // API hiccup there must not take the ledger down with it.
      const [core, feed] = await Promise.all([
        Promise.all([
          listGroups(),
          listGroupExpenses(groupId),
          listSettlements(groupId),
          getGroupBalances(groupId),
        ]),
        listActivity(groupId).catch(() => null),
      ])
      if (get().groupId !== groupId) return
      const [groups, expenses, settlements, balances] = core
      const group = groups.find((g) => g.id === groupId) ?? null
      if (!group) {
        set({ status: 'error', error: 'Group not found — it may have been deleted.' })
        return
      }
      set({
        group,
        expenses,
        settlements,
        balances,
        activity: feed?.entries ?? [],
        activityBefore: feed?.nextBefore ?? null,
        status: 'ready',
      })
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

  loadMoreActivity: async () => {
    const { groupId, activityBefore, activityLoading } = get()
    if (!groupId || !activityBefore || activityLoading) return
    set({ activityLoading: true })
    try {
      const page = await listActivity(groupId, activityBefore)
      // A group switch mid-request would otherwise append someone else's feed.
      if (get().groupId !== groupId) return
      set((state) => ({
        activity: [...state.activity, ...page.entries],
        activityBefore: page.nextBefore,
      }))
    } catch {
      // Paging further is optional; the entries already shown stay valid.
    } finally {
      set({ activityLoading: false })
    }
  },

  reset: () => set({ ...initial }),
}))
