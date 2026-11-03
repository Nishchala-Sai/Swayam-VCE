// The student details staff need (to reach people on WhatsApp and to know who is who): phone, roll number, branch and
// year. All are required before registering for anything; the site asks for them right after the first sign-in.
import { users } from '../../db/schema.js'

// The user fields the API hands out (never the unused password_hash)
export const userColumns = {
  id: users.id,
  email: users.email,
  name: users.name,
  phone: users.phone,
  rollNumber: users.rollNumber,
  branch: users.branch,
  year: users.year,
  role: users.role,
  isActive: users.isActive,
  createdAt: users.createdAt,
}

export const isProfileComplete = (u) => Boolean(u.name && u.phone && u.rollNumber && u.branch && u.year)
export const withProfileFlag = (u) => ({ ...u, profileComplete: isProfileComplete(u) })

// The college's branches, exactly as stored and shown. Must match BRANCHES in frontend/src/lib/profile.js.
export const BRANCHES = ['CSE', 'CSE (AIML)', 'IT', 'ECE', 'EEE', 'Mechanical', 'Civil']

export const PROFILE_REQUIRED = 'Complete your profile (name, phone, roll number, branch and year) before registering.'

// An Indian mobile number in any usual spelling (+91 98765 43210, 098765-43210) → 9876543210, or null
export function normalisePhone(value) {
  if (typeof value !== 'string') return null
  let digits = value.replace(/[\s().-]/g, '')
  if (digits.startsWith('+')) digits = digits.slice(1)
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  return /^[6-9]\d{9}$/.test(digits) ? digits : null
}

// Body: any of { name, phone, rollNumber, branch, year }. Returns { values } with the cleaned fields given, or { error }.
export function readProfile(body) {
  const { name, phone, rollNumber, branch, year } = body ?? {}
  const values = {}
  if (name !== undefined) {
    const n = typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : ''
    if (!n || n.length > 100) return { error: 'Enter your name (up to 100 characters).' }
    values.name = n
  }
  if (phone !== undefined) {
    values.phone = normalisePhone(phone)
    if (!values.phone) return { error: 'Enter a 10-digit Indian mobile number.' }
  }
  if (rollNumber !== undefined) {
    const r = typeof rollNumber === 'string' ? rollNumber.trim().toUpperCase().replace(/\s+/g, ' ') : ''
    if (!/^[A-Z0-9][A-Z0-9 /-]{2,29}$/.test(r)) return { error: 'Enter your roll number (3 to 30 letters, digits or dashes).' }
    values.rollNumber = r
  }
  if (branch !== undefined) {
    const b = typeof branch === 'string' ? branch.trim().replace(/\s+/g, ' ').toLowerCase() : ''
    values.branch = BRANCHES.find((x) => x.toLowerCase() === b)
    if (!values.branch) return { error: `Branch must be one of: ${BRANCHES.join(', ')}.` }
  }
  if (year !== undefined) {
    if (!Number.isInteger(year) || year < 1 || year > 4) return { error: 'Year must be 1, 2, 3 or 4.' }
    values.year = year
  }
  if (!Object.keys(values).length) return { error: 'Send at least one of name, phone, rollNumber, branch or year.' }
  return { values }
}
