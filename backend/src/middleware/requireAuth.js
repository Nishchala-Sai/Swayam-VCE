// Reads the JWT from the httpOnly `token` cookie, then loads the user from the database on every request,
// so a suspension (isActive = false) or role change takes effect immediately instead of when the token expires.
// The token payload is { sub: <user id> }. Requires cookie-parser to be mounted before this middleware.
import jwt from 'jsonwebtoken'
import { eq } from 'drizzle-orm'
import { db } from '../db/index.js'
import { users } from '../db/schema.js'
import { isUuid } from '../utils/isUuid.js'

const unauthorized = (res) => res.status(401).json({ success: false, message: 'Unauthorized' })

export async function requireAuth(req, res, next) {
  const token = req.cookies?.token
  if (!token) return unauthorized(res)

  let payload
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'] })
  } catch {
    return unauthorized(res) // expired, malformed or wrong signature
  }
  // Session tokens have no audience; anything with one (a login-link token) is not a session
  if (!isUuid(payload.sub) || payload.aud !== undefined) return unauthorized(res)

  try {
    const [user] = await db
      .select({ id: users.id, email: users.email, name: users.name, role: users.role, isActive: users.isActive, createdAt: users.createdAt })
      .from(users)
      .where(eq(users.id, payload.sub))
      .limit(1)
    if (!user || !user.isActive) return unauthorized(res)
    req.user = user // never includes passwordHash
    next()
  } catch (err) {
    next(err) // database outage is a 500, not a 401, so the frontend does not log the user out
  }
}
