import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
  where,
  Timestamp,
} from 'firebase/firestore'
import type { DocumentData, QueryDocumentSnapshot } from 'firebase/firestore'

import { monthStart, nextMonthStart } from '@/lib/dates'
import type { MonthKey } from '@/lib/dates'
import { getDb } from '@/services/firebase'
import { friendlyFirestoreMessage, toIso, trackWrite } from '@/services/firestore'
import { useAuthStore } from '@/stores/auth-store'
import type { CurrencyCode, Expense, ExpenseKind, Id } from '@/types'

export interface ExpenseInput {
  description: string
  amountMinor: number
  currency: CurrencyCode
  categoryId: Id | null
  date: string
  kind: ExpenseKind
  notes: string | null
}

export function toExpense(snapshot: QueryDocumentSnapshot<DocumentData>): Expense {
  const data = snapshot.data()
  return {
    id: snapshot.id,
    userId: data.ownerId as Id,
    groupId: (data.groupId as Id | null) ?? null,
    paidBy: data.paidBy as Id,
    categoryId: (data.categoryId as Id | null) ?? null,
    description: data.description as string,
    amountMinor: data.amountMinor as number,
    currency: data.currency as CurrencyCode,
    date: data.date as string,
    kind: data.kind as ExpenseKind,
    notes: (data.notes as string | null) ?? null,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  }
}

function expenseFromInput(userId: Id, id: Id, input: ExpenseInput, createdAt: string): Expense {
  return {
    id,
    userId,
    groupId: null,
    // A personal expense is paid by its owner — the security rules enforce
    // exactly this, so the optimistic row can assert it.
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

/**
 * The document body for a personal expense. `date` stays a YYYY-MM-DD string
 * so range filters and month keys keep comparing lexicographically.
 *
 * `createdAt` is a client Timestamp, deliberately not serverTimestamp(): an
 * unresolved server timestamp reads back as null from the local cache, and the
 * dashboard's recent-activity query orders by createdAt alone — a brand-new
 * expense would sort last and fall straight out of its limit(8). The clock
 * that sets it is the same one that already chose `date`.
 */
function toDocument(userId: Id, input: ExpenseInput) {
  return {
    ownerId: userId,
    groupId: null,
    groupName: null,
    memberIds: [userId],
    paidBy: userId,
    categoryId: input.categoryId,
    description: input.description,
    amountMinor: input.amountMinor,
    currency: input.currency,
    date: input.date,
    kind: input.kind,
    notes: input.notes,
  }
}

// ---------------------------------------------------------------------------
// Reads
//
// No cache layer and no pending-op overlay: Firestore's persistent cache
// serves these queries when the device is offline, and a write applied locally
// is already visible to every later query — including one that has not
// reached the server yet.
// ---------------------------------------------------------------------------

function personalExpensesQuery(userId: Id, from: string, to: string, withCreatedAt: boolean) {
  const clauses = [
    where('ownerId', '==', userId),
    where('groupId', '==', null),
    where('date', '>=', from),
    where('date', '<', to),
    orderBy('date', 'desc'),
  ]
  if (withCreatedAt) clauses.push(orderBy('createdAt', 'desc'))
  return query(collection(getDb(), 'expenses'), ...clauses)
}

/** Personal expenses (no group) for one calendar month, newest first. */
export async function listExpensesForMonth(month: MonthKey): Promise<Expense[]> {
  const userId = requireUserId()
  try {
    const snapshot = await getDocs(
      personalExpensesQuery(userId, monthStart(month), nextMonthStart(month), true),
    )
    return snapshot.docs.map(toExpense)
  } catch (error) {
    throw new Error(friendlyFirestoreMessage(error, 'Couldn’t load expenses.'))
  }
}

/**
 * Personal expenses across a span of months, for the trend report. One query
 * instead of one per month: a 12-month view would otherwise be twelve round
 * trips, and the report is a page people scrub back and forth on.
 */
export async function listExpensesInRange(
  fromMonth: MonthKey,
  toMonth: MonthKey,
): Promise<Expense[]> {
  const userId = requireUserId()
  try {
    const snapshot = await getDocs(
      personalExpensesQuery(userId, monthStart(fromMonth), nextMonthStart(toMonth), false),
    )
    return snapshot.docs.map(toExpense)
  } catch (error) {
    throw new Error(friendlyFirestoreMessage(error, 'Couldn’t load expenses.'))
  }
}

// ---------------------------------------------------------------------------
// Writes
//
// None of these await the server. Firestore applies the change to the local
// cache synchronously and resolves its promise only once the server has it,
// which offline is never — awaiting would make adding an expense block on the
// network, the one thing the product promises it never does. trackWrite keeps
// the promise, drives the pending badge, and reports a real rejection.
// ---------------------------------------------------------------------------

/** `id` is provided by the caller so optimistic inserts keep a stable key. */
export async function createExpense(id: Id, input: ExpenseInput): Promise<Expense> {
  const userId = requireUserId()
  trackWrite(
    id,
    setDoc(doc(getDb(), 'expenses', id), {
      ...toDocument(userId, input),
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    }),
    'save the expense',
  )
  return expenseFromInput(userId, id, input, new Date().toISOString())
}

export async function updateExpense(id: Id, input: ExpenseInput): Promise<Expense> {
  const userId = requireUserId()
  trackWrite(
    id,
    updateDoc(doc(getDb(), 'expenses', id), {
      categoryId: input.categoryId,
      description: input.description,
      amountMinor: input.amountMinor,
      currency: input.currency,
      date: input.date,
      kind: input.kind,
      notes: input.notes,
      updatedAt: Timestamp.now(),
    }),
    'update the expense',
  )
  return expenseFromInput(userId, id, input, new Date().toISOString())
}

export async function deleteExpense(id: Id): Promise<void> {
  requireUserId()
  trackWrite(id, deleteDoc(doc(getDb(), 'expenses', id)), 'delete the expense')
}
