import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { CategoryField } from '@/features/expense-composer/components/category-field'
import { SplitEditor } from '@/features/expense-composer/components/split-editor'
import {
  applyPreset,
  draftFromExpense,
  emptyDraft,
  summarizeSplit,
  toSplitPayload,
} from '@/features/expense-composer/split-draft'
import type { SplitDraft } from '@/features/expense-composer/split-draft'
import { useDashboardStore } from '@/features/dashboard/dashboard-store'
import { memberDisplayName } from '@/features/groups/display'
import { useGroupDetailStore } from '@/features/groups/group-detail-store'
import {
  createGroupExpense,
  createPreset,
  listPresets,
  updateGroupExpense,
} from '@/features/groups/groups-service'
import { useGroupsStore } from '@/features/groups/groups-store'
import type { GroupExpense, GroupExpenseInput, GroupWithMembers, SplitPreset } from '@/features/groups/types'
import { todayISODate } from '@/lib/dates'
import { formatMinorForInput, formatMoney, parseMoney } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

export function GroupExpenseForm({
  group,
  editing,
  onDone,
}: {
  group: GroupWithMembers
  editing: GroupExpense | null
  onDone: () => void
}) {
  const myUserId = useAuthStore((state) => state.user?.id ?? '')

  const [description, setDescription] = useState(editing?.description ?? '')
  const [amount, setAmount] = useState(
    editing ? formatMinorForInput(editing.amountMinor, group.currency) : '',
  )
  const [categoryId, setCategoryId] = useState(editing?.categoryId ?? 'none')
  const [date, setDate] = useState(editing?.date ?? todayISODate())
  const [notes, setNotes] = useState(editing?.notes ?? '')
  const [paidBy, setPaidBy] = useState(editing?.paidBy ?? myUserId)
  const [draft, setDraft] = useState<SplitDraft>(() =>
    editing
      ? draftFromExpense(editing, group.currency, group.members)
      : emptyDraft(group.members),
  )
  const [presets, setPresets] = useState<SplitPreset[]>([])
  const [savingPreset, setSavingPreset] = useState(false)
  const [presetName, setPresetName] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    listPresets(group.id)
      .then((result) => {
        if (!cancelled) setPresets(result)
      })
      // Presets are a shortcut, not a prerequisite — a failure here must not
      // stand between the user and logging the expense.
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [group.id])

  const amountMinor = parseMoney(amount, group.currency)
  const summary = useMemo(
    () => summarizeSplit(draft, amountMinor, group.currency, formatMoney),
    [draft, amountMinor, group.currency],
  )

  async function submit() {
    if (!description.trim()) {
      toast.error('What was it for?')
      return
    }
    if (amountMinor === null || amountMinor <= 0) {
      toast.error('Enter a valid amount.')
      return
    }
    if (summary.error) {
      toast.error(summary.error)
      return
    }

    const input: GroupExpenseInput = {
      description: description.trim(),
      amountMinor,
      categoryId: categoryId === 'none' ? null : categoryId,
      date,
      notes: notes.trim() || null,
      paidBy,
      ...toSplitPayload(draft, group.currency),
    }

    setSaving(true)
    try {
      if (editing) await updateGroupExpense(editing.id, input)
      else await createGroupExpense(group.id, input)
      toast.success(editing ? 'Expense updated' : 'Expense added')
      onDone()
      refreshAfterWrite(group.id)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Couldn’t save the expense.')
    } finally {
      setSaving(false)
    }
  }

  async function saveCurrentSplitAsPreset() {
    const name = presetName.trim()
    if (!name) return
    if (draft.method === 'itemized') return
    try {
      const preset = await createPreset(group.id, {
        name,
        method: draft.method,
        participants: toSplitPayload(draft, group.currency).participants ?? [],
      })
      setPresets((current) => [...current, preset].sort((a, b) => a.name.localeCompare(b.name)))
      setSavingPreset(false)
      setPresetName('')
      toast.success(`Saved "${preset.name}"`)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Couldn’t save that preset.')
    }
  }

  return (
    <>
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

        <div className="flex flex-col gap-2">
          <Label htmlFor="gx-paid-by">Paid by</Label>
          <Select value={paidBy} onValueChange={setPaidBy}>
            <SelectTrigger id="gx-paid-by">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {group.members.map((member) => (
                <SelectItem key={member.userId} value={member.userId}>
                  {memberDisplayName(member, myUserId)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <CategoryField id="gx-category" value={categoryId} onChange={setCategoryId} />
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

        <SplitEditor
          draft={draft}
          onChange={setDraft}
          members={group.members}
          currency={group.currency}
          myUserId={myUserId}
          summary={summary}
          presets={presets}
          onApplyPreset={(preset) => setDraft((current) => applyPreset(current, preset, group.members))}
          onSavePreset={() => setSavingPreset(true)}
        />

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

      <Dialog open={savingPreset} onOpenChange={setSavingPreset}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Save this split</DialogTitle>
            <DialogDescription>
              Reuse these people and shares next time. Amounts aren’t saved — they belong to
              this bill.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor="preset-name">Name</Label>
            <Input
              id="preset-name"
              autoFocus
              maxLength={40}
              placeholder="Rent split, weekday lunch…"
              value={presetName}
              onChange={(event) => setPresetName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  void saveCurrentSplitAsPreset()
                }
              }}
            />
          </div>
          <DialogFooter>
            <Button onClick={() => void saveCurrentSplitAsPreset()}>Save preset</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

/** A group write moves balances that three different screens display. */
function refreshAfterWrite(groupId: string): void {
  const detail = useGroupDetailStore.getState()
  if (detail.groupId === groupId) void detail.refresh()
  const groups = useGroupsStore.getState()
  if (groups.status === 'ready') void groups.refresh()
  const dashboard = useDashboardStore.getState()
  if (dashboard.status === 'ready') void dashboard.load()
}
