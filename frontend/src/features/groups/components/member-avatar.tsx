import { isDeletedMember } from '@/features/groups/display'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import type { GroupMemberProfile } from '@/features/groups/types'
import { cn } from '@/lib/utils'

function initialsOf(member: GroupMemberProfile): string {
  // The tombstone's placeholder address would otherwise initial as "DB".
  if (isDeletedMember(member)) return '–'
  const source = member.fullName?.trim() || member.email
  const words = source.split(/[\s@._-]+/).filter(Boolean)
  return words
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase() ?? '')
    .join('')
}

export function MemberAvatar({
  member,
  className,
}: {
  member: GroupMemberProfile
  className?: string
}) {
  return (
    <Avatar className={cn('border-2 border-background', className)}>
      {member.avatarUrl && <AvatarImage src={member.avatarUrl} alt="" />}
      <AvatarFallback className="text-[10px] font-medium">{initialsOf(member)}</AvatarFallback>
    </Avatar>
  )
}
