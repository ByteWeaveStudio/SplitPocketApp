import type { Currency, CurrencyCode } from '@/types'

/** Starter set for the currency picker; extend as needed. */
export const CURRENCIES: Currency[] = [
  { code: 'USD', symbol: '$', name: 'US Dollar', decimalDigits: 2 },
  { code: 'EUR', symbol: '€', name: 'Euro', decimalDigits: 2 },
  { code: 'GBP', symbol: '£', name: 'British Pound', decimalDigits: 2 },
  { code: 'INR', symbol: '₹', name: 'Indian Rupee', decimalDigits: 2 },
  { code: 'JPY', symbol: '¥', name: 'Japanese Yen', decimalDigits: 0 },
  { code: 'CNY', symbol: '¥', name: 'Chinese Yuan', decimalDigits: 2 },
  { code: 'AUD', symbol: 'A$', name: 'Australian Dollar', decimalDigits: 2 },
  { code: 'CAD', symbol: 'C$', name: 'Canadian Dollar', decimalDigits: 2 },
  { code: 'SGD', symbol: 'S$', name: 'Singapore Dollar', decimalDigits: 2 },
  { code: 'AED', symbol: 'د.إ', name: 'UAE Dirham', decimalDigits: 2 },
]

export const DEFAULT_CURRENCY: CurrencyCode = 'USD'

export function isSupportedCurrency(value: unknown): value is CurrencyCode {
  return typeof value === 'string' && CURRENCIES.some((currency) => currency.code === value)
}

/** The bare symbol, for the standalone prefix beside the amount field.
 * `formatMoney` can't be used there — it would print a whole formatted value,
 * and the number is a live input. Falls back to the code, which is never
 * wrong, only longer. */
export function currencySymbol(code: CurrencyCode): string {
  try {
    const part = new Intl.NumberFormat('en', { style: 'currency', currency: code })
      .formatToParts(0)
      .find((candidate) => candidate.type === 'currency')
    if (part) return part.value
  } catch {
    // Unknown code — fall through to the table.
  }
  return CURRENCIES.find((currency) => currency.code === code)?.symbol ?? code
}

/** Minor-unit digits from Intl's ISO 4217 data; table is only a fallback. */
export function currencyDecimalDigits(code: CurrencyCode): number {
  try {
    const resolved = new Intl.NumberFormat('en', {
      style: 'currency',
      currency: code,
    }).resolvedOptions()
    return resolved.maximumFractionDigits ?? 2
  } catch {
    return CURRENCIES.find((currency) => currency.code === code)?.decimalDigits ?? 2
  }
}
