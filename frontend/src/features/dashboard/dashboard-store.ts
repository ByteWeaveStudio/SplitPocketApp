import { create } from 'zustand'

import { getMyBalances } from '@/features/groups/groups-service'
import type { MyGroupBalance } from '@/features/groups/types'
import { listExpensesForMonth } from '@/features/personal-expenses/expenses-service'
import { currentMonthKey } from '@/lib/dates'
import { cacheKeys, cachedFetch } from '@/services/offline/cache'
import { getSupabase } from '@/services/supabase'
import { useAuthStore } from '@/stores/auth-store'
import type { Expense, ExpenseKind } from '@/types'

export interface RecentExpense extends Expense {
  groupName: string | null
}

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

interface DashboardState {
  monthExpenses: Expense[]
  recent: RecentExpense[]
  groupBalances: MyGroupBalance[]
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
  status: 'idle',
  error: null,

  load: async () => {
    if (get().status === 'loading') return
    set({ status: 'loading', error: null })
    try {
      const [monthExpenses, recent, groupBalances] = await Promise.all([
        listExpensesForMonth(currentMonthKey()),
        listRecent(8),
        getMyBalances(),
      ])
      set({ monthExpenses, recent, groupBalances, status: 'ready' })
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : 'Load failed.',
      })
    }
  },

  reset: () =>
    set({ monthExpenses: [], recent: [], groupBalances: [], status: 'idle', error: null }),
}))
