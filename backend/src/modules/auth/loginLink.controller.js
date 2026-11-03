// Emergency sign-in without Google, for when Google or Firebase is down or for local development:
//   npm run login-link -- admin@example.com      (on Render: the service's Shell tab)
// prints a link that signs that account in. Only someone who can run commands on the server (and so already has
// JWT_SECRET) can make one. The link expires after 10 minutes; opening it sets the normal session cookie.
//
// Link tokens carry aud 'login-link', and requireAuth refuses any token with an audience, so a link token can't be
// used as a session cookie directly.
import jwt from 'jsonwebtoken'
import { eq } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { users } from '../../db/schema.js'
import { frontendUrl } from '../../utils/frontendUrl.js'
import { isUuid } from '../../utils/isUuid.js'
import { setAuthCookie } from './auth.controller.js'

const AUDIENCE = 'login-link'

export function createLoginLink(userId) {
  const token = jwt.sign({ sub: userId }, process.env.JWT_SECRET, { algorithm: 'HS256', audience: AUDIENCE, expiresIn: '10m' })
  return `${frontendUrl()}/api/auth/link?token=${token}`
}

// GET /api/auth/link?token=... A browser navigation, so it answers with redirects rather than JSON
export async function useLoginLink(req, res) {
  const failed = () => res.redirect(`${frontendUrl()}/login?link=invalid`)
  let payload
  try {
    payload = jwt.verify(String(req.query.token ?? ''), process.env.JWT_SECRET, { algorithms: ['HS256'], audience: AUDIENCE })
  } catch {
    return failed() // expired, malformed or wrong signature
  }
  if (!isUuid(payload.sub)) return failed()

  const [user] = await db.select({ id: users.id, email: users.email, isActive: users.isActive }).from(users).where(eq(users.id, payload.sub)).limit(1)
  if (!user || !user.isActive) return failed()

  console.log(`[login link used] ${user.email}`)
  setAuthCookie(res, user.id)
  res.redirect(`${frontendUrl()}/dashboard`)
}
