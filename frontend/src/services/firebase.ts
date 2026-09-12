import { type FirebaseApp, initializeApp } from 'firebase/app'
import { type Auth, getAuth } from 'firebase/auth'
import {
  type Firestore,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
} from 'firebase/firestore'

/**
 * Firebase web config, in the source rather than in env vars.
 *
 * None of this is secret. `apiKey` identifies the project and routes API calls;
 * it is not a credential, and every Firebase web app on the internet ships
 * these values in its bundle. A build-time env var would put the exact same
 * strings in `dist/` while adding a way for a deploy to boot half-configured,
 * so the config lives here where it can be read and reviewed.
 *
 * What actually protects the data is `firestore.rules`, the Authentication →
 * Settings → Authorized domains list, and an HTTP-referrer restriction on the
 * API key in the Google Cloud console.
 *
 * Console → Project settings → General → Your apps → Web app → SDK setup.
 */
const firebaseConfig = {
  apiKey: 'AIzaSyDuiJspd4mlHXFs86fvDFysLaqKMam7GSY',
  // Serves the OAuth handler at /__/auth/handler. GitHub Pages cannot serve
  // that path, so it stays on firebaseapp.com — which is a different *site*
  // from my.splitpocket.app, and browsers partition storage by site. That
  // makes redirect sign-in unreliable and popup sign-in fragile.
  //
  // The fix is to attach auth.splitpocket.app to Firebase Hosting (which
  // serves the handler on any domain it answers for) and switch this to
  // 'auth.splitpocket.app'. Same registrable domain as the app, so the
  // browser treats it as first-party. Do not switch it before that subdomain
  // is verified and serving, or sign-in stops entirely.
  authDomain: 'splitpocket-806a1.firebaseapp.com',
  projectId: 'splitpocket-806a1',
  storageBucket: 'splitpocket-806a1.firebasestorage.app',
  messagingSenderId: '83638354155',
  appId: '1:83638354155:web:e2e210f252cf20a104beae',
  measurementId: 'G-M1F454KMT0',
} as const

let app: FirebaseApp | null = null
let db: Firestore | null = null

/** Lazy singleton — nothing connects until something actually reads data. */
export function getFirebaseApp(): FirebaseApp {
  app ??= initializeApp(firebaseConfig)
  return app
}

export function getFirebaseAuth(): Auth {
  return getAuth(getFirebaseApp())
}

/**
 * Firestore with persistent local caching — this is what replaced the
 * hand-rolled IndexedDB cache and outbox. Reads are served from disk when
 * offline and writes queue and replay on their own, for group data as well as
 * personal, which the old outbox never covered.
 *
 * Must go through initializeFirestore (not getFirestore) because the cache is
 * settable only at construction, and only once per app.
 */
export function getDb(): Firestore {
  if (db) return db
  db = initializeFirestore(getFirebaseApp(), {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  })
  return db
}
