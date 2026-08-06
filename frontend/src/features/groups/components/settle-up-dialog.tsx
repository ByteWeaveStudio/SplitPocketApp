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
import { recordSettlement } from '@/features/groups/groups-service'
import { memberDisplayName } from '@/features/groups/display'
import type { GroupWithMembers, SuggestedSettlement } from '@/features/groups/types'
import { formatMoney } from '@/lib/format'
import { useAuthStore } from '@/stores/auth-store'

export function SettleUpDialog({
  group,
  suggestion,
  onOpenChange,
}: {
  group: GroupWithMembers
  /** Null = closed. */
  suggestion: SuggestedSettlement | null
  onOpenChange: (open: boolean) => void
}) {
  const myUserId = useAuthStore((state) => state.user?.id ?? '')
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  if (!suggestion) return null
  const from = group.members.find((m) => m.userId === suggestion.fromUserId)
  const to = group.members.find((m) => m.userId === suggestion.toUserId)
  if (!from || !to) return null

  async function submit() {
    if (!suggestion) return
    setSaving(true)
    try {
      await recordSettlement(group.id, {
        fromUserId: suggestion.fromUserId,
        toUserId: suggestion.toUserId,
        amountMinor: suggestion.amountMinor,
        note: note.trim() || null,
      })
      onOpenChange(false)
      setNote('')
      toast.success('Settlement recorded')
      void useGroupDetailStore.getState().refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Couldn’t record the settlement.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Record a settlement</DialogTitle>
          <DialogDescription>
            {memberDisplayName(from, myUserId)} paid {memberDisplayName(to, myUserId)}{' '}
            <strong>{formatMoney(suggestion.amountMinor, group.currency)}</strong> outside the
            app — record it here to update the balances.
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-col gap-2">
          <Label htmlFor="settle-note">
            Note <span className="font-normal text-muted-foreground">(optional)</span>
          </Label>
          <Input
            id="settle-note"
            placeholder="UPI, cash…"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        </div>
        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={saving} onClick={() => void submit()}>
            {saving ? 'Recording…' : 'Record payment'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
