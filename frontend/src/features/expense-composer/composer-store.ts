import { create } from 'zustand'

import type { GroupExpense } from '@/features/groups/types'
import type { Expense, Id } from '@/types'

/** A group expense carries its splits; a personal one has nothing to carry. */
export function isGroupExpense(expense: Expense | GroupExpense): expense is GroupExpense {
  return 'splits' in expense
}

/**
 * Global open/close state for the one expense composer, so the sidebar button,
 * the mobile "+", the `n` shortcut, a group page and any list row can all
 * drive the single sheet mounted in AppLayout.
 */
interface ComposerState {
  open: boolean
  /** Null = creating. */
  editing: Expense | GroupExpense | null
  /**
   * Which group a *new* expense starts against; null means personal. Set when
   * the composer is opened from inside a group, so the common case there is
   * zero taps on the group picker.
   */
  initialGroupId: Id | null
  /**
   * Bumped on every open and used as the form's React key: reopening during
   * the close animation must not reuse the still-mounted previous form.
   */
  session: number
  openNew: (groupId?: Id | null) => void
  openEdit: (expense: Expense | GroupExpense) => void
  setOpen: (open: boolean) => void
}

export const useComposerStore = create<ComposerState>()((set) => ({
  open: false,
  editing: null,
  initialGroupId: null,
  session: 0,

  openNew: (groupId = null) =>
    set((state) => ({
      open: true,
      editing: null,
      initialGroupId: groupId,
      session: state.session + 1,
    })),

  openEdit: (expense) =>
    set((state) => ({
      open: true,
      editing: expense,
      initialGroupId: expense.groupId,
      session: state.session + 1,
    })),

  setOpen: (open) =>
    set((state) => ({
      open,
      editing: open ? state.editing : null,
      initialGroupId: open ? state.initialGroupId : null,
    })),
}))
