// Team and amount input shared by event registration and sub-event booking.
import { and, eq, inArray } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { users } from '../../db/schema.js'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const MAX_TEAMMATES = 10

// No teammateEmails → solo ({ team: null }). Otherwise { team: { name, emails } } or { error }.
export function readTeam(body, leaderEmail) {
  const { teamName, teammateEmails } = body ?? {}
  if (teammateEmails === undefined || teammateEmails === null) {
    if (teamName != null) return { error: 'teamName is only used with teammateEmails.' }
    return { team: null }
  }
  if (!Array.isArray(teammateEmails) || teammateEmails.length === 0) {
    return { error: 'teammateEmails must be a non-empty list of emails.' }
  }
  if (teammateEmails.length > MAX_TEAMMATES) return { error: `A team can have at most ${MAX_TEAMMATES} teammates.` }
  const emails = teammateEmails.map((e) => (typeof e === 'string' ? e.trim().toLowerCase() : ''))
  if (emails.some((e) => !EMAIL.test(e) || e.length > 255)) return { error: 'Every teammate email must be a valid email.' }
  if (new Set(emails).size !== emails.length) return { error: 'teammateEmails contains the same email twice.' }
  if (emails.includes(leaderEmail)) return { error: 'Do not include your own email in teammateEmails.' }
  if (typeof teamName !== 'string' || !teamName.trim() || teamName.trim().length > 100) {
    return { error: 'teamName is required for a team (up to 100 characters).' }
  }
  return { team: { name: teamName.trim(), emails } }
}

// Leader first, then teammates in the order given. Every teammate needs an active account, because every row
// belongs to a user. Returns { members: [{ userId, email, isLeader }] } or { error }.
export async function resolveMembers(leader, team) {
  const members = [{ userId: leader.id, email: leader.email, isLeader: Boolean(team) }]
  if (!team || team.emails.length === 0) return { members } // a team of one (team-competition sessions)

  const found = await db
    .select({ id: users.id, email: users.email })
    .from(users)
    .where(and(inArray(users.email, team.emails), eq(users.isActive, true)))
  const missing = team.emails.filter((e) => !found.some((u) => u.email === e))
  if (missing.length) return { error: `These teammates need to sign in to Swayam with Google once first: ${missing.join(', ')}` }
  return {
    members: members.concat(team.emails.map((e) => ({ userId: found.find((u) => u.email === e).id, email: e, isLeader: false }))),
  }
}

// totalAmountPaid is optional here; undefined/null → null. Whole rupees only.
export function readAmount(value) {
  if (value === undefined || value === null) return { amount: null }
  if (!Number.isInteger(value) || value < 0 || value > 1000000) {
    return { error: 'totalAmountPaid must be a whole number of rupees from 0 to 1000000.' }
  }
  return { amount: value }
}
