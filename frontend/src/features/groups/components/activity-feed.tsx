import {
  Archive,
  ArchiveRestore,
  HandCoins,
  MessageSquare,
  Pencil,
  PenLine,
  Receipt,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserMinus,
  UserPlus,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { useGroupDetailStore } from '@/features/groups/group-detail-store'
import type { ActivityEntry, ActivityKind, GroupWithMembers } from '@/features/groups/types'
import { formatMoney } from '@/lib/format'

const ICONS: Record<ActivityKind, LucideIcon> = {
  'group.created': Sparkles,
  'group.renamed': PenLine,
  'group.archived': Archive,
  'group.unarchived': ArchiveRestore,
  'member.added': UserPlus,
  'member.joined': UserPlus,
  'member.removed': UserMinus,
  'member.role_changed': ShieldCheck,
  'expense.added': Receipt,
  'expense.updated': Pencil,
  'expense.deleted': Trash2,
  'settlement.recorded': HandCoins,
  'settlement.deleted': Trash2,
  'comment.added': MessageSquare,
}

/**
 * One line of history. Everything it needs was denormalized onto the row at
 * write time, so an entry about a deleted expense still reads properly — see
 * the `detail` column in 20260807110000.
 */
function describe(entry: ActivityEntry): string {
  const { detail } = entry
  const money = () =>
    detail.amountMinor !== undefined && detail.currency
      ? formatMoney(detail.amountMinor, detail.currency)
      : ''

  switch (entry.kind) {
    case 'group.created':
      return `Created ${detail.groupName ?? 'the group'}`
    case 'group.renamed':
      return `Renamed ${detail.from ?? 'the group'} to ${detail.to ?? ''}`
    case 'group.archived':
      return 'Archived the group'
    case 'group.unarchived':
      return 'Brought the group back'
    case 'member.added':
      return `Added ${detail.memberName ?? 'someone'}`
    case 'member.joined':
      return `${detail.memberName ?? 'Someone'} joined with an invite link`
    case 'member.removed':
      return detail.left
        ? `${detail.memberName ?? 'Someone'} left`
        : `Removed ${detail.memberName ?? 'someone'}`
    case 'member.role_changed':
      return `Made ${detail.memberName ?? 'someone'} ${detail.role === 'owner' ? 'an owner' : 'a member'}`
    case 'expense.added':
      return `Added "${detail.description ?? 'an expense'}" ${money()}${
        detail.paidByName ? ` · paid by ${detail.paidByName}` : ''
      }`
    case 'expense.updated':
      return `Updated "${detail.description ?? 'an expense'}" ${money()}`
    case 'expense.deleted':
      return `Deleted "${detail.description ?? 'an expense'}" ${money()}`
    case 'settlement.recorded':
      return `${detail.fromName ?? 'Someone'} paid ${detail.toName ?? 'someone'} ${money()}`
    case 'settlement.deleted':
      return `Removed a payment of ${money()} from ${detail.fromName ?? 'someone'} to ${detail.toName ?? 'someone'}`
    case 'comment.added':
      return `Commented on "${detail.description ?? 'an expense'}"`
  }
}

/** "3 minutes ago" — relative, because a feed is about recency. */
function relativeTime(iso: string): string {
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000)
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  const steps: [Intl.RelativeTimeFormatUnit, number][] = [
    ['second', 60],
    ['minute', 60],
    ['hour', 24],
    ['day', 7],
    ['week', 4.35],
    ['month', 12],
  ]
  let value = seconds
  for (const [unit, size] of steps) {
    if (Math.abs(value) < size) return formatter.format(-Math.round(value), unit)
    value /= size
  }
  return formatter.format(-Math.round(value), 'year')
}

export function ActivityFeed({ group }: { group: GroupWithMembers }) {
  const activity = useGroupDetailStore((state) => state.activity)
  const activityBefore = useGroupDetailStore((state) => state.activityBefore)
  const activityLoading = useGroupDetailStore((state) => state.activityLoading)
  const loadMore = useGroupDetailStore((state) => state.loadMoreActivity)

  const nameOf = (actorId: string | null) => {
    if (!actorId) return 'Someone'
    const member = group.members.find((candidate) => candidate.userId === actorId)
    if (!member) return 'A former member'
    return (member.fullName ?? '').trim() || member.email
  }

  if (activity.length === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Activity</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col">
          {activity.map((entry) => {
            const Icon = ICONS[entry.kind] ?? Receipt
            return (
              <li key={entry.id} className="flex items-start gap-3 border-b py-2.5 last:border-b-0">
                <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-muted">
                  <Icon className="size-3.5 text-muted-foreground" aria-hidden />
                </span>
                <span className="min-w-0 flex-1 text-sm">
                  <span className="font-medium">{nameOf(entry.actorId)}</span>{' '}
                  <span className="text-muted-foreground">{describe(entry)}</span>
                </span>
                <time
                  dateTime={entry.createdAt}
                  className="shrink-0 pt-0.5 text-xs text-muted-foreground"
                >
                  {relativeTime(entry.createdAt)}
                </time>
              </li>
            )
          })}
        </ul>
        {activityBefore && (
          <div className="pt-3 text-center">
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground"
              disabled={activityLoading}
              onClick={() => void loadMore()}
            >
              {activityLoading ? 'Loading…' : 'Show older'}
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
