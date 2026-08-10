import { create } from 'zustand'

import { getMyBalances, listGroups } from '@/features/groups/groups-service'
import type { GroupWithMembers, MyGroupBalance } from '@/features/groups/types'
import { listExpensesForMonth } from '@/features/personal-expenses/expenses-service'
import { currentMonthKey } from '@/lib/dates'
import { cacheKeys, cachedFetch } from '@/services/offline/cache'
import { getSupabase } from '@/services/supabase'
import { useAuthStore } from '@/stores/auth-store'
import type { Expense, ExpenseKind } from '@/types'

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

function listRecent(limit: number): Promise<RecentExpense[]> {
  const userId = useAuthStore.getState().user?.id ?? ''
  return cachedFetch(cacheKeys.recentActivity(userId), () => fetchRecent(limit))
}

async function fetchRecent(limit: number): Promise<RecentExpense[]> {
  const { data, error } = await getSupabase()
    .from('expenses')
    .select('*, groups(name)')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw new Error(`Couldn't load recent activity. ${error.message}`)
  return data.map((row) => ({
    id: row.id,
    userId: row.user_id,
    groupId: row.group_id,
    paidBy: row.paid_by,
    categoryId: row.category_id,
    description: row.description,
    amountMinor: row.amount_minor,
    currency: row.currency,
    date: row.date,
    kind: row.kind as ExpenseKind,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    groupName: (row.groups as { name: string } | null)?.name ?? null,
  }))
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
    // Group balances are the only section that needs the Python API; the rest
    // is Supabase. Settled separately so an API outage costs that one section
    // instead of the whole dashboard.
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
