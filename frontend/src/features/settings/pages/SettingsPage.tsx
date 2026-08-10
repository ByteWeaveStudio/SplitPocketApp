import { useTheme } from 'next-themes'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'

import { ConfirmDialog } from '@/components/confirm-dialog'
import { PageHeader } from '@/components/page-header'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { signOut } from '@/features/auth/auth-service'
import { CURRENCIES } from '@/lib/currencies'
import { useAuthStore } from '@/stores/auth-store'
import { useNetworkStore } from '@/stores/network-store'
import { useSettingsStore } from '@/stores/settings-store'

function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function SettingsPage() {
  const { resolvedTheme, setTheme } = useTheme()
  const currency = useSettingsStore((state) => state.currency)
  const currencySource = useSettingsStore((state) => state.currencySource)
  const setCurrency = useSettingsStore((state) => state.setCurrency)
  const user = useAuthStore((state) => state.user)
  const pendingCount = useNetworkStore((state) => state.pendingCount)
  const [confirmingSignOut, setConfirmingSignOut] = useState(false)

  async function doSignOut() {
    try {
      await signOut()
      toast.success('Signed out')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Sign-out failed. Try again.')
    }
  }

  function handleSignOut() {
    // Signing out wipes this device's offline data — don't silently discard
    // changes that haven't reached the server yet.
    if (pendingCount > 0) setConfirmingSignOut(true)
    else void doSignOut()
  }

  return (
    <>
      <PageHeader title="Settings" description="Appearance, preferences, and your account." />
      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle>Appearance</CardTitle>
            <CardDescription>How SplitPocket looks on this device.</CardDescription>
          </CardHeader>
          <CardContent>
            {/* Two states, so a switch rather than a two-item dropdown —
                same single tap as the header toggle it mirrors. */}
            <div className="flex max-w-xs items-center justify-between gap-4">
              <Label htmlFor="dark-mode" className="font-normal">
                Dark mode
              </Label>
              <Switch
                id="dark-mode"
                checked={resolvedTheme === 'dark'}
                onCheckedChange={(checked) => setTheme(checked ? 'dark' : 'light')}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Currency</CardTitle>
            <CardDescription>
              {currencySource === 'detected'
                ? 'Guessed from your device language — choose one and it sticks.'
                : 'Used as the default for new expenses and summaries.'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex max-w-xs flex-col gap-2">
              <Label htmlFor="currency">Default currency</Label>
              <Select value={currency} onValueChange={setCurrency}>
                <SelectTrigger id="currency">
                  <SelectValue placeholder="Select a currency" />
                </SelectTrigger>
                <SelectContent>
                  {CURRENCIES.map((item) => (
                    <SelectItem key={item.code} value={item.code}>
                      {item.code} — {item.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Account</CardTitle>
            <CardDescription>
              {user ? 'Signed in to SplitPocket.' : "You're not signed in."}
            </CardDescription>
          </CardHeader>
          {user ? (
            <CardContent className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <Avatar>
                  <AvatarImage src={user.avatarUrl ?? undefined} alt="" />
                  <AvatarFallback>{initialsOf(user.fullName ?? user.email)}</AvatarFallback>
                </Avatar>
                <div>
                  <p className="text-sm font-medium">{user.fullName ?? user.email}</p>
                  <p className="text-sm text-muted-foreground">{user.email}</p>
                </div>
              </div>
              <Button variant="outline" onClick={handleSignOut}>
                Sign out
              </Button>
              <ConfirmDialog
                open={confirmingSignOut}
                onOpenChange={setConfirmingSignOut}
                title={`Sign out with ${pendingCount} unsynced ${pendingCount === 1 ? 'change' : 'changes'}?`}
                description="Changes made offline haven't reached the server yet. Signing out deletes them from this device. Reconnect first to keep them."
                confirmLabel="Sign out anyway"
                onConfirm={() => void doSignOut()}
              />
            </CardContent>
          ) : (
            <CardContent className="flex flex-wrap items-center gap-3">
              <Button asChild variant="outline">
                <Link to="/auth/sign-in">Go to sign-in</Link>
              </Button>
              <p className="text-sm text-muted-foreground">
                Sign in to sync your expenses and join groups.
              </p>
            </CardContent>
          )}
        </Card>
      </div>
    </>
  )
}
