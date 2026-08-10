import type { PostgrestError } from '@supabase/supabase-js'

import type {
  ActivityPage,
  ExpenseComment,
  GroupBalances,
  GroupExpense,
  GroupExpenseInput,
  GroupInvite,
  GroupSettlement,
  GroupWithMembers,
  InvitePreview,
  MyGroupBalance,
  SplitPreset,
} from '@/features/groups/types'
import { api, ApiError } from '@/services/api'
import { cacheKeys, cachedFetch } from '@/services/offline/cache'
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

function post<T>(path: string, body: unknown, fallback: string): Promise<T> {
  return call(api<T>(path, { method: 'POST', body: JSON.stringify(body) }), fallback)
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
  // Archived groups are included: the Groups page can show them behind a
  // toggle, and hiding them here would make "unarchive" unreachable.
  const { data, error } = await getSupabase()
    .from('groups')
    .select('*, group_members(user_id, role, joined_at, profiles(email, full_name, avatar_url))')
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
  return post('/api/v1/groups', input, 'Couldn’t create the group.')
}

export function updateGroup(
  groupId: Id,
  input: { name?: string; description?: string | null; archived?: boolean },
): Promise<GroupWithMembers> {
  return call(
    api<GroupWithMembers>(`/api/v1/groups/${groupId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
    'Couldn’t update the group.',
  )
}

export function addMemberByEmail(groupId: Id, email: string) {
  return post<GroupWithMembers['members'][number]>(
    `/api/v1/groups/${groupId}/members`,
    { email },
    'Couldn’t add that person.',
  )
}

export function setMemberRole(groupId: Id, userId: Id, role: 'owner' | 'member') {
  return call(
    api<GroupWithMembers['members'][number]>(
      `/api/v1/groups/${groupId}/members/${userId}`,
      { method: 'PATCH', body: JSON.stringify({ role }) },
    ),
    'Couldn’t change that role.',
  )
}

export function removeMember(groupId: Id, userId: Id): Promise<void> {
  return call(
    api<void>(`/api/v1/groups/${groupId}/members/${userId}`, { method: 'DELETE' }),
    'Couldn’t remove that member.',
  )
}

// ---------------------------------------------------------------------------
// Invite links
// ---------------------------------------------------------------------------

export function createInvite(
  groupId: Id,
  input: { expiresInHours: number; maxUses: number | null },
): Promise<GroupInvite> {
  return post(`/api/v1/groups/${groupId}/invites`, input, 'Couldn’t create an invite link.')
}

export function listInvites(groupId: Id): Promise<GroupInvite[]> {
  return call(
    api<GroupInvite[]>(`/api/v1/groups/${groupId}/invites`),
    'Couldn’t load invite links.',
  )
}

export function revokeInvite(groupId: Id, inviteId: Id): Promise<void> {
  return call(
    api<void>(`/api/v1/groups/${groupId}/invites/${inviteId}`, { method: 'DELETE' }),
    'Couldn’t revoke that link.',
  )
}

// The token travels in the body, not the path: it is a bearer credential and
// a path lands in every access log between here and the server.
export function previewInvite(token: string): Promise<InvitePreview> {
  return post('/api/v1/invites/preview', { token }, 'This invite link is no longer valid.')
}

export function acceptInvite(token: string): Promise<GroupWithMembers> {
  return post('/api/v1/invites/accept', { token }, 'Couldn’t join that group.')
}

/** The link a user actually shares. */
export function inviteUrl(token: string): string {
  return `${window.location.origin}/join/${token}`
}

// ---------------------------------------------------------------------------
// Activity & comments
// ---------------------------------------------------------------------------

export function listActivity(groupId: Id, before?: string): Promise<ActivityPage> {
  const query = before ? `?before=${encodeURIComponent(before)}` : ''
  return call(
    api<ActivityPage>(`/api/v1/groups/${groupId}/activity${query}`),
    'Couldn’t load the activity feed.',
  )
}

export function listComments(expenseId: Id): Promise<ExpenseComment[]> {
  return call(
    api<ExpenseComment[]>(`/api/v1/expenses/${expenseId}/comments`),
    'Couldn’t load comments.',
  )
}

export function addComment(expenseId: Id, body: string): Promise<ExpenseComment> {
  return post(`/api/v1/expenses/${expenseId}/comments`, { body }, 'Couldn’t post that comment.')
}

export function deleteComment(commentId: Id): Promise<void> {
  return call(
    api<void>(`/api/v1/comments/${commentId}`, { method: 'DELETE' }),
    'Couldn’t delete that comment.',
  )
}

// ---------------------------------------------------------------------------
// Split presets
// ---------------------------------------------------------------------------

export function listPresets(groupId: Id): Promise<SplitPreset[]> {
  return call(api<SplitPreset[]>(`/api/v1/groups/${groupId}/presets`), 'Couldn’t load presets.')
}

export function createPreset(
  groupId: Id,
  input: Pick<SplitPreset, 'name' | 'method' | 'participants'>,
): Promise<SplitPreset> {
  return post(`/api/v1/groups/${groupId}/presets`, input, 'Couldn’t save that preset.')
}

export function deletePreset(presetId: Id): Promise<void> {
  return call(
    api<void>(`/api/v1/presets/${presetId}`, { method: 'DELETE' }),
    'Couldn’t delete that preset.',
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
  return post(
    `/api/v1/groups/${groupId}/settlements`,
    input,
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

/** Via the API since 20260807110000: deleting a settlement puts a debt back on
 * someone else's balance, and that has to appear in the group's history. */
export function deleteSettlement(id: Id): Promise<void> {
  return call(
    api<void>(`/api/v1/settlements/${id}`, { method: 'DELETE' }),
    'Couldn’t delete the settlement.',
  )
}

// ---------------------------------------------------------------------------
// Group expenses
// ---------------------------------------------------------------------------

type ExpenseRow = Tables<'expenses'> & {
  expense_splits: Tables<'expense_splits'>[]
  expense_items: (Tables<'expense_items'> & {
    expense_item_shares: { user_id: string }[]
  })[]
}

export function listGroupExpenses(groupId: Id): Promise<GroupExpense[]> {
  return cachedFetch(cacheKeys.groupExpenses(requireUserId(), groupId), () =>
    fetchGroupExpenses(groupId),
  )
}

async function fetchGroupExpenses(groupId: Id): Promise<GroupExpense[]> {
  const { data, error } = await getSupabase()
    .from('expenses')
    .select(
      '*, expense_splits(*), expense_items(*, expense_item_shares(user_id))',
    )
    .eq('group_id', groupId)
    .order('date', { ascending: false })
    .order('created_at', { ascending: false })
  if (error) throwFriendly('load expenses', error)
  return (data as unknown as ExpenseRow[]).map(toGroupExpense)
}

function toGroupExpense(row: ExpenseRow): GroupExpense {
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
    splits: row.expense_splits.map((split) => ({
      id: split.id,
      expenseId: split.expense_id,
      userId: split.user_id,
      owedMinor: split.owed_minor,
      shareBasisPoints: split.share_basis_points,
      shareUnits: split.share_units,
      method: split.method as SplitMethod,
    })),
    items: (row.expense_items ?? [])
      .map((item) => ({
        id: item.id,
        description: item.description,
        amountMinor: item.amount_minor,
        position: item.position,
        participantIds: (item.expense_item_shares ?? []).map((share) => share.user_id),
      }))
      .sort((a, b) => a.position - b.position),
  }
}

export function createGroupExpense(groupId: Id, input: GroupExpenseInput): Promise<GroupExpense> {
  return post(`/api/v1/groups/${groupId}/expenses`, input, 'Couldn’t save the expense.')
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

/** Via the API since 20260807110000, for the same reason as settlements.
 * `api()` already refuses offline, so there is no separate guard here. */
export function deleteGroupExpense(id: Id): Promise<void> {
  return call(
    api<void>(`/api/v1/expenses/${id}`, { method: 'DELETE' }),
    'Couldn’t delete the expense.',
  )
}
