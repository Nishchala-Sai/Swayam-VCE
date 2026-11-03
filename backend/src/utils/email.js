// Email through Brevo's SMTP relay (smtp-relay.brevo.com:587, STARTTLS) with nodemailer. With BREVO_SMTP_USER or
// BREVO_SMTP_PASS unset (local development) nothing is sent and the message is printed in the terminal instead, so
// links such as password resets still work while testing.
// Brevo > SMTP & API > SMTP: the login is BREVO_SMTP_USER, an SMTP key is BREVO_SMTP_PASS. EMAIL_FROM is the sender,
// e.g. "Swayam E-Cell <noreply@your-domain>", and must be a sender or domain verified in Brevo.
//
// sendEmail never throws: callers fire and forget, and a mail failure must not fail the request that caused it.
import nodemailer from 'nodemailer'

const RESERVED = /@[^@]+\.(invalid|test|example|localhost)$/i // test addresses that can never receive mail

const escape = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])

// One pooled connection to Brevo, made on the first email
let transport = null
const smtp = () =>
  (transport ??= nodemailer.createTransport({
    host: 'smtp-relay.brevo.com',
    port: 587,
    secure: false, // upgraded with STARTTLS; requireTLS refuses to send in the clear
    requireTLS: true,
    pool: true,
    auth: { user: process.env.BREVO_SMTP_USER, pass: process.env.BREVO_SMTP_PASS },
  }))

export const frontendUrl = () =>
  (process.env.FRONTEND_URL || (process.env.CORS_ORIGIN || 'http://localhost:5173').split(',')[0]).replace(/\/+$/, '')

// { to, subject, heading, lines: [text], button?: { label, url }, footer? } → a plain, on-brand message (HTML + text)
export async function sendEmail({ to, subject, heading, lines, button, footer }) {
  if (!to) return
  const text = [heading, '', ...lines, ...(button ? ['', `${button.label}: ${button.url}`] : []), ...(footer ? ['', footer] : [])].join('\n')
  if (!process.env.BREVO_SMTP_USER || !process.env.BREVO_SMTP_PASS) {
    console.log(`[email not sent: BREVO_SMTP_USER/BREVO_SMTP_PASS unset] to ${to}: ${subject}\n${text}\n`)
    return
  }
  if (RESERVED.test(to)) return
  const html = `<!doctype html><html><body style="margin:0;background:#000;font-family:Arial,Helvetica,sans-serif;color:#f4f4f2">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#000;padding:32px 16px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#0a0a0a;border:1px solid #262626;border-radius:14px;padding:28px">
<tr><td style="font-size:20px;font-weight:700;padding-bottom:4px">Swayam <span style="color:#8c8c8c;font-weight:400;font-size:14px">E-Cell</span></td></tr>
<tr><td style="font-size:22px;font-weight:700;padding:16px 0 8px">${escape(heading)}</td></tr>
${lines.map((l) => `<tr><td style="font-size:15px;line-height:1.6;color:#cfcfcc;padding-bottom:10px">${escape(l)}</td></tr>`).join('')}
${button ? `<tr><td style="padding:14px 0 6px"><a href="${escape(button.url)}" style="display:inline-block;background:#ff9f1c;color:#000;font-weight:700;text-decoration:none;padding:12px 22px;border-radius:999px">${escape(button.label)}</a></td></tr>` : ''}
${footer ? `<tr><td style="font-size:12px;line-height:1.5;color:#8c8c8c;padding-top:18px">${escape(footer)}</td></tr>` : ''}
</table></td></tr></table></body></html>`

  if (!process.env.EMAIL_FROM) {
    console.error(`[email] EMAIL_FROM is unset, so the message to ${to} was not sent`)
    return
  }
  try {
    await smtp().sendMail({ from: process.env.EMAIL_FROM, to, subject, html, text })
  } catch (err) {
    console.error(`[email] Brevo did not accept the message to ${to}:`, err?.message ?? err)
  }
}
