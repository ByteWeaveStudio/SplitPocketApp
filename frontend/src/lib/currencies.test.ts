import { describe, expect, it } from 'vitest'

import { currencyDecimalDigits, isSupportedCurrency } from '@/lib/currencies'
import type { CurrencyCode } from '@/types'

describe('isSupportedCurrency', () => {
  it('accepts codes from the picker list', () => {
    expect(isSupportedCurrency('USD')).toBe(true)
    expect(isSupportedCurrency('JPY')).toBe(true)
  })

  it('rejects unknown codes, lowercase, and non-strings', () => {
    expect(isSupportedCurrency('XYZ')).toBe(false)
    expect(isSupportedCurrency('usd')).toBe(false)
    expect(isSupportedCurrency(42)).toBe(false)
    expect(isSupportedCurrency(null)).toBe(false)
    expect(isSupportedCurrency(undefined)).toBe(false)
  })
})

describe('currencyDecimalDigits', () => {
  it('uses real ISO 4217 data, not a hardcoded 2', () => {
    expect(currencyDecimalDigits('USD')).toBe(2)
    expect(currencyDecimalDigits('JPY')).toBe(0)
    // 3-decimal currency the picker table doesn't know — must come from Intl.
    expect(currencyDecimalDigits('BHD' as CurrencyCode)).toBe(3)
  })

  it('falls back to 2 for malformed codes', () => {
    expect(currencyDecimalDigits('X' as CurrencyCode)).toBe(2)
  })
})
