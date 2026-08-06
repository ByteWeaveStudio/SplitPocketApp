import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { BrandMark } from '@/components/brand-mark'
import { Button } from '@/components/ui/button'
import { AuthShell } from '@/features/auth/components/auth-shell'
import { useAuthStore } from '@/stores/auth-store'

/** Reads OAuth error details from either the query string or the URL hash. */
function oauthErrorFromUrl(): string | null {
  const query = new URLSearchParams(window.location.search)
  const hash = new URLSearchParams(window.location.hash.slice(1))
  return (
    query.get('error_description') ??
    hash.get('error_description') ??
    (query.get('error') || hash.get('error'))
  )
}

export function AuthCallbackPage() {
  const status = useAuthStore((state) => state.status)
  const navigate = useNavigate()
  const [oauthError] = useState(oauthErrorFromUrl)
  const [timedOut, setTimedOut] = useState(false)

  useEffect(() => {
    if (status === 'signedIn') navigate('/', { replace: true })
  }, [status, navigate])

  useEffect(() => {
    const timer = window.setTimeout(() => setTimedOut(true), 10_000)
    return () => window.clearTimeout(timer)
  }, [])

  if (oauthError || timedOut) {
    return (
      <AuthShell title="Sign-in didn't complete">
        <p className="text-center text-sm text-muted-foreground">
          {oauthError ?? 'The sign-in took too long. Please try again.'}
        </p>
        <Button asChild>
          <Link to="/auth/sign-in">Back to sign-in</Link>
        </Button>
      </AuthShell>
    )
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-4" aria-busy="true">
      <BrandMark withWordmark className="animate-pulse" />
      <p className="text-sm text-muted-foreground">Signing you in…</p>
    </div>
  )
}
