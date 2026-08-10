import { describe, expect, it } from 'vitest'

import type { GroupExpense, GroupMemberProfile } from '@/features/groups/types'
import {
  MAX_SLICES,
  groupMemberStats,
  monthlyTrend,
  spendingByCategory,
  toCsv,
} from '@/features/reports/reports-data'
import type { Category, Expense } from '@/types'

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: crypto.randomUUID(),
    userId: 'me',
    groupId: null,
    paidBy: 'me',
    categoryId: null,
    description: 'Thing',
    amountMinor: 1_000,
    currency: 'USD',
    date: '2026-08-04',
    kind: 'expense',
    notes: null,
    createdAt: '2026-08-04T10:00:00Z',
    updatedAt: '2026-08-04T10:00:00Z',
    ...overrides,
  }
}

function category(id: string, name: string): Category {
  return { id, name, icon: 'tag', userId: null, createdAt: '2026-01-01T00:00:00Z' }
}

describe('spendingByCategory', () => {
  const categories = new Map([
    ['food', category('food', 'Food')],
    ['rent', category('rent', 'Rent')],
  ])

  it('groups by category and ranks by size', () => {
    const slices = spendingByCategory(
      [
        expense({ categoryId: 'food', amountMinor: 300 }),
        expense({ categoryId: 'rent', amountMinor: 700 }),
        expense({ categoryId: 'food', amountMinor: 100 }),
      ],
      'USD',
      categories,
    )
    expect(slices.map((slice) => [slice.label, slice.valueMinor])).toEqual([
      ['Rent', 700],
      ['Food', 400],
    ])
    expect(slices[0]?.share).toBeCloseTo(0.636, 2)
  })

  it('ignores income and other currencies', () => {
    const slices = spendingByCategory(
      [
        expense({ categoryId: 'food', amountMinor: 500 }),
        expense({ categoryId: 'food', amountMinor: 900, kind: 'income' }),
        expense({ categoryId: 'food', amountMinor: 900, currency: 'EUR' }),
      ],
      'USD',
      categories,
    )
    expect(slices).toEqual([
      expect.objectContaining({ label: 'Food', valueMinor: 500, share: 1 }),
    ])
  })

  it('labels a missing category rather than dropping the spend', () => {
    const slices = spendingByCategory([expense({ amountMinor: 250 })], 'USD', categories)
    expect(slices[0]?.label).toBe('Uncategorized')
  })

  it('folds the long tail into one row', () => {
    const many = Array.from({ length: MAX_SLICES + 4 }, (_, index) =>
      expense({ categoryId: `c${index}`, amountMinor: 100 - index }),
    )
    const slices = spendingByCategory(many, 'USD', new Map())
    expect(slices).toHaveLength(MAX_SLICES)
    expect(slices.at(-1)?.label).toBe('Everything else (5)')
    // Folding must not lose money.
    const total = slices.reduce((sum, slice) => sum + slice.valueMinor, 0)
    expect(total).toBe(many.reduce((sum, item) => sum + item.amountMinor, 0))
  })

  it('returns nothing when there is nothing', () => {
    expect(spendingByCategory([], 'USD', categories)).toEqual([])
  })
})

describe('monthlyTrend', () => {
  it('keeps empty months as zeroes', () => {
    // "We spent nothing in June" is information; dropping the bucket would
    // silently rescale the chart.
    const points = monthlyTrend([expense({ date: '2026-08-04' })], '2026-08', 3)
    expect(points.map((point) => point.month)).toEqual(['2026-06', '2026-07', '2026-08'])
    expect(points.map((point) => point.spentMinor)).toEqual([0, 0, 1_000])
  })

  it('separates spend from income', () => {
    const points = monthlyTrend(
      [
        expense({ date: '2026-08-01', amountMinor: 400 }),
        expense({ date: '2026-08-02', amountMinor: 900, kind: 'income' }),
      ],
      '2026-08',
      1,
    )
    expect(points).toEqual([{ month: '2026-08', spentMinor: 400, incomeMinor: 900 }])
  })

  it('ignores anything outside the window', () => {
    const points = monthlyTrend([expense({ date: '2025-01-04' })], '2026-08', 3)
    expect(points.every((point) => point.spentMinor === 0)).toBe(true)
  })

  it('crosses a year boundary', () => {
    const points = monthlyTrend([expense({ date: '2025-12-31' })], '2026-01', 2)
    expect(points.map((point) => point.month)).toEqual(['2025-12', '2026-01'])
    expect(points[0]?.spentMinor).toBe(1_000)
  })
})

describe('groupMemberStats', () => {
  const members: GroupMemberProfile[] = [
    { userId: 'a', role: 'owner', joinedAt: '', email: 'a@x.com', fullName: 'Ana', avatarUrl: null },
    { userId: 'b', role: 'member', joinedAt: '', email: 'b@x.com', fullName: 'Bo', avatarUrl: null },
  ]
  const groupExpense = (paidBy: string, amount: number, splits: [string, number][]): GroupExpense => ({
    ...expense({ groupId: 'g', paidBy, amountMinor: amount }),
    splits: splits.map(([userId, owedMinor], index) => ({
      id: `s${index}`,
      expenseId: 'e',
      userId,
      owedMinor,
      shareBasisPoints: null,
      shareUnits: null,
      method: 'equal' as const,
    })),
    items: [],
  })

  it('credits the payer, not the person who typed it in', () => {
    const stats = groupMemberStats(
      [groupExpense('b', 1_000, [['a', 500], ['b', 500]])],
      members,
      (member) => member.fullName ?? member.email,
    )
    expect(stats.find((stat) => stat.userId === 'b')?.paidMinor).toBe(1_000)
    expect(stats.find((stat) => stat.userId === 'a')?.paidMinor).toBe(0)
  })

  it('includes members with no activity', () => {
    const stats = groupMemberStats([], members, (member) => member.fullName ?? member.email)
    expect(stats).toHaveLength(2)
    expect(stats.every((stat) => stat.paidMinor === 0 && stat.shareMinor === 0)).toBe(true)
  })

  it('keeps someone who has left, so the columns still add up', () => {
    const stats = groupMemberStats(
      [groupExpense('gone', 900, [['a', 450], ['gone', 450]])],
      members,
      (member) => member.fullName ?? member.email,
    )
    const paid = stats.reduce((sum, stat) => sum + stat.paidMinor, 0)
    const share = stats.reduce((sum, stat) => sum + stat.shareMinor, 0)
    expect(paid).toBe(900)
    expect(share).toBe(900)
    expect(stats.find((stat) => stat.userId === 'gone')?.label).toBe('Former member')
  })
})

describe('toCsv', () => {
  it('quotes separators, quotes and newlines', () => {
    expect(toCsv(['a', 'b'], [['x,y', 'he said "hi"'], ['line\nbreak', 'plain']])).toBe(
      'a,b\r\n"x,y","he said ""hi"""\r\n"line\nbreak",plain',
    )
  })

  it('neutralises spreadsheet formula injection', () => {
    // A description of "=1+1" must arrive as text, not as something Excel runs.
    const csv = toCsv(['description'], [['=cmd|calc']])
    expect(csv).toBe("description\r\n'=cmd|calc")
  })

  it.each(['+44 phone', '-5 refund', '@handle'])('guards the leading %s', (value) => {
    expect(toCsv(['x'], [[value]])).toBe(`x\r\n'${value}`)
  })

  it('leaves ordinary values alone', () => {
    expect(toCsv(['amount'], [['12.50']])).toBe('amount\r\n12.50')
  })
})
