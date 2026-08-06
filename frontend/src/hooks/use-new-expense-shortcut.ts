import { useEffect } from 'react'

import { useExpenseSheetStore } from '@/features/personal-expenses/expense-sheet-store'

/** Pressing "n" anywhere outside a form field starts a new expense. */
export function useNewExpenseShortcut() {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'n' || event.metaKey || event.ctrlKey || event.altKey) return
      const target = event.target
      if (target instanceof HTMLElement && target.closest('input, textarea, select, [contenteditable]')) {
        return
      }
      event.preventDefault()
      useExpenseSheetStore.getState().openNew()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])
}
