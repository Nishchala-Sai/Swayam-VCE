// Prints a 10-minute sign-in link for an existing, active account, for when Google sign-in is unavailable and for
// signing in to seeded accounts during local development:
//   npm run login-link -- admin@example.com
// On Render, run it from the service's Shell tab; the link points at FRONTEND_URL. See src/modules/auth/loginLink.controller.js.
// Exits through process.exitCode, not process.exit(), which can crash Node on Windows while a request is closing.
import 'dotenv/config'
import { eq } from 'drizzle-orm'
import { db } from '../src/db/index.js'
import { users } from '../src/db/schema.js'
import { createLoginLink } from '../src/modules/auth/loginLink.controller.js'

const email = process.argv[2]?.trim().toLowerCase()
if (!email) {
  console.error('Usage: npm run login-link -- <email>')
  process.exitCode = 1
} else {
  const [user] = await db.select({ id: users.id, role: users.role, isActive: users.isActive }).from(users).where(eq(users.email, email)).limit(1)
  if (!user) {
    console.error(`No account for ${email}. The person signs in with Google once to create it.`)
    process.exitCode = 1
  } else if (!user.isActive) {
    console.error(`${email} is deactivated. Reactivate it first: update users set is_active = true where email = '${email}';`)
    process.exitCode = 1
  } else {
    console.log(`Sign-in link for ${email} (${user.role}), valid for 10 minutes:\n\n${createLoginLink(user.id)}\n`)
  }
}
