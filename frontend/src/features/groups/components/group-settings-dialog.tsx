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
import { updateGroup } from '@/features/groups/groups-service'
import { useGroupsStore } from '@/features/groups/groups-store'
import type { GroupWithMembers } from '@/features/groups/types'

export function GroupSettingsDialog({
  group,
  open,
  onOpenChange,
}: {
  group: GroupWithMembers
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [name, setName] = useState(group.name)
  const [description, setDescription] = useState(group.description ?? '')
  const [saving, setSaving] = useState(false)

  async function submit() {
    const trimmed = name.trim()
    if (!trimmed) {
      toast.error('A group needs a name.')
      return
    }
    setSaving(true)
    try {
      await updateGroup(group.id, {
        name: trimmed,
        description: description.trim() || null,
      })
      toast.success('Group updated')
      onOpenChange(false)
      await useGroupDetailStore.getState().refresh()
      void useGroupsStore.getState().refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Couldn’t update the group.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Group settings</DialogTitle>
          <DialogDescription>
            The currency is fixed at {group.currency} — changing it would re-price every amount
            already recorded here.
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
            <Label htmlFor="group-settings-name">Name</Label>
            <Input
              id="group-settings-name"
              autoFocus
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="group-settings-description">
              Description <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Input
              id="group-settings-description"
              maxLength={500}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </div>
          <DialogFooter>
            <Button type="submit" disabled={saving} className="w-full sm:w-auto">
              {saving ? 'Saving…' : 'Save changes'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
