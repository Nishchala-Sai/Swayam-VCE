// GET /api/events/:eventId/export: everyone registered for the event as a CSV file, for staff to open in Excel or
// Google Sheets. One row per person (team members each get their own row), cancelled registrations included so the
// payment history is complete.
import { sql } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { managedEvent } from './subEvents.controller.js'

// Excel and Sheets run a cell starting with = + - @ (or a tab/CR) as a formula; a leading ' keeps names typed by
// students as plain text
const cell = (value) => {
  const text = String(value ?? '')
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
  return `"${safe.replace(/"/g, '""')}"`
}

// 2026-11-20 10:32 in India time, which sorts correctly as text
const istTime = (date) => date.toLocaleString('sv-SE', { timeZone: 'Asia/Kolkata' }).slice(0, 16)

export async function exportAttendees(req, res) {
  const event = await managedEvent(req, res, req.params.eventId)
  if (!event) return

  const { rows } = await db.execute(sql`
    select r.id, r.payment_status, r.attended_at, u.name, u.email, u.phone, u.roll_number, u.branch, u.year
    from registrations r join users u on u.id = r.user_id
    where r.event_id = ${event.id}::uuid
    order by lower(coalesce(u.name, u.email)), u.email`)

  const lines = [
    ['Student Name', 'Email', 'Phone', 'Roll Number', 'Branch', 'Year', 'Registration Code', 'Payment Status', 'Check-in Time (IST)'],
    // The code is the start of the registration id, as the Ticket ID column in the dashboard shows it
    ...rows.map((r) => [
      r.name, r.email, r.phone, r.roll_number, r.branch, r.year,
      r.id.slice(0, 8).toUpperCase(), r.payment_status, r.attended_at ? istTime(new Date(r.attended_at)) : 'Not Attended',
    ]),
  ]
  const csv = lines.map((line) => line.map(cell).join(',')).join('\r\n')

  const name = `${event.title} attendees.csv`
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    // ASCII fallback plus the exact (UTF-8) name for browsers that read filename*
    'Content-Disposition': `attachment; filename="${name.replace(/[^\w .-]/g, '_')}"; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Cache-Control': 'no-store',
  })
  res.send('﻿' + csv) // the byte-order mark makes Excel read the file as UTF-8
}
