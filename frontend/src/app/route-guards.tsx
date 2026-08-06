import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

import { BrandMark } from '@/components/brand-mark'
import { safeInternalPath } from '@/lib/navigation'
import { isSupabaseConfigured } from '@/services/supabase'
import { useAuthStore } from '@/stores/auth-store'

function SplashScreen() {
  return (
    <div className="flex min-h-svh items-center justify-center" aria-busy="true">
      <BrandMark withWordmark className="animate-pulse" />
    </div>
  )
}

/** Gates the app shell: unauthenticated users go to sign-in. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const status = useAuthStore((state) => state.status)
  const location = useLocation()

  // Without Supabase configured there is no auth to enforce — let the shell
  // render in local preview mode (a banner in the layout explains it).
  if (!isSupabaseConfigured) return <>{children}</>

  if (status === 'loading') return <SplashScreen />
  if (status === 'signedOut') {
    return (
      <Navigate
        to="/auth/sign-in"
        replace
        state={{ from: location.pathname + location.search }}
      />
    )
  }
  return <>{children}</>
}

/** Keeps signed-in users out of the sign-in/sign-up/forgot pages. */
export function RedirectIfSignedIn({ children }: { children: ReactNode }) {
  const status = useAuthStore((state) => state.status)
  const location = useLocation()

  if (!isSupabaseConfigured) return <>{children}</>

  if (status === 'loading') return <SplashScreen />
  if (status === 'signedIn') {
    const from = safeInternalPath((location.state as { from?: unknown } | null)?.from)
    return <Navigate to={from ?? '/'} replace />
  }
  return <>{children}</>
}
