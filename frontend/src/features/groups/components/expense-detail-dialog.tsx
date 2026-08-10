import { Pencil, Send, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { useCategoriesStore } from '@/features/categories/categories-store'
import { memberDisplayName } from '@/features/groups/display'
import { addComment, deleteComment, listComments } from '@/features/groups/groups-service'
import type {
  ExpenseComment,
  GroupExpense,
  GroupWithMembers,
} from '@/features/groups/types'
import { dayLabel } from '@/lib/dates'
import { formatMoney } from '@/lib/format'
import type { SplitMethod } from '@/types'

const METHOD_LABEL: Record<SplitMethod, string> = {
  equal: 'Split equally',
  custom: 'Split by amounts',
  percentage: 'Split by percent',
  shares: 'Split by shares',
  itemized: 'Split by item',
}

/**
 * Everything about one shared expense in one place: who paid, who owes what
 * and why, the bill it came from, and the conversation about it. The list row
 * behind this can then stay a single line.
 */
export function ExpenseDetailDialog({
  group,
  expense,
  myUserId,
  canEdit,
  onEdit,
  onDelete,
  onOpenChange,
}: {
  group: GroupWithMembers
  /** Null = closed. */
  expense: GroupExpense | null
  myUserId: string
  canEdit: boolean
  onEdit: (expense: GroupExpense) => void
  onDelete: (expense: GroupExpense) => void
  onOpenChange: (open: boolean) => void
}) {
  const categories = useCategoriesStore((state) => state.categories)
  const [comments, setComments] = useState<ExpenseComment[] | null>(null)
  const [body, setBody] = useState('')
  const [posting, setPosting] = useState(false)

  const expenseId = expense?.id ?? null
  useEffect(() => {
    if (!expenseId) return
    let cancelled = false
    setComments(null)
    setBody('')
    listComments(expenseId)
      .then((result) => {
        if (!cancelled) setComments(result)
      })
      .catch(() => {
        if (!cancelled) setComments([])
      })
    return () => {
      cancelled = true
    }
  }, [expenseId])

  if (!expense) return null

  const nameOf = (userId: string) => {
    const member = group.members.find((candidate) => candidate.userId === userId)
    return member ? memberDisplayName(member, myUserId) : 'Former member'
  }
  const method = (expense.splits[0]?.method ?? 'equal') as SplitMethod
  const category = categories.find((candidate) => candidate.id === expense.categoryId)

  async function post() {
    const trimmed = body.trim()
    if (!trimmed || !expenseId) return
    setPosting(true)
    try {
      const comment = await addComment(expenseId, trimmed)
      setComments((current) => [...(current ?? []), comment])
      setBody('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Couldn’t post that comment.')
    } finally {
      setPosting(false)
    }
  }

  async function remove(commentId: string) {
    try {
      await deleteComment(commentId)
      setComments((current) => (current ?? []).filter((entry) => entry.id !== commentId))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Couldn’t delete that comment.')
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="pr-6">{expense.description}</DialogTitle>
          <DialogDescription>
            {dayLabel(expense.date)} · paid by {nameOf(expense.paidBy)}
            {category ? ` · ${category.name}` : ''}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-baseline justify-between gap-3">
          <span className="money text-2xl font-semibold">
            {formatMoney(expense.amountMinor, group.currency)}
          </span>
          <Badge variant="secondary">{METHOD_LABEL[method]}</Badge>
        </div>

        {expense.notes && <p className="text-sm text-muted-foreground">{expense.notes}</p>}

        {expense.items.length > 0 && (
          <section className="flex flex-col gap-2">
            <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              The bill
            </h3>
            <ul className="flex flex-col rounded-xl border">
              {expense.items.map((item) => (
                <li key={item.id} className="flex flex-col gap-0.5 border-b px-3 py-2 last:border-b-0">
                  <span className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate">{item.description}</span>
                    <span className="money shrink-0 font-medium">
                      {formatMoney(item.amountMinor, group.currency)}
                    </span>
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {item.participantIds.map(nameOf).join(', ')}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Who owes what
          </h3>
          <ul className="flex flex-col rounded-xl border">
            {expense.splits.map((split) => (
              <li
                key={split.id}
                className="flex items-center justify-between gap-3 border-b px-3 py-2 text-sm last:border-b-0"
              >
                <span className="min-w-0 truncate">
                  {nameOf(split.userId)}
                  {split.shareUnits !== null && (
                    <span className="text-muted-foreground">
                      {' '}
                      · {split.shareUnits} {split.shareUnits === 1 ? 'share' : 'shares'}
                    </span>
                  )}
                  {split.shareBasisPoints !== null && (
                    <span className="text-muted-foreground">
                      {' '}
                      · {split.shareBasisPoints / 100}%
                    </span>
                  )}
                </span>
                <span className="money shrink-0 font-medium">
                  {formatMoney(split.owedMinor, group.currency)}
                </span>
              </li>
            ))}
          </ul>
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            Comments
          </h3>
          {comments === null ? (
            <Skeleton className="h-12 w-full rounded-lg" />
          ) : comments.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nothing yet — add a note if something here needs explaining.
            </p>
          ) : (
            <ul className="flex flex-col gap-2">
              {comments.map((comment) => (
                <li key={comment.id} className="flex items-start gap-2 text-sm">
                  <span className="min-w-0 flex-1">
                    <span className="font-medium">{nameOf(comment.userId)}</span>{' '}
                    <span className="text-muted-foreground">{comment.body}</span>
                  </span>
                  {comment.userId === myUserId && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 shrink-0 text-muted-foreground"
                      aria-label="Delete comment"
                      onClick={() => void remove(comment.id)}
                    >
                      <Trash2 className="size-3.5" aria-hidden />
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          )}
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault()
              void post()
            }}
          >
            <Input
              placeholder="Add a comment"
              aria-label="Add a comment"
              maxLength={1000}
              value={body}
              onChange={(event) => setBody(event.target.value)}
            />
            <Button type="submit" size="icon" aria-label="Post comment" disabled={posting || !body.trim()}>
              <Send className="size-4" aria-hidden />
            </Button>
          </form>
        </section>

        {canEdit && (
          <div className="flex gap-2 border-t pt-4">
            <Button variant="outline" className="flex-1" onClick={() => onEdit(expense)}>
              <Pencil className="size-4" aria-hidden />
              Edit
            </Button>
            <Button
              variant="outline"
              className="flex-1 text-destructive hover:text-destructive"
              onClick={() => onDelete(expense)}
            >
              <Trash2 className="size-4" aria-hidden />
              Delete
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
