// Password reset by emailed link (Brevo SMTP). Without the Brevo SMTP login the email is printed in the server terminal.
//
// The link carries a random 32-byte token; only its SHA-256 is stored, with a 30-minute expiry. Using a token deletes
// it in the same statement that changes the password, so each link works once. Requesting a new link deletes the
// user's older ones.
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { eq, sql } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { passwordResetTokens, users } from '../../db/schema.js'
import { verifyTurnstile } from '../../utils/verifyTurnstile.js'
import { frontendUrl, sendEmail } from '../../utils/email.js'
import { BCRYPT_COST } from './auth.controller.js'

const fail = (res, status, message) => res.status(status).json({ success: false, message })
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const TOKEN_MINUTES = 30
const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex')

// Body: { email, turnstileToken }. Always answers the same way, so it can't be used to find out which emails have
// accounts. Deactivated accounts get no link.
export async function forgotPassword(req, res) {
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : ''
  if (!EMAIL.test(email) || email.length > 255) return fail(res, 400, 'Enter a valid email address.')
  if (!(await verifyTurnstile(req.body?.turnstileToken, req.ip))) {
    return fail(res, 403, 'CAPTCHA verification failed. Are you a bot?')
  }

  const [user] = await db.select({ id: users.id, name: users.name, isActive: users.isActive }).from(users).where(eq(users.email, email)).limit(1)
  if (user?.isActive) {
    const token = crypto.randomBytes(32).toString('base64url')
    await db.batch([
      db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, user.id)),
      db.insert(passwordResetTokens).values({
        userId: user.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + TOKEN_MINUTES * 60 * 1000),
      }),
    ])
    // Not awaited: the reply takes the same time whether or not the account exists
    void sendEmail({
      to: email,
      subject: 'Reset your Swayam password',
      heading: 'Reset your password',
      lines: [
        `Hi ${user.name?.split(' ')[0] || 'there'},`,
        `Someone (hopefully you) asked to reset the password for your Swayam account. The link works once and expires in ${TOKEN_MINUTES} minutes.`,
      ],
      button: { label: 'Choose a new password', url: `${frontendUrl()}/reset-password?token=${token}` },
      footer: "If you didn't ask for this, ignore this email; your password stays the same.",
    })
  }

  res.json({ success: true, message: 'If an account exists for that email, a password reset link has been sent.' })
}

// Body: { token, password }. Same password rules as signup.
export async function resetPassword(req, res) {
  const { token, password } = req.body ?? {}
  if (typeof token !== 'string' || token.length < 20 || token.length > 200) {
    return fail(res, 400, 'This reset link is invalid. Request a new one.')
  }
  if (typeof password !== 'string' || password.length < 8 || Buffer.byteLength(password) > 72) {
    return fail(res, 400, 'Choose a password of 8 to 72 characters.')
  }

  const passwordHash = await bcrypt.hash(password, BCRYPT_COST)
  // Consume the token and change the password in one statement: a link can't be used twice, even at the same moment
  const { rows } = await db.execute(sql`
    with used as (
      delete from password_reset_tokens
      where token_hash = ${sha256(token)} and expires_at > now()
      returning user_id
    )
    update users set password_hash = ${passwordHash}
    from used where users.id = used.user_id
    returning users.id`)
  if (!rows.length) return fail(res, 400, 'This reset link is invalid or has expired. Request a new one.')

  // Any other outstanding links for this user are now pointless
  await db.delete(passwordResetTokens).where(eq(passwordResetTokens.userId, rows[0].id))
  res.json({ success: true, message: 'Your password has been changed. You can now log in.' })
}
