import { create } from 'zustand'

import type { Expense } from '@/types'

/**
 * Global open/close state for the expense form sheet, so the sidebar button,
 * the mobile "+" button, the `n` shortcut, and list rows can all drive one
 * sheet mounted in AppLayout.
 */
interface ExpenseSheetState {
  open: boolean
  /** Null = creating a new expense. */
  editing: Expense | null
  /**
   * Bumped on every open and used as the form's React key: reopening during
   * the close animation must not reuse the still-mounted previous form.
   */
  session: number
  openNew: () => void
  openEdit: (expense: Expense) => void
  setOpen: (open: boolean) => void
}

export const useExpenseSheetStore = create<ExpenseSheetState>()((set) => ({
  open: false,
  editing: null,
  session: 0,
  openNew: () => set((state) => ({ open: true, editing: null, session: state.session + 1 })),
  openEdit: (expense) =>
    set((state) => ({ open: true, editing: expense, session: state.session + 1 })),
  setOpen: (open) => set((state) => ({ open, editing: open ? state.editing : null })),
}))
