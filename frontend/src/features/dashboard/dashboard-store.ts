import { collection, getDocs, limit as fsLimit, orderBy, query, where } from 'firebase/firestore'
import { create } from 'zustand'

import { getMyBalances, listGroups } from '@/features/groups/groups-service'
import type { GroupWithMembers, MyGroupBalance } from '@/features/groups/types'
import {
  listExpensesForMonth,
  toExpense,
} from '@/features/personal-expenses/expenses-service'
import { currentMonthKey } from '@/lib/dates'
import { getDb } from '@/services/firebase'
import { friendlyFirestoreMessage } from '@/services/firestore'
import { useAuthStore } from '@/stores/auth-store'
import type { Expense } from '@/types'

export interface RecentExpense extends Expense {
  groupName: string | null
}

/** A group card on the home screen: identity, my position in it, and how
 * recently anything happened. */
export interface ActiveGroup {
  group: GroupWithMembers
  balance: MyGroupBalance | undefined
  lastActivityAt: string | null
}

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

interface DashboardState {
  monthExpenses: Expense[]
  recent: RecentExpense[]
  groupBalances: MyGroupBalance[]
  groups: GroupWithMembers[]
  status: LoadStatus
  error: string | null
  load: () => Promise<void>
  reset: () => void
}

/**
 * Everything the user can see, personal and group alike, newest first.
 *
 * Postgres left the scoping to RLS and joined `groups(name)` for the label.
 * Firestore has neither, so membership is carried on each document as
 * `memberIds` (== [ownerId] for a personal expense) and the group's name is
 * denormalized onto the expense as `groupName`.
 */
async function listRecent(limit: number): Promise<RecentExpense[]> {
  const userId = useAuthStore.getState().user?.id ?? ''
  if (!userId) return []
  try {
    const snapshot = await getDocs(
      query(
        collection(getDb(), 'expenses'),
        where('memberIds', 'array-contains', userId),
        orderBy('createdAt', 'desc'),
        fsLimit(limit),
      ),
    )
    return snapshot.docs.map((d) => ({
      ...toExpense(d),
      groupName: (d.data().groupName as string | null) ?? null,
    }))
  } catch (error) {
    throw new Error(friendlyFirestoreMessage(error, 'Couldn’t load recent activity.'))
  }
}

export const useDashboardStore = create<DashboardState>()((set, get) => ({
  monthExpenses: [],
  recent: [],
  groupBalances: [],
  groups: [],
  status: 'idle',
  error: null,

  load: async () => {
    if (get().status === 'loading') return
    set({ status: 'loading', error: null })
    // Settled separately so one failing section costs that section instead
    // of the whole dashboard.
    const [month, recentActivity, balances, groups] = await Promise.allSettled([
      listExpensesForMonth(currentMonthKey()),
      listRecent(8),
      getMyBalances(),
      listGroups(),
    ])

    const failure = [month, recentActivity].find((r) => r.status === 'rejected')
    if (failure?.status === 'rejected') {
      const error = failure.reason
      set({
        status: 'error',
        error: error instanceof Error ? error.message : 'Load failed.',
      })
      return
    }

    set({
      monthExpenses: month.status === 'fulfilled' ? month.value : [],
      recent: recentActivity.status === 'fulfilled' ? recentActivity.value : [],
      groupBalances: balances.status === 'fulfilled' ? balances.value : [],
      groups: groups.status === 'fulfilled' ? groups.value : [],
      status: 'ready',
    })
  },

  reset: () =>
    set({
      monthExpenses: [],
      recent: [],
      groupBalances: [],
      groups: [],
      status: 'idle',
      error: null,
    }),
}))

/**
 * The groups worth putting on the home screen: live ones, most recently
 * touched first. A group nobody has spent in yet still ranks — by its creation
 * time, via the seeded `group.created` activity row — so a group created five
 * minutes ago does not sort below one that has been quiet for a year.
 */
export function rankActiveGroups(
  groups: GroupWithMembers[],
  balances: MyGroupBalance[],
  limit: number,
): ActiveGroup[] {
  const balanceByGroup = new Map(balances.map((balance) => [balance.groupId, balance]))
  return groups
    .filter((group) => group.archivedAt === null)
    .map((group) => {
      const balance = balanceByGroup.get(group.id)
      return {
        group,
        balance,
        lastActivityAt: balance?.lastActivityAt ?? group.createdAt,
      }
    })
    .sort((a, b) => (b.lastActivityAt ?? '').localeCompare(a.lastActivityAt ?? ''))
    .slice(0, limit)
}

/** Totals across every group, split into what you're owed and what you owe. */
export function rollUpBalances(balances: MyGroupBalance[]): {
  owed: Map<string, number>
  owing: Map<string, number>
} {
  const owed = new Map<string, number>()
  const owing = new Map<string, number>()
  for (const balance of balances) {
    if (balance.archived || balance.netMinor === 0) continue
    const target = balance.netMinor > 0 ? owed : owing
    target.set(
      balance.currency,
      (target.get(balance.currency) ?? 0) + Math.abs(balance.netMinor),
    )
  }
  return { owed, owing }
}
