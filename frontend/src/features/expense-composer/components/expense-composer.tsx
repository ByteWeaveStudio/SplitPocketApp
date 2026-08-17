import { User, Users } from 'lucide-react'
import { useEffect, useState } from 'react'

import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { GroupExpenseForm } from '@/features/expense-composer/components/group-expense-form'
import { PersonalExpenseForm } from '@/features/expense-composer/components/personal-expense-form'
import { isGroupExpense, useComposerStore } from '@/features/expense-composer/composer-store'
import { useGroupsStore } from '@/features/groups/groups-store'
import type { GroupWithMembers } from '@/features/groups/types'
import { useMediaQuery } from '@/hooks/use-media-query'
import type { Id } from '@/types'

/** Sentinel for the personal option — Radix Select items can't have empty values. */
const PERSONAL = 'personal'

/**
 * The one place an expense is created or edited, mounted once in AppLayout.
 *
 * It opens by asking what the expense belongs to, because that is the first
 * thing that is true about it: a shared dinner and a solo coffee are different
 * records with different rules, and picking afterwards would mean re-entering
 * the amount. Editing locks the choice — an expense cannot move between a
 * group and your own ledger (the database forbids changing group_id, so
 * offering it here would be a promise the write can't keep).
 */
export function ExpenseComposer() {
  const { open, editing, initialGroupId, session, setOpen } = useComposerStore()
  const isDesktop = useMediaQuery('(min-width: 768px)')

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      {/* gap-0 because the body now owns its own rhythm, and the submit bar
          has to sit flush against the bottom edge to stay pinned. */}
      <SheetContent
        side={isDesktop ? 'right' : 'bottom'}
        className="gap-0 data-[side=bottom]:max-h-[92svh] data-[side=bottom]:rounded-t-2xl data-[side=right]:sm:max-w-md"
      >
        {open && (
          <ComposerBody
            key={session}
            editing={editing}
            initialGroupId={initialGroupId}
            onDone={() => setOpen(false)}
          />
        )}
      </SheetContent>
    </Sheet>
  )
}

function ComposerBody({
  editing,
  initialGroupId,
  onDone,
}: {
  editing: ReturnType<typeof useComposerStore.getState>['editing']
  initialGroupId: Id | null
  onDone: () => void
}) {
  const groups = useGroupsStore((state) => state.groups)
  const status = useGroupsStore((state) => state.status)
  const load = useGroupsStore((state) => state.load)
  const [target, setTarget] = useState<Id | typeof PERSONAL>(initialGroupId ?? PERSONAL)

  useEffect(() => {
    if (status === 'idle') void load()
  }, [status, load])

  // Archived groups accept no new expenses, so they are not offered — but one
  // stays selectable if that is where an expense being edited lives.
  const selectable = groups.filter(
    (group) => group.archivedAt === null || group.id === initialGroupId,
  )
  const group: GroupWithMembers | undefined =
    target === PERSONAL ? undefined : groups.find((candidate) => candidate.id === target)
  const locked = editing !== null

  const Icon = group ? Users : User

  return (
    <>
      {/* The target reads as context, not a question: opened from inside a
          group it is already correct, so it sits as a pill under the title
          rather than as the first labelled field of a form. */}
      <SheetHeader className="items-center gap-2 pb-3 text-center">
        <SheetTitle>{editing ? 'Edit expense' : 'Add expense'}</SheetTitle>
        <SheetDescription className="sr-only">
          {group
            ? `Split it with ${group.name} — in ${group.currency}.`
            : 'Log an expense or income — only what happened, no ceremony.'}
        </SheetDescription>

        {locked ? (
          <p className="flex h-9 items-center gap-2 rounded-full border bg-muted/50 px-3.5 text-sm font-medium">
            <Icon className="size-4 text-muted-foreground" aria-hidden />
            {group ? group.name : 'Personal'}
            <span className="text-xs font-normal text-muted-foreground">· can’t be moved</span>
          </p>
        ) : (
          <Select value={target} onValueChange={setTarget}>
            <SelectTrigger
              id="composer-target"
              aria-label="Add to"
              className="h-9 w-auto max-w-full rounded-full bg-secondary px-3.5 font-medium"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={PERSONAL}>
                <User className="size-4 text-muted-foreground" aria-hidden />
                Personal
              </SelectItem>
              {selectable.map((candidate) => (
                <SelectItem key={candidate.id} value={candidate.id}>
                  <Users className="size-4 text-muted-foreground" aria-hidden />
                  {candidate.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
        {target !== PERSONAL && !group && status === 'ready' && (
          <p className="text-sm text-destructive" role="alert">
            That group isn’t available right now.
          </p>
        )}
      </SheetHeader>

      {group ? (
        // Keyed by group: the split draft is a list of that group's member
        // ids, so switching groups has to start it over rather than carry
        // people who aren't in the new one.
        <GroupExpenseForm
          key={group.id}
          group={group}
          editing={editing && isGroupExpense(editing) ? editing : null}
          onDone={onDone}
        />
      ) : (
        <PersonalExpenseForm
          editing={editing && !isGroupExpense(editing) ? editing : null}
          onDone={onDone}
        />
      )}
    </>
  )
}
