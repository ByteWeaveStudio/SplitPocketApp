import { useEffect } from 'react'
import { onAuthStateChanged } from 'firebase/auth'
import { ThemeProvider, useTheme } from 'next-themes'
import { RouterProvider } from 'react-router-dom'

import { router } from '@/app/router'
import { Toaster } from '@/components/ui/sonner'
import { ensureProfile, toSessionUser } from '@/features/auth/auth-service'
import { useCategoriesStore } from '@/features/categories/categories-store'
import { useDashboardStore } from '@/features/dashboard/dashboard-store'
import { useGroupDetailStore } from '@/features/groups/group-detail-store'
import { useGroupsStore } from '@/features/groups/groups-store'
import { useExpensesStore } from '@/features/personal-expenses/expenses-store'
import { DEFAULT_THEME } from '@/lib/theme'
import { initConnectivity } from '@/services/connectivity'
import { getFirebaseAuth } from '@/services/firebase'
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

/** Mirrors the Firebase session into the auth store (initial state included). */
function AuthListener() {
  useEffect(() => {
    return onAuthStateChanged(getFirebaseAuth(), (user) => {
      if (user) {
        const alreadySignedIn = useAuthStore.getState().status === 'signedIn'
        useAuthStore.getState().setSession(toSessionUser(user))
        // Postgres created the profile row from a trigger on auth.users. With
        // no server, the client has to do it — and here rather than only in
        // sign-up, or anyone arriving through Google or Apple never gets one.
        // Deferred so no async work runs inside the callback.
        if (!alreadySignedIn) {
          setTimeout(() => {
            void ensureProfile(user).catch(() => {
              // Offline: the write is queued by Firestore and lands on its own.
            })
          }, 0)
        }
      } else {
        useAuthStore.getState().clearSession()
        // Drop the previous account's data so the next sign-in starts clean.
        useExpensesStore.getState().reset()
        useCategoriesStore.getState().reset()
        useGroupsStore.getState().reset()
        useGroupDetailStore.getState().reset()
        useDashboardStore.getState().reset()
      }
    })
  }, [])

  return null
}

/** Browser connectivity tracking; Firestore handles sync by itself. */
function SyncListener() {
  useEffect(() => initConnectivity(), [])
  return null
}

export function Providers() {
  return (
    // Light unless the user says otherwise, and the OS preference is not
    // consulted — see lib/theme.ts.
    <ThemeProvider
      attribute="class"
      defaultTheme={DEFAULT_THEME}
      enableSystem={false}
      disableTransitionOnChange
    >
      <ThemeColorSync />
      <AuthListener />
      <SyncListener />
      <RouterProvider router={router} />
      <Toaster position="top-center" />
    </ThemeProvider>
  )
}
