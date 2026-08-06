import { Plus, ReceiptText } from 'lucide-react'
import { useEffect, useMemo } from 'react'

import { EmptyState } from '@/components/empty-state'
import { ReceiptIllustration, SearchIllustration } from '@/components/illustrations'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { useCategoriesStore } from '@/features/categories/categories-store'
import { ExpenseFilters } from '@/features/personal-expenses/components/expense-filters'
import { ExpenseList } from '@/features/personal-expenses/components/expense-list'
import { MonthSwitcher } from '@/features/personal-expenses/components/month-switcher'
import { MonthSummary } from '@/features/personal-expenses/components/month-summary'
import { useExpenseSheetStore } from '@/features/personal-expenses/expense-sheet-store'
import {
  filterExpenses,
  summarizeByCurrency,
  useExpensesStore,
} from '@/features/personal-expenses/expenses-store'
import { monthKeyLabel } from '@/lib/dates'

export function ExpensesPage() {
  const month = useExpensesStore((state) => state.month)
  const setMonth = useExpensesStore((state) => state.setMonth)
  const expenses = useExpensesStore((state) => state.expenses)
  const status = useExpensesStore((state) => state.status)
  const error = useExpensesStore((state) => state.error)
  const load = useExpensesStore((state) => state.load)
  const search = useExpensesStore((state) => state.search)
  const categoryFilter = useExpensesStore((state) => state.categoryFilter)
  const kindFilter = useExpensesStore((state) => state.kindFilter)
  const setSearch = useExpensesStore((state) => state.setSearch)
  const setCategoryFilter = useExpensesStore((state) => state.setCategoryFilter)
  const setKindFilter = useExpensesStore((state) => state.setKindFilter)

  const openNew = useExpenseSheetStore((state) => state.openNew)
  const categories = useCategoriesStore((state) => state.categories)
  const loadCategories = useCategoriesStore((state) => state.load)

  useEffect(() => {
    if (status === 'idle') void load()
  }, [status, load])
  useEffect(() => {
    void loadCategories()
  }, [loadCategories])

  const filtered = useMemo(
    () => filterExpenses(expenses, search, categoryFilter, kindFilter),
    [expenses, search, categoryFilter, kindFilter],
  )
  const summaries = useMemo(() => summarizeByCurrency(expenses), [expenses])

  const loading = status === 'idle' || status === 'loading'

  function clearFilters() {
    setSearch('')
    setCategoryFilter('all')
    setKindFilter('all')
  }

  return (
    <>
      <PageHeader
        title="Expenses"
        description="Everything you spend, in one list."
        action={
          <Button onClick={openNew}>
            <Plus className="size-4" aria-hidden />
            Add expense
          </Button>
        }
      />
      <MonthSwitcher month={month} onChange={setMonth} />
      <MonthSummary summaries={summaries} loading={loading} />
      <ExpenseFilters categories={categories} />

      {status === 'error' && (
        <EmptyState
          icon={ReceiptText}
          title="Couldn’t load expenses"
          description={error ?? 'Something went wrong.'}
          action={
            <Button variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      )}
      {loading && <ListSkeleton />}
      {status === 'ready' && expenses.length === 0 && (
        <EmptyState
          illustration={<ReceiptIllustration />}
          title="No expenses this month"
          description={`Nothing recorded for ${monthKeyLabel(month)}. Anything you add lands here.`}
          action={
            <Button variant="outline" onClick={openNew}>
              Add expense
            </Button>
          }
        />
      )}
      {status === 'ready' && expenses.length > 0 && filtered.length === 0 && (
        <EmptyState
          illustration={<SearchIllustration />}
          title="No matching expenses"
          description="Nothing in this month matches your search and filters."
          action={
            <Button variant="outline" onClick={clearFilters}>
              Clear filters
            </Button>
          }
        />
      )}
      {status === 'ready' && filtered.length > 0 && (
        <ExpenseList expenses={filtered} categories={categories} />
      )}
    </>
  )
}

function ListSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden>
      <Skeleton className="h-4 w-28" />
      <Skeleton className="h-16 w-full rounded-xl" />
      <Skeleton className="h-16 w-full rounded-xl" />
      <Skeleton className="h-16 w-full rounded-xl" />
    </div>
  )
}
