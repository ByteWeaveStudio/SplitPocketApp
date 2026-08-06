import type { GroupMemberProfile } from '@/features/groups/types'

export function memberDisplayName(member: GroupMemberProfile, myUserId?: string): string {
  if (myUserId && member.userId === myUserId) return 'You'
  return member.fullName?.trim() || member.email
}
