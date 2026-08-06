import { useEffect } from 'react'
import { ThemeProvider, useTheme } from 'next-themes'
import { RouterProvider } from 'react-router-dom'

import { router } from '@/app/router'
import { Toaster } from '@/components/ui/sonner'
import { toSessionUser } from '@/features/auth/auth-service'
import { useCategoriesStore } from '@/features/categories/categories-store'
import { useDashboardStore } from '@/features/dashboard/dashboard-store'
import { useGroupDetailStore } from '@/features/groups/group-detail-store'
import { useGroupsStore } from '@/features/groups/groups-store'
import { useExpensesStore } from '@/features/personal-expenses/expenses-store'
import { initSync, onSignedIn, onSignedOut } from '@/services/offline/sync'
import { getSupabase, isSupabaseConfigured } from '@/services/supabase'
import { useAuthStore } from '@/stores/auth-store'

const THEME_COLORS = { light: '#f8f8f5', dark: '#04060a' } as const

/**
 * Keeps the browser/OS chrome color in sync with the active theme.
 * The static media-split tags in index.html only track the OS preference,
 * which is wrong once the user overrides the theme in-app.
 */
function ThemeColorSync() {
  const { resolvedTheme } = useTheme()

  useEffect(() => {
    if (resolvedTheme !== 'light' && resolvedTheme !== 'dark') return
    const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')
    metas.forEach((meta, index) => {
      if (index > 0) meta.remove()
    })
    let meta = metas[0]
    if (!meta) {
      meta = document.createElement('meta')
      meta.name = 'theme-color'
      document.head.appendChild(meta)
    }
    meta.removeAttribute('media')
    meta.content = THEME_COLORS[resolvedTheme]
  }, [resolvedTheme])

  return null
}

/** Mirrors the Supabase session into the auth store (INITIAL_SESSION included). */
function AuthListener() {
  useEffect(() => {
    if (!isSupabaseConfigured) {
      useAuthStore.getState().clearSession()
      return
    }
    const { data } = getSupabase().auth.onAuthStateChange((_event, session) => {
      // No async work in this callback (supabase-js deadlocks on it) — store
      // writes only; onSignedIn/onSignedOut defer their work with setTimeout.
      if (session) {
        const alreadySignedIn = useAuthStore.getState().status === 'signedIn'
        useAuthStore.getState().setSession(toSessionUser(session.user))
        // First session event of this app load: sync anything queued offline.
        if (!alreadySignedIn) onSignedIn(session.user.id)
      } else {
        useAuthStore.getState().clearSession()
        // Drop the previous account's data so the next sign-in starts clean.
        useExpensesStore.getState().reset()
        useCategoriesStore.getState().reset()
        useGroupsStore.getState().reset()
        useGroupDetailStore.getState().reset()
        useDashboardStore.getState().reset()
        onSignedOut()
      }
    })
    return () => data.subscription.unsubscribe()
  }, [])

  return null
}

/** Connectivity tracking + outbox flush on reconnect. */
function SyncListener() {
  useEffect(() => initSync(), [])
  return null
}

export function Providers() {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <ThemeColorSync />
      <AuthListener />
      <SyncListener />
      <RouterProvider router={router} />
      <Toaster position="top-center" />
    </ThemeProvider>
  )
}
