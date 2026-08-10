import { Archive, Plus, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'

import { EmptyState } from '@/components/empty-state'
import { GroupIllustration } from '@/components/illustrations'
import { PageHeader } from '@/components/page-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { CreateGroupDialog } from '@/features/groups/components/create-group-dialog'
import { MemberAvatar } from '@/features/groups/components/member-avatar'
import { sortGroups, useGroupsStore } from '@/features/groups/groups-store'
import type { GroupWithMembers, MyGroupBalance } from '@/features/groups/types'
import { formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'

export function GroupsPage() {
  const {
    groups,
    netByGroup,
    balancesUnavailable,
    showArchived,
    setShowArchived,
    status,
    error,
    load,
  } = useGroupsStore()
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (status === 'idle') void load()
  }, [status, load])

  const visible = useMemo(
    () => sortGroups(groups, netByGroup, showArchived),
    [groups, netByGroup, showArchived],
  )
  const archivedCount = groups.filter((group) => group.archivedAt !== null).length
  const liveCount = groups.length - archivedCount

  return (
    <>
      <PageHeader
        title="Groups"
        description="Split costs with the people you share them with."
        action={
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-4" aria-hidden />
            Create group
          </Button>
        }
      />
      {(status === 'idle' || status === 'loading') && (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      )}
      {status === 'error' && (
        <EmptyState
          icon={Users}
          title="Couldn’t load groups"
          description={error ?? 'Something went wrong.'}
          action={
            <Button variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          }
        />
      )}
      {status === 'ready' && liveCount === 0 && !showArchived && (
        <EmptyState
          illustration={<GroupIllustration />}
          title={archivedCount > 0 ? 'No active groups' : 'No groups yet'}
          description={
            archivedCount > 0
              ? `Everything you're in is archived. ${archivedCount === 1 ? 'It' : 'They'} can be brought back at any time.`
              : 'Create a group to split expenses with friends, roommates, or travel buddies.'
          }
          action={
            archivedCount > 0 ? (
              <Button variant="outline" onClick={() => setShowArchived(true)}>
                <Archive className="size-4" aria-hidden />
                Show archived
              </Button>
            ) : (
              <Button variant="outline" onClick={() => setCreating(true)}>
                Create group
              </Button>
            )
          }
        />
      )}
      {status === 'ready' && (liveCount > 0 || showArchived) && (
        <>
          {balancesUnavailable && (
            <p className="mb-3 text-sm text-muted-foreground" role="status">
              Balances are unavailable right now — amounts will reappear once the connection is
              back.
            </p>
          )}
          <ul className="flex flex-col gap-3">
            {visible.map((group, index) => (
              <GroupCard
                key={group.id}
                group={group}
                balance={netByGroup[group.id]}
                stagger={Math.min(index, 8)}
              />
            ))}
          </ul>
          {archivedCount > 0 && (
            <div className="pt-4 text-center">
              <Button
                variant="ghost"
                size="sm"
                className="text-muted-foreground"
                onClick={() => setShowArchived(!showArchived)}
              >
                <Archive className="size-4" aria-hidden />
                {showArchived
                  ? 'Hide archived'
                  : `Show ${archivedCount} archived ${archivedCount === 1 ? 'group' : 'groups'}`}
              </Button>
            </div>
          )}
        </>
      )}
      <CreateGroupDialog open={creating} onOpenChange={setCreating} />
    </>
  )
}

function GroupCard({
  group,
  balance,
  stagger,
}: {
  group: GroupWithMembers
  balance: MyGroupBalance | undefined
  stagger: number
}) {
  // No balance is not the same as a zero balance: claiming "Settled up" when
  // the amounts never arrived tells the user something about their money that
  // we don't actually know.
  const net = balance?.netMinor ?? 0
  const archived = group.archivedAt !== null

  return (
    <li className="rise-in" style={{ '--stagger': stagger } as React.CSSProperties}>
      <Link to={`/groups/${group.id}`} className="block">
        <Card
          className={cn(
            'transition-all hover:bg-accent/40 hover:ring-foreground/20',
            archived && 'opacity-70',
          )}
        >
          <CardContent className="flex items-center gap-4 px-4 py-1">
            <div className="min-w-0 flex-1">
              <p className="flex items-center gap-2 truncate font-medium">
                <span className="truncate">{group.name}</span>
                {archived && (
                  <Badge variant="secondary" className="shrink-0">
                    Archived
                  </Badge>
                )}
              </p>
              <p className="truncate text-sm text-muted-foreground">
                {group.members.length} {group.members.length === 1 ? 'member' : 'members'} ·{' '}
                {group.currency}
                {group.description ? ` · ${group.description}` : ''}
              </p>
            </div>
            <div className="hidden -space-x-2 sm:flex">
              {group.members.slice(0, 4).map((member) => (
                <MemberAvatar key={member.userId} member={member} className="size-7" />
              ))}
              {group.members.length > 4 && (
                <span className="flex size-7 items-center justify-center rounded-full border-2 border-background bg-muted text-[10px] font-medium">
                  +{group.members.length - 4}
                </span>
              )}
            </div>
            <div className="w-28 shrink-0 text-right">
              {balance === undefined ? (
                <span className="text-sm text-muted-foreground" aria-label="Balance unavailable">
                  —
                </span>
              ) : net === 0 ? (
                <span className="text-sm text-muted-foreground">Settled up</span>
              ) : (
                <>
                  <p className="text-xs text-muted-foreground">
                    {net > 0 ? 'you’re owed' : 'you owe'}
                  </p>
                  <p
                    className={cn(
                      'money text-sm font-semibold',
                      net > 0 ? 'text-positive' : 'text-negative',
                    )}
                  >
                    {formatMoney(Math.abs(net), group.currency)}
                  </p>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      </Link>
    </li>
  )
}
