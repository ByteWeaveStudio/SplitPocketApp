/** Month keys are 'YYYY-MM' in the user's local timezone. */
export type MonthKey = string

function pad(value: number): string {
  return String(value).padStart(2, '0')
}

/** Today as a local date-only string (YYYY-MM-DD). */
export function todayISODate(): string {
  const now = new Date()
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

export function currentMonthKey(): MonthKey {
  return todayISODate().slice(0, 7)
}

export function monthKeyOf(isoDate: string): MonthKey {
  return isoDate.slice(0, 7)
}

/** First day of the month, as an ISO date. */
export function monthStart(key: MonthKey): string {
  return `${key}-01`
}

function monthKeyParts(key: MonthKey): [year: number, month: number] {
  return [Number(key.slice(0, 4)), Number(key.slice(5, 7))]
}

/** First day of the following month — exclusive upper bound for range queries. */
export function nextMonthStart(key: MonthKey): string {
  const [year, month] = monthKeyParts(key)
  return month === 12 ? `${year + 1}-01-01` : `${year}-${pad(month + 1)}-01`
}

export function shiftMonthKey(key: MonthKey, delta: number): MonthKey {
  const [year, month] = monthKeyParts(key)
  const shifted = new Date(Date.UTC(year, month - 1 + delta, 1))
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}`
}

/** "August 2026" in the user's locale. */
export function monthKeyLabel(key: MonthKey): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${monthStart(key)}T00:00:00Z`))
}

/** "Mon, Aug 4" (year added when not the current year). */
export function dayLabel(isoDate: string): string {
  const sameYear = isoDate.slice(0, 4) === todayISODate().slice(0, 4)
  return new Intl.DateTimeFormat(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    timeZone: 'UTC',
  }).format(new Date(`${isoDate}T00:00:00Z`))
}
