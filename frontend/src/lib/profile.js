// Student details required before registering. The same rules as backend/src/modules/auth/profile.js, checked here
// first so mistakes show next to the field.

// The college's branches, exactly as the API accepts them (BRANCHES in backend/src/modules/auth/profile.js)
export const BRANCHES = ['CSE', 'CSE (AIML)', 'IT', 'ECE', 'EEE', 'Mechanical', 'Civil']
export const YEARS = [1, 2, 3, 4]
export const yearLabel = (y) => ['', '1st year', '2nd year', '3rd year', '4th year'][y] ?? ''

// +91 98765 43210, 098765-43210 → 9876543210, or null
export function normalisePhone(value) {
  let digits = String(value ?? '').replace(/[\s().-]/g, '')
  if (digits.startsWith('+')) digits = digits.slice(1)
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  return /^[6-9]\d{9}$/.test(digits) ? digits : null
}

export const formatPhone = (p) => (p ? `+91 ${p.slice(0, 5)} ${p.slice(5)}` : '')

// { name, phone, rollNumber, branch, year } as typed → { body } ready for PATCH /api/auth/me, or { errors: { field } }
export function readProfileForm(f) {
  const errors = {}
  const name = f.name.trim().replace(/\s+/g, ' ')
  if (!name || name.length > 100) errors.name = 'Enter your full name.'
  const phone = normalisePhone(f.phone)
  if (!phone) errors.phone = 'Enter a 10-digit Indian mobile number.'
  const rollNumber = f.rollNumber.trim().toUpperCase().replace(/\s+/g, ' ')
  if (!/^[A-Z0-9][A-Z0-9 /-]{2,29}$/.test(rollNumber)) errors.rollNumber = 'Enter your roll number, e.g. 1602-23-733-042.'
  const branch = f.branch
  if (!BRANCHES.includes(branch)) errors.branch = 'Choose your branch.'
  const year = Number(f.year)
  if (!YEARS.includes(year)) errors.year = 'Choose your year.'
  return Object.keys(errors).length ? { errors } : { body: { name, phone, rollNumber, branch, year } }
}
