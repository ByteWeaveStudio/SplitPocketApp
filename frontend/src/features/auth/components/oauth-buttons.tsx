import { useState } from 'react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
import { Separator } from '@/components/ui/separator'
import { signInWithOAuth } from '@/features/auth/auth-service'
import type { OAuthProvider } from '@/features/auth/auth-service'
import { AppleIcon, GoogleIcon } from '@/features/auth/components/provider-icons'

export function OAuthButtons() {
  const [pending, setPending] = useState<OAuthProvider | null>(null)

  async function handleClick(provider: OAuthProvider) {
    setPending(provider)
    try {
      await signInWithOAuth(provider)
      // On success the browser navigates to the provider — no state to reset.
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Sign-in failed. Try again.')
      setPending(null)
    }
  }

  return (
    <>
      <div className="flex flex-col gap-2">
        <Button
          variant="outline"
          disabled={pending !== null}
          onClick={() => handleClick('google')}
        >
          <GoogleIcon className="size-4" />
          Continue with Google
        </Button>
        <Button
          variant="outline"
          disabled={pending !== null}
          onClick={() => handleClick('apple')}
        >
          <AppleIcon className="size-4" />
          Continue with Apple
        </Button>
      </div>
      <div className="flex items-center gap-3">
        <Separator className="flex-1" />
        <span className="text-xs text-muted-foreground">or</span>
        <Separator className="flex-1" />
      </div>
    </>
  )
}
