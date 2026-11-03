// Demo accounts for testing the whole platform by hand: npm run db:seed:demo
// Runs the db:seed accounts, then adds 3 event managers and 10 students. Sign in to any with npm run login-link -- <email>.
//   admin@swayam.com                                  ADMIN
//   manager1@swayam.com ... manager3@swayam.com       EVENT_HEAD
//   student1@swayam.com ... student10@swayam.com      STUDENT
// Safe to re-run (roles are reset). Refuses NODE_ENV=production unless given --force.
import { BASE_ACCOUNTS, seedAccounts } from './lib/seedAccounts.js'

const range = (n) => Array.from({ length: n }, (_, i) => i + 1)
const DEMO_ACCOUNTS = [
  ...range(3).map((i) => ({ email: `manager${i}@swayam.com`, name: `Event Manager ${i}`, role: 'EVENT_HEAD' })),
  ...range(10).map((i) => ({ email: `student${i}@swayam.com`, name: `Student ${i}`, role: 'STUDENT' })),
]

process.exit((await seedAccounts([...BASE_ACCOUNTS, ...DEMO_ACCOUNTS])) ? 0 : 1)
