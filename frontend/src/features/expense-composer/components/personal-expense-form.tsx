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
import { Textarea } from '@/components/ui/textarea'
import { CategoryField } from '@/features/expense-composer/components/category-field'
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
    <form onSubmit={handleSubmit(onSubmit)} className="flex flex-col gap-4 px-4 pt-2" noValidate>
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

      <div className="flex flex-col gap-2">
        <Label htmlFor="expense-amount">Amount</Label>
        <div className="flex gap-2">
          <Input
            id="expense-amount"
            inputMode="decimal"
            placeholder="0.00"
            autoFocus
            className="flex-1 text-lg font-medium"
            aria-invalid={errors.amount ? true : undefined}
            {...register('amount')}
          />
          <Select value={currency} onValueChange={(value) => setValue('currency', value)}>
            <SelectTrigger className="w-28" aria-label="Currency">
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
        </div>
        <FieldError message={errors.amount?.message} />
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

      <div className="flex flex-col gap-2">
        <Label htmlFor="expense-notes">
          Notes <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea id="expense-notes" rows={2} {...register('notes')} />
        <FieldError message={errors.notes?.message} />
      </div>

      <Button type="submit" className="mt-2 w-full">
        {editing ? 'Save changes' : kind === 'income' ? 'Add income' : 'Add expense'}
      </Button>
    </form>
  )
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="text-sm text-destructive">{message}</p>
}
