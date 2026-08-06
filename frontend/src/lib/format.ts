import { currencyDecimalDigits, DEFAULT_CURRENCY } from '@/lib/currencies'
import type { CurrencyCode, ISODateString } from '@/types'

function currencyFormatter(currency: CurrencyCode): Intl.NumberFormat {
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency })
  } catch {
    // Invalid code (e.g. corrupted persisted settings) — fall back rather than crash.
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: DEFAULT_CURRENCY })
  }
}

/**
 * Format an amount in minor units (cents, paise, …) as a currency string.
 * Minor-unit digits come from Intl (true ISO 4217 data), so conversion and
 * display always agree — including 0- and 3-digit currencies.
 */
export function formatMoney(amountMinor: number, currency: CurrencyCode): string {
  const formatter = currencyFormatter(currency)
  const digits = formatter.resolvedOptions().maximumFractionDigits ?? 2
  return formatter.format(amountMinor / 10 ** digits)
}

/**
 * Parse a user-typed amount ("12.50", "1200", "9,99") into minor units for
 * the given currency. Returns null when the input isn't a valid amount or
 * has more decimals than the currency allows. String math — no float drift.
 */
export function parseMoney(input: string, currency: CurrencyCode): number | null {
  const normalized = input.trim().replace(',', '.')
  const match = /^(\d+)(?:\.(\d*))?$/.exec(normalized)
  if (!match) return null
  const digits = currencyDecimalDigits(currency)
  const [, whole, fraction = ''] = match
  if (fraction.length > digits) return null
  const minor = Number(whole) * 10 ** digits + Number(fraction.padEnd(digits, '0') || '0')
  return Number.isSafeInteger(minor) ? minor : null
}

/** Minor units → a plain editable string for form inputs ("1250" → "12.50"). */
export function formatMinorForInput(amountMinor: number, currency: CurrencyCode): string {
  const digits = currencyDecimalDigits(currency)
  return (amountMinor / 10 ** digits).toFixed(digits)
}

/** Format a date-only string (YYYY-MM-DD). Rendered in UTC so the day never shifts. */
export function formatDate(date: ISODateString): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeZone: 'UTC' }).format(
    new Date(date),
  )
}

/** Format a full ISO timestamp in the user's local timezone. */
export function formatDateTime(timestamp: ISODateString): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(timestamp))
}
