import { Activity, ArrowRight, Users } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'

import { EmptyState } from '@/components/empty-state'
import { ActivityIllustration } from '@/components/illustrations'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useCategoriesStore } from '@/features/categories/categories-store'
import { categoryIcon } from '@/features/categories/category-icons'
import { useDashboardStore } from '@/features/dashboard/dashboard-store'
import type { RecentExpense } from '@/features/dashboard/dashboard-store'
import type { MyGroupBalance } from '@/features/groups/types'
import { MonthSummary } from '@/features/personal-expenses/components/month-summary'
import { useExpenseSheetStore } from '@/features/personal-expenses/expense-sheet-store'
import { summarizeByCurrency } from '@/features/personal-expenses/expenses-store'
import { currentMonthKey, dayLabel, monthKeyLabel } from '@/lib/dates'
import { formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 5) return 'Up late'
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

export function DashboardPage() {
  const user = useAuthStore((state) => state.user)
  const { monthExpenses, recent, groupBalances, status, error, load } = useDashboardStore()
  const loadCategories = useCategoriesStore((state) => state.load)

  useEffect(() => {
    void load()
    void loadCategories()
  }, [load, loadCategories])

  const summaries = useMemo(() => summarizeByCurrency(monthExpenses), [monthExpenses])
  const firstName = user?.fullName?.split(' ')[0]
  const loading = status === 'idle' || status === 'loading'

  return (
    <>
      <PageHeader
        title={firstName ? `${greeting()}, ${firstName}` : greeting()}
        description={`Here's ${monthKeyLabel(currentMonthKey())} so far.`}
      />
      {status === 'error' ? (
        <EmptyState
          icon={Activity}
          title="Couldn’t load your dashboard"
          description={error ?? 'Something went wrong.'}
          action={
            <Button variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      ) : (
        <div className="flex flex-col gap-6">
          <section aria-label="This month" className="rise-in">
            <SectionHeading to="/expenses" label="Personal spending" linkLabel="All expenses" />
            <MonthSummary summaries={summaries} loading={loading} />
          </section>
          <div className="rise-in" style={{ '--stagger': 2 } as React.CSSProperties}>
            <GroupBalancesSection balances={groupBalances} loading={loading} />
          </div>
          <div className="rise-in" style={{ '--stagger': 4 } as React.CSSProperties}>
            <RecentActivitySection recent={recent} loading={loading} />
          </div>
        </div>
      )}
    </>
  )
}

function SectionHeading({
  label,
  to,
  linkLabel,
}: {
  label: string
  to: string
  linkLabel: string
}) {
  return (
    <div className="flex items-center justify-between pb-3">
      <h2 className="text-sm font-medium text-muted-foreground">{label}</h2>
      <Button variant="ghost" size="sm" asChild className="text-muted-foreground">
        <Link to={to}>
          {linkLabel}
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </Button>
    </div>
  )
}

function GroupBalancesSection({
  balances,
  loading,
}: {
  balances: MyGroupBalance[]
  loading: boolean
}) {
  const owed = balances.filter((b) => b.netMinor > 0)
  const owing = balances.filter((b) => b.netMinor < 0)

  return (
    <section aria-label="Group balances">
      <SectionHeading to="/groups" label="Group balances" linkLabel="All groups" />
      {loading ? (
        <Skeleton className="h-24 w-full rounded-xl" />
      ) : balances.length === 0 ? (
        <Card>
          <CardContent className="flex items-center gap-3 px-4 py-1 text-sm text-muted-foreground">
            <Users className="size-4 shrink-0" aria-hidden />
            No groups yet — create one to start splitting expenses.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <BalanceRollupCard label="You're owed" entries={owed} tone="positive" />
          <BalanceRollupCard label="You owe" entries={owing} tone="negative" />
        </div>
      )}
    </section>
  )
}

function BalanceRollupCard({
  label,
  entries,
  tone,
}: {
  label: string
  entries: MyGroupBalance[]
  tone: 'positive' | 'negative'
}) {
  const totals = new Map<string, number>()
  for (const entry of entries) {
    totals.set(entry.currency, (totals.get(entry.currency) ?? 0) + Math.abs(entry.netMinor))
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {totals.size === 0 ? (
          <p className="text-sm text-muted-foreground">
            {tone === 'positive' ? 'Nothing right now.' : 'Nothing — you’re all square.'}
          </p>
        ) : (
          <p
            className={cn(
              'money text-lg font-semibold',
              tone === 'positive' ? 'text-positive' : 'text-negative',
            )}
          >
            {[...totals.entries()]
              .map(([currency, amount]) => formatMoney(amount, currency))
              .join(' + ')}
          </p>
        )}
        {entries.map((entry) => (
          <Link
            key={entry.groupId}
            to={`/groups/${entry.groupId}`}
            className="flex items-center justify-between text-sm text-muted-foreground transition-colors hover:text-foreground"
          >
            <span className="truncate">{entry.groupName}</span>
            <span className="money">
              {formatMoney(Math.abs(entry.netMinor), entry.currency)}
            </span>
          </Link>
        ))}
      </CardContent>
    </Card>
  )
}

function RecentActivitySection({
  recent,
  loading,
}: {
  recent: RecentExpense[]
  loading: boolean
}) {
  const categories = useCategoriesStore((state) => state.categories)
  const categoriesById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  )
  const openNewExpense = useExpenseSheetStore((state) => state.openNew)

  return (
    <section aria-label="Recent activity">
      <SectionHeading to="/expenses" label="Recent activity" linkLabel="View all" />
      {loading ? (
        <Skeleton className="h-40 w-full rounded-xl" />
      ) : recent.length === 0 ? (
        <EmptyState
          illustration={<ActivityIllustration />}
          title="No activity yet"
          description="Expenses you add and groups you join will show up here."
          action={
            <Button variant="outline" onClick={openNewExpense}>
              Add your first expense
            </Button>
          }
        />
      ) : (
        <Card>
          <CardContent className="px-4 py-1">
            <ul className="flex flex-col">
              {recent.map((expense) => {
                const category = expense.categoryId
                  ? categoriesById.get(expense.categoryId)
                  : undefined
                const Icon = categoryIcon(category?.icon)
                const isIncome = expense.kind === 'income'
                return (
                  <li key={expense.id} className="border-b last:border-b-0">
                    <Link
                      to={expense.groupId ? `/groups/${expense.groupId}` : '/expenses'}
                      className="flex items-center gap-3 py-2.5"
                    >
                      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted">
                        <Icon className="size-4 text-muted-foreground" aria-hidden />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">
                          {expense.description}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {dayLabel(expense.date)}
                          {expense.groupName ? ` · ${expense.groupName}` : ' · Personal'}
                        </span>
                      </span>
                      <span
                        className={cn(
                          'money shrink-0 text-sm font-medium',
                          isIncome && 'text-positive',
                        )}
                      >
                        {isIncome ? '+' : ''}
                        {formatMoney(expense.amountMinor, expense.currency)}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          </CardContent>
        </Card>
      )}
    </section>
  )
}
