import { CloudOff, MoreVertical, Pencil, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { categoryIcon } from '@/features/categories/category-icons'
import { useComposerStore } from '@/features/expense-composer/composer-store'
import { useExpensesStore } from '@/features/personal-expenses/expenses-store'
import { dayLabel } from '@/lib/dates'
import { formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'
import { useNetworkStore } from '@/stores/network-store'
import type { Category, Expense } from '@/types'

export function ExpenseList({
  expenses,
  categories,
}: {
  expenses: Expense[]
  categories: Category[]
}) {
  const categoriesById = useMemo(
    () => new Map(categories.map((category) => [category.id, category])),
    [categories],
  )
  const days = useMemo(() => {
    const groups = new Map<string, Expense[]>()
    for (const expense of expenses) {
      const group = groups.get(expense.date)
      if (group) group.push(expense)
      else groups.set(expense.date, [expense])
    }
    return [...groups.entries()]
  }, [expenses])

  const [deleting, setDeleting] = useState<Expense | null>(null)
  const remove = useExpensesStore((state) => state.remove)

  function confirmDelete() {
    if (!deleting) return
    remove(deleting.id).catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Couldn’t delete the expense.')
    })
    toast.success('Expense deleted')
  }

  return (
    <div className="flex flex-col gap-5">
      {days.map(([date, dayExpenses], index) => (
        <section
          key={date}
          aria-label={dayLabel(date)}
          className="rise-in"
          style={{ '--stagger': Math.min(index, 8) } as React.CSSProperties}
        >
          <h2 className="pb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {dayLabel(date)}
          </h2>
          <ul className="overflow-hidden rounded-xl border bg-card">
            {dayExpenses.map((expense) => (
              <ExpenseRow
                key={expense.id}
                expense={expense}
                category={
                  expense.categoryId ? categoriesById.get(expense.categoryId) : undefined
                }
                onDelete={() => setDeleting(expense)}
              />
            ))}
          </ul>
        </section>
      ))}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => {
          if (!open) setDeleting(null)
        }}
        title="Delete this expense?"
        description={
          deleting
            ? `"${deleting.description}" (${formatMoney(deleting.amountMinor, deleting.currency)}) will be removed. This can't be undone.`
            : ''
        }
        onConfirm={confirmDelete}
      />
    </div>
  )
}

function ExpenseRow({
  expense,
  category,
  onDelete,
}: {
  expense: Expense
  category: Category | undefined
  onDelete: () => void
}) {
  const openEdit = useComposerStore((state) => state.openEdit)
  const pendingSync = useNetworkStore((state) => state.pendingIds.has(expense.id))
  const isIncome = expense.kind === 'income'
  const Icon = categoryIcon(category?.icon)

  return (
    <li className="flex items-center gap-1 border-b px-2 last:border-b-0">
      <button
        type="button"
        onClick={() => openEdit(expense)}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-accent/50"
      >
        <span
          className={cn(
            'flex size-9 shrink-0 items-center justify-center rounded-full',
            isIncome ? 'bg-positive/10' : 'bg-muted',
          )}
        >
          <Icon
            className={cn('size-4', isIncome ? 'text-positive' : 'text-muted-foreground')}
            aria-hidden
          />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">{expense.description}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {category?.name ?? 'Uncategorized'}
            {expense.notes ? ` · ${expense.notes}` : ''}
          </span>
        </span>
        {pendingSync && (
          <CloudOff
            className="size-3.5 shrink-0 text-muted-foreground"
            aria-label="Waiting to sync"
          >
            <title>Waiting to sync</title>
          </CloudOff>
        )}
        <span className={cn('money shrink-0 text-sm font-medium', isIncome && 'text-positive')}>
          {isIncome ? '+' : ''}
          {formatMoney(expense.amountMinor, expense.currency)}
        </span>
      </button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="size-9 shrink-0 text-muted-foreground"
            aria-label={`Actions for ${expense.description}`}
          >
            <MoreVertical className="size-4" aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={() => openEdit(expense)}>
            <Pencil className="size-4" aria-hidden />
            Edit
          </DropdownMenuItem>
          <DropdownMenuItem variant="destructive" onClick={onDelete}>
            <Trash2 className="size-4" aria-hidden />
            Delete
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </li>
  )
}
