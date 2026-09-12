import {
  Timestamp,
  collection,
  doc,
  getDocs,
  query,
  where,
  writeBatch,
} from 'firebase/firestore'
import type { DocumentData, DocumentSnapshot } from 'firebase/firestore'

import type {
  ActivityDetail,
  ActivityKind,
  ExpenseComment,
  GroupExpense,
  GroupInvite,
  GroupMemberProfile,
  GroupSettlement,
  GroupWithMembers,
  SplitPreset,
} from '@/features/groups/types'
import { getDb } from '@/services/firebase'
import { toIso, toIsoOrNull } from '@/services/firestore'
import { useAuthStore } from '@/stores/auth-store'
import type { CurrencyCode, ExpenseItem, Id, SplitMethod } from '@/types'
import type { SessionUser } from '@/stores/auth-store'

/** Both getDoc and a query result satisfy this, so the mappers below take
 * either without a cast. Callers check `exists()` first; `data()` is only
 * undefined for a snapshot that does not. */
type Snap = DocumentSnapshot<DocumentData>

/** Every collection whose documents carry a copy of a group's `memberIds`. */
export const MEMBER_SCOPED_COLLECTIONS = [
  'expenses',
  'settlements',
  'comments',
  'groupActivity',
  'splitPresets',
] as const

export function currentUser(): SessionUser {
  const user = useAuthStore.getState().user
  if (!user) throw new Error('You need to be signed in.')
  return user
}

export function requireUserId(): Id {
  return currentUser().id
}

export function newId(collectionName: string): Id {
  return doc(collection(getDb(), collectionName)).id
}

// ---------------------------------------------------------------------------
// Document -> domain
// ---------------------------------------------------------------------------

interface MemberEntry {
  role?: string
  joinedAt?: unknown
  email?: string
  fullName?: string | null
  avatarUrl?: string | null
}

export function toGroup(snapshot: Snap): GroupWithMembers {
  const data = snapshot.data() ?? {}
  const entries = (data.members ?? {}) as Record<string, MemberEntry>
  const members: GroupMemberProfile[] = ((data.memberIds ?? []) as Id[])
    .map((userId) => {
      const entry = entries[userId] ?? {}
      return {
        userId,
        role: entry.role === 'owner' ? ('owner' as const) : ('member' as const),
        joinedAt: toIso(entry.joinedAt),
        email: entry.email ?? '',
        fullName: entry.fullName ?? null,
        avatarUrl: entry.avatarUrl ?? null,
      }
    })
    .sort((a, b) => a.joinedAt.localeCompare(b.joinedAt))

  return {
    id: snapshot.id,
    name: data.name as string,
    description: (data.description as string | null) ?? null,
    currency: data.currency as CurrencyCode,
    createdBy: data.createdBy as Id,
    createdAt: toIso(data.createdAt),
    archivedAt: toIsoOrNull(data.archivedAt),
    members,
  }
}

interface SplitEntry {
  userId: Id
  owedMinor: number
  shareBasisPoints?: number | null
  shareUnits?: number | null
}

interface ItemEntry {
  description: string
  amountMinor: number
  position: number
  participantIds: Id[]
}

export function toGroupExpense(snapshot: Snap): GroupExpense {
  const data = snapshot.data() ?? {}
  const method = (data.splitMethod ?? 'equal') as SplitMethod
  const items = ((data.items ?? []) as ItemEntry[])
    .map<ExpenseItem>((item, index) => ({
      // Items are nested, so they have no ids of their own. The index is
      // stable for a given saved bill, which is all the edit screen keys on.
      id: `${snapshot.id}__item_${index}`,
      description: item.description,
      amountMinor: item.amountMinor,
      position: item.position ?? index,
      participantIds: item.participantIds ?? [],
    }))
    .sort((a, b) => a.position - b.position)

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
    kind: 'expense',
    notes: (data.notes as string | null) ?? null,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
    splits: ((data.splits ?? []) as SplitEntry[]).map((split) => ({
      id: `${snapshot.id}__${split.userId}`,
      expenseId: snapshot.id,
      userId: split.userId,
      owedMinor: split.owedMinor,
      shareBasisPoints: split.shareBasisPoints ?? null,
      shareUnits: split.shareUnits ?? null,
      method,
    })),
    items,
  }
}

export function toSettlement(snapshot: Snap): GroupSettlement {
  const data = snapshot.data() ?? {}
  return {
    id: snapshot.id,
    groupId: data.groupId as Id,
    fromUserId: data.fromUserId as Id,
    toUserId: data.toUserId as Id,
    amountMinor: data.amountMinor as number,
    currency: data.currency as CurrencyCode,
    note: (data.note as string | null) ?? null,
    settledAt: toIso(data.settledAt),
    createdAt: toIso(data.createdAt),
  }
}

export function toInvite(snapshot: Snap): GroupInvite {
  const data = snapshot.data() ?? {}
  return {
    id: snapshot.id,
    groupId: data.groupId as Id,
    // The document id is the token, so unlike the Postgres version (which
    // stored only a hash) an existing link can be read back and re-shared.
    token: snapshot.id,
    expiresAt: toIso(data.expiresAt),
    maxUses: (data.maxUses as number | null) ?? null,
    uses: (data.uses as number) ?? 0,
    revokedAt: toIsoOrNull(data.revokedAt),
    createdBy: data.createdBy as Id,
    createdAt: toIso(data.createdAt),
  }
}

export function toComment(snapshot: Snap): ExpenseComment {
  const data = snapshot.data() ?? {}
  return {
    id: snapshot.id,
    expenseId: data.expenseId as Id,
    userId: data.userId as Id,
    body: data.body as string,
    createdAt: toIso(data.createdAt),
    updatedAt: toIso(data.updatedAt),
  }
}

export function toPreset(snapshot: Snap): SplitPreset {
  const data = snapshot.data() ?? {}
  return {
    id: snapshot.id,
    groupId: data.groupId as Id,
    name: data.name as string,
    method: data.method as SplitPreset['method'],
    participants: (data.participants ?? []) as SplitPreset['participants'],
    createdBy: data.createdBy as Id,
    createdAt: toIso(data.createdAt),
  }
}

// ---------------------------------------------------------------------------
// Member helpers
// ---------------------------------------------------------------------------

export function memberRole(group: GroupWithMembers, userId: Id): 'owner' | 'member' | null {
  return group.members.find((m) => m.userId === userId)?.role ?? null
}

export function requireOwner(group: GroupWithMembers, userId: Id, action: string): void {
  if (memberRole(group, userId) !== 'owner') {
    throw new Error(`Only owners can ${action}.`)
  }
}

export function assertActive(group: GroupWithMembers): void {
  if (group.archivedAt !== null) throw new Error('This group is archived.')
}

/**
 * A name to freeze into an activity row.
 *
 * The feed has to stay readable after the person leaves the group, so the label
 * is copied at write time rather than joined at read time.
 */
export function displayName(group: GroupWithMembers, userId: Id | null): string {
  if (userId === null) return 'Someone'
  const member = group.members.find((m) => m.userId === userId)
  if (!member) return 'A former member'
  return member.fullName?.trim() || member.email
}

export function memberEntry(user: SessionUser, role: 'owner' | 'member', viaInvite?: string) {
  return {
    role,
    joinedAt: Timestamp.now(),
    email: user.email,
    fullName: user.fullName,
    avatarUrl: user.avatarUrl,
    ...(viaInvite ? { viaInvite } : {}),
  }
}

// ---------------------------------------------------------------------------
// Activity
// ---------------------------------------------------------------------------

/**
 * Append one entry to a group's history.
 *
 * Always added to the same batch as the change it describes, so a feed entry
 * cannot survive a write that failed — the closest thing available to the
 * single transaction the server used to run this in.
 */
export function activityDoc(
  groupId: Id,
  memberIds: Id[],
  actorId: Id,
  kind: ActivityKind,
  detail: ActivityDetail = {},
) {
  return {
    ref: doc(collection(getDb(), 'groupActivity')),
    data: {
      groupId,
      memberIds,
      actorId,
      kind,
      detail,
      createdAt: Timestamp.now(),
    },
  }
}

export function expenseDetail(
  expense: Pick<GroupExpense, 'id' | 'description' | 'amountMinor' | 'currency' | 'paidBy'>,
  group: GroupWithMembers,
): ActivityDetail {
  return {
    expenseId: expense.id,
    description: expense.description,
    amountMinor: expense.amountMinor,
    currency: expense.currency,
    paidByName: displayName(group, expense.paidBy),
  }
}

// ---------------------------------------------------------------------------
// Membership fan-out
// ---------------------------------------------------------------------------

/** Firestore's hard cap on writes in one batch. */
const BATCH_LIMIT = 500

/**
 * Rewrite `memberIds` on every document belonging to a group.
 *
 * This is the cost of denormalizing membership so the rules can authorize
 * without a lookup: a join or a removal has to touch every expense, settlement,
 * comment, activity row and preset in the group.
 *
 * There is no cross-batch transaction available to a client, so a large group
 * can end up partially rewritten if the tab closes mid-run. The group document
 * is updated first by every caller, which is what actually gates discovery —
 * a removed member can no longer list the group, so they cannot reach the
 * stragglers by query. Re-running is safe: each write is an assignment, not a
 * delta.
 */
export async function fanOutMemberIds(groupId: Id, memberIds: Id[]): Promise<void> {
  const db = getDb()
  const actorId = requireUserId()
  for (const collectionName of MEMBER_SCOPED_COLLECTIONS) {
    // The array-contains clause is what makes the query legal, not just
    // narrow: rules are proved against a query's constraints, so one that
    // filters on groupId alone is refused. The caller is still a member at
    // this point, which is what makes it satisfiable.
    const snapshot = await getDocs(
      query(
        collection(db, collectionName),
        where('memberIds', 'array-contains', actorId),
        where('groupId', '==', groupId),
      ),
    )
    for (let index = 0; index < snapshot.docs.length; index += BATCH_LIMIT) {
      const batch = writeBatch(db)
      for (const document of snapshot.docs.slice(index, index + BATCH_LIMIT)) {
        batch.update(document.ref, { memberIds })
      }
      await batch.commit()
    }
  }
}

/** Delete a group and everything hanging off it. Postgres did this with ON
 * DELETE CASCADE; Firestore has no such thing, so it is spelled out. */
export async function deleteGroupCascade(groupId: Id): Promise<void> {
  const db = getDb()
  const actorId = requireUserId()
  for (const collectionName of [...MEMBER_SCOPED_COLLECTIONS, 'groupInvites']) {
    // Invites carry no memberIds — they are readable by any signed-in holder
    // of the token, so their read rule needs nothing proved about the query.
    const scoped = collectionName !== 'groupInvites'
    const snapshot = await getDocs(
      query(
        collection(db, collectionName),
        ...(scoped ? [where('memberIds', 'array-contains', actorId)] : []),
        where('groupId', '==', groupId),
      ),
    )
    for (let index = 0; index < snapshot.docs.length; index += BATCH_LIMIT) {
      const batch = writeBatch(db)
      for (const document of snapshot.docs.slice(index, index + BATCH_LIMIT)) {
        batch.delete(document.ref)
      }
      await batch.commit()
    }
  }
  const batch = writeBatch(db)
  batch.delete(doc(db, 'groups', groupId))
  await batch.commit()
}
