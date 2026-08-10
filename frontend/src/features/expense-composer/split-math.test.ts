import { describe, expect, it } from 'vitest'

import { equalSplit, itemizedOwed, proportional } from './split-math'

/**
 * These assertions are deliberately the same cases as
 * backend/tests/test_splits.py. The preview and the server have to produce
 * identical numbers; testing them against the same table is what keeps that
 * true when one side is edited.
 */

describe('proportional', () => {
  it('divides by weight', () => {
    expect(proportional(9_000, [2, 1])).toEqual([6_000, 3_000])
  })

  it('gives the leftover to the largest weight', () => {
    expect(proportional(101, [3, 1, 1])).toEqual([61, 20, 20])
  })

  it('matches the percentage case from the server suite', () => {
    // 33.33 / 33.33 / 33.34 of 100 units.
    expect(proportional(100, [3_333, 3_333, 3_334])).toEqual([33, 33, 34])
  })

  it.each([1, 7, 99, 12_345, 999_999_999])('always reconciles (%i)', (amount) => {
    const owed = proportional(amount, [3, 1, 1])
    expect(owed.reduce((sum, value) => sum + value, 0)).toBe(amount)
  })

  it('handles a zero total without dividing by zero', () => {
    expect(proportional(500, [0, 0])).toEqual([0, 0])
  })
})

describe('equalSplit', () => {
  it('divides evenly', () => {
    expect(equalSplit(9_000, 2)).toEqual([4_500, 4_500])
  })

  it('puts the remainder on the first participants', () => {
    expect(equalSplit(100, 3)).toEqual([34, 33, 33])
  })

  it('handles an amount smaller than the group', () => {
    expect(equalSplit(2, 3)).toEqual([1, 1, 0])
  })

  it('returns nothing for nobody', () => {
    expect(equalSplit(100, 0)).toEqual([])
  })
})

describe('itemizedOwed', () => {
  it('splits each item among its own participants', () => {
    const owed = itemizedOwed([
      { amountMinor: 1_000, participantIds: ['a', 'b'] },
      { amountMinor: 500, participantIds: ['a'] },
    ])
    expect(Object.fromEntries(owed)).toEqual({ a: 1_000, b: 500 })
  })

  it('rotates the rounding between items', () => {
    const owed = itemizedOwed([
      { amountMinor: 101, participantIds: ['a', 'b'] },
      { amountMinor: 101, participantIds: ['a', 'b'] },
      { amountMinor: 101, participantIds: ['a', 'b'] },
    ])
    expect(Object.fromEntries(owed)).toEqual({ a: 152, b: 151 })
  })

  it('skips items with nobody on them', () => {
    const owed = itemizedOwed([{ amountMinor: 100, participantIds: [] }])
    expect(owed.size).toBe(0)
  })

  it.each([3, 101, 9_999, 1_000_003])('always reconciles (%i)', (amount) => {
    const half = Math.floor(amount / 2)
    const owed = itemizedOwed([
      { amountMinor: half, participantIds: ['a', 'b', 'c'] },
      { amountMinor: amount - half, participantIds: ['a', 'b'] },
    ])
    expect([...owed.values()].reduce((sum, value) => sum + value, 0)).toBe(amount)
  })
})
