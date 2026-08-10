/**
 * Client-side previews of the split the server will compute.
 *
 * These mirror `backend/app/services/splits.py` exactly, including how
 * leftover minor units are handed out. The server stays authoritative — but a
 * preview that rounds differently means the number under someone's name
 * changes the instant you press save, which reads as the app losing money.
 * If one side changes, change the other.
 */

/** Divide `amountMinor` in proportion to `weights`, losing nothing. */
export function proportional(amountMinor: number, weights: number[]): number[] {
  const total = weights.reduce((sum, weight) => sum + weight, 0)
  if (total <= 0) return weights.map(() => 0)
  const owed = weights.map((weight) => Math.floor((amountMinor * weight) / total))
  const leftover = amountMinor - owed.reduce((sum, value) => sum + value, 0)
  // Largest weight first; ties keep their original order, as Python's
  // sorted(reverse=True) does, because both sorts are stable.
  const order = weights
    .map((weight, index) => ({ weight, index }))
    .sort((a, b) => b.weight - a.weight)
  for (let step = 0; step < leftover; step += 1) {
    const target = order[step % order.length]
    if (!target) break
    owed[target.index] = (owed[target.index] ?? 0) + 1
  }
  return owed
}

/** An even split, with the first `remainder` participants absorbing the rest. */
export function equalSplit(amountMinor: number, count: number): number[] {
  if (count <= 0) return []
  const base = Math.floor(amountMinor / count)
  const remainder = amountMinor - base * count
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0))
}

export interface ItemLike {
  amountMinor: number
  participantIds: string[]
}

/**
 * What each person owes across an itemized bill. Every item is split equally
 * among its own participants; which participant absorbs an item's leftover
 * minor unit rotates with the item's position, so the first name on the list
 * does not pay for the rounding on every line.
 */
export function itemizedOwed(items: ItemLike[]): Map<string, number> {
  const owed = new Map<string, number>()
  items.forEach((item, position) => {
    const count = item.participantIds.length
    if (count === 0) return
    const base = Math.floor(item.amountMinor / count)
    const remainder = item.amountMinor - base * count
    for (const userId of item.participantIds) {
      owed.set(userId, (owed.get(userId) ?? 0) + base)
    }
    for (let offset = 0; offset < remainder; offset += 1) {
      const userId = item.participantIds[(position + offset) % count]
      if (userId === undefined) break
      owed.set(userId, (owed.get(userId) ?? 0) + 1)
    }
  })
  return owed
}
