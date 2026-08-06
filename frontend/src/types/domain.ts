/**
 * Core domain entities, mirroring the future database schema (Milestone 3).
 *
 * Conventions:
 * - All ids are UUID strings.
 * - All monetary amounts are integers in the currency's minor unit
 *   (cents, paise, …) to avoid floating-point drift. Use `formatMoney`
 *   from `@/lib/format` for display.
 * - All timestamps and dates are ISO 8601 strings.
 */

export type Id = string
export type ISODateString = string
/** ISO 4217 code, e.g. "USD", "INR". */
export type CurrencyCode = string

export interface UserProfile {
  id: Id
  email: string
  fullName: string | null
  avatarUrl: string | null
  defaultCurrency: CurrencyCode
  createdAt: ISODateString
}

export interface Category {
  id: Id
  name: string
  /** Lucide icon name rendered in category pickers. */
  icon: string
  /** Null for the built-in defaults shared by all users. */
  userId: Id | null
  createdAt: ISODateString
}

export type ExpenseKind = 'expense' | 'income'

export interface Expense {
  id: Id
  /** Who created the record (and paid, unless splits say otherwise). */
  userId: Id
  /** Null for personal expenses; set when the expense belongs to a group. */
  groupId: Id | null
  categoryId: Id | null
  description: string
  amountMinor: number
  currency: CurrencyCode
  /** The day the expense happened (date only). */
  date: ISODateString
  kind: ExpenseKind
  notes: string | null
  createdAt: ISODateString
  updatedAt: ISODateString
}

export type SplitMethod = 'equal' | 'custom' | 'percentage'

export interface ExpenseSplit {
  id: Id
  expenseId: Id
  userId: Id
  /** What this member owes toward the expense, in minor units. */
  owedMinor: number
  /** Basis points (1/100 of a percent) when method is "percentage". */
  shareBasisPoints: number | null
  method: SplitMethod
}

export interface Group {
  id: Id
  name: string
  description: string | null
  currency: CurrencyCode
  createdBy: Id
  createdAt: ISODateString
  archivedAt: ISODateString | null
}

export type GroupRole = 'owner' | 'member'

export interface GroupMember {
  groupId: Id
  userId: Id
  role: GroupRole
  joinedAt: ISODateString
}

export interface Settlement {
  id: Id
  groupId: Id
  fromUserId: Id
  toUserId: Id
  amountMinor: number
  currency: CurrencyCode
  note: string | null
  settledAt: ISODateString
  createdAt: ISODateString
}

export type BudgetPeriod = 'monthly'

export interface Budget {
  id: Id
  userId: Id
  /** Null means the budget covers all categories. */
  categoryId: Id | null
  amountMinor: number
  currency: CurrencyCode
  period: BudgetPeriod
  startsOn: ISODateString
}

export interface Currency {
  code: CurrencyCode
  symbol: string
  name: string
  /** Number of digits in the minor unit (2 for USD, 0 for JPY). */
  decimalDigits: number
}

/** A pairwise balance derived from splits and settlements. */
export interface Balance {
  /** Positive: the other user owes you. Negative: you owe them. */
  amountMinor: number
  currency: CurrencyCode
  otherUserId: Id
  groupId: Id | null
}
