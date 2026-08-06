import { create } from 'zustand'

export interface SessionUser {
  id: string
  email: string
  fullName: string | null
  avatarUrl: string | null
}

export type AuthStatus = 'loading' | 'signedIn' | 'signedOut'

interface AuthState {
  status: AuthStatus
  user: SessionUser | null
  setSession: (user: SessionUser) => void
  clearSession: () => void
}

/** Populated by AuthListener in providers.tsx from Supabase session events. */
export const useAuthStore = create<AuthState>()((set) => ({
  status: 'loading',
  user: null,
  setSession: (user) => set({ status: 'signedIn', user }),
  clearSession: () => set({ status: 'signedOut', user: null }),
}))
