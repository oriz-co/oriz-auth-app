// Firebase client SDK init — auth-only, no Firestore here.
// Cookie sync at .oriz.in domain so every subdomain can read the ID token.
import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import {
  getAuth,
  onAuthStateChanged,
  browserLocalPersistence,
  setPersistence,
  type Auth,
  type User,
} from 'firebase/auth'

const config = {
  apiKey: import.meta.env.PUBLIC_FIREBASE_API_KEY,
  authDomain: import.meta.env.PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.PUBLIC_FIREBASE_APP_ID,
}

let app: FirebaseApp
let auth: Auth

export function getFirebase(): { app: FirebaseApp; auth: Auth } {
  if (!app) {
    app = getApps()[0] ?? initializeApp(config)
    auth = getAuth(app)
    // Persistent across tabs + reloads
    setPersistence(auth, browserLocalPersistence).catch(() => {})
  }
  return { app, auth }
}

// Sync the Firebase auth state into a cookie at .oriz.in so every subdomain
// can read it (chrome / SSR / CF Pages Functions). We write a JSON blob with
// the subset of fields the @chirag127/astro-shell `auth-gate` helpers expect
// (displayName / email / photoURL / uid / exp). Firebase SDK refreshes the
// underlying ID token automatically; we re-sync on every onIdTokenChanged so
// `exp` stays fresh and avatar updates propagate.
export function startCookieSync(): () => void {
  const { auth } = getFirebase()
  const unsub = onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      // Build the JSON payload @chirag127/astro-shell/auth-gate expects.
      // exp = unix seconds, ~1h matches Firebase ID-token TTL.
      const payload = {
        uid: user.uid,
        email: user.email ?? undefined,
        displayName: user.displayName ?? undefined,
        photoURL: user.photoURL ?? undefined,
        exp: Math.floor(Date.now() / 1000) + 3600,
      }
      const value = encodeURIComponent(JSON.stringify(payload))
      document.cookie = [
        `oriz_auth=${value}`,
        'Domain=.oriz.in',
        'Path=/',
        'Max-Age=3600',
        'Secure',
        'SameSite=Lax',
      ].join('; ')
    } else {
      document.cookie = 'oriz_auth=; Domain=.oriz.in; Path=/; Max-Age=0'
    }
  })
  return unsub
}

// Safe-redirect: only return-URLs on oriz.in (or localhost during dev) are honoured.
export function safeReturnURL(raw: string | null | undefined): string {
  if (!raw) return '/account'
  try {
    const url = new URL(raw, window.location.origin)
    const host = url.hostname
    if (
      host === 'oriz.in' ||
      host.endsWith('.oriz.in') ||
      host === 'localhost' ||
      host === '127.0.0.1'
    ) {
      return url.toString()
    }
  } catch {
    /* fallthrough */
  }
  return '/account'
}
