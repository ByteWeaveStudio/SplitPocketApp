import { Check, Copy, Link2, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createInvite, inviteUrl, listInvites, revokeInvite } from '@/features/groups/groups-service'
import type { GroupInvite } from '@/features/groups/types'
import { formatDateTime } from '@/lib/format'
import type { Id } from '@/types'

const EXPIRY_OPTIONS = [
  { value: '24', label: '24 hours' },
  { value: '168', label: '7 days' },
  { value: '720', label: '30 days' },
]

/**
 * Adding by email needs the other person to already have an account, which is
 * exactly what is not true when a group forms. A link inverts that: create the
 * group now, and the link survives their signup.
 *
 * The token is shown once, here, because only its hash is stored — a link that
 * could be re-read from the database would be a link a database dump hands out.
 */
export function InviteDialog({
  groupId,
  open,
  onOpenChange,
}: {
  groupId: Id
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const [invites, setInvites] = useState<GroupInvite[]>([])
  const [expiresInHours, setExpiresInHours] = useState('168')
  const [singleUse, setSingleUse] = useState(false)
  const [fresh, setFresh] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setFresh(null)
    setCopied(false)
    listInvites(groupId)
      .then(setInvites)
      .catch((error: unknown) =>
        toast.error(error instanceof Error ? error.message : 'Couldn’t load invite links.'),
      )
  }, [open, groupId])

  async function create() {
    setBusy(true)
    try {
      const invite = await createInvite(groupId, {
        expiresInHours: Number(expiresInHours),
        maxUses: singleUse ? 1 : null,
      })
      setInvites((current) => [invite, ...current])
      setFresh(invite.token ? inviteUrl(invite.token) : null)
      setCopied(false)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Couldn’t create an invite link.')
    } finally {
      setBusy(false)
    }
  }

  async function copy(url: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopied(true)
      toast.success('Link copied')
    } catch {
      // Clipboard access can be denied (or unavailable over plain http on a
      // LAN address); the input below is selectable either way.
      toast.error('Couldn’t copy — select the link and copy it manually.')
    }
  }

  async function revoke(inviteId: Id) {
    try {
      await revokeInvite(groupId, inviteId)
      setInvites((current) => current.filter((invite) => invite.id !== inviteId))
      toast.success('Link revoked')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Couldn’t revoke that link.')
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Invite with a link</DialogTitle>
          <DialogDescription>
            Anyone with the link can join this group until it expires. They’ll need a
            SplitPocket account, but they can create one after opening it.
          </DialogDescription>
        </DialogHeader>

        {fresh ? (
          <div className="flex flex-col gap-2">
            <Label htmlFor="invite-link">Your new link</Label>
            <div className="flex gap-2">
              <Input
                id="invite-link"
                readOnly
                value={fresh}
                onFocus={(event) => event.currentTarget.select()}
                className="font-mono text-xs"
              />
              <Button type="button" size="icon" aria-label="Copy link" onClick={() => void copy(fresh)}>
                {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Copy it now — for security this link isn’t stored and can’t be shown again.
            </p>
            <Button variant="outline" className="mt-2" onClick={() => setFresh(null)}>
              Create another
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor="invite-expiry">Expires after</Label>
              <Select value={expiresInHours} onValueChange={setExpiresInHours}>
                <SelectTrigger id="invite-expiry">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {EXPIRY_OPTIONS.map((option) => (
                    <SelectItem key={option.value} value={option.value}>
                      {option.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={singleUse}
                onChange={(event) => setSingleUse(event.target.checked)}
              />
              One person only
            </label>
            <Button disabled={busy} onClick={() => void create()}>
              <Link2 className="size-4" aria-hidden />
              {busy ? 'Creating…' : 'Create link'}
            </Button>
          </div>
        )}

        {invites.length > 0 && (
          <div className="flex flex-col gap-2 border-t pt-4">
            <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Active links
            </p>
            <ul className="flex flex-col">
              {invites.map((invite) => (
                <li
                  key={invite.id}
                  className="flex items-center gap-2 border-b py-2 text-sm last:border-b-0"
                >
                  <Link2 className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">
                    Expires {formatDateTime(invite.expiresAt)}
                    {invite.maxUses !== null && ` · ${invite.uses}/${invite.maxUses} used`}
                  </span>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-8 shrink-0 text-muted-foreground"
                    aria-label="Revoke this link"
                    onClick={() => void revoke(invite.id)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
