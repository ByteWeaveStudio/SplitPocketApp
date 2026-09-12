import type { GroupExpense, GroupSettlement, SuggestedSettlement } from '@/features/groups/types'
import type { Id } from '@/types'

/**
 * Balance aggregation and debt simplification.
 *
 * Port of `backend/app/services/balances.py`, which ran as SQL aggregates the
 * server could do in one query. Firestore has no GROUP BY, so the same sums are
 * a reduce over documents the persistent cache is already holding.
 *
 * Sign convention: positive net = the group owes you (you're owed);
 * negative net = you owe the group.
 */

export function computeNet(
  memberIds: Id[],
  expenses: Array<{ paidBy: Id; amountMinor: number }>,
  splits: Array<{ userId: Id; owedMinor: number }>,
  settlements: Array<{ fromUserId: Id; toUserId: Id; amountMinor: number }>,
): Map<Id, number> {
  const net = new Map<Id, number>(memberIds.map((id) => [id, 0]))

  // paidBy, not the person who recorded it: the two can differ, and it is the
  // payer the group owes.
  for (const expense of expenses) {
    net.set(expense.paidBy, (net.get(expense.paidBy) ?? 0) + expense.amountMinor)
  }
  for (const split of splits) {
    net.set(split.userId, (net.get(split.userId) ?? 0) - split.owedMinor)
  }
  for (const settlement of settlements) {
    // Paying cash toward a debt raises the payer's net, lowers the receiver's.
    net.set(
      settlement.fromUserId,
      (net.get(settlement.fromUserId) ?? 0) + settlement.amountMinor,
    )
    net.set(settlement.toUserId, (net.get(settlement.toUserId) ?? 0) - settlement.amountMinor)
  }
  return net
}

/**
 * Greedy min-cash-flow: repeatedly settle the largest debtor with the largest
 * creditor. At most n-1 transfers; ties broken by user id so the result is
 * deterministic.
 */
export function simplifyDebts(net: Map<Id, number>): SuggestedSettlement[] {
  const creditors = [...net.entries()]
    .filter(([, value]) => value > 0)
    .sort(([aId, a], [bId, b]) => b - a || aId.localeCompare(bId))
    .map(([id, value]) => ({ id, amount: value }))
  const debtors = [...net.entries()]
    .filter(([, value]) => value < 0)
    .map(([id, value]) => ({ id, amount: -value }))
    .sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id))

  const transfers: SuggestedSettlement[] = []
  let i = 0
  let j = 0
  while (i < debtors.length && j < creditors.length) {
    const debtor = debtors[i]
    const creditor = creditors[j]
    if (!debtor || !creditor) break

    const amount = Math.min(debtor.amount, creditor.amount)
    transfers.push({ fromUserId: debtor.id, toUserId: creditor.id, amountMinor: amount })
    debtor.amount -= amount
    creditor.amount -= amount
    if (debtor.amount === 0) i += 1
    if (creditor.amount === 0) j += 1
  }
  return transfers
}

/** Everything the balances view needs, from documents already in hand. */
export function netFromLedger(
  memberIds: Id[],
  expenses: GroupExpense[],
  settlements: GroupSettlement[],
): Map<Id, number> {
  return computeNet(
    memberIds,
    expenses.map((e) => ({ paidBy: e.paidBy, amountMinor: e.amountMinor })),
    expenses.flatMap((e) => e.splits),
    settlements,
  )
}
