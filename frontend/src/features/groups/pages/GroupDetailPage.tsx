import {
  Archive,
  ArchiveRestore,
  ArrowLeft,
  HandCoins,
  Link2,
  LogOut,
  MoreVertical,
  Plus,
  Settings2,
  ShieldCheck,
  Trash2,
  UserMinus,
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
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { useComposerStore } from '@/features/expense-composer/composer-store'
import { ActivityFeed } from '@/features/groups/components/activity-feed'
import { AddMemberDialog } from '@/features/groups/components/add-member-dialog'
import { ExpenseDetailDialog } from '@/features/groups/components/expense-detail-dialog'
import { GroupSettingsDialog } from '@/features/groups/components/group-settings-dialog'
import { InviteDialog } from '@/features/groups/components/invite-dialog'
import { MemberAvatar } from '@/features/groups/components/member-avatar'
import { SettleUpDialog } from '@/features/groups/components/settle-up-dialog'
import { isDeletedMember, memberDisplayName } from '@/features/groups/display'
import { useGroupDetailStore } from '@/features/groups/group-detail-store'
import {
  deleteGroupExpense,
  deleteSettlement,
  removeMember,
  setMemberRole,
  updateGroup,
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
  const openComposer = useComposerStore((state) => state.openNew)
  const openComposerEdit = useComposerStore((state) => state.openEdit)

  const [addingMember, setAddingMember] = useState(false)
  const [inviting, setInviting] = useState(false)
  const [editingSettings, setEditingSettings] = useState(false)
  const [viewing, setViewing] = useState<GroupExpense | null>(null)
  const [settling, setSettling] = useState<SuggestedSettlement | null>(null)
  const [deletingExpense, setDeletingExpense] = useState<GroupExpense | null>(null)
  const [leaving, setLeaving] = useState(false)
  const [archiving, setArchiving] = useState(false)

  const membersById = new Map(group.members.map((m) => [m.userId, m]))
  const myRole = membersById.get(myUserId)?.role
  const isOwner = myRole === 'owner'
  const archived = group.archivedAt !== null

  function confirmDeleteExpense() {
    if (!deletingExpense) return
    deleteGroupExpense(deletingExpense.id)
      .then(() => {
        toast.success('Expense deleted')
        return useGroupDetailStore.getState().refresh()
      })
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : 'Couldn’t delete the expense.'),
      )
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

  async function toggleArchive() {
    try {
      await updateGroup(group.id, { archived: !archived })
      toast.success(archived ? `${group.name} is back` : `${group.name} archived`)
      await useGroupDetailStore.getState().refresh()
      void useGroupsStore.getState().refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Couldn’t update the group.')
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
          <h1 className="flex items-center gap-2 truncate text-2xl font-semibold tracking-tight">
            <span className="truncate">{group.name}</span>
            {archived && <Badge variant="secondary">Archived</Badge>}
          </h1>
          <p className="truncate text-sm text-muted-foreground">
            {group.currency}
            {group.description ? ` · ${group.description}` : ''}
          </p>
        </div>
        {!archived && (
          <Button onClick={() => openComposer(group.id)}>
            <Plus className="size-4" aria-hidden />
            Add expense
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="icon" aria-label="Group actions">
              <MoreVertical className="size-4" aria-hidden />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {isOwner && (
              <DropdownMenuItem onClick={() => setEditingSettings(true)}>
                <Settings2 className="size-4" aria-hidden />
                Group settings
              </DropdownMenuItem>
            )}
            {isOwner && (
              <DropdownMenuItem onClick={() => setArchiving(true)}>
                {archived ? (
                  <ArchiveRestore className="size-4" aria-hidden />
                ) : (
                  <Archive className="size-4" aria-hidden />
                )}
                {archived ? 'Unarchive group' : 'Archive group'}
              </DropdownMenuItem>
            )}
            {isOwner && <DropdownMenuSeparator />}
            <DropdownMenuItem variant="destructive" onClick={() => setLeaving(true)}>
              <LogOut className="size-4" aria-hidden />
              Leave group
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {archived && (
        <p className="mb-6 rounded-lg border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
          This group is archived. Its history stays readable, but nothing new can be added until
          an owner brings it back.
        </p>
      )}

      <div className="flex flex-col gap-6">
        {[
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
            archived={archived}
            onAdd={() => openComposer(group.id)}
            onOpen={setViewing}
          />,
          <MembersCard
            key="members"
            group={group}
            myUserId={myUserId}
            isOwner={isOwner}
            archived={archived}
            onAddMember={() => setAddingMember(true)}
            onInvite={() => setInviting(true)}
          />,
          <SettlementsCard
            key="settlements"
            group={group}
            settlements={settlements}
            myUserId={myUserId}
          />,
          <ActivityFeed key="activity" group={group} />,
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

      <ExpenseDetailDialog
        group={group}
        expense={viewing}
        myUserId={myUserId}
        canEdit={
          !archived && viewing !== null && (viewing.userId === myUserId || isOwner)
        }
        onEdit={(expense) => {
          setViewing(null)
          openComposerEdit(expense)
        }}
        // Close the detail dialog before opening the confirm: stacking two
        // modals leaves focus trapped in the one underneath.
        onDelete={(expense) => {
          setViewing(null)
          setDeletingExpense(expense)
        }}
        onOpenChange={(open) => {
          if (!open) setViewing(null)
        }}
      />
      <AddMemberDialog groupId={group.id} open={addingMember} onOpenChange={setAddingMember} />
      <InviteDialog groupId={group.id} open={inviting} onOpenChange={setInviting} />
      <GroupSettingsDialog
        group={group}
        open={editingSettings}
        onOpenChange={setEditingSettings}
      />
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
            ? `"${deletingExpense.description}" and its splits will be removed for everyone, and the group will see that you deleted it.`
            : ''
        }
        onConfirm={confirmDeleteExpense}
      />
      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={archived ? `Bring ${group.name} back?` : `Archive ${group.name}?`}
        description={
          archived
            ? 'The group becomes active again and can take new expenses.'
            : 'Nobody will be able to add expenses or settle up until it is unarchived. Nothing is deleted.'
        }
        confirmLabel={archived ? 'Unarchive' : 'Archive'}
        onConfirm={() => void toggleArchive()}
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
  isOwner,
  archived,
  onAddMember,
  onInvite,
}: {
  group: GroupWithMembers
  myUserId: string
  isOwner: boolean
  archived: boolean
  onAddMember: () => void
  onInvite: () => void
}) {
  function act(promise: Promise<unknown>, success: string, failure: string) {
    promise
      .then(() => {
        toast.success(success)
        return useGroupDetailStore.getState().refresh()
      })
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : failure),
      )
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">Members</CardTitle>
        {!archived && (
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={onInvite}>
              <Link2 className="size-4" aria-hidden />
              Invite link
            </Button>
            <Button variant="ghost" size="sm" onClick={onAddMember}>
              <UserPlus className="size-4" aria-hidden />
              By email
            </Button>
          </div>
        )}
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col gap-1">
          {group.members.map((member) => {
            const label = memberDisplayName(member, myUserId)
            const isMe = member.userId === myUserId
            return (
              <li key={member.userId} className="flex items-center gap-3 py-1">
                <MemberAvatar member={member} className="size-8" />
                <span className="min-w-0 flex-1 truncate text-sm">
                  {label}
                  {/* A tombstoned profile's address is a generated placeholder,
                      not something anyone can be reached at. */}
                  {!isDeletedMember(member) && (
                    <span className="text-muted-foreground"> · {member.email}</span>
                  )}
                </span>
                {member.role === 'owner' && <Badge variant="secondary">Owner</Badge>}
                {isOwner && !isMe && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0 text-muted-foreground"
                        aria-label={`Actions for ${label}`}
                      >
                        <MoreVertical className="size-4" aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onClick={() =>
                          act(
                            setMemberRole(
                              group.id,
                              member.userId,
                              member.role === 'owner' ? 'member' : 'owner',
                            ),
                            member.role === 'owner'
                              ? `${label} is now a member`
                              : `${label} is now an owner`,
                            'Couldn’t change that role.',
                          )
                        }
                      >
                        <ShieldCheck className="size-4" aria-hidden />
                        {member.role === 'owner' ? 'Make a member' : 'Make an owner'}
                      </DropdownMenuItem>
                      {member.role !== 'owner' && (
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() =>
                            act(
                              removeMember(group.id, member.userId),
                              `${label} removed`,
                              'Couldn’t remove that member.',
                            )
                          }
                        >
                          <UserMinus className="size-4" aria-hidden />
                          Remove from group
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </li>
            )
          })}
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
  archived,
  onAdd,
  onOpen,
}: {
  group: GroupWithMembers
  expenses: GroupExpense[]
  myUserId: string
  archived: boolean
  onAdd: () => void
  onOpen: (expense: GroupExpense) => void
}) {
  const membersById = new Map(group.members.map((m) => [m.userId, m]))
  const name = (userId: string) => {
    const member = membersById.get(userId)
    return member ? memberDisplayName(member, myUserId) : 'a former member'
  }

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
            description={
              archived
                ? 'This group was archived before anything was added to it.'
                : 'Add the first expense and split it with the group.'
            }
            action={
              archived ? undefined : (
                <Button variant="outline" onClick={onAdd}>
                  Add expense
                </Button>
              )
            }
          />
        ) : (
          <ul className="flex flex-col">
            {expenses.map((expense) => {
              const myShare = expense.splits.find((s) => s.userId === myUserId)?.owedMinor
              const method = expense.splits[0]?.method
              return (
                <li key={expense.id} className="border-b last:border-b-0">
                  <button
                    type="button"
                    onClick={() => onOpen(expense)}
                    className="flex w-full items-center gap-3 py-3 text-left transition-colors hover:bg-accent/40"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {expense.description}
                        </span>
                        {method === 'itemized' && (
                          <Badge variant="secondary" className="shrink-0 text-[10px]">
                            {expense.items.length} items
                          </Badge>
                        )}
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {dayLabel(expense.date)} · paid by {name(expense.paidBy)}
                        {myShare !== undefined &&
                          ` · your share ${formatMoney(myShare, group.currency)}`}
                      </span>
                    </span>
                    <span className="money shrink-0 text-sm font-medium">
                      {formatMoney(expense.amountMinor, group.currency)}
                    </span>
                  </button>
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
  const membersById = new Map(group.members.map((m) => [m.userId, m]))
  const name = (userId: string) => {
    const member = membersById.get(userId)
    return member ? memberDisplayName(member, myUserId) : 'Former member'
  }

  function confirmDelete() {
    if (!deleting) return
    deleteSettlement(deleting.id)
      .then(() => {
        toast.success('Settlement deleted')
        return useGroupDetailStore.getState().refresh()
      })
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : 'Couldn’t delete the settlement.'),
      )
  }

  if (settlements.length === 0) return null

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
