import { create } from 'zustand'

import {
  createExpense,
  deleteExpense,
  listExpensesForMonth,
  updateExpense,
} from '@/features/personal-expenses/expenses-service'
import { currentMonthKey, monthKeyOf } from '@/lib/dates'
import type { MonthKey } from '@/lib/dates'
import { useAuthStore } from '@/stores/auth-store'
import type { Expense, ExpenseKind, Id } from '@/types'
import type { ExpenseInput } from '@/features/personal-expenses/expenses-service'

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

interface ExpensesState {
  month: MonthKey
  expenses: Expense[]
  status: LoadStatus
  error: string | null
  search: string
  categoryFilter: Id | 'all'
  kindFilter: ExpenseKind | 'all'
  setMonth: (month: MonthKey) => void
  load: () => Promise<void>
  setSearch: (search: string) => void
  setCategoryFilter: (categoryId: Id | 'all') => void
  setKindFilter: (kind: ExpenseKind | 'all') => void
  /** Mutations are optimistic: apply locally, roll back and rethrow on failure. */
  add: (input: ExpenseInput) => Promise<void>
  edit: (id: Id, input: ExpenseInput) => Promise<void>
  remove: (id: Id) => Promise<void>
  reset: () => void
}

function byDateDesc(a: Expense, b: Expense): number {
  return a.date === b.date
    ? b.createdAt.localeCompare(a.createdAt)
    : b.date.localeCompare(a.date)
}

function sorted(expenses: Expense[]): Expense[] {
  return [...expenses].sort(byDateDesc)
}

const initial = {
  month: currentMonthKey(),
  expenses: [] as Expense[],
  status: 'idle' as LoadStatus,
  error: null,
  search: '',
  categoryFilter: 'all' as const,
  kindFilter: 'all' as const,
}

export const useExpensesStore = create<ExpensesState>()((set, get) => ({
  ...initial,

  setMonth: (month) => {
    if (month === get().month) return
    set({ month, status: 'idle', expenses: [] })
    void get().load()
  },

  load: async () => {
    const { month, status } = get()
    if (status === 'loading') return
    set({ status: 'loading', error: null })
    try {
      const expenses = await listExpensesForMonth(month)
      // A rapid month switch may resolve out of order — keep only the current one.
      if (get().month === month) set({ expenses, status: 'ready' })
    } catch (error) {
      if (get().month === month) {
        set({ status: 'error', error: error instanceof Error ? error.message : 'Load failed.' })
      }
    }
  },

  setSearch: (search) => set({ search }),
  setCategoryFilter: (categoryFilter) => set({ categoryFilter }),
  setKindFilter: (kindFilter) => set({ kindFilter }),

  add: async (input) => {
    const id = crypto.randomUUID()
    const now = new Date().toISOString()
    const optimistic: Expense = {
      id,
      userId: useAuthStore.getState().user?.id ?? '',
      groupId: null,
      categoryId: input.categoryId,
      description: input.description,
      amountMinor: input.amountMinor,
      currency: input.currency,
      date: input.date,
      kind: input.kind,
      notes: input.notes,
      createdAt: now,
      updatedAt: now,
    }
    const inVisibleMonth = monthKeyOf(input.date) === get().month
    if (inVisibleMonth) {
      set((state) => ({ expenses: sorted([optimistic, ...state.expenses]) }))
    }
    try {
      const saved = await createExpense(id, input)
      if (inVisibleMonth) {
        set((state) => ({
          expenses: sorted(state.expenses.map((e) => (e.id === id ? saved : e))),
        }))
      }
    } catch (error) {
      if (inVisibleMonth) {
        set((state) => ({ expenses: state.expenses.filter((e) => e.id !== id) }))
      }
      throw error
    }
  },

  edit: async (id, input) => {
    const previous = get().expenses.find((e) => e.id === id)
    const stillVisible = monthKeyOf(input.date) === get().month
    set((state) => ({
      expenses: sorted(
        state.expenses
          .map((e) => (e.id === id ? { ...e, ...input } : e))
          .filter((e) => e.id !== id || stillVisible),
      ),
    }))
    try {
      const saved = await updateExpense(id, input)
      if (stillVisible) {
        set((state) => ({
          expenses: sorted(state.expenses.map((e) => (e.id === id ? saved : e))),
        }))
      }
    } catch (error) {
      if (previous) {
        set((state) => ({
          expenses: sorted([...state.expenses.filter((e) => e.id !== id), previous]),
        }))
      }
      throw error
    }
  },

  remove: async (id) => {
    const previous = get().expenses.find((e) => e.id === id)
    set((state) => ({ expenses: state.expenses.filter((e) => e.id !== id) }))
    try {
      await deleteExpense(id)
    } catch (error) {
      if (previous) {
        set((state) => ({ expenses: sorted([...state.expenses, previous]) }))
      }
      throw error
    }
  },

  reset: () => set({ ...initial, month: currentMonthKey() }),
}))

/** Month totals per currency, unaffected by search/filters. */
export interface CurrencySummary {
  currency: string
  spentMinor: number
  incomeMinor: number
}

export function summarizeByCurrency(expenses: Expense[]): CurrencySummary[] {
  const map = new Map<string, CurrencySummary>()
  for (const expense of expenses) {
    let entry = map.get(expense.currency)
    if (!entry) {
      entry = { currency: expense.currency, spentMinor: 0, incomeMinor: 0 }
      map.set(expense.currency, entry)
    }
    if (expense.kind === 'income') entry.incomeMinor += expense.amountMinor
    else entry.spentMinor += expense.amountMinor
  }
  return [...map.values()].sort((a, b) => b.spentMinor - a.spentMinor)
}

export function filterExpenses(
  expenses: Expense[],
  search: string,
  categoryFilter: Id | 'all',
  kindFilter: ExpenseKind | 'all',
): Expense[] {
  const query = search.trim().toLowerCase()
  return expenses.filter((expense) => {
    if (kindFilter !== 'all' && expense.kind !== kindFilter) return false
    if (categoryFilter !== 'all' && expense.categoryId !== categoryFilter) return false
    if (
      query &&
      !expense.description.toLowerCase().includes(query) &&
      !(expense.notes ?? '').toLowerCase().includes(query)
    ) {
      return false
    }
    return true
  })
}
