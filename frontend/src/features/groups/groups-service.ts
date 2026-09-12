import {
  Timestamp,
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocs,
  increment,
  limit as fsLimit,
  orderBy,
  query,
  startAfter,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore'

import { netFromLedger, simplifyDebts } from '@/features/groups/balances'
import {
  activityDoc,
  assertActive,
  currentUser,
  deleteGroupCascade,
  displayName,
  expenseDetail,
  fanOutMemberIds,
  memberEntry,
  memberRole,
  newId,
  requireOwner,
  requireUserId,
  toComment,
  toGroup,
  toGroupExpense,
  toInvite,
  toPreset,
  toSettlement,
} from '@/features/groups/group-docs'
import {
  SplitError,
  computeItemizedSplits,
  computeSplits,
  toSplitRows,
} from '@/features/groups/split-compute'
import type {
  ActivityDetail,
  ActivityEntry,
  ActivityKind,
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
import { getDb } from '@/services/firebase'
import { friendlyFirestoreMessage, toIso } from '@/services/firestore'
import type { CurrencyCode, Id } from '@/types'

/**
 * Groups, members, invites, activity, presets, balances and settlements —
 * all on Firestore, all from the browser.
 *
 * This replaces the FastAPI service that used to own every one of these
 * writes. Three things it did are gone and cannot come back client-side:
 * transactions spanning many documents, a database that recomputed splits
 * from the request, and an email -> account lookup. What replaces them:
 * batched writes that at least fail together, `split-compute.ts` running the
 * same arithmetic here, and invite links instead of add-by-email.
 *
 * Reads need no cache layer — Firestore's persistent cache serves them
 * offline, including writes that have not reached the server yet.
 */

function fail(error: unknown, fallback: string): never {
  if (error instanceof SplitError) throw new Error(error.message)
  if (error instanceof Error && error.name === 'Error') throw error
  throw new Error(friendlyFirestoreMessage(error, fallback))
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

export async function listGroups(): Promise<GroupWithMembers[]> {
  const userId = requireUserId()
  try {
    const snapshot = await getDocs(
      query(
        collection(getDb(), 'groups'),
        where('memberIds', 'array-contains', userId),
        orderBy('createdAt', 'desc'),
      ),
    )
    return snapshot.docs.map(toGroup)
  } catch (error) {
    return fail(error, 'Couldn’t load your groups.')
  }
}

/** Reads one group, which doubles as a membership probe: the rules deny a
 * non-member, so a rejection means "not in this group" rather than "gone". */
async function fetchGroup(groupId: Id): Promise<GroupWithMembers> {
  const snapshot = await getDoc(doc(getDb(), 'groups', groupId))
  if (!snapshot.exists()) throw new Error('Group not found.')
  return toGroup(snapshot)
}

export async function createGroup(input: {
  name: string
  description: string | null
  currency: CurrencyCode
}): Promise<GroupWithMembers> {
  const user = currentUser()
  const name = input.name.trim()
  if (!name) throw new Error('A group needs a name.')

  const db = getDb()
  const groupId = newId('groups')
  const now = Timestamp.now()
  const entry = memberEntry(user, 'owner')

  try {
    const batch = writeBatch(db)
    batch.set(doc(db, 'groups', groupId), {
      name,
      description: input.description,
      currency: input.currency,
      createdBy: user.id,
      createdAt: now,
      archivedAt: null,
      lastActivityAt: now,
      memberIds: [user.id],
      members: { [user.id]: entry },
    })
    const activity = activityDoc(groupId, [user.id], user.id, 'group.created', {
      groupName: name,
    })
    batch.set(activity.ref, activity.data)
    await batch.commit()
  } catch (error) {
    return fail(error, 'Couldn’t create the group.')
  }

  return {
    id: groupId,
    name,
    description: input.description,
    currency: input.currency,
    createdBy: user.id,
    createdAt: toIso(now),
    archivedAt: null,
    members: [
      {
        userId: user.id,
        role: 'owner',
        joinedAt: toIso(now),
        email: user.email,
        fullName: user.fullName,
        avatarUrl: user.avatarUrl,
      },
    ],
  }
}

export async function updateGroup(
  groupId: Id,
  input: { name?: string; description?: string | null; archived?: boolean },
): Promise<GroupWithMembers> {
  const user = currentUser()
  try {
    const before = await fetchGroup(groupId)
    requireOwner(before, user.id, 'change a group’s details')

    const patch: Record<string, unknown> = { lastActivityAt: Timestamp.now() }
    const entries: Array<{ kind: ActivityKind; detail: ActivityDetail }> = []

    if (input.name !== undefined) {
      const name = input.name.trim()
      if (!name) throw new Error('A group needs a name.')
      patch.name = name
      if (name !== before.name) {
        entries.push({ kind: 'group.renamed', detail: { from: before.name, to: name } })
      }
    }
    if (input.description !== undefined) patch.description = input.description

    if (input.archived !== undefined) {
      // Boolean in, timestamp out: the field records when, the caller says
      // whether, so no client has to invent a timestamp.
      const archivedAt = input.archived ? Timestamp.now() : null
      patch.archivedAt = archivedAt
      if (input.archived !== (before.archivedAt !== null)) {
        entries.push({
          kind: input.archived ? 'group.archived' : 'group.unarchived',
          detail: { groupName: (patch.name as string) ?? before.name },
        })
      }
    }

    const db = getDb()
    const batch = writeBatch(db)
    batch.update(doc(db, 'groups', groupId), patch)
    const memberIds = before.members.map((m) => m.userId)
    for (const { kind, detail } of entries) {
      const activity = activityDoc(groupId, memberIds, user.id, kind, detail)
      batch.set(activity.ref, activity.data)
    }
    await batch.commit()

    return fetchGroup(groupId)
  } catch (error) {
    return fail(error, 'Couldn’t update the group.')
  }
}

// ---------------------------------------------------------------------------
// Members
// ---------------------------------------------------------------------------

export async function setMemberRole(
  groupId: Id,
  userId: Id,
  role: 'owner' | 'member',
): Promise<GroupWithMembers['members'][number]> {
  const user = currentUser()
  try {
    const group = await fetchGroup(groupId)
    requireOwner(group, user.id, 'change roles')

    const current = memberRole(group, userId)
    if (current === null) throw new Error('They’re not in this group.')

    const existing = group.members.find((m) => m.userId === userId)
    if (current === role && existing) return existing

    // Self-demotion is how a group loses its last owner by accident. Stepping
    // down is fine once someone else can let people in.
    const hasAnotherOwner = group.members.some(
      (m) => m.role === 'owner' && m.userId !== user.id,
    )
    if (role === 'member' && userId === user.id && !hasAnotherOwner) {
      throw new Error('You’re the only owner — make someone else an owner first.')
    }

    const db = getDb()
    const batch = writeBatch(db)
    batch.update(doc(db, 'groups', groupId), {
      [`members.${userId}.role`]: role,
      lastActivityAt: Timestamp.now(),
    })
    const activity = activityDoc(
      groupId,
      group.members.map((m) => m.userId),
      user.id,
      'member.role_changed',
      { memberName: displayName(group, userId), role },
    )
    batch.set(activity.ref, activity.data)
    await batch.commit()

    return { ...(existing as GroupWithMembers['members'][number]), role }
  } catch (error) {
    return fail(error, 'Couldn’t change that role.')
  }
}

export async function removeMember(groupId: Id, userId: Id): Promise<void> {
  const user = currentUser()
  try {
    const group = await fetchGroup(groupId)
    const myRole = memberRole(group, user.id)
    const targetRole = memberRole(group, userId)
    if (targetRole === null) throw new Error('They’re not in this group.')

    const leavingSelf = userId === user.id
    if (leavingSelf) {
      const otherOwners = group.members.some(
        (m) => m.role === 'owner' && m.userId !== user.id,
      )
      if (myRole === 'owner' && group.members.length > 1 && !otherOwners) {
        throw new Error(
          'You’re the only owner — make someone else an owner before leaving.',
        )
      }
    } else {
      if (myRole !== 'owner') throw new Error('Only owners can remove members.')
      if (targetRole === 'owner') throw new Error('Owners can’t remove other owners.')
    }

    // Last member out — an empty group is just clutter.
    if (leavingSelf && group.members.length === 1) {
      await deleteGroupCascade(groupId)
      return
    }

    const remaining = group.members.map((m) => m.userId).filter((id) => id !== userId)
    const db = getDb()
    const batch = writeBatch(db)
    // The group document goes first: it is what gates discovery, so even if
    // the fan-out below is interrupted the removed member cannot find the
    // group to query the documents that still name them.
    batch.update(doc(db, 'groups', groupId), {
      memberIds: arrayRemove(userId),
      [`members.${userId}`]: deleteField(),
      lastActivityAt: Timestamp.now(),
    })
    const activity = activityDoc(groupId, remaining, user.id, 'member.removed', {
      memberName: displayName(group, userId),
      left: leavingSelf,
    })
    batch.set(activity.ref, activity.data)
    await batch.commit()

    await fanOutMemberIds(groupId, remaining)
  } catch (error) {
    fail(error, 'Couldn’t remove that member.')
  }
}

// ---------------------------------------------------------------------------
// Invite links
// ---------------------------------------------------------------------------

/**
 * 32 bytes of CSPRNG, URL-safe.
 *
 * This value is the document id, which makes it the whole credential: the
 * server used to store only a SHA-256 hash and compare, but a client has to
 * read the invite document to accept it, so there is nothing to compare
 * against. Unguessability is doing all the work.
 */
function mintToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '')
}

export async function createInvite(
  groupId: Id,
  input: { expiresInHours: number; maxUses: number | null },
): Promise<GroupInvite> {
  const user = currentUser()
  try {
    const group = await fetchGroup(groupId)
    assertActive(group)
    requireOwner(group, user.id, 'create invite links')

    const token = mintToken()
    const now = Timestamp.now()
    const expiresAt = Timestamp.fromMillis(now.toMillis() + input.expiresInHours * 3_600_000)

    await writeBatch(getDb())
      .set(doc(getDb(), 'groupInvites', token), {
        groupId,
        // Denormalized so the preview screen can describe the group to
        // someone who is not yet allowed to read it.
        groupName: group.name,
        currency: group.currency,
        memberCount: group.members.length,
        expiresAt,
        maxUses: input.maxUses,
        uses: 0,
        revokedAt: null,
        createdBy: user.id,
        createdAt: now,
      })
      .commit()

    return {
      id: token,
      groupId,
      token,
      expiresAt: toIso(expiresAt),
      maxUses: input.maxUses,
      uses: 0,
      revokedAt: null,
      createdBy: user.id,
      createdAt: toIso(now),
    }
  } catch (error) {
    return fail(error, 'Couldn’t create an invite link.')
  }
}

export async function listInvites(groupId: Id): Promise<GroupInvite[]> {
  try {
    // Filtered and sorted in memory rather than in the query: a group holds a
    // handful of these, and the alternative is a composite index earning its
    // keep on nothing.
    const snapshot = await getDocs(
      query(collection(getDb(), 'groupInvites'), where('groupId', '==', groupId)),
    )
    const now = Date.now()
    return snapshot.docs
      .map(toInvite)
      .filter((i) => i.revokedAt === null && Date.parse(i.expiresAt) > now)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  } catch (error) {
    return fail(error, 'Couldn’t load invite links.')
  }
}

export async function revokeInvite(groupId: Id, inviteId: Id): Promise<void> {
  const user = currentUser()
  try {
    const group = await fetchGroup(groupId)
    requireOwner(group, user.id, 'revoke invite links')
    await updateDoc(doc(getDb(), 'groupInvites', inviteId), { revokedAt: Timestamp.now() })
  } catch (error) {
    fail(error, 'Couldn’t revoke that link.')
  }
}

const INVALID_INVITE = 'This invite link is no longer valid.'

/** One message for expired, revoked, spent and never-existed: telling them
 * apart turns this into an oracle for which tokens are real. */
async function usableInvite(token: string) {
  const snapshot = await getDoc(doc(getDb(), 'groupInvites', token))
  if (!snapshot.exists()) throw new Error(INVALID_INVITE)
  const invite = toInvite(snapshot)
  if (invite.revokedAt !== null) throw new Error(INVALID_INVITE)
  if (Date.parse(invite.expiresAt) <= Date.now()) throw new Error(INVALID_INVITE)
  if (invite.maxUses !== null && invite.uses >= invite.maxUses) throw new Error(INVALID_INVITE)
  return { invite, data: snapshot.data() }
}

export async function previewInvite(token: string): Promise<InvitePreview> {
  requireUserId()
  try {
    const { invite, data } = await usableInvite(token)
    // Reading the group is the membership test — the rules let a member
    // through and deny everyone else, so a failure here means "not a member",
    // which is exactly the question being asked.
    const alreadyMember = await getDoc(doc(getDb(), 'groups', invite.groupId))
      .then((snapshot) => snapshot.exists())
      .catch(() => false)

    return {
      groupId: invite.groupId,
      groupName: (data.groupName as string) ?? 'a group',
      currency: (data.currency as CurrencyCode) ?? 'USD',
      memberCount: (data.memberCount as number) ?? 0,
      alreadyMember,
    }
  } catch (error) {
    return fail(error, INVALID_INVITE)
  }
}

export async function acceptInvite(token: string): Promise<GroupWithMembers> {
  const user = currentUser()
  try {
    const { invite } = await usableInvite(token)
    const groupId = invite.groupId

    const already = await getDoc(doc(getDb(), 'groups', groupId))
      .then((snapshot) => snapshot.exists())
      .catch(() => false)
    if (already) return fetchGroup(groupId)

    const db = getDb()
    await updateDoc(doc(db, 'groups', groupId), {
      memberIds: arrayUnion(user.id),
      // `viaInvite` is what the security rules resolve to authorise a
      // non-member writing themselves into the group. It is provenance, not
      // decoration — see joiningViaInvite() in firestore.rules.
      [`members.${user.id}`]: memberEntry(user, 'member', token),
      lastActivityAt: Timestamp.now(),
    })

    const group = await fetchGroup(groupId)
    const memberIds = group.members.map((m) => m.userId)

    const batch = writeBatch(db)
    // Advisory only: rules cannot atomically increment-and-check, so two
    // people spending the last use at once both get in.
    batch.update(doc(db, 'groupInvites', token), { uses: increment(1) })
    const activity = activityDoc(groupId, memberIds, user.id, 'member.joined', {
      memberName: displayName(group, user.id),
    })
    batch.set(activity.ref, activity.data)
    await batch.commit()

    await fanOutMemberIds(groupId, memberIds)
    return group
  } catch (error) {
    return fail(error, 'Couldn’t join that group.')
  }
}

/** The link a user actually shares. */
export function inviteUrl(token: string): string {
  return `${window.location.origin}/join/${token}`
}

// ---------------------------------------------------------------------------
// Activity & comments
// ---------------------------------------------------------------------------

const ACTIVITY_PAGE_SIZE = 30

export async function listActivity(groupId: Id, before?: string): Promise<ActivityPage> {
  try {
    const clauses = [
      where('memberIds', 'array-contains', requireUserId()),
      where('groupId', '==', groupId),
      orderBy('createdAt', 'desc'),
      ...(before ? [startAfter(Timestamp.fromMillis(Date.parse(before)))] : []),
      fsLimit(ACTIVITY_PAGE_SIZE),
    ]
    const snapshot = await getDocs(query(collection(getDb(), 'groupActivity'), ...clauses))
    const entries = snapshot.docs.map<ActivityEntry>((d) => {
      const data = d.data()
      return {
        id: d.id,
        groupId: data.groupId as Id,
        actorId: (data.actorId as Id | null) ?? null,
        kind: data.kind as ActivityKind,
        detail: (data.detail ?? {}) as ActivityDetail,
        createdAt: toIso(data.createdAt),
      }
    })
    // Only a full page can have more behind it, same keyset rule the API used.
    const nextBefore =
      entries.length === ACTIVITY_PAGE_SIZE
        ? (entries[entries.length - 1]?.createdAt ?? null)
        : null
    return { entries, nextBefore }
  } catch (error) {
    return fail(error, 'Couldn’t load the activity feed.')
  }
}

export async function listComments(expenseId: Id): Promise<ExpenseComment[]> {
  try {
    const snapshot = await getDocs(
      query(
        collection(getDb(), 'comments'),
        where('memberIds', 'array-contains', requireUserId()),
        where('expenseId', '==', expenseId),
        orderBy('createdAt', 'asc'),
      ),
    )
    return snapshot.docs.map(toComment)
  } catch (error) {
    return fail(error, 'Couldn’t load comments.')
  }
}

export async function addComment(expenseId: Id, body: string): Promise<ExpenseComment> {
  const user = currentUser()
  const text = body.trim()
  if (!text) throw new Error('Write something first.')
  try {
    const expense = await getDoc(doc(getDb(), 'expenses', expenseId))
    if (!expense.exists()) throw new Error('Expense not found.')
    const data = expense.data()
    const groupId = data.groupId as Id | null
    if (!groupId) throw new Error('Only shared expenses can be commented on.')
    const memberIds = (data.memberIds ?? []) as Id[]

    const db = getDb()
    const commentId = newId('comments')
    const now = Timestamp.now()
    const batch = writeBatch(db)
    batch.set(doc(db, 'comments', commentId), {
      expenseId,
      groupId,
      memberIds,
      userId: user.id,
      body: text,
      createdAt: now,
      updatedAt: now,
    })
    const activity = activityDoc(groupId, memberIds, user.id, 'comment.added', {
      expenseId,
      description: data.description as string,
      authorName: user.fullName?.trim() || user.email,
    })
    batch.set(activity.ref, activity.data)
    batch.update(doc(db, 'groups', groupId), { lastActivityAt: now })
    await batch.commit()

    return {
      id: commentId,
      expenseId,
      userId: user.id,
      body: text,
      createdAt: toIso(now),
      updatedAt: toIso(now),
    }
  } catch (error) {
    return fail(error, 'Couldn’t post that comment.')
  }
}

export async function deleteComment(commentId: Id): Promise<void> {
  requireUserId()
  try {
    await deleteDoc(doc(getDb(), 'comments', commentId))
  } catch (error) {
    fail(error, 'Couldn’t delete that comment.')
  }
}

// ---------------------------------------------------------------------------
// Split presets
// ---------------------------------------------------------------------------

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export async function listPresets(groupId: Id): Promise<SplitPreset[]> {
  try {
    const snapshot = await getDocs(
      query(
        collection(getDb(), 'splitPresets'),
        where('memberIds', 'array-contains', requireUserId()),
        where('groupId', '==', groupId),
        orderBy('name', 'asc'),
      ),
    )
    return snapshot.docs.map(toPreset)
  } catch (error) {
    return fail(error, 'Couldn’t load presets.')
  }
}

export async function createPreset(
  groupId: Id,
  input: Pick<SplitPreset, 'name' | 'method' | 'participants'>,
): Promise<SplitPreset> {
  const user = currentUser()
  const name = input.name.trim()
  const slug = slugify(name)
  if (!slug) throw new Error('Give the preset a name.')
  try {
    const group = await fetchGroup(groupId)
    const memberIds = group.members.map((m) => m.userId)
    if (!input.participants.every((p) => memberIds.includes(p.userId))) {
      throw new Error('Everyone in the preset must be a member of the group.')
    }

    // `{groupId}__{slug}` as the id makes the old unique index on
    // (group_id, lower(name)) structural instead of checked.
    const presetId = `${groupId}__${slug}`
    const existing = await getDoc(doc(getDb(), 'splitPresets', presetId))
    if (existing.exists()) {
      throw new Error('This group already has a preset with that name.')
    }

    const now = Timestamp.now()
    await writeBatch(getDb())
      .set(doc(getDb(), 'splitPresets', presetId), {
        groupId,
        memberIds,
        name,
        slug,
        method: input.method,
        participants: input.participants,
        createdBy: user.id,
        createdAt: now,
      })
      .commit()

    return {
      id: presetId,
      groupId,
      name,
      method: input.method,
      participants: input.participants,
      createdBy: user.id,
      createdAt: toIso(now),
    }
  } catch (error) {
    return fail(error, 'Couldn’t save that preset.')
  }
}

export async function deletePreset(presetId: Id): Promise<void> {
  requireUserId()
  try {
    await deleteDoc(doc(getDb(), 'splitPresets', presetId))
  } catch (error) {
    fail(error, 'Couldn’t delete that preset.')
  }
}

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

export async function getGroupBalances(groupId: Id): Promise<GroupBalances> {
  try {
    const [group, expenses, settlements] = await Promise.all([
      fetchGroup(groupId),
      listGroupExpenses(groupId),
      listSettlements(groupId),
    ])
    const memberIds = group.members.map((m) => m.userId)
    const net = netFromLedger(memberIds, expenses, settlements)
    return {
      groupId,
      currency: group.currency,
      members: memberIds.map((userId) => ({ userId, netMinor: net.get(userId) ?? 0 })),
      suggestedSettlements: simplifyDebts(net),
    }
  } catch (error) {
    return fail(error, 'Couldn’t load balances.')
  }
}

/**
 * My net in every group I'm in.
 *
 * The server did this as one CTE with five aggregates. Firestore has no
 * GROUP BY, so it is three queries — groups, then every expense and settlement
 * I can see — bucketed by group in memory. `memberIds array-contains me` is
 * exactly "the ledgers I'm party to", so the totals are complete, not just my
 * own rows.
 */
export async function getMyBalances(): Promise<MyGroupBalance[]> {
  const userId = requireUserId()
  try {
    const db = getDb()
    const [groups, expenseSnapshot, settlementSnapshot] = await Promise.all([
      listGroups(),
      getDocs(
        query(collection(db, 'expenses'), where('memberIds', 'array-contains', userId)),
      ),
      getDocs(
        query(collection(db, 'settlements'), where('memberIds', 'array-contains', userId)),
      ),
    ])

    const expenses = expenseSnapshot.docs
      .map(toGroupExpense)
      .filter((e) => e.groupId !== null)
    const settlements = settlementSnapshot.docs.map(toSettlement)

    return groups
      .map<MyGroupBalance>((group) => {
        const memberIds = group.members.map((m) => m.userId)
        const net = netFromLedger(
          memberIds,
          expenses.filter((e) => e.groupId === group.id),
          settlements.filter((s) => s.groupId === group.id),
        )
        return {
          groupId: group.id,
          groupName: group.name,
          currency: group.currency,
          netMinor: net.get(userId) ?? 0,
          memberCount: memberIds.length,
          lastActivityAt: lastActivityOf(group.id, expenses, settlements),
          archived: group.archivedAt !== null,
        }
      })
      .sort((a, b) => a.groupName.localeCompare(b.groupName))
  } catch (error) {
    return fail(error, 'Couldn’t load balances.')
  }
}

/** Postgres took max(group_activity.created_at); without an aggregate, the
 * newest ledger write in hand is the same signal without an extra query. */
function lastActivityOf(
  groupId: Id,
  expenses: GroupExpense[],
  settlements: GroupSettlement[],
): string | null {
  const stamps = [
    ...expenses.filter((e) => e.groupId === groupId).map((e) => e.createdAt),
    ...settlements.filter((s) => s.groupId === groupId).map((s) => s.createdAt),
  ]
  return stamps.length === 0 ? null : stamps.reduce((a, b) => (a > b ? a : b))
}

// ---------------------------------------------------------------------------
// Settlements
// ---------------------------------------------------------------------------

export async function recordSettlement(
  groupId: Id,
  input: { fromUserId: Id; toUserId: Id; amountMinor: number; note: string | null },
): Promise<GroupSettlement> {
  const user = currentUser()
  if (input.fromUserId === input.toUserId) {
    throw new Error('Payer and receiver must differ.')
  }
  if (user.id !== input.fromUserId && user.id !== input.toUserId) {
    throw new Error('You can only record settlements you’re part of.')
  }
  try {
    const group = await fetchGroup(groupId)
    const memberIds = group.members.map((m) => m.userId)
    if (!memberIds.includes(input.fromUserId) || !memberIds.includes(input.toUserId)) {
      throw new Error('Both people must be members of the group.')
    }

    const db = getDb()
    const settlementId = newId('settlements')
    const now = Timestamp.now()
    const batch = writeBatch(db)
    batch.set(doc(db, 'settlements', settlementId), {
      groupId,
      memberIds,
      fromUserId: input.fromUserId,
      toUserId: input.toUserId,
      amountMinor: input.amountMinor,
      currency: group.currency,
      note: input.note,
      settledAt: now,
      createdAt: now,
    })
    const activity = activityDoc(groupId, memberIds, user.id, 'settlement.recorded', {
      fromName: displayName(group, input.fromUserId),
      toName: displayName(group, input.toUserId),
      amountMinor: input.amountMinor,
      currency: group.currency,
    })
    batch.set(activity.ref, activity.data)
    batch.update(doc(db, 'groups', groupId), { lastActivityAt: now })
    await batch.commit()

    return {
      id: settlementId,
      groupId,
      fromUserId: input.fromUserId,
      toUserId: input.toUserId,
      amountMinor: input.amountMinor,
      currency: group.currency,
      note: input.note,
      settledAt: toIso(now),
      createdAt: toIso(now),
    }
  } catch (error) {
    return fail(error, 'Couldn’t record the settlement.')
  }
}

export async function listSettlements(groupId: Id): Promise<GroupSettlement[]> {
  try {
    const snapshot = await getDocs(
      query(
        collection(getDb(), 'settlements'),
        where('memberIds', 'array-contains', requireUserId()),
        where('groupId', '==', groupId),
        orderBy('settledAt', 'desc'),
      ),
    )
    return snapshot.docs.map(toSettlement)
  } catch (error) {
    return fail(error, 'Couldn’t load settlements.')
  }
}

/** Deleting a settlement puts a debt back on someone else's balance, and doing
 * that silently is how a group ends up arguing about the app instead of the
 * money — hence the activity entry. */
export async function deleteSettlement(id: Id): Promise<void> {
  const user = currentUser()
  try {
    const snapshot = await getDoc(doc(getDb(), 'settlements', id))
    if (!snapshot.exists()) throw new Error('Settlement not found.')
    const settlement = toSettlement(snapshot)
    const group = await fetchGroup(settlement.groupId)

    const involved =
      user.id === settlement.fromUserId || user.id === settlement.toUserId
    if (!involved && memberRole(group, user.id) !== 'owner') {
      throw new Error('Only the people in a settlement, or a group owner, can delete it.')
    }

    const db = getDb()
    const batch = writeBatch(db)
    batch.delete(doc(db, 'settlements', id))
    const activity = activityDoc(
      settlement.groupId,
      group.members.map((m) => m.userId),
      user.id,
      'settlement.deleted',
      {
        fromName: displayName(group, settlement.fromUserId),
        toName: displayName(group, settlement.toUserId),
        amountMinor: settlement.amountMinor,
        currency: settlement.currency,
      },
    )
    batch.set(activity.ref, activity.data)
    await batch.commit()
  } catch (error) {
    fail(error, 'Couldn’t delete the settlement.')
  }
}

// ---------------------------------------------------------------------------
// Group expenses
// ---------------------------------------------------------------------------

export async function listGroupExpenses(groupId: Id): Promise<GroupExpense[]> {
  try {
    const snapshot = await getDocs(
      query(
        collection(getDb(), 'expenses'),
        where('memberIds', 'array-contains', requireUserId()),
        where('groupId', '==', groupId),
        orderBy('date', 'desc'),
        orderBy('createdAt', 'desc'),
      ),
    )
    return snapshot.docs.map(toGroupExpense)
  } catch (error) {
    return fail(error, 'Couldn’t load expenses.')
  }
}

/** Runs the checks the server used to, then the split arithmetic. */
function buildSplits(input: GroupExpenseInput, memberIds: Id[]) {
  const named =
    input.method === 'itemized'
      ? (input.items ?? []).flatMap((item) => item.participantIds)
      : (input.participants ?? []).map((p) => p.userId)
  if (!named.every((id) => memberIds.includes(id))) {
    throw new Error('Everyone in the split must be a member of the group.')
  }
  return input.method === 'itemized'
    ? computeItemizedSplits(input.amountMinor, input.items ?? [])
    : computeSplits(input.method, input.amountMinor, input.participants ?? [])
}

function itemDocs(input: GroupExpenseInput) {
  if (input.method !== 'itemized') return []
  return (input.items ?? []).map((item, position) => ({
    description: item.description.trim(),
    amountMinor: item.amountMinor,
    position,
    participantIds: item.participantIds,
  }))
}

export async function createGroupExpense(
  groupId: Id,
  input: GroupExpenseInput,
): Promise<GroupExpense> {
  const user = currentUser()
  try {
    const group = await fetchGroup(groupId)
    assertActive(group)
    const memberIds = group.members.map((m) => m.userId)

    const paidBy = input.paidBy ?? user.id
    if (!memberIds.includes(paidBy)) {
      throw new Error('The payer must be a member of the group.')
    }
    const computed = buildSplits(input, memberIds)

    const db = getDb()
    const expenseId = newId('expenses')
    const now = Timestamp.now()
    const description = input.description.trim()

    const batch = writeBatch(db)
    batch.set(doc(db, 'expenses', expenseId), {
      ownerId: user.id,
      groupId,
      groupName: group.name,
      memberIds,
      paidBy,
      categoryId: input.categoryId,
      description,
      amountMinor: input.amountMinor,
      currency: group.currency,
      date: input.date,
      kind: 'expense',
      notes: input.notes,
      splitMethod: input.method,
      splits: computed,
      items: itemDocs(input),
      createdAt: now,
      updatedAt: now,
    })
    const activity = activityDoc(
      groupId,
      memberIds,
      user.id,
      'expense.added',
      expenseDetail(
        { id: expenseId, description, amountMinor: input.amountMinor, currency: group.currency, paidBy },
        group,
      ),
    )
    batch.set(activity.ref, activity.data)
    batch.update(doc(db, 'groups', groupId), { lastActivityAt: now })
    await batch.commit()

    return {
      id: expenseId,
      userId: user.id,
      groupId,
      paidBy,
      categoryId: input.categoryId,
      description,
      amountMinor: input.amountMinor,
      currency: group.currency,
      date: input.date,
      kind: 'expense',
      notes: input.notes,
      createdAt: toIso(now),
      updatedAt: toIso(now),
      splits: toSplitRows(expenseId, input.method, computed),
      items: itemDocs(input).map((item, index) => ({
        id: `${expenseId}__item_${index}`,
        ...item,
      })),
    }
  } catch (error) {
    return fail(error, 'Couldn’t save the expense.')
  }
}

export async function updateGroupExpense(
  expenseId: Id,
  input: GroupExpenseInput,
): Promise<GroupExpense> {
  const user = currentUser()
  try {
    const snapshot = await getDoc(doc(getDb(), 'expenses', expenseId))
    if (!snapshot.exists()) throw new Error('Expense not found.')
    const existing = toGroupExpense(snapshot)
    if (!existing.groupId) throw new Error('Expense not found.')

    const group = await fetchGroup(existing.groupId)
    // Re-checked on every edit, not just at creation: leaving a group has to
    // revoke write access to the expenses added while inside it.
    const role = memberRole(group, user.id)
    if (role === null) throw new Error('Expense not found.')
    if (existing.userId !== user.id && role !== 'owner') {
      throw new Error(
        'Only the person who added an expense, or a group owner, can change it.',
      )
    }
    assertActive(group)

    const memberIds = group.members.map((m) => m.userId)
    const paidBy = input.paidBy ?? existing.paidBy
    if (!memberIds.includes(paidBy)) {
      throw new Error('The payer must be a member of the group.')
    }
    const computed = buildSplits(input, memberIds)

    const db = getDb()
    const now = Timestamp.now()
    const description = input.description.trim()
    // Items are replaced wholesale, so a method change away from itemized
    // clears them — otherwise the edit screen would reopen a bill that no
    // longer describes the split.
    const items = itemDocs(input)

    const batch = writeBatch(db)
    batch.update(doc(db, 'expenses', expenseId), {
      paidBy,
      categoryId: input.categoryId,
      description,
      amountMinor: input.amountMinor,
      date: input.date,
      notes: input.notes,
      splitMethod: input.method,
      splits: computed,
      items,
      updatedAt: now,
    })
    const activity = activityDoc(
      existing.groupId,
      memberIds,
      user.id,
      'expense.updated',
      expenseDetail(
        { id: expenseId, description, amountMinor: input.amountMinor, currency: existing.currency, paidBy },
        group,
      ),
    )
    batch.set(activity.ref, activity.data)
    batch.update(doc(db, 'groups', existing.groupId), { lastActivityAt: now })
    await batch.commit()

    return {
      ...existing,
      paidBy,
      categoryId: input.categoryId,
      description,
      amountMinor: input.amountMinor,
      date: input.date,
      notes: input.notes,
      updatedAt: toIso(now),
      splits: toSplitRows(expenseId, input.method, computed),
      items: items.map((item, index) => ({ id: `${expenseId}__item_${index}`, ...item })),
    }
  } catch (error) {
    return fail(error, 'Couldn’t update the expense.')
  }
}

export async function deleteGroupExpense(id: Id): Promise<void> {
  const user = currentUser()
  try {
    const snapshot = await getDoc(doc(getDb(), 'expenses', id))
    if (!snapshot.exists()) throw new Error('Expense not found.')
    const existing = toGroupExpense(snapshot)
    if (!existing.groupId) throw new Error('Expense not found.')

    const group = await fetchGroup(existing.groupId)
    const role = memberRole(group, user.id)
    if (role === null) throw new Error('Expense not found.')
    if (existing.userId !== user.id && role !== 'owner') {
      throw new Error(
        'Only the person who added an expense, or a group owner, can change it.',
      )
    }

    const db = getDb()
    const comments = await getDocs(
      query(
        collection(db, 'comments'),
        where('memberIds', 'array-contains', user.id),
        where('expenseId', '==', id),
      ),
    )

    const batch = writeBatch(db)
    batch.delete(doc(db, 'expenses', id))
    // No ON DELETE CASCADE here, so the comments go explicitly.
    for (const comment of comments.docs) batch.delete(comment.ref)
    const activity = activityDoc(
      existing.groupId,
      group.members.map((m) => m.userId),
      user.id,
      'expense.deleted',
      expenseDetail(existing, group),
    )
    batch.set(activity.ref, activity.data)
    await batch.commit()
  } catch (error) {
    fail(error, 'Couldn’t delete the expense.')
  }
}
