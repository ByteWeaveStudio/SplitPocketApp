import type { GroupExpense, GroupMemberProfile } from '@/features/groups/types'
import { monthKeyOf, shiftMonthKey } from '@/lib/dates'
import type { MonthKey } from '@/lib/dates'
import type { Category, CurrencyCode, Expense, Id } from '@/types'

/**
 * Aggregation for the reports screen. Pure and separate from the components so
 * the arithmetic can be tested without rendering anything — these are the
 * numbers people will quote at each other.
 */

/** Categories beyond this fold into "Everything else" so the list stays readable. */
export const MAX_SLICES = 8

export interface BarSlice {
  key: string
  label: string
  /** Lucide icon name, when the row represents a category. */
  icon?: string
  valueMinor: number
  /** 0–1 of the total; the bar's width. */
  share: number
}

export interface MonthPoint {
  month: MonthKey
  spentMinor: number
  incomeMinor: number
}

function fold(slices: BarSlice[], total: number): BarSlice[] {
  if (slices.length <= MAX_SLICES) return slices
  const kept = slices.slice(0, MAX_SLICES - 1)
  const rest = slices.slice(MAX_SLICES - 1)
  const valueMinor = rest.reduce((sum, slice) => sum + slice.valueMinor, 0)
  kept.push({
    key: 'other',
    label: `Everything else (${rest.length})`,
    valueMinor,
    share: total === 0 ? 0 : valueMinor / total,
  })
  return kept
}

function toSlices(totals: Map<string, { label: string; icon?: string; value: number }>): BarSlice[] {
  const total = [...totals.values()].reduce((sum, entry) => sum + entry.value, 0)
  if (total === 0) return []
  return fold(
    [...totals.entries()]
      .map(([key, entry]) => ({
        key,
        label: entry.label,
        icon: entry.icon,
        valueMinor: entry.value,
        share: entry.value / total,
      }))
      .sort((a, b) => b.valueMinor - a.valueMinor),
    total,
  )
}

/** Personal spending in one currency, broken down by category. */
export function spendingByCategory(
  expenses: Expense[],
  currency: CurrencyCode,
  categoriesById: Map<Id, Category>,
): BarSlice[] {
  const totals = new Map<string, { label: string; icon?: string; value: number }>()
  for (const expense of expenses) {
    if (expense.currency !== currency || expense.kind !== 'expense') continue
    const key = expense.categoryId ?? 'uncategorized'
    const category = expense.categoryId ? categoriesById.get(expense.categoryId) : undefined
    const entry = totals.get(key) ?? {
      label: category?.name ?? 'Uncategorized',
      icon: category?.icon,
      value: 0,
    }
    entry.value += expense.amountMinor
    totals.set(key, entry)
  }
  return toSlices(totals)
}

/** The last `count` months ending at `endMonth`, oldest first, gaps included. */
export function monthlyTrend(
  expenses: Expense[],
  endMonth: MonthKey,
  count: number,
): MonthPoint[] {
  const points = new Map<MonthKey, MonthPoint>()
  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const month = shiftMonthKey(endMonth, -offset)
    // Months with nothing in them are real information ("we spent nothing in
    // March"), so they are seeded rather than dropped.
    points.set(month, { month, spentMinor: 0, incomeMinor: 0 })
  }
  for (const expense of expenses) {
    const point = points.get(monthKeyOf(expense.date))
    if (!point) continue
    if (expense.kind === 'income') point.incomeMinor += expense.amountMinor
    else point.spentMinor += expense.amountMinor
  }
  return [...points.values()]
}

export interface GroupMemberStat {
  userId: Id
  label: string
  paidMinor: number
  shareMinor: number
}

/** Per-member totals for a group: what they put in, and what was theirs. */
export function groupMemberStats(
  expenses: GroupExpense[],
  members: GroupMemberProfile[],
  labelOf: (member: GroupMemberProfile) => string,
): GroupMemberStat[] {
  const stats = new Map<Id, GroupMemberStat>(
    members.map((member) => [
      member.userId,
      { userId: member.userId, label: labelOf(member), paidMinor: 0, shareMinor: 0 },
    ]),
  )
  const ensure = (userId: Id) => {
    // A payer or ower who has since left the group still has to appear, or the
    // columns won't add up to the group's total.
    let stat = stats.get(userId)
    if (!stat) {
      stat = { userId, label: 'Former member', paidMinor: 0, shareMinor: 0 }
      stats.set(userId, stat)
    }
    return stat
  }

  for (const expense of expenses) {
    ensure(expense.paidBy).paidMinor += expense.amountMinor
    for (const split of expense.splits) {
      ensure(split.userId).shareMinor += split.owedMinor
    }
  }
  return [...stats.values()].sort((a, b) => b.shareMinor - a.shareMinor)
}

/** Group spending by category, in the group's own currency. */
export function groupSpendingByCategory(
  expenses: GroupExpense[],
  categoriesById: Map<Id, Category>,
): BarSlice[] {
  const totals = new Map<string, { label: string; icon?: string; value: number }>()
  for (const expense of expenses) {
    const key = expense.categoryId ?? 'uncategorized'
    const category = expense.categoryId ? categoriesById.get(expense.categoryId) : undefined
    const entry = totals.get(key) ?? {
      label: category?.name ?? 'Uncategorized',
      icon: category?.icon,
      value: 0,
    }
    entry.value += expense.amountMinor
    totals.set(key, entry)
  }
  return toSlices(totals)
}

// ---------------------------------------------------------------------------
// CSV export
// ---------------------------------------------------------------------------

/**
 * Amounts are written as decimal strings in the currency's own scale, not
 * minor units: the file is for a spreadsheet, and 1250 in a column headed
 * "amount" is a different claim from 12.50.
 */
function csvCell(value: string | number): string {
  const text = String(value)
  // A leading =, +, - or @ makes Excel and Sheets evaluate the cell as a
  // formula. Prefixing with a quote keeps a description like "-5 refund" text.
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return /[",\n\r]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded
}

export function toCsv(headers: string[], rows: (string | number)[][]): string {
  return [headers, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
}

/** Hands the browser a file without a round trip to the server. */
export function downloadCsv(filename: string, contents: string): void {
  // The BOM is what makes Excel read the file as UTF-8 rather than the local
  // codepage — without it every ₹ and € in a description arrives mangled.
  const blob = new Blob([`﻿${contents}`], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
