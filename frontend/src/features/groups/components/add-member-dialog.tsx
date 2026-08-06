import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useGroupDetailStore } from '@/features/groups/group-detail-store'
import { addMemberByEmail } from '@/features/groups/groups-service'
import type { Id } from '@/types'

export function AddMemberDialog({
  groupId,
  open,
  onOpenChange,
}: {
  groupId: Id
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)

  async function submit() {
    const trimmed = email.trim()
    if (!trimmed) return
    setSaving(true)
    try {
      const member = await addMemberByEmail(groupId, trimmed)
      onOpenChange(false)
      setEmail('')
      toast.success(`${member.fullName ?? member.email} added to the group`)
      void useGroupDetailStore.getState().refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Couldn’t add that person.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Add a member</DialogTitle>
          <DialogDescription>
            They need a SplitPocket account — invite them by the email they signed up with.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
        >
          <div className="flex flex-col gap-2">
            <Label htmlFor="member-email">Email</Label>
            <Input
              id="member-email"
              type="email"
              autoFocus
              placeholder="friend@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving} className="w-full sm:w-auto">
              {saving ? 'Adding…' : 'Add member'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
