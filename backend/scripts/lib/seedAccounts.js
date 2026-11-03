// Shared by the seed scripts: creates accounts (or resets their role and reactivates them), then reads them back.
// Sign-in is Google-only; to sign in to a seeded account locally, print a link with npm run login-link -- <email>.
// Refuses to run with NODE_ENV=production unless the script is given --force.
import 'dotenv/config'
import { inArray, sql } from 'drizzle-orm'
import { db } from '../../src/db/index.js'
import { users } from '../../src/db/schema.js'

// The accounts db:seed has always created; seed-demo.js adds more on top
export const BASE_ACCOUNTS = [
  { email: 'admin@swayam.com', name: 'Swayam Admin', role: 'ADMIN' },
  { email: 'manager@swayam.com', name: 'Event Manager', role: 'EVENT_HEAD' },
  { email: 'student@swayam.com', name: 'Test Student', role: 'STUDENT' },
]

// accounts: [{ email, name, role }]. Returns true when every account was saved with its role.
export async function seedAccounts(accounts) {
  if (process.env.NODE_ENV === 'production' && !process.argv.includes('--force')) {
    console.error('NODE_ENV is production: refusing to create test accounts. Pass --force to override.')
    return false
  }

  // Made-up student details, so seeded accounts can register without filling in /welcome
  const withProfile = accounts.map((a, i) => ({ phone: `90000${String(i + 1).padStart(5, '0')}`, rollNumber: `DEMO-${i + 1}`, branch: 'CSE', year: 2, ...a }))
  await db
    .insert(users)
    .values(withProfile)
    .onConflictDoUpdate({ target: users.email, set: { role: sql`excluded.role`, isActive: true } })

  const saved = await db.select().from(users).where(inArray(users.email, accounts.map((a) => a.email)))
  let ok = true
  for (const { email, role } of accounts) {
    const row = saved.find((u) => u.email === email)
    const works = row && row.role === role && row.isActive
    if (!works) ok = false
    console.log(`${works ? 'ok  ' : 'FAIL'} ${email.padEnd(24)} ${role}`)
  }
  console.log(ok ? `\nAll ${accounts.length} accounts saved. Sign in to one with: npm run login-link -- <email>` : '\nSome accounts did not save correctly.')
  return ok
}
