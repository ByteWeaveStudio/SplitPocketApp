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
import type { CurrencyCode, Id } from '@/types'

/**
 * Group features, temporarily disabled.
 *
 * Everything in here used to run through the Python API, which owned the split
 * math, balance computation, membership rules and invite tokens. That service
 * is gone; the Firestore replacement lands in the next pass.
 *
 * Until then this module keeps every signature it had, so its thirteen callers
 * — the stores, the reports page, the composer's group form and the seven
 * dialogs — compile and render untouched. Reads answer empty, so group screens
 * show the empty states they already have; writes reject with one message that
 * the existing error paths surface as a toast.
 */

export const GROUPS_DISABLED_NOTICE =
  'Group features are being rebuilt on Firebase — personal expenses work as normal.'

const DISABLED_MESSAGE = 'Group features are being rebuilt on Firebase — back shortly.'

function disabled(): never {
  throw new Error(DISABLED_MESSAGE)
}

/** True while group writes are stubbed; the app shell reads it for the banner. */
export const GROUPS_DISABLED = true

// ---------------------------------------------------------------------------
// Groups & members
// ---------------------------------------------------------------------------

export function listGroups(): Promise<GroupWithMembers[]> {
  return Promise.resolve([])
}

export function createGroup(_input: {
  name: string
  description: string | null
  currency: CurrencyCode
}): Promise<GroupWithMembers> {
  return disabled()
}

export function updateGroup(
  _groupId: Id,
  _input: { name?: string; description?: string | null; archived?: boolean },
): Promise<GroupWithMembers> {
  return disabled()
}

export function addMemberByEmail(
  _groupId: Id,
  _email: string,
): Promise<GroupWithMembers['members'][number]> {
  return disabled()
}

export function setMemberRole(
  _groupId: Id,
  _userId: Id,
  _role: 'owner' | 'member',
): Promise<GroupWithMembers['members'][number]> {
  return disabled()
}

export function removeMember(_groupId: Id, _userId: Id): Promise<void> {
  return disabled()
}

// ---------------------------------------------------------------------------
// Invite links
// ---------------------------------------------------------------------------

export function createInvite(
  _groupId: Id,
  _input: { expiresInHours: number; maxUses: number | null },
): Promise<GroupInvite> {
  return disabled()
}

export function listInvites(_groupId: Id): Promise<GroupInvite[]> {
  return Promise.resolve([])
}

export function revokeInvite(_groupId: Id, _inviteId: Id): Promise<void> {
  return disabled()
}

export function previewInvite(_token: string): Promise<InvitePreview> {
  return disabled()
}

export function acceptInvite(_token: string): Promise<GroupWithMembers> {
  return disabled()
}

/** The link a user actually shares. Pure, so it keeps working. */
export function inviteUrl(token: string): string {
  return `${window.location.origin}/join/${token}`
}

// ---------------------------------------------------------------------------
// Activity & comments
// ---------------------------------------------------------------------------

export function listActivity(_groupId: Id, _before?: string): Promise<ActivityPage> {
  return Promise.resolve({ entries: [], nextBefore: null })
}

export function listComments(_expenseId: Id): Promise<ExpenseComment[]> {
  return Promise.resolve([])
}

export function addComment(_expenseId: Id, _body: string): Promise<ExpenseComment> {
  return disabled()
}

export function deleteComment(_commentId: Id): Promise<void> {
  return disabled()
}

// ---------------------------------------------------------------------------
// Split presets
// ---------------------------------------------------------------------------

export function listPresets(_groupId: Id): Promise<SplitPreset[]> {
  return Promise.resolve([])
}

export function createPreset(
  _groupId: Id,
  _input: Pick<SplitPreset, 'name' | 'method' | 'participants'>,
): Promise<SplitPreset> {
  return disabled()
}

export function deletePreset(_presetId: Id): Promise<void> {
  return disabled()
}

// ---------------------------------------------------------------------------
// Balances & settlements
// ---------------------------------------------------------------------------

export function getGroupBalances(groupId: Id): Promise<GroupBalances> {
  // Unreachable in practice — listGroups answers empty, so no group detail
  // page ever resolves a real id. Shaped correctly rather than thrown so a
  // stray call renders an empty balance sheet instead of an error boundary.
  return Promise.resolve({
    groupId,
    currency: 'USD',
    members: [],
    suggestedSettlements: [],
  })
}

export function getMyBalances(): Promise<MyGroupBalance[]> {
  return Promise.resolve([])
}

export function recordSettlement(
  _groupId: Id,
  _input: { fromUserId: Id; toUserId: Id; amountMinor: number; note: string | null },
): Promise<GroupSettlement> {
  return disabled()
}

export function listSettlements(_groupId: Id): Promise<GroupSettlement[]> {
  return Promise.resolve([])
}

export function deleteSettlement(_id: Id): Promise<void> {
  return disabled()
}

// ---------------------------------------------------------------------------
// Group expenses
// ---------------------------------------------------------------------------

export function listGroupExpenses(_groupId: Id): Promise<GroupExpense[]> {
  return Promise.resolve([])
}

export function createGroupExpense(
  _groupId: Id,
  _input: GroupExpenseInput,
): Promise<GroupExpense> {
  return disabled()
}

export function updateGroupExpense(
  _expenseId: Id,
  _input: GroupExpenseInput,
): Promise<GroupExpense> {
  return disabled()
}

export function deleteGroupExpense(_id: Id): Promise<void> {
  return disabled()
}
