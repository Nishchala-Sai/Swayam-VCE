import { eq } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { users } from '../../db/schema.js'
import { readProfile, userColumns, withProfileFlag } from './profile.js'

// Body: any of { name, phone, rollNumber, branch, year } (see profile.js). Updates only the fields sent.
export async function updateMe(req, res) {
  const { values, error } = readProfile(req.body)
  if (error) return res.status(400).json({ success: false, message: error })

  const [user] = await db.update(users).set(values).where(eq(users.id, req.user.id)).returning(userColumns)
  res.json({ success: true, data: withProfileFlag(user) })
}
