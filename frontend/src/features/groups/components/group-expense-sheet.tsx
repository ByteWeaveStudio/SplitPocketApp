import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { useGroupDetailStore } from '@/features/groups/group-detail-store'
import { createGroupExpense, updateGroupExpense } from '@/features/groups/groups-service'
import { memberDisplayName } from '@/features/groups/display'
import type {
  GroupExpense,
  GroupExpenseInput,
  GroupWithMembers,
  SplitParticipantInput,
} from '@/features/groups/types'
import { useMediaQuery } from '@/hooks/use-media-query'
import { todayISODate } from '@/lib/dates'
import { formatMinorForInput, formatMoney, parseMoney } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'
import type { SplitMethod } from '@/types'

export function GroupExpenseSheet({
  group,
  editing,
  open,
  onOpenChange,
}: {
  group: GroupWithMembers
  /** Null = new expense. */
  editing: GroupExpense | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const isDesktop = useMediaQuery('(min-width: 768px)')
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side={isDesktop ? 'right' : 'bottom'}
        className="data-[side=bottom]:max-h-[92svh] data-[side=right]:sm:max-w-md"
      >
        <div className="overflow-y-auto pb-[max(1rem,env(safe-area-inset-bottom))]">
          <SheetHeader>
            <SheetTitle>{editing ? 'Edit shared expense' : 'Add shared expense'}</SheetTitle>
            <SheetDescription>
              Paid by you, split with the group — in {group.currency}.
            </SheetDescription>
          </SheetHeader>
          {open && (
            <GroupExpenseForm
              key={editing?.id ?? 'new'}
              group={group}
              editing={editing}
              onDone={() => onOpenChange(false)}
            />
          )}
        </div>
      </SheetContent>
    </Sheet>
  )
}

function GroupExpenseForm({
  group,
  editing,
  onDone,
}: {
  group: GroupWithMembers
  editing: GroupExpense | null
  onDone: () => void
}) {
  const myUserId = useAuthStore((state) => state.user?.id ?? '')
  const { categories, load: loadCategories } = useCategoriesStore()
  useEffect(() => {
    void loadCategories()
  }, [loadCategories])

  const [description, setDescription] = useState(editing?.description ?? '')
  const [amount, setAmount] = useState(
    editing ? formatMinorForInput(editing.amountMinor, group.currency) : '',
  )
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? 'none')
  const [date, setDate] = useState(editing?.date ?? todayISODate())
  const [notes, setNotes] = useState(editing?.notes ?? '')
  const [method, setMethod] = useState<SplitMethod>(editing?.splits[0]?.method ?? 'equal')
  const [selected, setSelected] = useState<Set<string>>(
    () =>
      new Set(
        editing ? editing.splits.map((s) => s.userId) : group.members.map((m) => m.userId),
      ),
  )
  const [customAmounts, setCustomAmounts] = useState<Record<string, string>>(() =>
    editing && editing.splits[0]?.method === 'custom'
      ? Object.fromEntries(
          editing.splits.map((s) => [s.userId, formatMinorForInput(s.owedMinor, group.currency)]),
        )
      : {},
  )
  const [percents, setPercents] = useState<Record<string, string>>(() =>
    editing && editing.splits[0]?.method === 'percentage'
      ? Object.fromEntries(
          editing.splits.map((s) => [s.userId, String((s.shareBasisPoints ?? 0) / 100)]),
        )
      : {},
  )
  const [saving, setSaving] = useState(false)

  const amountMinor = parseMoney(amount, group.currency)
  const participants = group.members.filter((m) => selected.has(m.userId))

  function toggleMember(userId: string) {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(userId)) next.delete(userId)
      else next.add(userId)
      return next
    })
  }

  // Live feedback for custom/percentage splits.
  const splitState = useMemo(() => {
    if (method === 'custom') {
      let sum = 0
      let invalid = false
      for (const member of participants) {
        const minor = parseMoney(customAmounts[member.userId] ?? '', group.currency)
        if (minor === null) invalid = true
        else sum += minor
      }
      return { sum, invalid, remaining: (amountMinor ?? 0) - sum }
    }
    if (method === 'percentage') {
      let sum = 0
      let invalid = false
      for (const member of participants) {
        const value = Number(percents[member.userId] ?? '')
        if (!Number.isFinite(value) || value < 0) invalid = true
        else sum += Math.round(value * 100)
      }
      return { sum, invalid, remaining: 10_000 - sum }
    }
    return { sum: 0, invalid: false, remaining: 0 }
  }, [method, participants, customAmounts, percents, amountMinor, group.currency])

  const equalPreview =
    method === 'equal' && amountMinor && participants.length
      ? Math.floor(amountMinor / participants.length)
      : null

  function buildParticipants(): SplitParticipantInput[] {
    return participants.map((member) => {
      if (method === 'custom') {
        return {
          userId: member.userId,
          owedMinor: parseMoney(customAmounts[member.userId] ?? '', group.currency) ?? 0,
        }
      }
      if (method === 'percentage') {
        return {
          userId: member.userId,
          shareBasisPoints: Math.round(Number(percents[member.userId] ?? 0) * 100),
        }
      }
      return { userId: member.userId }
    })
  }

  async function submit() {
    if (!description.trim()) {
      toast.error('What was it for?')
      return
    }
    if (!amountMinor) {
      toast.error('Enter a valid amount.')
      return
    }
    if (participants.length === 0) {
      toast.error('Pick at least one person to split with.')
      return
    }
    if (method === 'custom' && (splitState.invalid || splitState.remaining !== 0)) {
      toast.error('The split amounts must add up to the total.')
      return
    }
    if (method === 'percentage' && (splitState.invalid || splitState.remaining !== 0)) {
      toast.error('Percentages must add up to exactly 100%.')
      return
    }
    const input: GroupExpenseInput = {
      description: description.trim(),
      amountMinor,
      categoryId: categoryId === 'none' ? null : categoryId,
      date,
      notes: notes.trim() || null,
      method,
      participants: buildParticipants(),
    }
    setSaving(true)
    try {
      if (editing) await updateGroupExpense(editing.id, input)
      else await createGroupExpense(group.id, input)
      toast.success(editing ? 'Expense updated' : 'Expense added')
      onDone()
      void useGroupDetailStore.getState().refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Couldn’t save the expense.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form
      className="flex flex-col gap-4 px-4 pt-2"
      noValidate
      onSubmit={(event) => {
        event.preventDefault()
        void submit()
      }}
    >
      <div className="flex flex-col gap-2">
        <Label htmlFor="gx-amount">Amount ({group.currency})</Label>
        <Input
          id="gx-amount"
          inputMode="decimal"
          placeholder="0.00"
          autoFocus={!editing}
          className="text-lg font-medium"
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
        />
      </div>

      <div className="flex flex-col gap-2">
        <Label htmlFor="gx-description">Description</Label>
        <Input
          id="gx-description"
          placeholder="Dinner, taxi, hotel…"
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>

      <div className="grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-2">
          <Label htmlFor="gx-category">Category</Label>
          <Select value={categoryId} onValueChange={setCategoryId}>
            <SelectTrigger id="gx-category">
              <SelectValue />
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
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="gx-date">Date</Label>
          <Input
            id="gx-date"
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        </div>
      </div>

      <fieldset className="flex flex-col gap-2">
        <Label asChild>
          <legend>Split</legend>
        </Label>
        <Tabs value={method} onValueChange={(value) => setMethod(value as SplitMethod)}>
          <TabsList className="w-full">
            <TabsTrigger value="equal" className="flex-1">
              Equally
            </TabsTrigger>
            <TabsTrigger value="custom" className="flex-1">
              Amounts
            </TabsTrigger>
            <TabsTrigger value="percentage" className="flex-1">
              Percent
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <ul className="flex flex-col gap-1 rounded-xl border p-2">
          {group.members.map((member) => {
            const isSelected = selected.has(member.userId)
            return (
              <li key={member.userId} className="flex items-center gap-3 px-2 py-1.5">
                <Checkbox
                  id={`split-${member.userId}`}
                  checked={isSelected}
                  onCheckedChange={() => toggleMember(member.userId)}
                />
                <Label
                  htmlFor={`split-${member.userId}`}
                  className="min-w-0 flex-1 truncate font-normal"
                >
                  {memberDisplayName(member, myUserId)}
                </Label>
                {isSelected && method === 'equal' && equalPreview !== null && (
                  <span className="text-sm text-muted-foreground tabular-nums">
                    ~{formatMoney(equalPreview, group.currency)}
                  </span>
                )}
                {isSelected && method === 'custom' && (
                  <Input
                    inputMode="decimal"
                    placeholder="0.00"
                    aria-label={`Amount for ${memberDisplayName(member, myUserId)}`}
                    className="h-8 w-24 text-right"
                    value={customAmounts[member.userId] ?? ''}
                    onChange={(event) =>
                      setCustomAmounts((current) => ({
                        ...current,
                        [member.userId]: event.target.value,
                      }))
                    }
                  />
                )}
                {isSelected && method === 'percentage' && (
                  <div className="flex items-center gap-1">
                    <Input
                      inputMode="decimal"
                      placeholder="0"
                      aria-label={`Percent for ${memberDisplayName(member, myUserId)}`}
                      className="h-8 w-16 text-right"
                      value={percents[member.userId] ?? ''}
                      onChange={(event) =>
                        setPercents((current) => ({
                          ...current,
                          [member.userId]: event.target.value,
                        }))
                      }
                    />
                    <span className="text-sm text-muted-foreground">%</span>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
        {method === 'custom' && amountMinor !== null && splitState.remaining !== 0 && (
          <p className="text-sm text-muted-foreground">
            {splitState.remaining > 0
              ? `${formatMoney(splitState.remaining, group.currency)} left to assign`
              : `${formatMoney(-splitState.remaining, group.currency)} over the total`}
          </p>
        )}
        {method === 'percentage' && splitState.remaining !== 0 && (
          <p className="text-sm text-muted-foreground">
            {splitState.remaining > 0
              ? `${splitState.remaining / 100}% left to assign`
              : `${-splitState.remaining / 100}% over 100%`}
          </p>
        )}
      </fieldset>

      <div className="flex flex-col gap-2">
        <Label htmlFor="gx-notes">
          Notes <span className="font-normal text-muted-foreground">(optional)</span>
        </Label>
        <Textarea
          id="gx-notes"
          rows={2}
          value={notes}
          onChange={(event) => setNotes(event.target.value)}
        />
      </div>

      <Button type="submit" disabled={saving} className="mt-2 w-full">
        {saving ? 'Saving…' : editing ? 'Save changes' : 'Add expense'}
      </Button>
    </form>
  )
}
