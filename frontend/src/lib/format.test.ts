import { describe, expect, it } from 'vitest'

import { formatDate, formatMinorForInput, formatMoney, parseMoney } from '@/lib/format'
import type { CurrencyCode } from '@/types'

/** Locale-proof: grouping and symbols vary by machine locale, digits don't. */
function digitsOf(formatted: string): string {
  return formatted.replace(/\D/g, '')
}

describe('parseMoney', () => {
  it('parses plain decimal amounts into minor units', () => {
    expect(parseMoney('12.50', 'USD')).toBe(1250)
    expect(parseMoney('1200', 'USD')).toBe(120000)
    expect(parseMoney('0.05', 'USD')).toBe(5)
  })

  it('accepts a comma as the decimal separator', () => {
    expect(parseMoney('9,99', 'USD')).toBe(999)
  })

  it('pads short fractions and tolerates a trailing separator', () => {
    expect(parseMoney('12.5', 'USD')).toBe(1250)
    expect(parseMoney('12.', 'USD')).toBe(1200)
  })

  it('trims surrounding whitespace', () => {
    expect(parseMoney('  12.50  ', 'USD')).toBe(1250)
  })

  it('respects zero-decimal currencies', () => {
    expect(parseMoney('1200', 'JPY')).toBe(1200)
    expect(parseMoney('12.5', 'JPY')).toBeNull()
  })

  it('rejects more decimals than the currency allows', () => {
    expect(parseMoney('12.999', 'USD')).toBeNull()
  })

  it('rejects non-amounts', () => {
    for (const input of ['', 'abc', '-5', '1.2.3', '1,2,3', '12 50', '$12']) {
      expect(parseMoney(input, 'USD')).toBeNull()
    }
  })

  it('rejects amounts beyond the safe-integer range', () => {
    expect(parseMoney('90071992547409.91', 'USD')).toBe(9007199254740991)
    expect(parseMoney('90071992547409.92', 'USD')).toBeNull()
  })
})

describe('formatMinorForInput', () => {
  it('renders minor units as an editable string', () => {
    expect(formatMinorForInput(1250, 'USD')).toBe('12.50')
    expect(formatMinorForInput(5, 'USD')).toBe('0.05')
    expect(formatMinorForInput(1250, 'JPY')).toBe('1250')
  })

  it('round-trips through parseMoney', () => {
    const cases: Array<[number, CurrencyCode]> = [
      [1, 'USD'],
      [1250, 'USD'],
      [999999, 'INR'],
      [1250, 'JPY'],
      [0, 'EUR'],
    ]
    for (const [minor, currency] of cases) {
      expect(parseMoney(formatMinorForInput(minor, currency), currency)).toBe(minor)
    }
  })
})

describe('formatMoney', () => {
  it('scales minor units by the currency decimals', () => {
    expect(digitsOf(formatMoney(1250, 'USD'))).toBe('1250')
    expect(digitsOf(formatMoney(1250, 'JPY'))).toBe('1250')
    expect(digitsOf(formatMoney(0, 'USD'))).toBe('000')
  })

  it('falls back instead of crashing on a corrupted currency code', () => {
    expect(digitsOf(formatMoney(1250, 'NOPE' as CurrencyCode))).toBe('1250')
  })
})

describe('formatDate', () => {
  it('never shifts the day across timezones (renders in UTC)', () => {
    // In any negative-offset timezone a naive format would show Dec 31, 2025.
    expect(formatDate('2026-01-01')).toContain('2026')
    expect(formatDate('2026-01-01')).not.toContain('2025')
  })
})
