import { describe, expect, it } from 'vitest'

import { describeSplit, emptyDraft, newItem, summarizeSplit } from './split-draft'
import type { SplitDraft } from './split-draft'
import type { GroupMemberProfile } from '@/features/groups/types'
import { formatMoney } from '@/lib/format'

/**
 * The collapsed composer row is the only place the split is described before
 * it is saved, so this sentence is load-bearing: it is what the user checks
 * instead of opening the editor. Getting it wrong means they ship a split they
 * never actually looked at.
 */

const ME = 'me'

function members(count: number): GroupMemberProfile[] {
  return Array.from({ length: count }, (_, index) => ({
    userId: index === 0 ? ME : `user-${index}`,
    role: index === 0 ? ('owner' as const) : ('member' as const),
    joinedAt: '2026-01-01T00:00:00Z',
    email: `person${index}@example.com`,
    fullName: index === 0 ? 'Me' : `Person ${index}`,
    avatarUrl: null,
  }))
}

function describe_(draft: SplitDraft, amountMinor: number | null, people: GroupMemberProfile[], paidBy = ME) {
  return describeSplit({
    draft,
    summary: summarizeSplit(draft, amountMinor, 'USD', formatMoney),
    members: people,
    currency: 'USD',
    amountMinor,
    paidBy,
    myUserId: ME,
    formatMoney,
  })
}

describe('describeSplit', () => {
  it('names the per-head amount when the split is even', () => {
    const people = members(4)
    expect(describe_(emptyDraft(people), 120_00, people)).toEqual({
      headline: 'Split equally · $30.00 each',
      detail: 'You paid · 4 people',
    })
  })

  it('hedges when the amount does not divide cleanly', () => {
    const people = members(3)
    // 100 across 3 is 33.34 / 33.33 / 33.33 — nobody pays a flat third.
    expect(describe_(emptyDraft(people), 100_00, people).headline).toBe(
      'Split equally · about $33.33 each',
    )
  })

  it('falls back to a headcount before an amount is typed', () => {
    const people = members(4)
    expect(describe_(emptyDraft(people), null, people).headline).toBe('Split equally between 4')
  })

  it('names the payer when it is not you', () => {
    const people = members(3)
    expect(describe_(emptyDraft(people), 90_00, people, 'user-1').detail).toBe(
      'Person 1 paid · 3 people',
    )
  })

  it('says so when nobody is selected', () => {
    const people = members(3)
    const draft = { ...emptyDraft(people), selected: [] }
    expect(describe_(draft, 90_00, people)).toEqual({
      headline: 'Nobody’s sharing this yet',
      detail: 'You paid',
    })
  })

  it('counts lines, not people, for an itemized split', () => {
    const people = members(3)
    const draft: SplitDraft = {
      ...emptyDraft(people),
      method: 'itemized',
      items: [newItem([ME, 'user-1']), newItem(['user-2'])],
    }
    expect(describe_(draft, null, people)).toEqual({
      headline: 'By item · 2 lines',
      detail: 'You paid · 3 people',
    })
  })

  it.each([
    ['shares', 'Split by shares'],
    ['custom', 'Split by amounts'],
    ['percentage', 'Split by percent'],
  ] as const)('names the %s method', (method, expected) => {
    const people = members(2)
    expect(describe_({ ...emptyDraft(people), method }, 50_00, people).headline).toBe(expected)
  })

  it('singularises a one-person split', () => {
    const people = members(3)
    const draft = { ...emptyDraft(people), selected: [ME] }
    expect(describe_(draft, 50_00, people).detail).toBe('You paid · 1 person')
  })
})
