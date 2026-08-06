import type { AuthError, User } from '@supabase/supabase-js'

import { getSupabase } from '@/services/supabase'
import type { SessionUser } from '@/stores/auth-store'

export type OAuthProvider = 'google' | 'apple'

export function toSessionUser(user: User): SessionUser {
  const metadata = user.user_metadata as Record<string, unknown>
  return {
    id: user.id,
    email: user.email ?? '',
    fullName: typeof metadata.full_name === 'string' ? metadata.full_name : null,
    avatarUrl: typeof metadata.avatar_url === 'string' ? metadata.avatar_url : null,
  }
}

/** Maps Supabase auth errors to copy a person can act on. */
function friendlyAuthMessage(error: AuthError): string {
  switch (error.code) {
    case 'invalid_credentials':
      return 'Wrong email or password.'
    case 'email_not_confirmed':
      return 'Confirm your email first — check your inbox for the link.'
    case 'user_already_exists':
    case 'email_exists':
      return 'An account with this email already exists. Try signing in.'
    case 'weak_password':
      return 'That password is too weak — use at least 8 characters.'
    case 'over_request_rate_limit':
    case 'over_email_send_rate_limit':
      return 'Too many attempts — wait a minute and try again.'
    case 'validation_failed':
      return 'That sign-in method isn’t enabled yet.'
    default:
      return error.message
  }
}

function throwFriendly(error: AuthError): never {
  throw new Error(friendlyAuthMessage(error))
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  const { error } = await getSupabase().auth.signInWithPassword({ email, password })
  if (error) throwFriendly(error)
}

export type SignUpResult = 'signedIn' | 'confirmEmail'

export async function signUpWithEmail(
  fullName: string,
  email: string,
  password: string,
): Promise<SignUpResult> {
  const { data, error } = await getSupabase().auth.signUp({
    email,
    password,
    options: { data: { full_name: fullName } },
  })
  if (error) throwFriendly(error)
  // With email confirmation on, an existing account returns a fake user with
  // no identities instead of an error (anti-enumeration). Surface it honestly.
  if (data.user && (data.user.identities?.length ?? 0) === 0) {
    throw new Error('An account with this email already exists. Try signing in.')
  }
  return data.session ? 'signedIn' : 'confirmEmail'
}

export async function signInWithOAuth(provider: OAuthProvider): Promise<void> {
  const { error } = await getSupabase().auth.signInWithOAuth({
    provider,
    options: { redirectTo: `${window.location.origin}/auth/callback` },
  })
  if (error) throwFriendly(error)
}

export async function signOut(): Promise<void> {
  const { error } = await getSupabase().auth.signOut()
  if (error) throwFriendly(error)
}

export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await getSupabase().auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/auth/reset-password`,
  })
  // Rate limits should surface; "user not found" never comes back (anti-enumeration).
  if (error) throwFriendly(error)
}

export async function updatePassword(password: string): Promise<void> {
  const { error } = await getSupabase().auth.updateUser({ password })
  if (error) throwFriendly(error)
}
