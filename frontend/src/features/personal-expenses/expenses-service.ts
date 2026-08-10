import type { PostgrestError } from '@supabase/supabase-js'

import { monthKeyOf, monthStart, nextMonthStart } from '@/lib/dates'
import type { MonthKey } from '@/lib/dates'
import { cacheKeys, cachedFetch, listCacheKeys, readCache, writeCache } from '@/services/offline/cache'
import { isNetworkError, isOffline } from '@/services/offline/net'
import { enqueueOp, listOps } from '@/services/offline/outbox'
import type { OutboxOp } from '@/services/offline/outbox'
import { getSupabase } from '@/services/supabase'
import { useAuthStore } from '@/stores/auth-store'
import type { CurrencyCode, Expense, ExpenseKind, Id, Tables, TablesInsert } from '@/types'

type ExpenseRow = Tables<'expenses'>

export interface ExpenseInput {
  description: string
  amountMinor: number
  currency: CurrencyCode
  categoryId: Id | null
  date: string
  kind: ExpenseKind
  notes: string | null
}

function toExpense(row: ExpenseRow): Expense {
  return {
    id: row.id,
    userId: row.user_id,
    groupId: row.group_id,
    paidBy: row.paid_by,
    categoryId: row.category_id,
    description: row.description,
    amountMinor: row.amount_minor,
    currency: row.currency,
    date: row.date,
    kind: row.kind as ExpenseKind,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function expenseFromInput(userId: Id, id: Id, input: ExpenseInput, createdAt: string): Expense {
  return {
    id,
    userId,
    groupId: null,
    // A personal expense is paid by its owner — the database enforces exactly
    // this (enforce_expense_payer), so the optimistic row can assert it.
    paidBy: userId,
    categoryId: input.categoryId,
    description: input.description,
    amountMinor: input.amountMinor,
    currency: input.currency,
    date: input.date,
    kind: input.kind,
    notes: input.notes,
    createdAt,
    updatedAt: new Date().toISOString(),
  }
}

function requireUserId(): Id {
  const user = useAuthStore.getState().user
  if (!user) throw new Error('You need to be signed in.')
  return user.id
}

function throwFriendly(action: string, error: PostgrestError): never {
  throw new Error(`Couldn't ${action}. ${error.message}`)
}

function byDateDesc(a: Expense, b: Expense): number {
  return a.date === b.date
    ? b.createdAt.localeCompare(a.createdAt)
    : b.date.localeCompare(a.date)
}

// ---------------------------------------------------------------------------
// Reads — network-first with cache fallback, plus the pending-op overlay so
// changes queued offline stay visible across reloads until they sync.
// ---------------------------------------------------------------------------

async function fetchExpensesForMonth(userId: Id, month: MonthKey): Promise<Expense[]> {
  const { data, error } = await getSupabase()
    .from('expenses')
    .select('*')
    .eq('user_id', userId)
    .is('group_id', null)
    .gte('date', monthStart(month))
    .lt('date', nextMonthStart(month))
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throwFriendly('load expenses', error)
  return data.map(toExpense)
}

/** Replays queued ops on top of a (possibly cached) month of expenses. */
async function withPendingOps(
  userId: Id,
  month: MonthKey,
  expenses: Expense[],
): Promise<Expense[]> {
  const pending = await listOps(userId)
  if (pending.length === 0) return expenses
  let result = [...expenses]
  for (const entry of pending) {
    const op = entry.op
    if (op.kind === 'expense.create' || op.kind === 'expense.update') {
      const existing = result.find((expense) => expense.id === op.entityId)
      result = result.filter((expense) => expense.id !== op.entityId)
      if (monthKeyOf(op.input.date) === month) {
        result.push({
          ...expenseFromInput(userId, op.entityId, op.input, entry.queuedAt),
          createdAt: existing?.createdAt ?? entry.queuedAt,
        })
      }
    } else if (op.kind === 'expense.delete') {
      result = result.filter((expense) => expense.id !== op.entityId)
    }
  }
  return result.sort(byDateDesc)
}

/** Personal expenses (no group) for one calendar month, newest first. */
export async function listExpensesForMonth(month: MonthKey): Promise<Expense[]> {
  const userId = requireUserId()
  let expenses: Expense[]
  try {
    expenses = await cachedFetch(cacheKeys.expensesMonth(userId, month), () =>
      fetchExpensesForMonth(userId, month),
    )
  } catch (error) {
    // "Offline" is a claim about the device, and it was being made for any
    // failed request — a blocked CORS preflight or a server that never
    // answered reads to fetch() exactly like a dropped connection. Telling
    // someone with four bars that they are offline sends them to fix the
    // wrong thing, so only say it when navigator actually says so.
    if (isOffline()) {
      throw new Error('You’re offline and this month isn’t saved on this device yet.')
    }
    if (isNetworkError(error)) {
      throw new Error('Couldn’t reach the server, and this month isn’t saved on this device yet.')
    }
    throw error
  }
  return withPendingOps(userId, month, expenses)
}

/**
 * Personal expenses across a span of months, for the trend report. One query
 * instead of one per month: a 12-month view would otherwise be twelve round
 * trips, and the report is a page people scrub back and forth on.
 *
 * Pending offline ops are not replayed over this — the trend is a
 * look-back at settled history, and a queued change to last March would
 * make the chart disagree with the month view it came from.
 */
export async function listExpensesInRange(
  fromMonth: MonthKey,
  toMonth: MonthKey,
): Promise<Expense[]> {
  const userId = requireUserId()
  const from = monthStart(fromMonth)
  const to = nextMonthStart(toMonth)
  return cachedFetch(cacheKeys.expensesRange(userId, from, to), async () => {
    const { data, error } = await getSupabase()
      .from('expenses')
      .select('*')
      .eq('user_id', userId)
      .is('group_id', null)
      .gte('date', from)
      .lt('date', to)
      .order('date', { ascending: false })
    if (error) throwFriendly('load expenses', error)
    return data.map(toExpense)
  })
}

// ---------------------------------------------------------------------------
// Cache maintenance for confirmed (online) writes, so going offline right
// after a change still shows it. Only months already cached are patched —
// an uncached month gets a complete snapshot on its next successful fetch.
// ---------------------------------------------------------------------------

async function patchMonthCaches(userId: Id, id: Id, replacement: Expense | null): Promise<void> {
  const monthKeys = await listCacheKeys(`expenses:${userId}:`)
  const targetKey = replacement
    ? cacheKeys.expensesMonth(userId, monthKeyOf(replacement.date))
    : null
  for (const key of monthKeys) {
    const list = await readCache<Expense[]>(key)
    if (!list) continue
    const without = list.filter((expense) => expense.id !== id)
    if (key === targetKey && replacement) {
      await writeCache(key, [...without, replacement].sort(byDateDesc))
    } else if (without.length !== list.length) {
      await writeCache(key, without)
    }
  }
}

// ---------------------------------------------------------------------------
// Writes — straight to Supabase when online; queued to the outbox (and
// echoed back optimistically) when the network is away.
// ---------------------------------------------------------------------------

async function insertExpenseRow(userId: Id, id: Id, input: ExpenseInput): Promise<Expense> {
  const row: TablesInsert<'expenses'> = {
    id,
    user_id: userId,
    group_id: null,
    category_id: input.categoryId,
    description: input.description,
    amount_minor: input.amountMinor,
    currency: input.currency,
    date: input.date,
    kind: input.kind,
    notes: input.notes,
  }
  const { data, error } = await getSupabase().from('expenses').insert(row).select().single()
  if (error) throw error
  return toExpense(data)
}

/** `id` is provided by the caller so optimistic inserts keep a stable key. */
export async function createExpense(id: Id, input: ExpenseInput): Promise<Expense> {
  const userId = requireUserId()
  // Always attempted, never skipped on the strength of navigator.onLine. A
  // write that queues because of a wrong hint is a write the user watches not
  // happen; a write that fails for real falls through to the outbox anyway,
  // so trying first costs nothing but a round trip.
  try {
    const saved = await insertExpenseRow(userId, id, input)
    await patchMonthCaches(userId, id, saved)
    return saved
  } catch (error) {
    if (!isNetworkError(error)) throwFriendly('save the expense', error as PostgrestError)
  }
  await enqueueOp(userId, { kind: 'expense.create', entityId: id, input })
  return expenseFromInput(userId, id, input, new Date().toISOString())
}

export async function updateExpense(id: Id, input: ExpenseInput): Promise<Expense> {
  const userId = requireUserId()
  try {
    const { data, error } = await getSupabase()
      .from('expenses')
      .update({
        category_id: input.categoryId,
        description: input.description,
        amount_minor: input.amountMinor,
        currency: input.currency,
        date: input.date,
        kind: input.kind,
        notes: input.notes,
      })
      .eq('id', id)
      .select()
      .single()
    if (error) throw error
    const saved = toExpense(data)
    await patchMonthCaches(userId, id, saved)
    return saved
  } catch (error) {
    if (!isNetworkError(error)) throwFriendly('update the expense', error as PostgrestError)
  }
  await enqueueOp(userId, { kind: 'expense.update', entityId: id, input })
  const cached = await readCache<Expense[]>(
    cacheKeys.expensesMonth(userId, monthKeyOf(input.date)),
  )
  const createdAt =
    cached?.find((expense) => expense.id === id)?.createdAt ?? new Date().toISOString()
  return expenseFromInput(userId, id, input, createdAt)
}

export async function deleteExpense(id: Id): Promise<void> {
  const userId = requireUserId()
  try {
    const { error } = await getSupabase().from('expenses').delete().eq('id', id)
    if (error) throw error
    await patchMonthCaches(userId, id, null)
    return
  } catch (error) {
    if (!isNetworkError(error)) throwFriendly('delete the expense', error as PostgrestError)
  }
  await enqueueOp(userId, { kind: 'expense.delete', entityId: id })
}

// ---------------------------------------------------------------------------
// Replay — called by the sync runner when connectivity returns. Idempotent:
// a create that already reached the server is a duplicate-key no-op, and
// updates/deletes of rows removed elsewhere match zero rows.
// ---------------------------------------------------------------------------

export async function replayExpenseOp(userId: Id, op: OutboxOp): Promise<void> {
  if (op.kind === 'expense.create') {
    try {
      await insertExpenseRow(userId, op.entityId, op.input)
    } catch (error) {
      if ((error as PostgrestError).code !== '23505') throw error
    }
  } else if (op.kind === 'expense.update') {
    const { error } = await getSupabase()
      .from('expenses')
      .update({
        category_id: op.input.categoryId,
        description: op.input.description,
        amount_minor: op.input.amountMinor,
        currency: op.input.currency,
        date: op.input.date,
        kind: op.input.kind,
        notes: op.input.notes,
      })
      .eq('id', op.entityId)
    if (error) throw error
  } else if (op.kind === 'expense.delete') {
    const { error } = await getSupabase().from('expenses').delete().eq('id', op.entityId)
    if (error) throw error
  }
}
