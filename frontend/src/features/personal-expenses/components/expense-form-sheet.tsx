import { zodResolver } from '@hookform/resolvers/zod'
import { Check, Plus, X } from 'lucide-react'
import { useEffect, useState } from 'react'
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
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { useCategoriesStore } from '@/features/categories/categories-store'
import { categoryIcon } from '@/features/categories/category-icons'
import { useExpenseSheetStore } from '@/features/personal-expenses/expense-sheet-store'
import type { ExpenseInput } from '@/features/personal-expenses/expenses-service'
import { useExpensesStore } from '@/features/personal-expenses/expenses-store'
import { ExpenseFormSchema } from '@/features/personal-expenses/schemas'
import type { ExpenseFormValues } from '@/features/personal-expenses/schemas'
import { useMediaQuery } from '@/hooks/use-media-query'
import { CURRENCIES } from '@/lib/currencies'
import { todayISODate } from '@/lib/dates'
import { formatMinorForInput, parseMoney } from '@/lib/format'
import { useSettingsStore } from '@/stores/settings-store'
import type { Expense } from '@/types'

/** Mounted once in AppLayout; opened via useExpenseSheetStore from anywhere. */
export function ExpenseFormSheet() {
  const { open, editing, session, setOpen } = useExpenseSheetStore()
  const isDesktop = useMediaQuery('(min-width: 768px)')

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side={isDesktop ? 'right' : 'bottom'}
        className="data-[side=bottom]:max-h-[92svh] data-[side=bottom]:rounded-t-2xl data-[side=right]:sm:max-w-md"
      >
        <div className="overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]">
          <SheetHeader>
            <SheetTitle>{editing ? 'Edit expense' : 'Add expense'}</SheetTitle>
            <SheetDescription>
              {editing
                ? 'Change the details and save.'
                : 'Log an expense or income — only what happened, no ceremony.'}
            </SheetDescription>
          </SheetHeader>
          <ExpenseForm key={session} editing={editing} onDone={() => setOpen(false)} />
        </div>
      </SheetContent>
    </Sheet>
  )
}

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

function ExpenseForm({ editing, onDone }: { editing: Expense | null; onDone: () => void }) {
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
    // settles, and rolls back (with this toast) if it fails.
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
    <form
      onSubmit={handleSubmit(onSubmit)}
      className="flex flex-col gap-4 px-4 pt-2"
      noValidate
    >
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

function CategoryField({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { categories, status, load, add } = useCategoriesStore()
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')

  useEffect(() => {
    void load()
  }, [load])

  async function createCategory() {
    const trimmed = name.trim()
    if (!trimmed) return
    try {
      const category = await add(trimmed)
      onChange(category.id)
      setCreating(false)
      setName('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Couldn’t create the category.')
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor="expense-category">Category</Label>
      {creating ? (
        <div className="flex gap-2">
          <Input
            autoFocus
            placeholder="Category name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                void createCategory()
              }
            }}
          />
          <Button type="button" size="icon" aria-label="Create category" onClick={createCategory}>
            <Check className="size-4" aria-hidden />
          </Button>
          <Button
            type="button"
            size="icon"
            variant="outline"
            aria-label="Cancel new category"
            onClick={() => setCreating(false)}
          >
            <X className="size-4" aria-hidden />
          </Button>
        </div>
      ) : (
        <div className="flex gap-2">
          <Select value={value} onValueChange={onChange}>
            <SelectTrigger id="expense-category" className="flex-1">
              <SelectValue placeholder={status === 'loading' ? 'Loading…' : 'Pick a category'} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Uncategorized</SelectItem>
              {categories.map((category) => {
                const Icon = categoryIcon(category.icon)
                return (
                  <SelectItem key={category.id} value={category.id}>
                    <Icon className="size-4 text-muted-foreground" aria-hidden />
                    {category.name}
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
          <Button
            type="button"
            size="icon"
            variant="outline"
            aria-label="New category"
            onClick={() => setCreating(true)}
          >
            <Plus className="size-4" aria-hidden />
          </Button>
        </div>
      )}
    </div>
  )
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null
  return <p className="text-sm text-destructive">{message}</p>
}
