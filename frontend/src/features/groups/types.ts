import type { CurrencyCode, Expense, Id, ISODateString, SplitMethod } from '@/types'

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
  method: SplitMethod
}

export interface GroupExpense extends Expense {
  splits: GroupExpenseSplit[]
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
}

export interface SplitParticipantInput {
  userId: Id
  owedMinor?: number
  shareBasisPoints?: number
}

export interface GroupExpenseInput {
  description: string
  amountMinor: number
  categoryId: Id | null
  date: string
  notes: string | null
  method: SplitMethod
  participants: SplitParticipantInput[]
}
