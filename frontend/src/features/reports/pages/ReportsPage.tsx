import { TrendingUp } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { EmptyState } from '@/components/empty-state'
import { ChartIllustration } from '@/components/illustrations'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useCategoriesStore } from '@/features/categories/categories-store'
import { categoryIcon } from '@/features/categories/category-icons'
import { MonthSummary } from '@/features/personal-expenses/components/month-summary'
import { MonthSwitcher } from '@/features/personal-expenses/components/month-switcher'
import { listExpensesForMonth } from '@/features/personal-expenses/expenses-service'
import { summarizeByCurrency } from '@/features/personal-expenses/expenses-store'
import { currentMonthKey, monthKeyLabel } from '@/lib/dates'
import type { MonthKey } from '@/lib/dates'
import { formatMoney } from '@/lib/format'
import type { Category, Expense, Id } from '@/types'

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

/** One bar-list row: a category's spending within one currency. */
interface CategorySlice {
  key: string
  label: string
  icon: string | undefined
  spentMinor: number
  share: number
}

/** Categories beyond this fold into "Everything else" so the list stays readable. */
const MAX_SLICES = 8

function sliceByCategory(
  expenses: Expense[],
  currency: string,
  categoriesById: Map<Id, Category>,
): CategorySlice[] {
  const totals = new Map<string, number>()
  for (const expense of expenses) {
    if (expense.currency !== currency || expense.kind !== 'expense') continue
    const key = expense.categoryId ?? 'uncategorized'
    totals.set(key, (totals.get(key) ?? 0) + expense.amountMinor)
  }
  const total = [...totals.values()].reduce((sum, value) => sum + value, 0)
  if (total === 0) return []

  const slices = [...totals.entries()]
    .map(([key, spentMinor]) => {
      const category = key === 'uncategorized' ? undefined : categoriesById.get(key)
      return {
        key,
        label: category?.name ?? 'Uncategorized',
        icon: category?.icon,
        spentMinor,
        share: spentMinor / total,
      }
    })
    .sort((a, b) => b.spentMinor - a.spentMinor)

  if (slices.length <= MAX_SLICES) return slices
  const kept = slices.slice(0, MAX_SLICES - 1)
  const rest = slices.slice(MAX_SLICES - 1)
  kept.push({
    key: 'other',
    label: `Everything else (${rest.length})`,
    icon: undefined,
    spentMinor: rest.reduce((sum, slice) => sum + slice.spentMinor, 0),
    share: rest.reduce((sum, slice) => sum + slice.share, 0),
  })
  return kept
}

export function ReportsPage() {
  const [month, setMonth] = useState<MonthKey>(currentMonthKey())
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [status, setStatus] = useState<LoadStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  const categories = useCategoriesStore((state) => state.categories)
  const loadCategories = useCategoriesStore((state) => state.load)

  useEffect(() => {
    void loadCategories()
  }, [loadCategories])

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setError(null)
    listExpensesForMonth(month)
      .then((result) => {
        if (cancelled) return
        setExpenses(result)
        setStatus('ready')
      })
      .catch((loadError: unknown) => {
        if (cancelled) return
        setError(loadError instanceof Error ? loadError.message : 'Load failed.')
        setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [month, attempt])

  const categoriesById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  )
  const summaries = useMemo(() => summarizeByCurrency(expenses), [expenses])
  const spending = summaries.filter((summary) => summary.spentMinor > 0)
  const loading = status === 'idle' || status === 'loading'

  return (
    <>
      <PageHeader
        title="Reports"
        description="Where your personal spending goes, month by month."
      />
      <MonthSwitcher month={month} onChange={setMonth} />

      {status === 'error' ? (
        <EmptyState
          icon={TrendingUp}
          title="Couldn’t load this report"
          description={error ?? 'Something went wrong.'}
          action={
            <Button variant="outline" onClick={() => setAttempt((count) => count + 1)}>
              Try again
            </Button>
          }
        />
      ) : (
        <>
          <MonthSummary summaries={summaries} loading={loading} />
          {loading ? (
            <Skeleton className="h-64 w-full rounded-xl" />
          ) : spending.length === 0 ? (
            <EmptyState
              illustration={<ChartIllustration />}
              title="Nothing to report"
              description={`No spending recorded for ${monthKeyLabel(month)}. The breakdown appears as soon as there is one expense.`}
            />
          ) : (
            <div className="flex flex-col gap-4">
              {spending.map((summary) => (
                <CategoryBreakdownCard
                  key={summary.currency}
                  currency={summary.currency}
                  totalMinor={summary.spentMinor}
                  slices={sliceByCategory(expenses, summary.currency, categoriesById)}
                  showCurrency={spending.length > 1}
                />
              ))}
            </div>
          )}
        </>
      )}
    </>
  )
}

function CategoryBreakdownCard({
  currency,
  totalMinor,
  slices,
  showCurrency,
}: {
  currency: string
  totalMinor: number
  slices: CategorySlice[]
  showCurrency: boolean
}) {
  return (
    <Card className="rise-in">
      <CardHeader className="flex flex-row items-baseline justify-between space-y-0">
        <CardTitle className="text-base">
          Spending by category{showCurrency ? ` · ${currency}` : ''}
        </CardTitle>
        <span className="money text-sm font-semibold">{formatMoney(totalMinor, currency)}</span>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-3">
          {slices.map((slice, index) => (
            <BarRow key={slice.key} slice={slice} currency={currency} index={index} />
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function BarRow({
  slice,
  currency,
  index,
}: {
  slice: CategorySlice
  currency: string
  index: number
}) {
  const Icon = categoryIcon(slice.icon)
  const percent = Math.round(slice.share * 100)
  return (
    <li className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3 text-sm">
        <span className="flex min-w-0 items-center gap-2">
          <Icon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{slice.label}</span>
          <span className="shrink-0 text-xs text-muted-foreground">{percent}%</span>
        </span>
        <span className="money shrink-0 font-medium">
          {formatMoney(slice.spentMinor, currency)}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="presentation">
        <div
          className="bar-grow h-full rounded-full bg-primary"
          style={
            {
              width: `${Math.max(slice.share * 100, 1.5)}%`,
              '--stagger': Math.min(index, 8),
            } as React.CSSProperties
          }
        />
      </div>
    </li>
  )
}
