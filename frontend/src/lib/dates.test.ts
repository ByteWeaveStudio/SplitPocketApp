import { describe, expect, it } from 'vitest'

import {
  currentMonthKey,
  dayLabel,
  monthKeyLabel,
  monthKeyOf,
  monthStart,
  nextMonthStart,
  shiftMonthKey,
  todayISODate,
} from '@/lib/dates'

describe('todayISODate', () => {
  it('returns the local date as YYYY-MM-DD', () => {
    expect(todayISODate()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    const now = new Date()
    expect(todayISODate().slice(0, 4)).toBe(String(now.getFullYear()))
  })
})

describe('month keys', () => {
  it('derives keys and bounds from ISO dates', () => {
    expect(monthKeyOf('2026-08-06')).toBe('2026-08')
    expect(monthStart('2026-08')).toBe('2026-08-01')
    expect(nextMonthStart('2026-08')).toBe('2026-09-01')
    expect(currentMonthKey()).toBe(todayISODate().slice(0, 7))
  })

  it('rolls December into the next year', () => {
    expect(nextMonthStart('2026-12')).toBe('2027-01-01')
  })
})

describe('shiftMonthKey', () => {
  it('shifts within a year', () => {
    expect(shiftMonthKey('2026-08', 1)).toBe('2026-09')
    expect(shiftMonthKey('2026-08', -2)).toBe('2026-06')
    expect(shiftMonthKey('2026-08', 0)).toBe('2026-08')
  })

  it('crosses year boundaries in both directions', () => {
    expect(shiftMonthKey('2026-12', 1)).toBe('2027-01')
    expect(shiftMonthKey('2026-01', -1)).toBe('2025-12')
    expect(shiftMonthKey('2026-08', -20)).toBe('2024-12')
    expect(shiftMonthKey('2026-08', 17)).toBe('2028-01')
  })
})

describe('labels', () => {
  it('monthKeyLabel names the right year', () => {
    expect(monthKeyLabel('2026-08')).toContain('2026')
  })

  it('dayLabel adds the year only for other years', () => {
    const currentYear = todayISODate().slice(0, 4)
    expect(dayLabel(`${currentYear}-03-15`)).not.toContain(currentYear)
    expect(dayLabel('2020-03-15')).toContain('2020')
  })
})
