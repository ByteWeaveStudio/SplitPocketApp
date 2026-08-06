import {
  ArrowLeft,
  HandCoins,
  MoreVertical,
  Pencil,
  Plus,
  Trash2,
  UserPlus,
  Users,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { EmptyState } from '@/components/empty-state'
import { ReceiptIllustration } from '@/components/illustrations'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { AddMemberDialog } from '@/features/groups/components/add-member-dialog'
import { GroupExpenseSheet } from '@/features/groups/components/group-expense-sheet'
import { MemberAvatar } from '@/features/groups/components/member-avatar'
import { memberDisplayName } from '@/features/groups/display'
import { SettleUpDialog } from '@/features/groups/components/settle-up-dialog'
import { useGroupDetailStore } from '@/features/groups/group-detail-store'
import {
  deleteGroupExpense,
  deleteSettlement,
  removeMember,
} from '@/features/groups/groups-service'
import { useGroupsStore } from '@/features/groups/groups-store'
import type {
  GroupExpense,
  GroupSettlement,
  GroupWithMembers,
  SuggestedSettlement,
} from '@/features/groups/types'
import { dayLabel } from '@/lib/dates'
import { formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useAuthStore } from '@/stores/auth-store'

export function GroupDetailPage() {
  const { groupId } = useParams<{ groupId: string }>()
  const { group, expenses, settlements, balances, status, error, load } = useGroupDetailStore()

  useEffect(() => {
    if (groupId) void load(groupId)
  }, [groupId, load])

  if (status === 'error') {
    return (
      <EmptyState
        icon={Users}
        title="Couldn’t open this group"
        description={error ?? 'Something went wrong.'}
        action={
          <Button variant="outline" asChild>
            <Link to="/groups">Back to groups</Link>
          </Button>
        }
      />
    )
  }
  if (!group || status === 'loading' || status === 'idle') {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-10 w-56" />
        <Skeleton className="h-32 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    )
  }

  return (
    <GroupDetail group={group} expenses={expenses} settlements={settlements} balances={balances} />
  )
}

function GroupDetail({
  group,
  expenses,
  settlements,
  balances,
}: {
  group: GroupWithMembers
  expenses: GroupExpense[]
  settlements: GroupSettlement[]
  balances: ReturnType<typeof useGroupDetailStore.getState>['balances']
}) {
  const myUserId = useAuthStore((state) => state.user?.id ?? '')
  const navigate = useNavigate()
  const [addingMember, setAddingMember] = useState(false)
  const [expenseSheetOpen, setExpenseSheetOpen] = useState(false)
  const [editingExpense, setEditingExpense] = useState<GroupExpense | null>(null)
  const [settling, setSettling] = useState<SuggestedSettlement | null>(null)
  const [deletingExpense, setDeletingExpense] = useState<GroupExpense | null>(null)
  const [leaving, setLeaving] = useState(false)

  const membersById = new Map(group.members.map((m) => [m.userId, m]))
  const myRole = membersById.get(myUserId)?.role

  function openNewExpense() {
    setEditingExpense(null)
    setExpenseSheetOpen(true)
  }

  function confirmDeleteExpense() {
    if (!deletingExpense) return
    deleteGroupExpense(deletingExpense.id)
      .then(() => useGroupDetailStore.getState().refresh())
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : 'Couldn’t delete the expense.'),
      )
    toast.success('Expense deleted')
  }

  async function leaveGroup() {
    try {
      await removeMember(group.id, myUserId)
      toast.success(`You left ${group.name}`)
      void useGroupsStore.getState().refresh()
      void navigate('/groups')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Couldn’t leave the group.')
    }
  }

  return (
    <>
      <div className="flex flex-wrap items-center gap-3 pb-6">
        <Button variant="ghost" size="icon" asChild className="shrink-0">
          <Link to="/groups" aria-label="Back to groups">
            <ArrowLeft className="size-4" aria-hidden />
          </Link>
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-2xl font-semibold tracking-tight">{group.name}</h1>
          <p className="truncate text-sm text-muted-foreground">
            {group.currency}
            {group.description ? ` · ${group.description}` : ''}
          </p>
        </div>
        <Button onClick={openNewExpense}>
          <Plus className="size-4" aria-hidden />
          Add expense
        </Button>
      </div>

      <div className="flex flex-col gap-6">
        {[
          <MembersCard
            key="members"
            group={group}
            myUserId={myUserId}
            myRole={myRole}
            onAddMember={() => setAddingMember(true)}
            onLeave={() => setLeaving(true)}
          />,
          <BalancesCard
            key="balances"
            group={group}
            balances={balances}
            myUserId={myUserId}
            onSettle={setSettling}
          />,
          <ExpensesCard
            key="expenses"
            group={group}
            expenses={expenses}
            myUserId={myUserId}
            membersById={membersById}
            onAdd={openNewExpense}
            onEdit={(expense) => {
              setEditingExpense(expense)
              setExpenseSheetOpen(true)
            }}
            onDelete={setDeletingExpense}
          />,
          <SettlementsCard
            key="settlements"
            group={group}
            settlements={settlements}
            myUserId={myUserId}
          />,
        ].map((card, index) => (
          <div
            key={card.key}
            className="rise-in"
            style={{ '--stagger': index * 2 } as React.CSSProperties}
          >
            {card}
          </div>
        ))}
      </div>

      <GroupExpenseSheet
        group={group}
        editing={editingExpense}
        open={expenseSheetOpen}
        onOpenChange={(open) => {
          setExpenseSheetOpen(open)
          if (!open) setEditingExpense(null)
        }}
      />
      <AddMemberDialog groupId={group.id} open={addingMember} onOpenChange={setAddingMember} />
      <SettleUpDialog
        group={group}
        suggestion={settling}
        onOpenChange={(open) => {
          if (!open) setSettling(null)
        }}
      />
      <ConfirmDialog
        open={deletingExpense !== null}
        onOpenChange={(open) => {
          if (!open) setDeletingExpense(null)
        }}
        title="Delete this expense?"
        description={
          deletingExpense
            ? `"${deletingExpense.description}" and its splits will be removed for everyone.`
            : ''
        }
        onConfirm={confirmDeleteExpense}
      />
      <ConfirmDialog
        open={leaving}
        onOpenChange={setLeaving}
        title={`Leave ${group.name}?`}
        description="Your past expenses stay in the group's history."
        confirmLabel="Leave group"
        onConfirm={() => void leaveGroup()}
      />
    </>
  )
}

function MembersCard({
  group,
  myUserId,
  myRole,
  onAddMember,
  onLeave,
}: {
  group: GroupWithMembers
  myUserId: string
  myRole: string | undefined
  onAddMember: () => void
  onLeave: () => void
}) {
  function remove(userId: string, label: string) {
    removeMember(group.id, userId)
      .then(() => {
        toast.success(`${label} removed`)
        void useGroupDetailStore.getState().refresh()
      })
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : 'Couldn’t remove that member.'),
      )
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Members</CardTitle>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={onAddMember}>
            <UserPlus className="size-4" aria-hidden />
            Add member
          </Button>
          <Button variant="ghost" size="sm" onClick={onLeave}>
            Leave
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-2">
          {group.members.map((member) => (
            <li key={member.userId} className="flex items-center gap-3">
              <MemberAvatar member={member} className="size-8" />
              <span className="min-w-0 flex-1 truncate text-sm">
                {memberDisplayName(member, myUserId)}
                <span className="text-muted-foreground"> · {member.email}</span>
              </span>
              {member.role === 'owner' && <Badge variant="secondary">Owner</Badge>}
              {myRole === 'owner' && member.role !== 'owner' && member.userId !== myUserId && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground"
                  onClick={() => remove(member.userId, memberDisplayName(member, myUserId))}
                >
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function BalancesCard({
  group,
  balances,
  myUserId,
  onSettle,
}: {
  group: GroupWithMembers
  balances: ReturnType<typeof useGroupDetailStore.getState>['balances']
  myUserId: string
  onSettle: (suggestion: SuggestedSettlement) => void
}) {
  const membersById = new Map(group.members.map((m) => [m.userId, m]))
  const name = (userId: string) => {
    const member = membersById.get(userId)
    return member ? memberDisplayName(member, myUserId) : 'Former member'
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Balances</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <ul className="flex flex-col gap-1.5">
          {(balances?.members ?? []).map((entry) => (
            <li key={entry.userId} className="flex items-center justify-between text-sm">
              <span>{name(entry.userId)}</span>
              {entry.netMinor === 0 ? (
                <span className="text-muted-foreground">settled up</span>
              ) : (
                <span
                  className={cn(
                    'font-medium',
                    entry.netMinor > 0 ? 'text-positive' : 'text-negative',
                  )}
                >
                  {entry.netMinor > 0
                    ? entry.userId === myUserId
                      ? 'get back '
                      : 'gets back '
                    : entry.userId === myUserId
                      ? 'owe '
                      : 'owes '}
                  <span className="money">
                    {formatMoney(Math.abs(entry.netMinor), group.currency)}
                  </span>
                </span>
              )}
            </li>
          ))}
        </ul>
        {(balances?.suggestedSettlements.length ?? 0) > 0 && (
          <div className="flex flex-col gap-2 border-t pt-3">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Suggested settle-up
            </p>
            {balances?.suggestedSettlements.map((suggestion, index) => (
              <div key={index} className="flex items-center justify-between gap-2 text-sm">
                <span className="min-w-0 truncate">
                  {suggestion.fromUserId === myUserId
                    ? 'You pay'
                    : `${name(suggestion.fromUserId)} pays`}{' '}
                  {name(suggestion.toUserId)}{' '}
                  <strong className="money">
                    {formatMoney(suggestion.amountMinor, group.currency)}
                  </strong>
                </span>
                {(suggestion.fromUserId === myUserId || suggestion.toUserId === myUserId) && (
                  <Button variant="outline" size="sm" onClick={() => onSettle(suggestion)}>
                    <HandCoins className="size-4" aria-hidden />
                    Record
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function ExpensesCard({
  group,
  expenses,
  myUserId,
  membersById,
  onAdd,
  onEdit,
  onDelete,
}: {
  group: GroupWithMembers
  expenses: GroupExpense[]
  myUserId: string
  membersById: Map<string, GroupWithMembers['members'][number]>
  onAdd: () => void
  onEdit: (expense: GroupExpense) => void
  onDelete: (expense: GroupExpense) => void
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Expenses</CardTitle>
      </CardHeader>
      <CardContent>
        {expenses.length === 0 ? (
          <EmptyState
            illustration={<ReceiptIllustration />}
            title="Nothing shared yet"
            description="Add the first expense and split it with the group."
            action={
              <Button variant="outline" onClick={onAdd}>
                Add expense
              </Button>
            }
          />
        ) : (
          <ul className="flex flex-col">
            {expenses.map((expense) => {
              const payer = membersById.get(expense.userId)
              const myShare = expense.splits.find((s) => s.userId === myUserId)?.owedMinor
              const isMine = expense.userId === myUserId
              return (
                <li
                  key={expense.id}
                  className="flex items-center gap-3 border-b py-3 last:border-b-0"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{expense.description}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {dayLabel(expense.date)} · paid by{' '}
                      {payer ? memberDisplayName(payer, myUserId) : 'a former member'}
                      {myShare !== undefined &&
                        ` · your share ${formatMoney(myShare, group.currency)}`}
                    </p>
                  </div>
                  <span className="money shrink-0 text-sm font-medium">
                    {formatMoney(expense.amountMinor, group.currency)}
                  </span>
                  {isMine && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="size-8 shrink-0 text-muted-foreground"
                          aria-label={`Actions for ${expense.description}`}
                        >
                          <MoreVertical className="size-4" aria-hidden />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onEdit(expense)}>
                          <Pencil className="size-4" aria-hidden />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onClick={() => onDelete(expense)}>
                          <Trash2 className="size-4" aria-hidden />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </CardContent>
    </Card>
  )
}

function SettlementsCard({
  group,
  settlements,
  myUserId,
}: {
  group: GroupWithMembers
  settlements: GroupSettlement[]
  myUserId: string
}) {
  const [deleting, setDeleting] = useState<GroupSettlement | null>(null)
  if (settlements.length === 0) return null
  const membersById = new Map(group.members.map((m) => [m.userId, m]))
  const name = (userId: string) => {
    const member = membersById.get(userId)
    return member ? memberDisplayName(member, myUserId) : 'Former member'
  }

  function confirmDelete() {
    if (!deleting) return
    deleteSettlement(deleting.id)
      .then(() => useGroupDetailStore.getState().refresh())
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : 'Couldn’t delete the settlement.'),
      )
    toast.success('Settlement deleted')
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Settlements</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col">
          {settlements.map((settlement) => {
            const involved =
              settlement.fromUserId === myUserId || settlement.toUserId === myUserId
            return (
              <li
                key={settlement.id}
                className="flex items-center gap-3 border-b py-2.5 text-sm last:border-b-0"
              >
                <HandCoins className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  {name(settlement.fromUserId)} paid {name(settlement.toUserId)}{' '}
                  <strong className="money">
                    {formatMoney(settlement.amountMinor, group.currency)}
                  </strong>
                  <span className="text-muted-foreground">
                    {' '}
                    · {dayLabel(settlement.settledAt.slice(0, 10))}
                    {settlement.note ? ` · ${settlement.note}` : ''}
                  </span>
                </span>
                {involved && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 text-muted-foreground"
                    aria-label="Delete settlement"
                    onClick={() => setDeleting(settlement)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                )}
              </li>
            )
          })}
        </ul>
      </CardContent>
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title="Delete this settlement?"
        description={
          deleting
            ? `The record of ${name(deleting.fromUserId)} paying ${name(deleting.toUserId)} ${formatMoney(deleting.amountMinor, group.currency)} will be removed, and balances will include that debt again.`
            : ''
        }
        onConfirm={confirmDelete}
      />
    </Card>
  )
}
