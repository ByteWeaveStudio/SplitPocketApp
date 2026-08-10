import { Users } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { toast } from 'sonner'

import { BrandMark } from '@/components/brand-mark'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { acceptInvite, previewInvite } from '@/features/groups/groups-service'
import type { InvitePreview } from '@/features/groups/types'
import { useDashboardStore } from '@/features/dashboard/dashboard-store'
import { useGroupsStore } from '@/features/groups/groups-store'
import { useAuthStore } from '@/stores/auth-store'

type Phase = 'loading' | 'ready' | 'invalid'

/**
 * The landing page for a share link. Deliberately outside RequireAuth: most
 * people opening one of these do not have an account yet, and bouncing them
 * to a bare sign-in screen loses the reason they clicked.
 */
export function JoinGroupPage() {
  const { token = '' } = useParams<{ token: string }>()
  const navigate = useNavigate()
  const authStatus = useAuthStore((state) => state.status)
  const [phase, setPhase] = useState<Phase>('loading')
  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [joining, setJoining] = useState(false)

  // The preview endpoint is authenticated, so there is nothing to fetch until
  // we know who is asking.
  useEffect(() => {
    if (authStatus !== 'signedIn' || !token) return
    let cancelled = false
    setPhase('loading')
    previewInvite(token)
      .then((result) => {
        if (cancelled) return
        setPreview(result)
        setPhase('ready')
      })
      .catch((loadError: unknown) => {
        if (cancelled) return
        setError(loadError instanceof Error ? loadError.message : 'This link is no longer valid.')
        setPhase('invalid')
      })
    return () => {
      cancelled = true
    }
  }, [authStatus, token])

  async function join() {
    setJoining(true)
    try {
      const group = await acceptInvite(token)
      toast.success(`You're in — welcome to ${group.name}`)
      // Both lists now have a group they didn't before.
      void useGroupsStore.getState().refresh()
      const dashboard = useDashboardStore.getState()
      if (dashboard.status === 'ready') void dashboard.load()
      void navigate(`/groups/${group.id}`, { replace: true })
    } catch (joinError) {
      toast.error(joinError instanceof Error ? joinError.message : 'Couldn’t join that group.')
      setJoining(false)
    }
  }

  return (
    <div className="flex min-h-svh flex-col items-center justify-center gap-6 px-4 py-10">
      <BrandMark withWordmark />
      <Card className="w-full max-w-sm">
        <CardContent className="flex flex-col items-center gap-4 px-6 py-2 text-center">
          {authStatus === 'loading' && <Skeleton className="h-24 w-full rounded-lg" />}

          {authStatus === 'signedOut' && (
            <>
              <IconBadge />
              <div>
                <h1 className="text-lg font-medium">You’ve been invited to a group</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Sign in or create an account to see it and join.
                </p>
              </div>
              <div className="flex w-full flex-col gap-2">
                <Button asChild>
                  <Link to="/auth/sign-in" state={{ from: `/join/${token}` }}>
                    Sign in
                  </Link>
                </Button>
                <Button variant="outline" asChild>
                  <Link to="/auth/sign-up" state={{ from: `/join/${token}` }}>
                    Create an account
                  </Link>
                </Button>
              </div>
            </>
          )}

          {authStatus === 'signedIn' && phase === 'loading' && (
            <Skeleton className="h-24 w-full rounded-lg" />
          )}

          {authStatus === 'signedIn' && phase === 'invalid' && (
            <>
              <IconBadge />
              <div>
                <h1 className="text-lg font-medium">This link doesn’t work</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {error ?? 'It may have expired or been revoked. Ask for a new one.'}
                </p>
              </div>
              <Button variant="outline" asChild className="w-full">
                <Link to="/">Go to SplitPocket</Link>
              </Button>
            </>
          )}

          {authStatus === 'signedIn' && phase === 'ready' && preview && (
            <>
              <IconBadge />
              <div>
                <h1 className="text-lg font-medium">{preview.groupName}</h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  {preview.memberCount} {preview.memberCount === 1 ? 'member' : 'members'} ·
                  expenses in {preview.currency}
                </p>
              </div>
              {preview.alreadyMember ? (
                <>
                  <p className="text-sm text-muted-foreground">You’re already in this group.</p>
                  <Button asChild className="w-full">
                    <Link to={`/groups/${preview.groupId}`}>Open group</Link>
                  </Button>
                </>
              ) : (
                <Button className="w-full" disabled={joining} onClick={() => void join()}>
                  {joining ? 'Joining…' : `Join ${preview.groupName}`}
                </Button>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

function IconBadge() {
  return (
    <span className="flex size-12 items-center justify-center rounded-full bg-muted">
      <Users className="size-6 text-muted-foreground" aria-hidden />
    </span>
  )
}
