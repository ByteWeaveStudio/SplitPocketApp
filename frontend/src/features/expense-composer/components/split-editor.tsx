import { Bookmark, Plus, Trash2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { MemberAvatar } from '@/features/groups/components/member-avatar'
import { memberDisplayName } from '@/features/groups/display'
import type { GroupMemberProfile, SplitPreset } from '@/features/groups/types'
import { SPLIT_METHODS, newItem } from '@/features/expense-composer/split-draft'
import type { SplitDraft, SplitSummary } from '@/features/expense-composer/split-draft'
import { formatMoney } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { CurrencyCode, Id, SplitMethod } from '@/types'

export function SplitEditor({
  draft,
  onChange,
  members,
  currency,
  myUserId,
  summary,
  presets,
  onApplyPreset,
  onSavePreset,
}: {
  draft: SplitDraft
  onChange: (draft: SplitDraft) => void
  members: GroupMemberProfile[]
  currency: CurrencyCode
  myUserId: Id
  summary: SplitSummary
  presets: SplitPreset[]
  onApplyPreset: (preset: SplitPreset) => void
  onSavePreset: () => void
}) {
  const nameOf = (userId: Id) => {
    const member = members.find((candidate) => candidate.userId === userId)
    return member ? memberDisplayName(member, myUserId) : 'Former member'
  }

  function setMethod(method: SplitMethod) {
    onChange({
      ...draft,
      method,
      // Entering item mode with an empty bill is a dead end; seed one line
      // pre-filled with whoever was already selected.
      items:
        method === 'itemized' && draft.items.length === 0
          ? [newItem(draft.selected.length ? draft.selected : members.map((m) => m.userId))]
          : draft.items,
    })
  }

  function toggleMember(userId: Id) {
    const selected = draft.selected.includes(userId)
      ? draft.selected.filter((id) => id !== userId)
      : // Keep member order rather than click order, so the list doesn't jump.
        members.filter((m) => m.userId === userId || draft.selected.includes(m.userId))
          .map((m) => m.userId)
    onChange({ ...draft, selected })
  }

  const allSelected = draft.selected.length === members.length
  const methodHint = SPLIT_METHODS.find((entry) => entry.value === draft.method)?.hint

  return (
    <fieldset className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <Label asChild className="sr-only">
          <legend>How to split</legend>
        </Label>
        {/* All five methods sit on the surface rather than behind a dropdown:
            choosing one is a comparison, and the panel is only open because
            the default was already wrong. */}
        <div role="radiogroup" aria-label="Split method" className="flex gap-0.5 rounded-lg bg-muted p-0.5">
          {SPLIT_METHODS.map((entry) => {
            const active = draft.method === entry.value
            return (
              <button
                key={entry.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setMethod(entry.value)}
                className={cn(
                  'min-w-0 flex-1 rounded-md px-1 py-1.5 text-xs transition-colors',
                  'focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none',
                  active
                    ? 'bg-card font-semibold text-foreground shadow-xs'
                    : 'text-muted-foreground hover:text-foreground',
                )}
              >
                {entry.short}
              </button>
            )
          })}
        </div>
        {methodHint && <p className="text-xs text-muted-foreground">{methodHint}</p>}
      </div>

      {presets.length > 0 && draft.method !== 'itemized' && (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Presets:</span>
          {presets.map((preset) => (
            <Button
              key={preset.id}
              type="button"
              size="sm"
              variant="outline"
              className="h-7 rounded-full px-3 text-xs"
              onClick={() => onApplyPreset(preset)}
            >
              {preset.name}
            </Button>
          ))}
        </div>
      )}

      {draft.method === 'itemized' ? (
        <ItemsEditor
          draft={draft}
          onChange={onChange}
          members={members}
          myUserId={myUserId}
          summary={summary}
        />
      ) : (
        <>
          <div className="flex items-center justify-between">
            <span className="text-xs text-muted-foreground">
              {draft.selected.length} of {members.length} sharing
            </span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              onClick={() =>
                onChange({
                  ...draft,
                  selected: allSelected ? [] : members.map((member) => member.userId),
                })
              }
            >
              {allSelected ? 'Clear all' : 'Select everyone'}
            </Button>
          </div>
          <ul className="flex flex-col">
            {members.map((member) => {
              const isSelected = draft.selected.includes(member.userId)
              const owed = summary.owedByUser.get(member.userId)
              return (
                <li
                  key={member.userId}
                  className={cn(
                    'flex items-center gap-2.5 py-1.5 transition-opacity',
                    !isSelected && 'opacity-55',
                  )}
                >
                  <Checkbox
                    id={`split-${member.userId}`}
                    checked={isSelected}
                    onCheckedChange={() => toggleMember(member.userId)}
                  />
                  {/* The avatar rides inside the label so the whole name-and-
                      face target toggles the person, not just the box. */}
                  <Label
                    htmlFor={`split-${member.userId}`}
                    className="flex min-w-0 flex-1 items-center gap-2.5 font-normal"
                  >
                    <MemberAvatar member={member} className="size-7 border-0" />
                    <span className="truncate">{memberDisplayName(member, myUserId)}</span>
                  </Label>
                  {isSelected && (
                    <ShareInput
                      draft={draft}
                      onChange={onChange}
                      userId={member.userId}
                      label={memberDisplayName(member, myUserId)}
                    />
                  )}
                  {isSelected && owed !== undefined && (
                    <span className="money shrink-0 text-right text-sm font-medium tabular-nums">
                      {formatMoney(owed, currency)}
                    </span>
                  )}
                </li>
              )
            })}
          </ul>
        </>
      )}

      <div className="flex min-h-6 items-center justify-between gap-2">
        <p
          className={cn(
            'text-sm',
            summary.error ? 'text-destructive' : 'text-muted-foreground',
          )}
          role={summary.error ? 'alert' : 'status'}
        >
          {summary.remaining ?? summary.error ?? ''}
        </p>
        {draft.method !== 'itemized' && draft.selected.length > 0 && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 shrink-0 text-xs text-muted-foreground"
            onClick={onSavePreset}
          >
            <Bookmark className="size-3.5" aria-hidden />
            Save split
          </Button>
        )}
      </div>
      {/* Only rendered for methods that name a payer per person; keeps the
          "who owes what" total honest when the amount is still blank. */}
      {summary.owedByUser.size > 0 && draft.method === 'itemized' && (
        <ul className="flex flex-col gap-1 rounded-xl border bg-muted/30 p-3 text-sm">
          {[...summary.owedByUser.entries()].map(([userId, owed]) => (
            <li key={userId} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate">{nameOf(userId)}</span>
              <span className="money shrink-0 font-medium">{formatMoney(owed, currency)}</span>
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  )
}

function ShareInput({
  draft,
  onChange,
  userId,
  label,
}: {
  draft: SplitDraft
  onChange: (draft: SplitDraft) => void
  userId: Id
  label: string
}) {
  if (draft.method === 'custom') {
    return (
      <Input
        inputMode="decimal"
        placeholder="0.00"
        aria-label={`Amount for ${label}`}
        className="h-8 w-24 text-right"
        value={draft.customAmounts[userId] ?? ''}
        onChange={(event) =>
          onChange({
            ...draft,
            customAmounts: { ...draft.customAmounts, [userId]: event.target.value },
          })
        }
      />
    )
  }
  if (draft.method === 'percentage') {
    return (
      <div className="flex items-center gap-1">
        <Input
          inputMode="decimal"
          placeholder="0"
          aria-label={`Percent for ${label}`}
          className="h-8 w-16 text-right"
          value={draft.percents[userId] ?? ''}
          onChange={(event) =>
            onChange({ ...draft, percents: { ...draft.percents, [userId]: event.target.value } })
          }
        />
        <span className="text-sm text-muted-foreground">%</span>
      </div>
    )
  }
  if (draft.method === 'shares') {
    return (
      <div className="flex items-center gap-1">
        <Input
          inputMode="numeric"
          placeholder="1"
          aria-label={`Shares for ${label}`}
          className="h-8 w-14 text-right"
          value={draft.shareUnits[userId] ?? '1'}
          onChange={(event) =>
            onChange({
              ...draft,
              shareUnits: { ...draft.shareUnits, [userId]: event.target.value },
            })
          }
        />
        <span className="text-sm text-muted-foreground">
          {Number(draft.shareUnits[userId] ?? '1') === 1 ? 'share' : 'shares'}
        </span>
      </div>
    )
  }
  // 'equal' needs no input — the amount column alongside says everything.
  return null
}

function ItemsEditor({
  draft,
  onChange,
  members,
  myUserId,
  summary,
}: {
  draft: SplitDraft
  onChange: (draft: SplitDraft) => void
  members: GroupMemberProfile[]
  myUserId: Id
  summary: SplitSummary
}) {
  function updateItem(key: string, patch: Partial<SplitDraft['items'][number]>) {
    onChange({
      ...draft,
      items: draft.items.map((item) => (item.key === key ? { ...item, ...patch } : item)),
    })
  }

  function toggleItemMember(key: string, userId: Id) {
    const item = draft.items.find((candidate) => candidate.key === key)
    if (!item) return
    const participantIds = item.participantIds.includes(userId)
      ? item.participantIds.filter((id) => id !== userId)
      : members
          .filter((m) => m.userId === userId || item.participantIds.includes(m.userId))
          .map((m) => m.userId)
    updateItem(key, { participantIds })
  }

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-2">
        {draft.items.map((item, index) => (
          <li key={item.key} className="flex flex-col gap-2 rounded-xl border p-3">
            <div className="flex gap-2">
              <Input
                placeholder={`Item ${index + 1}`}
                aria-label={`Item ${index + 1} description`}
                className="h-9 flex-1"
                value={item.description}
                onChange={(event) => updateItem(item.key, { description: event.target.value })}
              />
              <Input
                inputMode="decimal"
                placeholder="0.00"
                aria-label={`Item ${index + 1} amount`}
                className="h-9 w-24 text-right"
                value={item.amount}
                onChange={(event) => updateItem(item.key, { amount: event.target.value })}
              />
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9 shrink-0 text-muted-foreground"
                aria-label={`Remove item ${index + 1}`}
                onClick={() =>
                  onChange({
                    ...draft,
                    items: draft.items.filter((candidate) => candidate.key !== item.key),
                  })
                }
              >
                <Trash2 className="size-4" aria-hidden />
              </Button>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {members.map((member) => {
                const on = item.participantIds.includes(member.userId)
                return (
                  <button
                    key={member.userId}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggleItemMember(item.key, member.userId)}
                    className={cn(
                      'rounded-full border px-2.5 py-1 text-xs transition-colors',
                      on
                        ? 'border-primary bg-primary/10 text-foreground'
                        : 'border-border text-muted-foreground hover:bg-accent/50',
                    )}
                  >
                    {memberDisplayName(member, myUserId)}
                  </button>
                )
              })}
            </div>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() =>
            onChange({
              ...draft,
              // New lines inherit the previous line's people: a bill is
              // usually mostly-shared with a few exceptions.
              items: [
                ...draft.items,
                newItem(
                  draft.items.at(-1)?.participantIds ?? members.map((member) => member.userId),
                ),
              ],
            })
          }
        >
          <Plus className="size-4" aria-hidden />
          Add item
        </Button>
        {draft.items.length > 0 && (
          <Badge variant="secondary">
            {draft.items.length} {draft.items.length === 1 ? 'item' : 'items'}
          </Badge>
        )}
      </div>
      {summary.owedByUser.size === 0 && draft.items.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Tap names to say who shared each line.
        </p>
      )}
    </div>
  )
}
