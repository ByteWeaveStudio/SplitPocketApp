import { FirebaseError } from 'firebase/app'
import {
  GoogleAuthProvider,
  OAuthProvider as FirebaseOAuthProvider,
  type User,
  createUserWithEmailAndPassword,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  confirmPasswordReset as firebaseConfirmPasswordReset,
  signOut as firebaseSignOut,
  updatePassword as firebaseUpdatePassword,
  updateProfile,
  verifyPasswordResetCode,
} from 'firebase/auth'
import { doc, serverTimestamp, setDoc } from 'firebase/firestore'

import { getDb, getFirebaseAuth } from '@/services/firebase'
import type { SessionUser } from '@/stores/auth-store'

export type OAuthProvider = 'google' | 'apple'

export function toSessionUser(user: User): SessionUser {
  return {
    id: user.uid,
    email: user.email ?? '',
    fullName: user.displayName,
    avatarUrl: user.photoURL,
  }
}

/** Maps Firebase auth errors to copy a person can act on. */
function friendlyAuthMessage(error: FirebaseError): string {
  switch (error.code) {
    case 'auth/invalid-credential':
    case 'auth/wrong-password':
    case 'auth/user-not-found':
      return 'Wrong email or password.'
    case 'auth/invalid-email':
      return 'That doesn’t look like an email address.'
    case 'auth/email-already-in-use':
      return 'An account with this email already exists. Try signing in.'
    case 'auth/weak-password':
      return 'That password is too weak — use at least 8 characters.'
    case 'auth/too-many-requests':
      return 'Too many attempts — wait a minute and try again.'
    case 'auth/user-disabled':
      return 'This account has been disabled.'
    case 'auth/operation-not-allowed':
      return 'That sign-in method isn’t enabled yet.'
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'Sign-in was cancelled.'
    case 'auth/popup-blocked':
      return 'Your browser blocked the sign-in window. Allow pop-ups and try again.'
    case 'auth/invalid-action-code':
    case 'auth/expired-action-code':
      return 'This link has expired or was already used. Request a new one.'
    case 'auth/requires-recent-login':
      return 'For security, sign in again before changing your password.'
    case 'auth/network-request-failed':
      return 'Couldn’t reach the server — check your connection.'
    default:
      return error.message
  }
}

function throwFriendly(error: unknown): never {
  if (error instanceof FirebaseError) throw new Error(friendlyAuthMessage(error))
  throw error
}

/**
 * Creates or refreshes the caller's own profile document.
 *
 * Postgres did this with an `on_auth_user_created` trigger. There is no server
 * here, so it runs on the client — and from the auth listener rather than only
 * the sign-up path, otherwise anyone arriving through Google or Apple would
 * never get a profile at all. `merge` keeps it idempotent across every sign-in.
 */
export async function ensureProfile(user: User): Promise<void> {
  await setDoc(
    doc(getDb(), 'profiles', user.uid),
    {
      email: user.email ?? '',
      fullName: user.displayName,
      avatarUrl: user.photoURL,
      updatedAt: serverTimestamp(),
      createdAt: serverTimestamp(),
    },
    { merge: true },
  )
}

export async function signInWithEmail(email: string, password: string): Promise<void> {
  try {
    await signInWithEmailAndPassword(getFirebaseAuth(), email, password)
  } catch (error) {
    throwFriendly(error)
  }
}

export type SignUpResult = 'signedIn' | 'confirmEmail'

export async function signUpWithEmail(
  fullName: string,
  email: string,
  password: string,
): Promise<SignUpResult> {
  try {
    const { user } = await createUserWithEmailAndPassword(getFirebaseAuth(), email, password)
    await updateProfile(user, { displayName: fullName })
    await ensureProfile(user)
    // Firebase signs the account in immediately; there is no "confirm your
    // email before you may use this" gate the way Supabase had one. The
    // 'confirmEmail' arm stays in the type so the sign-up page keeps compiling.
    return 'signedIn'
  } catch (error) {
    throwFriendly(error)
  }
}

export async function signInWithOAuth(provider: OAuthProvider): Promise<void> {
  const authProvider =
    provider === 'google' ? new GoogleAuthProvider() : new FirebaseOAuthProvider('apple.com')
  if (provider === 'apple') authProvider.addScope('email')
  try {
    await signInWithPopup(getFirebaseAuth(), authProvider)
  } catch (error) {
    // Pop-ups are unavailable inside the Capacitor webviews, so fall back to a
    // full-page redirect rather than dead-ending the only sign-in some people
    // use. Redirect never resolves — the page navigates away.
    //
    // Caveat: redirect sign-in only works reliably when the app and the OAuth
    // handler are the same *site*. On GitHub Pages the handler stays on
    // firebaseapp.com, which is cross-site, so this fallback is a best effort.
    // The fix is serving the handler from auth.splitpocket.app — see the
    // README's "OAuth and the auth handler" section.
    if (
      error instanceof FirebaseError &&
      (error.code === 'auth/popup-blocked' ||
        error.code === 'auth/operation-not-supported-in-this-environment')
    ) {
      await signInWithRedirect(getFirebaseAuth(), authProvider)
      return
    }
    throwFriendly(error)
  }
}

export async function signOut(): Promise<void> {
  try {
    await firebaseSignOut(getFirebaseAuth())
  } catch (error) {
    throwFriendly(error)
  }
}

export async function requestPasswordReset(email: string): Promise<void> {
  try {
    await sendPasswordResetEmail(getFirebaseAuth(), email, {
      url: `${window.location.origin}/auth/sign-in`,
    })
  } catch (error) {
    // Firebase reports an unknown address; Supabase deliberately did not.
    // Keep the anti-enumeration behaviour the copy already promises.
    if (error instanceof FirebaseError && error.code === 'auth/user-not-found') return
    throwFriendly(error)
  }
}

/**
 * Validates the `oobCode` carried by a password-reset link and returns the
 * address it belongs to. Firebase hosts a reset page of its own by default;
 * these two functions are what /auth/reset-password needs when the project is
 * configured with a custom action URL instead.
 */
export async function verifyResetCode(code: string): Promise<string> {
  try {
    return await verifyPasswordResetCode(getFirebaseAuth(), code)
  } catch (error) {
    throwFriendly(error)
  }
}

export async function confirmPasswordReset(code: string, password: string): Promise<void> {
  try {
    await firebaseConfirmPasswordReset(getFirebaseAuth(), code, password)
  } catch (error) {
    throwFriendly(error)
  }
}

export async function updatePassword(password: string): Promise<void> {
  const user = getFirebaseAuth().currentUser
  if (!user) throw new Error('You need to be signed in.')
  try {
    await firebaseUpdatePassword(user, password)
  } catch (error) {
    throwFriendly(error)
  }
}
