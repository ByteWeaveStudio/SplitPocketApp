import { Download, TrendingUp } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { EmptyState } from '@/components/empty-state'
import { ChartIllustration } from '@/components/illustrations'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { useCategoriesStore } from '@/features/categories/categories-store'
import { memberDisplayName } from '@/features/groups/display'
import { listGroupExpenses } from '@/features/groups/groups-service'
import { useGroupsStore } from '@/features/groups/groups-store'
import type { GroupExpense, GroupWithMembers } from '@/features/groups/types'
import { MonthSummary } from '@/features/personal-expenses/components/month-summary'
import { MonthSwitcher } from '@/features/personal-expenses/components/month-switcher'
import {
  listExpensesForMonth,
  listExpensesInRange,
} from '@/features/personal-expenses/expenses-service'
import { summarizeByCurrency } from '@/features/personal-expenses/expenses-store'
import { BarList } from '@/features/reports/components/bar-list'
import { MonthlyTrend } from '@/features/reports/components/monthly-trend'
import {
  downloadCsv,
  groupMemberStats,
  groupSpendingByCategory,
  monthlyTrend,
  spendingByCategory,
  toCsv,
} from '@/features/reports/reports-data'
import { currentMonthKey, monthKeyLabel, shiftMonthKey } from '@/lib/dates'
import type { MonthKey } from '@/lib/dates'
import { formatMinorForInput, formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'
import type { Category, Expense, Id } from '@/types'

type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'

/** How far the trend looks back. Six fits a phone without crowding. */
const TREND_MONTHS = 6

export function ReportsPage() {
  const categories = useCategoriesStore((state) => state.categories)
  const loadCategories = useCategoriesStore((state) => state.load)

  useEffect(() => {
    void loadCategories()
  }, [loadCategories])

  const categoriesById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  )

  return (
    <>
      <PageHeader title="Reports" description="Where the money went, month by month." />
      <Tabs defaultValue="personal">
        <TabsList className="mb-4 w-full">
          <TabsTrigger value="personal" className="flex-1">
            Personal
          </TabsTrigger>
          <TabsTrigger value="groups" className="flex-1">
            Groups
          </TabsTrigger>
        </TabsList>
        <TabsContent value="personal">
          <PersonalReport categoriesById={categoriesById} />
        </TabsContent>
        <TabsContent value="groups">
          <GroupReport categoriesById={categoriesById} />
        </TabsContent>
      </Tabs>
    </>
  )
}

// ---------------------------------------------------------------------------
// Personal
// ---------------------------------------------------------------------------

function PersonalReport({ categoriesById }: { categoriesById: Map<Id, Category> }) {
  const [month, setMonth] = useState<MonthKey>(currentMonthKey())
  const [expenses, setExpenses] = useState<Expense[]>([])
  const [history, setHistory] = useState<Expense[]>([])
  const [status, setStatus] = useState<LoadStatus>('idle')
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let cancelled = false
    setStatus('loading')
    setError(null)
    Promise.all([
      listExpensesForMonth(month),
      listExpensesInRange(shiftMonthKey(month, -(TREND_MONTHS - 1)), month),
    ])
      .then(([monthResult, rangeResult]) => {
        if (cancelled) return
        setExpenses(monthResult)
        setHistory(rangeResult)
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

  const summaries = useMemo(() => summarizeByCurrency(expenses), [expenses])
  const spending = summaries.filter((summary) => summary.spentMinor > 0)
  const loading = status === 'idle' || status === 'loading'
  // The trend is one chart, so it plots one currency: the one most spent in
  // this month. Mixing currencies on a single scale would compare rupees to
  // dollars by height.
  const trendCurrency = summaries[0]?.currency
  const trend = useMemo(
    () => (trendCurrency ? monthlyTrend(history.filter((e) => e.currency === trendCurrency), month, TREND_MONTHS) : []),
    [history, month, trendCurrency],
  )

  function exportCsv() {
    downloadCsv(
      `splitpocket-${month}.csv`,
      toCsv(
        ['Date', 'Description', 'Category', 'Type', 'Amount', 'Currency', 'Notes'],
        expenses.map((expense) => [
          expense.date,
          expense.description,
          (expense.categoryId ? categoriesById.get(expense.categoryId)?.name : '') ?? '',
          expense.kind,
          formatMinorForInput(expense.amountMinor, expense.currency),
          expense.currency,
          expense.notes ?? '',
        ]),
      ),
    )
  }

  if (status === 'error') {
    return (
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
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <MonthSwitcher month={month} onChange={setMonth} />
        <Button
          variant="outline"
          size="sm"
          className="mb-4"
          disabled={loading || expenses.length === 0}
          onClick={exportCsv}
        >
          <Download className="size-4" aria-hidden />
          Export CSV
        </Button>
      </div>

      <MonthSummary summaries={summaries} loading={loading} />

      {loading ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : spending.length === 0 && trend.length === 0 ? (
        <EmptyState
          illustration={<ChartIllustration />}
          title="Nothing to report"
          description={`No spending recorded for ${monthKeyLabel(month)}. The breakdown appears as soon as there is one expense.`}
        />
      ) : (
        <>
          {trendCurrency && trend.length > 0 && (
            <MonthlyTrend
              points={trend}
              currency={trendCurrency}
              title={`Last ${TREND_MONTHS} months${summaries.length > 1 ? ` · ${trendCurrency}` : ''}`}
            />
          )}
          {spending.map((summary) => (
            <Card key={summary.currency} className="rise-in">
              <CardHeader className="flex flex-row items-baseline justify-between space-y-0">
                <CardTitle className="text-base">
                  Spending by category{spending.length > 1 ? ` · ${summary.currency}` : ''}
                </CardTitle>
                <span className="money text-sm font-semibold">
                  {formatMoney(summary.spentMinor, summary.currency)}
                </span>
              </CardHeader>
              <CardContent>
                <BarList
                  slices={spendingByCategory(expenses, summary.currency, categoriesById)}
                  currency={summary.currency}
                />
              </CardContent>
            </Card>
          ))}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

function GroupReport({ categoriesById }: { categoriesById: Map<Id, Category> }) {
  const myUserId = useAuthStore((state) => state.user?.id ?? '')
  const groups = useGroupsStore((state) => state.groups)
  const groupsStatus = useGroupsStore((state) => state.status)
  const loadGroups = useGroupsStore((state) => state.load)

  const [groupId, setGroupId] = useState<Id | ''>('')
  const [expenses, setExpenses] = useState<GroupExpense[]>([])
  const [status, setStatus] = useState<LoadStatus>('idle')

  useEffect(() => {
    if (groupsStatus === 'idle') void loadGroups()
  }, [groupsStatus, loadGroups])

  // Default to the first group so the tab has something in it on arrival.
  useEffect(() => {
    if (!groupId && groups.length > 0) setGroupId(groups[0]?.id ?? '')
  }, [groups, groupId])

  useEffect(() => {
    if (!groupId) return
    let cancelled = false
    setStatus('loading')
    listGroupExpenses(groupId)
      .then((result) => {
        if (cancelled) return
        setExpenses(result)
        setStatus('ready')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => {
      cancelled = true
    }
  }, [groupId])

  const group: GroupWithMembers | undefined = groups.find(
    (candidate) => candidate.id === groupId,
  )

  const totalMinor = expenses.reduce((sum, expense) => sum + expense.amountMinor, 0)
  const memberStats = useMemo(
    () =>
      group
        ? groupMemberStats(expenses, group.members, (member) =>
            memberDisplayName(member, myUserId),
          )
        : [],
    [expenses, group, myUserId],
  )
  const trend = useMemo(
    () =>
      monthlyTrend(
        // Group expenses are all outgoings; the trend shows spend only, and
        // MonthlyTrend hides the income series when there is none.
        expenses.map((expense) => ({ ...expense, kind: 'expense' as const })),
        currentMonthKey(),
        TREND_MONTHS,
      ),
    [expenses],
  )

  function exportCsv() {
    if (!group) return
    const nameOf = (userId: Id) => {
      const member = group.members.find((candidate) => candidate.userId === userId)
      return member ? memberDisplayName(member, myUserId) : 'Former member'
    }
    downloadCsv(
      `splitpocket-${group.name.replace(/[^\w-]+/g, '-').toLowerCase()}.csv`,
      toCsv(
        ['Date', 'Description', 'Category', 'Paid by', 'Amount', 'Currency', 'Your share'],
        expenses.map((expense) => [
          expense.date,
          expense.description,
          (expense.categoryId ? categoriesById.get(expense.categoryId)?.name : '') ?? '',
          nameOf(expense.paidBy),
          formatMinorForInput(expense.amountMinor, expense.currency),
          expense.currency,
          formatMinorForInput(
            expense.splits.find((split) => split.userId === myUserId)?.owedMinor ?? 0,
            expense.currency,
          ),
        ]),
      ),
    )
  }

  if (groupsStatus === 'ready' && groups.length === 0) {
    return (
      <EmptyState
        illustration={<ChartIllustration />}
        title="No groups to report on"
        description="Create a group and add a shared expense — the breakdown shows up here."
      />
    )
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select value={groupId} onValueChange={setGroupId}>
          <SelectTrigger className="w-full sm:w-64" aria-label="Group">
            <SelectValue placeholder="Pick a group" />
          </SelectTrigger>
          <SelectContent>
            {groups.map((candidate) => (
              <SelectItem key={candidate.id} value={candidate.id}>
                {candidate.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button
          variant="outline"
          size="sm"
          disabled={status !== 'ready' || expenses.length === 0}
          onClick={exportCsv}
        >
          <Download className="size-4" aria-hidden />
          Export CSV
        </Button>
      </div>

      {status === 'loading' && <Skeleton className="h-64 w-full rounded-xl" />}

      {status === 'error' && (
        <EmptyState
          icon={TrendingUp}
          title="Couldn’t load that group"
          description="Something went wrong reading its expenses."
        />
      )}

      {status === 'ready' && group && expenses.length === 0 && (
        <EmptyState
          illustration={<ChartIllustration />}
          title="Nothing shared yet"
          description={`No expenses in ${group.name} to break down.`}
        />
      )}

      {status === 'ready' && group && expenses.length > 0 && (
        <>
          <Card>
            <CardContent className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-1">
              <span className="text-sm text-muted-foreground">
                {expenses.length} {expenses.length === 1 ? 'expense' : 'expenses'} in total
              </span>
              <span className="money text-xl font-semibold">
                {formatMoney(totalMinor, group.currency)}
              </span>
            </CardContent>
          </Card>

          <MonthlyTrend
            points={trend}
            currency={group.currency}
            title={`${group.name} · last ${TREND_MONTHS} months`}
          />

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Spending by category</CardTitle>
            </CardHeader>
            <CardContent>
              <BarList
                slices={groupSpendingByCategory(expenses, categoriesById)}
                currency={group.currency}
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Who paid, and whose it was</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col gap-2">
                {memberStats.map((stat) => (
                  <li
                    key={stat.userId}
                    className="flex items-center justify-between gap-3 border-b py-2 text-sm last:border-b-0"
                  >
                    <span className="min-w-0 flex-1 truncate">{stat.label}</span>
                    <span className="shrink-0 text-right">
                      <span className="block text-xs text-muted-foreground">paid</span>
                      <span className="money">{formatMoney(stat.paidMinor, group.currency)}</span>
                    </span>
                    <span className="w-24 shrink-0 text-right">
                      <span className="block text-xs text-muted-foreground">their share</span>
                      <span
                        className={cn(
                          'money',
                          stat.paidMinor - stat.shareMinor > 0 && 'text-positive',
                          stat.paidMinor - stat.shareMinor < 0 && 'text-negative',
                        )}
                      >
                        {formatMoney(stat.shareMinor, group.currency)}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  )
}
