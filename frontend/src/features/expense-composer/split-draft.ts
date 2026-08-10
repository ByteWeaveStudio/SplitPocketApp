import { equalSplit, itemizedOwed, proportional } from '@/features/expense-composer/split-math'
import type {
  GroupExpense,
  GroupExpenseInput,
  GroupMemberProfile,
  SplitPreset,
} from '@/features/groups/types'
import { formatMinorForInput, parseMoney } from '@/lib/format'
import type { CurrencyCode, Id, SplitMethod } from '@/types'

/**
 * The editable state behind the split editor, and the pure functions that
 * turn it into a preview and into an API payload.
 *
 * Amounts stay as the strings the user typed until the last moment: parsing
 * on every keystroke would fight them mid-entry ("1." is not yet a number),
 * and rounding a half-typed value is how a form loses a digit.
 */

export interface DraftItem {
  /** Stable across re-renders and reorders; not sent to the server. */
  key: string
  description: string
  amount: string
  participantIds: Id[]
}

export interface SplitDraft {
  method: SplitMethod
  selected: Id[]
  customAmounts: Record<Id, string>
  percents: Record<Id, string>
  shareUnits: Record<Id, string>
  items: DraftItem[]
}

export const SPLIT_METHODS: { value: SplitMethod; label: string; hint: string }[] = [
  { value: 'equal', label: 'Equally', hint: 'Everyone selected pays the same.' },
  { value: 'shares', label: 'By shares', hint: 'Weights — 2 shares is twice 1 share.' },
  { value: 'custom', label: 'By amounts', hint: 'Type exactly what each person owes.' },
  { value: 'percentage', label: 'By percent', hint: 'Percentages, adding up to 100%.' },
  { value: 'itemized', label: 'By item', hint: 'List the bill; each line has its own people.' },
]

let itemKeySeed = 0
function nextItemKey(): string {
  itemKeySeed += 1
  return `item-${itemKeySeed}`
}

export function newItem(participantIds: Id[]): DraftItem {
  return { key: nextItemKey(), description: '', amount: '', participantIds }
}

export function emptyDraft(members: GroupMemberProfile[]): SplitDraft {
  return {
    method: 'equal',
    selected: members.map((member) => member.userId),
    customAmounts: {},
    percents: {},
    shareUnits: {},
    items: [],
  }
}

/** Reopen an existing expense in the mode it was saved with.
 *
 * Anyone who has left the group since is dropped from the selection: the API
 * rejects a split naming a non-member, and showing their share in a list they
 * no longer appear in would make that rejection unexplainable. The totals then
 * won't reconcile, which is the correct prompt — the split has to be redone. */
export function draftFromExpense(
  expense: GroupExpense,
  currency: CurrencyCode,
  members: GroupMemberProfile[],
): SplitDraft {
  const method = (expense.splits[0]?.method ?? 'equal') as SplitMethod
  const current = new Set(members.map((member) => member.userId))
  const draft = emptyDraft(members)
  draft.method = method
  draft.selected = expense.splits
    .map((split) => split.userId)
    .filter((userId) => current.has(userId))

  if (method === 'custom') {
    draft.customAmounts = Object.fromEntries(
      expense.splits.map((split) => [
        split.userId,
        formatMinorForInput(split.owedMinor, currency),
      ]),
    )
  }
  if (method === 'percentage') {
    draft.percents = Object.fromEntries(
      expense.splits.map((split) => [split.userId, String((split.shareBasisPoints ?? 0) / 100)]),
    )
  }
  if (method === 'shares') {
    draft.shareUnits = Object.fromEntries(
      expense.splits.map((split) => [split.userId, String(split.shareUnits ?? 1)]),
    )
  }
  if (method === 'itemized') {
    draft.items = expense.items.map((item) => ({
      key: nextItemKey(),
      description: item.description,
      amount: formatMinorForInput(item.amountMinor, currency),
      participantIds: item.participantIds.filter((userId) => current.has(userId)),
    }))
  }
  return draft
}

/** Presets outlive membership, so one saved before someone left still names
 * them. Filter to who is actually here rather than sending a split the API
 * will refuse. */
export function applyPreset(
  draft: SplitDraft,
  preset: SplitPreset,
  members: GroupMemberProfile[],
): SplitDraft {
  const current = new Set(members.map((member) => member.userId))
  const participants = preset.participants.filter((participant) =>
    current.has(participant.userId),
  )
  const next: SplitDraft = {
    ...draft,
    method: preset.method,
    selected: participants.map((participant) => participant.userId),
    items: [],
  }
  if (preset.method === 'percentage') {
    next.percents = Object.fromEntries(
      participants.map((p) => [p.userId, String((p.shareBasisPoints ?? 0) / 100)]),
    )
  }
  if (preset.method === 'shares') {
    next.shareUnits = Object.fromEntries(
      participants.map((p) => [p.userId, String(p.shareUnits ?? 1)]),
    )
  }
  // A 'custom' preset stores fixed amounts, which only make sense against the
  // total they were saved for. Reuse the people, drop the numbers.
  if (preset.method === 'custom') next.customAmounts = {}
  return next
}

/** Pair user ids with the amounts computed for them, positionally. */
function zip(userIds: Id[], amounts: number[]): Map<Id, number> {
  return new Map(userIds.map((userId, index) => [userId, amounts[index] ?? 0]))
}

export interface SplitSummary {
  /** What each person owes, for the live preview. Empty while input is invalid. */
  owedByUser: Map<Id, number>
  /** Shown under the editor: what is still unassigned, or over. */
  remaining: string | null
  /** Non-null blocks submission and is shown verbatim. */
  error: string | null
}

function parsedItems(draft: SplitDraft, currency: CurrencyCode) {
  return draft.items.map((item) => ({
    ...item,
    amountMinor: parseMoney(item.amount, currency),
  }))
}

export function summarizeSplit(
  draft: SplitDraft,
  amountMinor: number | null,
  currency: CurrencyCode,
  formatMoney: (minor: number, currency: CurrencyCode) => string,
): SplitSummary {
  const empty = new Map<Id, number>()

  if (draft.method === 'itemized') {
    const items = parsedItems(draft, currency)
    if (items.length === 0) return { owedByUser: empty, remaining: null, error: 'Add at least one item.' }
    if (items.some((item) => item.amountMinor === null || item.amountMinor <= 0)) {
      return { owedByUser: empty, remaining: null, error: 'Every item needs an amount.' }
    }
    const missingPeople = items.find((item) => item.participantIds.length === 0)
    if (missingPeople) {
      return {
        owedByUser: empty,
        remaining: null,
        error: missingPeople.description.trim()
          ? `Pick who shared "${missingPeople.description.trim()}".`
          : 'Pick who shared each item.',
      }
    }
    if (items.some((item) => !item.description.trim())) {
      return { owedByUser: empty, remaining: null, error: 'Every item needs a name.' }
    }
    const itemsTotal = items.reduce((sum, item) => sum + (item.amountMinor ?? 0), 0)
    const owedByUser = itemizedOwed(
      items.map((item) => ({
        amountMinor: item.amountMinor ?? 0,
        participantIds: item.participantIds,
      })),
    )
    if (amountMinor === null) return { owedByUser, remaining: null, error: null }
    const difference = amountMinor - itemsTotal
    if (difference !== 0) {
      return {
        owedByUser,
        remaining:
          difference > 0
            ? `${formatMoney(difference, currency)} of the total isn’t itemized yet`
            : `Items are ${formatMoney(-difference, currency)} over the total`,
        error: 'The items must add up to the total.',
      }
    }
    return { owedByUser, remaining: null, error: null }
  }

  if (draft.selected.length === 0) {
    return { owedByUser: empty, remaining: null, error: 'Pick at least one person to split with.' }
  }

  if (draft.method === 'equal') {
    if (amountMinor === null) return { owedByUser: empty, remaining: null, error: null }
    return {
      owedByUser: zip(draft.selected, equalSplit(amountMinor, draft.selected.length)),
      remaining: null,
      error: null,
    }
  }

  if (draft.method === 'shares') {
    const units = draft.selected.map((userId) => Number(draft.shareUnits[userId] ?? '1'))
    if (units.some((value) => !Number.isInteger(value) || value < 1)) {
      return { owedByUser: empty, remaining: null, error: 'Each share must be a whole number, at least 1.' }
    }
    if (amountMinor === null) return { owedByUser: empty, remaining: null, error: null }
    return {
      owedByUser: zip(draft.selected, proportional(amountMinor, units)),
      remaining: null,
      error: null,
    }
  }

  if (draft.method === 'percentage') {
    const points = draft.selected.map((userId) => {
      const raw = draft.percents[userId] ?? ''
      const value = Number(raw)
      return raw !== '' && Number.isFinite(value) && value >= 0 ? Math.round(value * 100) : null
    })
    if (points.some((value) => value === null)) {
      return { owedByUser: empty, remaining: null, error: 'Every person needs a percentage.' }
    }
    const weights = points.map((value) => value ?? 0)
    const total = weights.reduce((sum, value) => sum + value, 0)
    const owedByUser =
      amountMinor === null ? empty : zip(draft.selected, proportional(amountMinor, weights))
    if (total !== 10_000) {
      const gap = 10_000 - total
      return {
        owedByUser: empty,
        remaining:
          gap > 0 ? `${gap / 100}% left to assign` : `${-gap / 100}% over 100%`,
        error: 'Percentages must add up to exactly 100%.',
      }
    }
    return { owedByUser, remaining: null, error: null }
  }

  // custom
  const amounts = draft.selected.map((userId) =>
    parseMoney(draft.customAmounts[userId] ?? '', currency),
  )
  if (amounts.some((value) => value === null)) {
    return { owedByUser: empty, remaining: null, error: 'Every person needs an amount.' }
  }
  const total = amounts.reduce((sum: number, value) => sum + (value ?? 0), 0)
  const owedByUser = zip(
    draft.selected,
    amounts.map((value) => value ?? 0),
  )
  if (amountMinor === null) return { owedByUser, remaining: null, error: null }
  const difference = amountMinor - total
  if (difference !== 0) {
    return {
      owedByUser,
      remaining:
        difference > 0
          ? `${formatMoney(difference, currency)} left to assign`
          : `${formatMoney(-difference, currency)} over the total`,
      error: 'The split amounts must add up to the total.',
    }
  }
  return { owedByUser, remaining: null, error: null }
}

/** The `method` / `participants` / `items` part of a create-or-update body. */
export function toSplitPayload(
  draft: SplitDraft,
  currency: CurrencyCode,
): Pick<GroupExpenseInput, 'method' | 'participants' | 'items'> {
  if (draft.method === 'itemized') {
    return {
      method: 'itemized',
      items: draft.items.map((item) => ({
        description: item.description.trim(),
        amountMinor: parseMoney(item.amount, currency) ?? 0,
        participantIds: item.participantIds,
      })),
    }
  }
  return {
    method: draft.method,
    participants: draft.selected.map((userId) => {
      if (draft.method === 'custom') {
        return { userId, owedMinor: parseMoney(draft.customAmounts[userId] ?? '', currency) ?? 0 }
      }
      if (draft.method === 'percentage') {
        return { userId, shareBasisPoints: Math.round(Number(draft.percents[userId] ?? 0) * 100) }
      }
      if (draft.method === 'shares') {
        return { userId, shareUnits: Number(draft.shareUnits[userId] ?? 1) }
      }
      return { userId }
    }),
  }
}
