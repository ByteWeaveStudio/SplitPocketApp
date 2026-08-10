import type { GroupMemberProfile } from '@/features/groups/types'

/** Placeholder address written by the tombstone_deleted_user trigger when the
 * underlying auth account is deleted. The profile row is kept so the group's
 * ledger stays balanced, but there is no longer a person behind it. */
const DELETED_EMAIL_SUFFIX = '@deleted.invalid'

export function isDeletedMember(member: GroupMemberProfile): boolean {
  return member.email.endsWith(DELETED_EMAIL_SUFFIX)
}

export function memberDisplayName(member: GroupMemberProfile, myUserId?: string): string {
  if (myUserId && member.userId === myUserId) return 'You'
  // Falling through to `email` here would print the raw placeholder address.
  if (isDeletedMember(member)) return 'Deleted user'
  return member.fullName?.trim() || member.email
}
