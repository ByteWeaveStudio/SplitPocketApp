import { zodResolver } from '@hookform/resolvers/zod'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AmountField } from '@/features/expense-composer/components/amount-field'
import { CategoryField } from '@/features/expense-composer/components/category-field'
import { NoteField } from '@/features/expense-composer/components/note-field'
import type { ExpenseInput } from '@/features/personal-expenses/expenses-service'
import { useExpensesStore } from '@/features/personal-expenses/expenses-store'
import { ExpenseFormSchema } from '@/features/personal-expenses/schemas'
import type { ExpenseFormValues } from '@/features/personal-expenses/schemas'
import { CURRENCIES } from '@/lib/currencies'
import { todayISODate } from '@/lib/dates'
import { formatMinorForInput, parseMoney } from '@/lib/format'
import { useSettingsStore } from '@/stores/settings-store'
import type { Expense } from '@/types'

function toFormValues(editing: Expense | null, defaultCurrency: string): ExpenseFormValues {
  if (!editing) {
    return {
      kind: 'expense',
      amount: '',
      currency: defaultCurrency,
      description: '',
      categoryId: 'none',
      date: todayISODate(),
      notes: '',
    }
  }
  return {
    kind: editing.kind,
    amount: formatMinorForInput(editing.amountMinor, editing.currency),
    currency: editing.currency,
    description: editing.description,
    categoryId: editing.categoryId ?? 'none',
    date: editing.date,
    notes: editing.notes ?? '',
  }
}

export function PersonalExpenseForm({
  editing,
  onDone,
}: {
  editing: Expense | null
  onDone: () => void
}) {
  const defaultCurrency = useSettingsStore((state) => state.currency)
  const add = useExpensesStore((state) => state.add)
  const edit = useExpensesStore((state) => state.edit)

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    formState: { errors },
  } = useForm<ExpenseFormValues>({
    resolver: zodResolver(ExpenseFormSchema),
    defaultValues: toFormValues(editing, defaultCurrency),
  })
  const kind = watch('kind')
  const currency = watch('currency')
  const categoryId = watch('categoryId')
  // Amount and notes are driven by controlled components rather than
  // `register`, so their values have to be watched to render.
  const amount = watch('amount')
  const notes = watch('notes')

  function onSubmit(values: ExpenseFormValues) {
    // parseMoney already validated by the schema — non-null here.
    const amountMinor = parseMoney(values.amount, values.currency) ?? 0
    const input: ExpenseInput = {
      description: values.description.trim(),
      amountMinor,
      currency: values.currency,
      categoryId: values.categoryId === 'none' ? null : values.categoryId,
      date: values.date,
      kind: values.kind,
      notes: values.notes.trim() || null,
    }
    // Optimistic: the store applies the change locally before the request
    // settles, and rolls back (with this toast) if it fails. Personal writes
    // also queue offline, which is why this path never awaits.
    const action = editing ? edit(editing.id, input) : add(input)
    action.catch((error: unknown) => {
      toast.error(error instanceof Error ? error.message : 'Something went wrong.')
    })
    toast.success(
      editing ? 'Changes saved' : values.kind === 'income' ? 'Income added' : 'Expense added',
    )
    onDone()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col" noValidate>
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4">
        {/* Income is not a default that can be stated in a summary line — it
            changes what the record is — so the toggle stays on the surface. */}
        <Tabs
          value={kind}
          onValueChange={(value) => setValue('kind', value as ExpenseFormValues['kind'])}
        >
          <TabsList className="w-full">
            <TabsTrigger value="expense" className="flex-1">
              Expense
            </TabsTrigger>
            <TabsTrigger value="income" className="flex-1">
              Income
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex flex-col gap-1">
          <AmountField
            id="expense-amount"
            value={amount}
            onChange={(value) => setValue('amount', value, { shouldValidate: false })}
            currency={currency}
            autoFocus
            invalid={Boolean(errors.amount)}
          >
            <Select value={currency} onValueChange={(value) => setValue('currency', value)}>
              <SelectTrigger
                size="sm"
                aria-label="Currency"
                className="h-7 w-auto gap-1 border-0 bg-transparent px-2 text-xs text-muted-foreground shadow-none hover:bg-accent/50"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CURRENCIES.map((option) => (
                  <SelectItem key={option.code} value={option.code}>
                    {option.code} {option.symbol}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </AmountField>
          <div className="text-center">
            <FieldError message={errors.amount?.message} />
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <Label htmlFor="expense-description">Description</Label>
          <Input
            id="expense-description"
            placeholder={kind === 'income' ? 'Salary, refund…' : 'Coffee, groceries…'}
            aria-invalid={errors.description ? true : undefined}
            {...register('description')}
          />
          <FieldError message={errors.description?.message} />
        </div>

        <div className="grid grid-cols-2 gap-2 [&>*]:min-w-0">
          <CategoryField
            id="expense-category"
            value={categoryId}
            onChange={(value) => setValue('categoryId', value)}
          />
          <div className="flex flex-col gap-2">
            <Label htmlFor="expense-date">Date</Label>
            <Input
              id="expense-date"
              type="date"
              aria-invalid={errors.date ? true : undefined}
              {...register('date')}
            />
            <FieldError message={errors.date?.message} />
          </div>
        </div>

        <NoteField
          id="expense-notes"
          value={notes}
          onChange={(value) => setValue('notes', value)}
        />
        <FieldError message={errors.notes?.message} />
      </div>

      <div className="shrink-0 border-t bg-popover px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <Button type="submit" size="lg" className="h-11 w-full">
          {editing ? 'Save changes' : kind === 'income' ? 'Add income' : 'Add expense'}
        </Button>
      </div>
    </form>
  )
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="text-sm text-destructive">{message}</p>
}
