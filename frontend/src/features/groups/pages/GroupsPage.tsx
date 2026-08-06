import { Plus, Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { EmptyState } from '@/components/empty-state'
import { GroupIllustration } from '@/components/illustrations'
import { PageHeader } from '@/components/page-header'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { CreateGroupDialog } from '@/features/groups/components/create-group-dialog'
import { MemberAvatar } from '@/features/groups/components/member-avatar'
import { useGroupsStore } from '@/features/groups/groups-store'
import type { GroupWithMembers, MyGroupBalance } from '@/features/groups/types'
import { formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'

export function GroupsPage() {
  const { groups, netByGroup, status, error, load } = useGroupsStore()
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    if (status === 'idle') void load()
  }, [status, load])

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
      {status === 'ready' && groups.length === 0 && (
        <EmptyState
          illustration={<GroupIllustration />}
          title="No groups yet"
          description="Create a group to split expenses with friends, roommates, or travel buddies."
          action={
            <Button variant="outline" onClick={() => setCreating(true)}>
              Create group
            </Button>
          }
        />
      )}
      {status === 'ready' && groups.length > 0 && (
        <ul className="flex flex-col gap-3">
          {groups.map((group, index) => (
            <GroupCard
              key={group.id}
              group={group}
              balance={netByGroup[group.id]}
              stagger={Math.min(index, 8)}
            />
          ))}
        </ul>
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
  const net = balance?.netMinor ?? 0
  return (
    <li className="rise-in" style={{ '--stagger': stagger } as React.CSSProperties}>
      <Link to={`/groups/${group.id}`} className="block">
        <Card className="transition-all hover:bg-accent/40 hover:ring-foreground/20">
          <CardContent className="flex items-center gap-4 px-4 py-1">
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{group.name}</p>
              <p className="truncate text-sm text-muted-foreground">
                {group.members.length} {group.members.length === 1 ? 'member' : 'members'} ·{' '}
                {group.currency}
                {group.description ? ` · ${group.description}` : ''}
              </p>
            </div>
            <div className="flex -space-x-2">
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
              {net === 0 ? (
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
