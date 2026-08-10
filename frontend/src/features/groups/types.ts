import type {
  CurrencyCode,
  Expense,
  ExpenseItem,
  Id,
  ISODateString,
  SplitMethod,
} from '@/types'

/** Shapes returned by the SplitPocket API (already camelCase). */

export interface GroupMemberProfile {
  userId: Id
  role: 'owner' | 'member'
  joinedAt: ISODateString
  email: string
  fullName: string | null
  avatarUrl: string | null
}

export interface GroupWithMembers {
  id: Id
  name: string
  description: string | null
  currency: CurrencyCode
  createdBy: Id
  createdAt: ISODateString
  archivedAt: ISODateString | null
  members: GroupMemberProfile[]
}

export interface GroupExpenseSplit {
  id: Id
  expenseId: Id
  userId: Id
  owedMinor: number
  shareBasisPoints: number | null
  shareUnits: number | null
  method: SplitMethod
}

export interface GroupExpense extends Expense {
  splits: GroupExpenseSplit[]
  /** Populated only when the split method is 'itemized'. */
  items: ExpenseItem[]
}

export interface MemberBalance {
  userId: Id
  netMinor: number
}

export interface SuggestedSettlement {
  fromUserId: Id
  toUserId: Id
  amountMinor: number
}

export interface GroupBalances {
  groupId: Id
  currency: CurrencyCode
  members: MemberBalance[]
  suggestedSettlements: SuggestedSettlement[]
}

export interface GroupSettlement {
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

export interface MyGroupBalance {
  groupId: Id
  groupName: string
  currency: CurrencyCode
  netMinor: number
  memberCount: number
  /** Null for a group nobody has done anything in yet. */
  lastActivityAt: ISODateString | null
  archived: boolean
}

export interface SplitParticipantInput {
  userId: Id
  owedMinor?: number
  shareBasisPoints?: number
  shareUnits?: number
}

export interface LineItemInput {
  description: string
  amountMinor: number
  participantIds: Id[]
}

export interface GroupExpenseInput {
  description: string
  amountMinor: number
  categoryId: Id | null
  date: string
  notes: string | null
  method: SplitMethod
  /** Omit to record yourself as the payer. */
  paidBy?: Id
  /** Used by every method except 'itemized'. */
  participants?: SplitParticipantInput[]
  /** Used only by 'itemized'. */
  items?: LineItemInput[]
}

// ---------------------------------------------------------------------------
// Group operations
// ---------------------------------------------------------------------------

export interface GroupInvite {
  id: Id
  groupId: Id
  /** Present only in the response that created it — never stored, never re-read. */
  token: string | null
  expiresAt: ISODateString
  maxUses: number | null
  uses: number
  revokedAt: ISODateString | null
  createdBy: Id
  createdAt: ISODateString
}

export interface InvitePreview {
  groupId: Id
  groupName: string
  currency: CurrencyCode
  memberCount: number
  alreadyMember: boolean
}

export type ActivityKind =
  | 'group.created'
  | 'group.renamed'
  | 'group.archived'
  | 'group.unarchived'
  | 'member.added'
  | 'member.joined'
  | 'member.removed'
  | 'member.role_changed'
  | 'expense.added'
  | 'expense.updated'
  | 'expense.deleted'
  | 'settlement.recorded'
  | 'settlement.deleted'
  | 'comment.added'

/**
 * Denormalized at write time, so an entry stays readable after the row it
 * describes is gone. Every field is optional: the shape varies by kind, and
 * old entries predate any field added later.
 */
export interface ActivityDetail {
  groupName?: string
  from?: string
  to?: string
  memberName?: string
  role?: string
  left?: boolean
  expenseId?: string
  description?: string
  amountMinor?: number
  currency?: string
  paidByName?: string
  fromName?: string
  toName?: string
  authorName?: string
}

export interface ActivityEntry {
  id: Id
  groupId: Id
  actorId: Id | null
  kind: ActivityKind
  detail: ActivityDetail
  createdAt: ISODateString
}

export interface ActivityPage {
  entries: ActivityEntry[]
  nextBefore: ISODateString | null
}

export interface ExpenseComment {
  id: Id
  expenseId: Id
  userId: Id
  body: string
  createdAt: ISODateString
  updatedAt: ISODateString
}

export interface SplitPreset {
  id: Id
  groupId: Id
  name: string
  method: Exclude<SplitMethod, 'itemized'>
  participants: SplitParticipantInput[]
  createdBy: Id
  createdAt: ISODateString
}
