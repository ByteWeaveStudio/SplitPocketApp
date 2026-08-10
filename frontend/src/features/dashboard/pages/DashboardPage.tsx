import { Activity, ArrowRight, Plus } from 'lucide-react'
import { useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'

import { EmptyState } from '@/components/empty-state'
import { ActivityIllustration, GroupIllustration } from '@/components/illustrations'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { useCategoriesStore } from '@/features/categories/categories-store'
import { categoryIcon } from '@/features/categories/category-icons'
import {
  rankActiveGroups,
  rollUpBalances,
  useDashboardStore,
} from '@/features/dashboard/dashboard-store'
import type { ActiveGroup, RecentExpense } from '@/features/dashboard/dashboard-store'
import { useComposerStore } from '@/features/expense-composer/composer-store'
import { MemberAvatar } from '@/features/groups/components/member-avatar'
import type { MyGroupBalance } from '@/features/groups/types'
import { MonthSummary } from '@/features/personal-expenses/components/month-summary'
import { summarizeByCurrency } from '@/features/personal-expenses/expenses-store'
import { currentMonthKey, dayLabel, monthKeyLabel } from '@/lib/dates'
import { formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

/** How many group cards home leads with before deferring to /groups. */
const ACTIVE_GROUP_LIMIT = 4

function greeting(): string {
  const hour = new Date().getHours()
  if (hour < 5) return 'Up late'
  if (hour < 12) return 'Good morning'
  if (hour < 17) return 'Good afternoon'
  return 'Good evening'
}

/**
 * Home leads with groups: balances first, then the groups they came from, and
 * personal spending after. v1 had this the other way round, which made the
 * first screen a personal-finance app that happened to have groups in it.
 */
export function DashboardPage() {
  const user = useAuthStore((state) => state.user)
  const { monthExpenses, recent, groupBalances, groups, status, error, load } =
    useDashboardStore()
  const loadCategories = useCategoriesStore((state) => state.load)

  useEffect(() => {
    void load()
    void loadCategories()
  }, [load, loadCategories])

  const summaries = useMemo(() => summarizeByCurrency(monthExpenses), [monthExpenses])
  const activeGroups = useMemo(
    () => rankActiveGroups(groups, groupBalances, ACTIVE_GROUP_LIMIT),
    [groups, groupBalances],
  )
  const firstName = user?.fullName?.split(' ')[0]
  const loading = status === 'idle' || status === 'loading'

  if (status === 'error') {
    return (
      <>
        <PageHeader title={firstName ? `${greeting()}, ${firstName}` : greeting()} />
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
      </>
    )
  }

  return (
    <>
      <PageHeader
        title={firstName ? `${greeting()}, ${firstName}` : greeting()}
        description="Who owes whom, and where your month is going."
      />
      <div className="flex flex-col gap-6">
        <div className="rise-in">
          <BalanceHero balances={groupBalances} loading={loading} />
        </div>
        <div className="rise-in" style={{ '--stagger': 2 } as React.CSSProperties}>
          <ActiveGroupsSection groups={activeGroups} loading={loading} />
        </div>
        <section
          aria-label="This month"
          className="rise-in"
          style={{ '--stagger': 4 } as React.CSSProperties}
        >
          <SectionHeading
            to="/expenses"
            label={`Personal spending · ${monthKeyLabel(currentMonthKey())}`}
            linkLabel="All expenses"
          />
          <MonthSummary summaries={summaries} loading={loading} />
        </section>
        <div className="rise-in" style={{ '--stagger': 6 } as React.CSSProperties}>
          <RecentActivitySection recent={recent} loading={loading} />
        </div>
      </div>
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
    <div className="flex items-center justify-between gap-2 pb-3">
      <h2 className="min-w-0 truncate text-sm font-medium text-muted-foreground">{label}</h2>
      <Button variant="ghost" size="sm" asChild className="shrink-0 text-muted-foreground">
        <Link to={to}>
          {linkLabel}
          <ArrowRight className="size-3.5" aria-hidden />
        </Link>
      </Button>
    </div>
  )
}

/**
 * Totals are per currency and never converted: an exchange rate the app
 * invented would be a number the group cannot actually settle to.
 */
function BalanceHero({ balances, loading }: { balances: MyGroupBalance[]; loading: boolean }) {
  const { owed, owing } = rollUpBalances(balances)
  if (loading) return <Skeleton className="h-24 w-full rounded-xl" />

  return (
    <Card className="grid grid-cols-2 gap-0 divide-x divide-border py-0">
      <BalanceCell label="You’re owed" totals={owed} tone="positive" />
      <BalanceCell label="You owe" totals={owing} tone="negative" />
    </Card>
  )
}

function BalanceCell({
  label,
  totals,
  tone,
}: {
  label: string
  totals: Map<string, number>
  tone: 'positive' | 'negative'
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1 px-4 py-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      {totals.size === 0 ? (
        <span className="text-[15px] font-medium text-muted-foreground sm:text-lg">Nothing</span>
      ) : (
        [...totals.entries()].map(([currency, amount]) => (
          <span
            key={currency}
            className={cn(
              'money truncate text-[15px] font-semibold sm:text-xl',
              tone === 'positive' ? 'text-positive' : 'text-negative',
            )}
          >
            {formatMoney(amount, currency)}
          </span>
        ))
      )}
    </div>
  )
}

function ActiveGroupsSection({ groups, loading }: { groups: ActiveGroup[]; loading: boolean }) {
  const openNew = useComposerStore((state) => state.openNew)

  return (
    <section aria-label="Active groups">
      <SectionHeading to="/groups" label="Active groups" linkLabel="All groups" />
      {loading ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      ) : groups.length === 0 ? (
        <EmptyState
          illustration={<GroupIllustration />}
          title="No groups yet"
          description="Create a group to split rent, a trip, or tonight's dinner with the people you share it with."
          action={
            <Button variant="outline" asChild>
              <Link to="/groups">Create a group</Link>
            </Button>
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {groups.map((entry) => (
            <ActiveGroupCard key={entry.group.id} entry={entry} onAdd={openNew} />
          ))}
        </ul>
      )}
    </section>
  )
}

function ActiveGroupCard({
  entry,
  onAdd,
}: {
  entry: ActiveGroup
  onAdd: (groupId: string) => void
}) {
  const { group, balance } = entry
  // No balance is not the same as a zero balance: claiming "settled up" when
  // the amounts never arrived tells the user something we don't actually know.
  const net = balance?.netMinor ?? 0

  return (
    <li>
      <Card className="h-full transition-all hover:bg-accent/40 hover:ring-foreground/20">
        <CardContent className="flex h-full flex-col gap-3 px-4 py-1">
          <Link to={`/groups/${group.id}`} className="flex min-w-0 items-start gap-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{group.name}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {group.members.length} {group.members.length === 1 ? 'member' : 'members'} ·{' '}
                {group.currency}
              </span>
            </span>
            <span className="flex shrink-0 -space-x-2">
              {group.members.slice(0, 3).map((member) => (
                <MemberAvatar key={member.userId} member={member} className="size-6" />
              ))}
              {group.members.length > 3 && (
                <span className="flex size-6 items-center justify-center rounded-full border-2 border-background bg-muted text-[9px] font-medium">
                  +{group.members.length - 3}
                </span>
              )}
            </span>
          </Link>
          <div className="mt-auto flex items-center justify-between gap-2">
            {balance === undefined ? (
              <span className="text-sm text-muted-foreground" aria-label="Balance unavailable">
                —
              </span>
            ) : net === 0 ? (
              <span className="text-sm text-muted-foreground">Settled up</span>
            ) : (
              <span className="min-w-0 truncate text-sm">
                <span className="text-muted-foreground">
                  {net > 0 ? 'you’re owed ' : 'you owe '}
                </span>
                <span
                  className={cn(
                    'money font-semibold',
                    net > 0 ? 'text-positive' : 'text-negative',
                  )}
                >
                  {formatMoney(Math.abs(net), group.currency)}
                </span>
              </span>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-8 shrink-0 text-muted-foreground"
              onClick={() => onAdd(group.id)}
            >
              <Plus className="size-3.5" aria-hidden />
              Add
            </Button>
          </div>
        </CardContent>
      </Card>
    </li>
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
  const openNewExpense = useComposerStore((state) => state.openNew)

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
            <Button variant="outline" onClick={() => openNewExpense()}>
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
