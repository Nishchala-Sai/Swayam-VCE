// "Sign in with Google": the browser signs in with Firebase Authentication (Google provider) and sends us the Firebase
// ID token. We verify it with the Firebase Admin SDK, find or create the user, and issue our own JWT cookie, exactly
// as /login does. Firebase is used only to prove who the user is; sessions, roles and data stay in our API and Neon.
//
// Verifying ID tokens needs only the project id (Google's public signing keys are fetched by the SDK), so no
// service-account key is required. Without FIREBASE_PROJECT_ID the endpoint answers 503 and nothing else changes.
import { eq } from 'drizzle-orm'
import { initializeApp, getApps } from 'firebase-admin/app'
import { getAuth } from 'firebase-admin/auth'
import { db } from '../../db/index.js'
import { users } from '../../db/schema.js'
import { publicUser, setAuthCookie } from './auth.controller.js'

const fail = (res, status, message) => res.status(status).json({ success: false, message })

let firebaseAuth
function getFirebaseAuth() {
  if (!process.env.FIREBASE_PROJECT_ID) return null
  if (!firebaseAuth) {
    const app = getApps()[0] ?? initializeApp({ projectId: process.env.FIREBASE_PROJECT_ID })
    firebaseAuth = getAuth(app)
  }
  return firebaseAuth
}

// Body: { idToken }. Accounts are matched by email, so accounts made before sign-in became Google-only (they had a
// password) are reached by signing in with Google on the same address.
export async function googleLogin(req, res) {
  const auth = getFirebaseAuth()
  if (!auth) return fail(res, 503, 'Google sign-in is not configured on this server.')

  const { idToken } = req.body ?? {}
  if (typeof idToken !== 'string' || !idToken || idToken.length > 4096) return fail(res, 400, 'idToken is required.')

  let decoded
  try {
    decoded = await auth.verifyIdToken(idToken)
  } catch (err) {
    // Logged without the token. auth/argument-error with "aud" usually means FIREBASE_PROJECT_ID doesn't match the frontend's
    console.warn(`[google sign-in rejected] ${err.code ?? 'error'}: ${err.message}`)
    return fail(res, 401, 'Google sign-in failed. Please try again.') // expired, forged, or for another project
  }
  if (decoded.firebase?.sign_in_provider !== 'google.com') return fail(res, 401, 'Use a Google account to sign in here.')
  if (!decoded.email || decoded.email_verified !== true) return fail(res, 401, 'Your Google account email is not verified.')

  const email = decoded.email.trim().toLowerCase()
  const name = typeof decoded.name === 'string' ? decoded.name.trim().slice(0, 100) || null : null

  await db.insert(users).values({ email, name }).onConflictDoNothing({ target: users.email })

  const [user] = await db.select().from(users).where(eq(users.email, email)).limit(1)
  if (!user || !user.isActive) return fail(res, 401, 'This account cannot sign in. Contact the organisers.')
  if (!user.name && name) await db.update(users).set({ name }).where(eq(users.id, user.id))

  setAuthCookie(res, user.id)
  res.json({ success: true, data: { ...publicUser(user), name: user.name ?? name } })
}
