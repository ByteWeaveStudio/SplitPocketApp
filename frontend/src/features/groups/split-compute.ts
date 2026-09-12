import { equalSplit, itemizedOwed, proportional } from '@/features/expense-composer/split-math'
import type { GroupExpenseSplit, LineItemInput, SplitParticipantInput } from '@/features/groups/types'
import type { Id, SplitMethod } from '@/types'

/**
 * The split rows an expense is saved with.
 *
 * This is the port of `backend/app/services/splits.py`. It used to run on the
 * server because `expense_splits` was revoked from clients and a deferred
 * constraint trigger checked that the rows reconciled to the expense total.
 * Neither exists in Firestore, so the computation runs here and the rows are
 * written inside the expense document, which at least makes the write atomic.
 *
 * The arithmetic itself is not new: `split-math.ts` already mirrored the
 * server's rounding so the composer's preview could not disagree with what got
 * saved. What was missing was the dispatcher and the validation arms, which is
 * what this file adds. Error strings match `summarizeSplit()` in
 * `split-draft.ts`, so a rejection reads the same wherever it surfaces.
 */

const BASIS_POINTS_TOTAL = 10_000

export interface ComputedSplit {
  userId: Id
  owedMinor: number
  shareBasisPoints: number | null
  shareUnits: number | null
}

/** Thrown for a split a person can fix; the message is shown as-is. */
export class SplitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SplitError'
  }
}

export function computeSplits(
  method: Exclude<SplitMethod, 'itemized'>,
  amountMinor: number,
  participants: SplitParticipantInput[],
): ComputedSplit[] {
  if (participants.length === 0) {
    throw new SplitError('Pick at least one person to split with.')
  }
  if (new Set(participants.map((p) => p.userId)).size !== participants.length) {
    throw new SplitError('Each person can appear in the split only once.')
  }

  switch (method) {
    case 'equal':
      return equal(amountMinor, participants)
    case 'percentage':
      return percentage(amountMinor, participants)
    case 'custom':
      return custom(amountMinor, participants)
    case 'shares':
      return shares(amountMinor, participants)
  }
}

function equal(amountMinor: number, participants: SplitParticipantInput[]): ComputedSplit[] {
  const owed = equalSplit(amountMinor, participants.length)
  return participants.map((p, index) => ({
    userId: p.userId,
    owedMinor: owed[index] ?? 0,
    shareBasisPoints: null,
    shareUnits: null,
  }))
}

function percentage(
  amountMinor: number,
  participants: SplitParticipantInput[],
): ComputedSplit[] {
  if (participants.some((p) => p.shareBasisPoints === undefined)) {
    throw new SplitError('Every person needs a percentage.')
  }
  const points = participants.map((p) => p.shareBasisPoints ?? 0)
  if (points.some((value) => value < 0)) {
    throw new SplitError('Percentages can’t be negative.')
  }
  if (points.reduce((sum, value) => sum + value, 0) !== BASIS_POINTS_TOTAL) {
    throw new SplitError('Percentages must add up to exactly 100%.')
  }
  const owed = proportional(amountMinor, points)
  return participants.map((p, index) => ({
    userId: p.userId,
    owedMinor: owed[index] ?? 0,
    shareBasisPoints: points[index] ?? 0,
    shareUnits: null,
  }))
}

function custom(amountMinor: number, participants: SplitParticipantInput[]): ComputedSplit[] {
  if (participants.some((p) => p.owedMinor === undefined)) {
    throw new SplitError('Every person needs an amount.')
  }
  const amounts = participants.map((p) => p.owedMinor ?? 0)
  if (amounts.some((value) => value < 0)) {
    throw new SplitError('Split amounts can’t be negative.')
  }
  if (amounts.reduce((sum, value) => sum + value, 0) !== amountMinor) {
    throw new SplitError('The split amounts must add up to the total.')
  }
  return participants.map((p, index) => ({
    userId: p.userId,
    owedMinor: amounts[index] ?? 0,
    shareBasisPoints: null,
    shareUnits: null,
  }))
}

/**
 * Weights, not amounts: "two of us, one of them" is 2 : 1. Percentages can
 * express the same intent, but only after the user does the division — and
 * three equal people cannot be written as percentages at all (33.33 x 3 is not
 * 100).
 */
function shares(amountMinor: number, participants: SplitParticipantInput[]): ComputedSplit[] {
  if (participants.some((p) => p.shareUnits === undefined)) {
    throw new SplitError('Every person needs a share.')
  }
  const units = participants.map((p) => p.shareUnits ?? 0)
  if (units.some((value) => value < 1)) {
    throw new SplitError('Each share must be at least 1.')
  }
  const owed = proportional(amountMinor, units)
  return participants.map((p, index) => ({
    userId: p.userId,
    owedMinor: owed[index] ?? 0,
    shareBasisPoints: null,
    shareUnits: units[index] ?? 0,
  }))
}

/**
 * Split a bill line by line, each line among the people who shared it.
 *
 * A restaurant bill is not one amount divided one way — it is a list of things,
 * each shared by a different subset. Every item is divided equally among its own
 * participants and the results are summed per person.
 */
export function computeItemizedSplits(
  amountMinor: number,
  items: LineItemInput[],
): ComputedSplit[] {
  if (items.length === 0) throw new SplitError('Add at least one item.')

  const total = items.reduce((sum, item) => sum + item.amountMinor, 0)
  if (total !== amountMinor) throw new SplitError('The items must add up to the total.')

  for (const item of items) {
    if (item.participantIds.length === 0) {
      throw new SplitError(`Pick who shared "${item.description}".`)
    }
    if (new Set(item.participantIds).size !== item.participantIds.length) {
      throw new SplitError(`Each person can appear in "${item.description}" only once.`)
    }
  }

  // Map preserves insertion order, so splits come back in the order people
  // first appear on the bill — stable across re-saves of the same items.
  return [...itemizedOwed(items)].map(([userId, owedMinor]) => ({
    userId,
    owedMinor,
    shareBasisPoints: null,
    shareUnits: null,
  }))
}

/** Attach the method and expense id every persisted split row carries. */
export function toSplitRows(
  expenseId: Id,
  method: SplitMethod,
  computed: ComputedSplit[],
): GroupExpenseSplit[] {
  return computed.map((split) => ({
    id: `${expenseId}__${split.userId}`,
    expenseId,
    userId: split.userId,
    owedMinor: split.owedMinor,
    shareBasisPoints: split.shareBasisPoints,
    shareUnits: split.shareUnits,
    method,
  }))
}
