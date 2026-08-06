import type { PostgrestError } from '@supabase/supabase-js'

import type {
  GroupBalances,
  GroupExpense,
  GroupExpenseInput,
  GroupSettlement,
  GroupWithMembers,
  MyGroupBalance,
} from '@/features/groups/types'
import { api, ApiError } from '@/services/api'
import { cacheKeys, cachedFetch } from '@/services/offline/cache'
import { OFFLINE_MESSAGE, isNetworkError, isOffline } from '@/services/offline/net'
import { getSupabase } from '@/services/supabase'
import { useAuthStore } from '@/stores/auth-store'
import type { CurrencyCode, ExpenseKind, Id, SplitMethod, Tables } from '@/types'

/** Reads go straight to Supabase (RLS-scoped); writes with business rules go
 * through the Python API. API responses are already camelCase.
 *
 * Offline: reads fall back to the last cached result so groups stay viewable;
 * writes need a connection (they run multi-member rules server-side) and fail
 * with a clear offline message instead of being queued. */

function requireUserId(): Id {
  const user = useAuthStore.getState().user
  if (!user) throw new Error('You need to be signed in.')
  return user.id
}

function messageFrom(error: unknown, fallback: string): string {
  if (error instanceof ApiError) {
    const detail =
      error.body && typeof error.body === 'object' && 'detail' in error.body
        ? (error.body as { detail: unknown }).detail
        : null
    if (typeof detail === 'string') return detail
  }
  if (error instanceof Error && error.name !== 'ApiError') return error.message
  return fallback
}

async function call<T>(promise: Promise<T>, fallback: string): Promise<T> {
  try {
    return await promise
  } catch (error) {
    throw new Error(messageFrom(error, fallback))
  }
}

function throwFriendly(action: string, error: PostgrestError): never {
  throw new Error(`Couldn't ${action}. ${error.message}`)
}

// ---------------------------------------------------------------------------
// Groups & members
// ---------------------------------------------------------------------------

interface MemberRow {
  user_id: string
  role: string
  joined_at: string
  profiles: { email: string; full_name: string | null; avatar_url: string | null } | null
}

export function listGroups(): Promise<GroupWithMembers[]> {
  return cachedFetch(cacheKeys.groups(requireUserId()), fetchGroups)
}

async function fetchGroups(): Promise<GroupWithMembers[]> {
  const { data, error } = await getSupabase()
    .from('groups')
    .select('*, group_members(user_id, role, joined_at, profiles(email, full_name, avatar_url))')
    .is('archived_at', null)
    .order('created_at', { ascending: false })
  if (error) throwFriendly('load groups', error)
  return data.map((row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    currency: row.currency,
    createdBy: row.created_by,
    createdAt: row.created_at,
    archivedAt: row.archived_at,
    members: ((row.group_members ?? []) as MemberRow[]).map((member) => ({
      userId: member.user_id,
      role: member.role as 'owner' | 'member',
      joinedAt: member.joined_at,
      email: member.profiles?.email ?? '',
      fullName: member.profiles?.full_name ?? null,
      avatarUrl: member.profiles?.avatar_url ?? null,
    })),
  }))
}

export function createGroup(input: {
  name: string
  description: string | null
  currency: CurrencyCode
}): Promise<GroupWithMembers> {
  return call(
    api<GroupWithMembers>('/api/v1/groups', { method: 'POST', body: JSON.stringify(input) }),
    'Couldn’t create the group.',
  )
}

export function addMemberByEmail(groupId: Id, email: string) {
  return call(
    api<GroupWithMembers['members'][number]>(`/api/v1/groups/${groupId}/members`, {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
    'Couldn’t add that person.',
  )
}

export function removeMember(groupId: Id, userId: Id): Promise<void> {
  return call(
    api<void>(`/api/v1/groups/${groupId}/members/${userId}`, { method: 'DELETE' }),
    'Couldn’t remove that member.',
  )
}

// ---------------------------------------------------------------------------
// Balances & settlements
// ---------------------------------------------------------------------------

export function getGroupBalances(groupId: Id): Promise<GroupBalances> {
  return cachedFetch(cacheKeys.groupBalances(requireUserId(), groupId), () =>
    call(api<GroupBalances>(`/api/v1/groups/${groupId}/balances`), 'Couldn’t load balances.'),
  )
}

export function getMyBalances(): Promise<MyGroupBalance[]> {
  return cachedFetch(cacheKeys.myBalances(requireUserId()), () =>
    call(
      api<{ balances: MyGroupBalance[] }>('/api/v1/me/balances'),
      'Couldn’t load balances.',
    ).then((data) => data.balances),
  )
}

export function recordSettlement(
  groupId: Id,
  input: { fromUserId: Id; toUserId: Id; amountMinor: number; note: string | null },
): Promise<GroupSettlement> {
  return call(
    api<GroupSettlement>(`/api/v1/groups/${groupId}/settlements`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
    'Couldn’t record the settlement.',
  )
}

export function listSettlements(groupId: Id): Promise<GroupSettlement[]> {
  return cachedFetch(cacheKeys.groupSettlements(requireUserId(), groupId), () =>
    fetchSettlements(groupId),
  )
}

async function fetchSettlements(groupId: Id): Promise<GroupSettlement[]> {
  const { data, error } = await getSupabase()
    .from('settlements')
    .select('*')
    .eq('group_id', groupId)
    .order('settled_at', { ascending: false })
  if (error) throwFriendly('load settlements', error)
  return data.map((row) => ({
    id: row.id,
    groupId: row.group_id,
    fromUserId: row.from_user_id,
    toUserId: row.to_user_id,
    amountMinor: row.amount_minor,
    currency: row.currency,
    note: row.note,
    settledAt: row.settled_at,
    createdAt: row.created_at,
  }))
}

export async function deleteSettlement(id: Id): Promise<void> {
  if (isOffline()) throw new Error(OFFLINE_MESSAGE)
  const { error } = await getSupabase().from('settlements').delete().eq('id', id)
  if (error) {
    if (isNetworkError(error)) throw new Error(OFFLINE_MESSAGE)
    throwFriendly('delete the settlement', error)
  }
}

// ---------------------------------------------------------------------------
// Group expenses
// ---------------------------------------------------------------------------

type ExpenseRow = Tables<'expenses'> & { expense_splits: Tables<'expense_splits'>[] }

export function listGroupExpenses(groupId: Id): Promise<GroupExpense[]> {
  return cachedFetch(cacheKeys.groupExpenses(requireUserId(), groupId), () =>
    fetchGroupExpenses(groupId),
  )
}

async function fetchGroupExpenses(groupId: Id): Promise<GroupExpense[]> {
  const { data, error } = await getSupabase()
    .from('expenses')
    .select('*, expense_splits(*)')
    .eq('group_id', groupId)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throwFriendly('load expenses', error)
  return (data as ExpenseRow[]).map((row) => ({
    id: row.id,
    userId: row.user_id,
    groupId: row.group_id,
    categoryId: row.category_id,
    description: row.description,
    amountMinor: row.amount_minor,
    currency: row.currency,
    date: row.date,
    kind: row.kind as ExpenseKind,
    notes: row.notes,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    splits: row.expense_splits.map((split) => ({
      id: split.id,
      expenseId: split.expense_id,
      userId: split.user_id,
      owedMinor: split.owed_minor,
      shareBasisPoints: split.share_basis_points,
      method: split.method as SplitMethod,
    })),
  }))
}

export function createGroupExpense(groupId: Id, input: GroupExpenseInput): Promise<GroupExpense> {
  return call(
    api<GroupExpense>(`/api/v1/groups/${groupId}/expenses`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
    'Couldn’t save the expense.',
  )
}

export function updateGroupExpense(expenseId: Id, input: GroupExpenseInput): Promise<GroupExpense> {
  return call(
    api<GroupExpense>(`/api/v1/expenses/${expenseId}`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
    'Couldn’t update the expense.',
  )
}

export async function deleteGroupExpense(id: Id): Promise<void> {
  if (isOffline()) throw new Error(OFFLINE_MESSAGE)
  const { error } = await getSupabase().from('expenses').delete().eq('id', id)
  if (error) {
    if (isNetworkError(error)) throw new Error(OFFLINE_MESSAGE)
    throwFriendly('delete the expense', error)
  }
}
