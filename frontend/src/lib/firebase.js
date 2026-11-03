// "Sign in with Google" through Firebase Authentication. Firebase is only used to get a Google-verified ID token;
// the backend checks it and starts our own session, so we sign out of Firebase straight away.
// The SDK is not part of the main bundle: preloadGoogle() fetches it when the button appears, so by the time someone
// clicks, the popup opens straight from the click (browsers block popups opened after a slow await).
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

export const googleConfigured = Boolean(config.apiKey && config.authDomain && config.projectId)

let sdk = null
export function preloadGoogle() {
  sdk ??= Promise.all([import('firebase/app'), import('firebase/auth')]).catch((err) => {
    sdk = null // let the next attempt try again
    throw err
  })
  return sdk
}

// Firebase error codes worth explaining; anything else shows its code so it can be looked up
const MESSAGES = {
  'auth/popup-blocked': 'Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again.',
  'auth/unauthorized-domain': `This website's address isn't allowed for Google sign-in yet. The organisers need to add ${typeof location === 'undefined' ? 'it' : location.hostname} in Firebase (Authentication > Settings > Authorized domains).`,
  'auth/network-request-failed': "Couldn't reach Google. Check your connection, or turn off ad or tracker blocking (Brave Shields) for this site, and try again.",
  'auth/web-storage-unsupported': 'Your browser is blocking the storage Google sign-in needs. Allow cookies for this site (in Brave, turn Shields off for it) and try again.',
  'auth/internal-error': 'Google sign-in was interrupted, often by a privacy setting or extension. Allow cookies and pop-ups for this site (in Brave, turn Shields off for it) and try again.',
  'auth/operation-not-allowed': 'Google sign-in is switched off in the Firebase project. The organisers need to enable it.',
  'auth/invalid-api-key': 'The website has the wrong Firebase settings. The organisers need to check VITE_FIREBASE_API_KEY.',
}

// Resolves to an ID token, or null if the user closed the popup
export async function getGoogleIdToken() {
  const [{ initializeApp, getApps }, { getAuth, GoogleAuthProvider, signInWithPopup, signOut }] = await preloadGoogle()
  const app = getApps()[0] ?? initializeApp(config)
  const auth = getAuth(app)
  try {
    const result = await signInWithPopup(auth, new GoogleAuthProvider())
    const token = await result.user.getIdToken()
    signOut(auth).catch(() => {})
    return token
  } catch (err) {
    if (err?.code === 'auth/popup-closed-by-user' || err?.code === 'auth/cancelled-popup-request') return null
    console.error('Google sign-in failed:', err?.code, err?.message)
    throw new Error(MESSAGES[err?.code] ?? `Google sign-in did not complete (${err?.code ?? 'unknown error'}). Please try again.`)
  }
}
