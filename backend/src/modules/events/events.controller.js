import { asc, eq, sql } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { events } from '../../db/schema.js'
import { isUuid } from '../../utils/isUuid.js'
import { isHttpsUrl } from '../../utils/isHttpsUrl.js'
import { readSchedule } from '../../utils/schedule.js'
import { isUploaded, removeUploaded } from '../uploads/uploads.controller.js'

const fail = (res, status, message) => res.status(status).json({ success: false, message })

const isText = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.trim().length <= max
const isWholeNumber = (v, min, max) => Number.isInteger(v) && v >= min && v <= max
const UPI_ID = /^(?=.{3,100}$)[\w.-]+@[a-z][a-z0-9.-]*$/i

// Returns { values } ready to insert, or { error } with a message for the admin.
// Only known fields are copied, so a client can never set id, createdBy or createdAt.
function readEvent(body) {
  const { title, description, date, location, capacity, price = 0, upiQrUrl, upiId, upiPayeeName, bannerUrl, paymentInstructions, schedule, groupSize, groupPrice, maxTeamSize } = body ?? {}

  if (!isText(title, 200)) return { error: 'title is required (up to 200 characters).' }
  if (!isText(description, 10000)) return { error: 'description is required (up to 10,000 characters).' }
  const when = typeof date === 'string' ? new Date(date) : null
  if (!when || Number.isNaN(when.getTime())) return { error: 'date must be an ISO date-time, e.g. 2026-11-20T10:00:00+05:30.' }
  if (!isText(location, 255)) return { error: 'location is required (up to 255 characters).' }
  if (!isWholeNumber(capacity, 1, 100000)) return { error: 'capacity must be a whole number from 1 to 100000.' }
  if (!isWholeNumber(price, 0, 100000)) return { error: 'price must be a whole number of rupees from 0 to 100000.' }
  // Either an image uploaded through POST /api/uploads/upi-qr, or an https link
  if (upiQrUrl != null && !isHttpsUrl(upiQrUrl) && !isUploaded('upi-qr', upiQrUrl)) {
    return { error: 'upiQrUrl must be an uploaded QR image or an https URL.' }
  }
  if (price > 0 && upiQrUrl == null) return { error: 'upiQrUrl is required for paid events.' }
  // A UPI ID (VPA) is handle@bank: letters, digits, dots, hyphens and underscores, then the bank's handle
  if (upiId != null && !(typeof upiId === 'string' && UPI_ID.test(upiId.trim()))) {
    return { error: 'upiId must be a UPI ID like swayam@okaxis (up to 100 characters).' }
  }
  if (upiPayeeName != null && !isText(upiPayeeName, 100)) return { error: 'upiPayeeName must be text up to 100 characters.' }
  // Optional; an image uploaded through POST /api/uploads/banner, or an https link
  if (bannerUrl != null && !isHttpsUrl(bannerUrl) && !isUploaded('banner', bannerUrl)) {
    return { error: 'bannerUrl must be an uploaded banner image or an https URL.' }
  }
  const offer = readGroupOffer(groupSize, groupPrice, price)
  if (offer.error) return { error: offer.error }
  if (maxTeamSize != null && !isWholeNumber(maxTeamSize, 2, 11)) {
    return { error: 'maxTeamSize must be 2 to 11 people (a leader and up to 10 teammates), or null for individual registration.' }
  }
  if (maxTeamSize != null && offer.groupSize != null && offer.groupSize > maxTeamSize) {
    return { error: `The group offer is for ${offer.groupSize} people, but teams may only have ${maxTeamSize}. Raise maxTeamSize.` }
  }
  if (paymentInstructions != null && !isText(paymentInstructions, 2000)) {
    return { error: 'paymentInstructions must be text up to 2000 characters.' }
  }
  const { schedule: days, error: scheduleError } = readSchedule(schedule)
  if (scheduleError) return { error: scheduleError }

  return {
    values: {
      title: title.trim(),
      description: description.trim(),
      date: when,
      location: location.trim(),
      capacity,
      price,
      groupSize: offer.groupSize,
      groupPrice: offer.groupPrice,
      maxTeamSize: maxTeamSize ?? null,
      upiQrUrl: upiQrUrl ?? null,
      upiId: upiId?.trim() || null,
      upiPayeeName: upiPayeeName?.trim() || null,
      bannerUrl: bannerUrl ?? null,
      paymentInstructions: paymentInstructions?.trim() ?? null,
      schedule: days,
    },
  }
}

// Group offer: both groupSize and groupPrice, or neither. A team holds at most 11 people (a leader and 10 teammates),
// and the offer must be cheaper than paying per person, otherwise it isn't an offer.
function readGroupOffer(groupSize, groupPrice, price) {
  if (groupSize == null && groupPrice == null) return { groupSize: null, groupPrice: null }
  if (groupSize == null || groupPrice == null) return { error: 'Send both groupSize and groupPrice for a group offer, or neither.' }
  if (price === 0) return { error: 'A group offer needs a paid event: the event is free.' }
  if (!isWholeNumber(groupSize, 2, 11)) return { error: 'groupSize must be a whole number from 2 to 11 (a leader and up to 10 teammates).' }
  if (!isWholeNumber(groupPrice, 1, 1000000)) return { error: 'groupPrice must be a whole number of rupees, at least 1.' }
  if (groupPrice >= price * groupSize) {
    return { error: `groupPrice must be less than ${groupSize} x ${price} = ${price * groupSize}, or it is not an offer.` }
  }
  return { groupSize, groupPrice }
}

export async function createEvent(req, res) {
  const { values, error } = readEvent(req.body)
  if (error) return fail(res, 400, error)

  const [event] = await db
    .insert(events)
    .values({ ...values, createdBy: req.user.id })
    .returning()
  res.status(201).json({ success: true, data: event })
}

// Capacity can go below the seats already taken: nobody loses a seat, but new registrations are refused and
// approvals past the new limit become REFUND_REQUIRED. The UPDATE takes the event's row lock, so it waits for any
// registration or approval that is checking seats for this event at that moment.
export async function updateCapacity(req, res) {
  if (!isUuid(req.params.id)) return fail(res, 404, 'Event not found.')
  const { capacity } = req.body ?? {}
  if (!isWholeNumber(capacity, 1, 100000)) return fail(res, 400, 'capacity must be a whole number from 1 to 100000.')

  const [event] = await db.select({ createdBy: events.createdBy }).from(events).where(eq(events.id, req.params.id)).limit(1)
  if (!event) return fail(res, 404, 'Event not found.')
  if (req.user.role !== 'ADMIN' && event.createdBy !== req.user.id) {
    return fail(res, 403, 'You can only change events you created.')
  }

  const [updated] = await db.update(events).set({ capacity }).where(eq(events.id, req.params.id)).returning()
  if (!updated) return fail(res, 404, 'Event not found.')
  res.json({ success: true, data: updated })
}

export async function getAllEvents(req, res) {
  const list = await db.select().from(events).orderBy(asc(events.date))
  res.json({ success: true, data: list })
}

// PATCH /api/events/:id: the same body as creating, every field sent again (ADMIN, or the EVENT_HEAD who created it).
// Registrations already made keep the amount they paid; new prices, team rules and the schedule apply from now on.
// Capacity may go below the seats taken, as with PATCH /:id/capacity: nobody loses a seat, new registrations wait.
// A replaced uploaded QR or banner image is deleted once no event uses it.
export async function updateEvent(req, res) {
  if (!isUuid(req.params.id)) return fail(res, 404, 'Event not found.')
  const [event] = await db.select().from(events).where(eq(events.id, req.params.id)).limit(1)
  if (!event) return fail(res, 404, 'Event not found.')
  if (req.user.role !== 'ADMIN' && event.createdBy !== req.user.id) return fail(res, 403, 'You can only edit events you created.')
  const { values, error } = readEvent(req.body)
  if (error) return fail(res, 400, error)

  const [updated] = await db.update(events).set(values).where(eq(events.id, event.id)).returning()
  if (!updated) return fail(res, 404, 'Event not found.')
  if (event.upiQrUrl && event.upiQrUrl !== updated.upiQrUrl) await removeUploaded('upi-qr', event.upiQrUrl)
  if (event.bannerUrl && event.bannerUrl !== updated.bannerUrl) await removeUploaded('banner', event.bannerUrl)
  res.json({ success: true, data: updated })
}

// DELETE /api/events/:id. The event, its sessions and everything booked for them.
// Event heads may delete their own events only while nobody has registered or booked (rejected and refunded rows
// count too: they are payment records). Admins may delete one that has registrations by sending { confirm: <title> },
// which deletes every registration, booking and payment record for it.
export async function deleteEvent(req, res) {
  if (!isUuid(req.params.id)) return fail(res, 404, 'Event not found.')
  const [event] = await db.select().from(events).where(eq(events.id, req.params.id)).limit(1)
  if (!event) return fail(res, 404, 'Event not found.')
  if (req.user.role !== 'ADMIN' && event.createdBy !== req.user.id) return fail(res, 403, 'You can only delete events you created.')

  const id = event.id
  const { rows } = await db.execute(sql`
    select (select count(*) from registrations where event_id = ${id}::uuid)::int as registrations,
      (select count(*) from sub_event_bookings b join sub_events s on s.id = b.sub_event_id where s.event_id = ${id}::uuid)::int as bookings`)
  const { registrations: regCount, bookings: bookingCount } = rows[0]
  const force = regCount + bookingCount > 0
  if (force) {
    const what = `${regCount} registration${regCount === 1 ? '' : 's'} and ${bookingCount} session booking${bookingCount === 1 ? '' : 's'}`
    if (req.user.role !== 'ADMIN') return fail(res, 409, `${event.title} has ${what}. Only an admin can delete an event people have registered for.`)
    if (req.body?.confirm !== event.title) {
      return fail(res, 409, `${event.title} has ${what}. Deleting it removes all of them and their payment records. Confirm with the exact event title.`)
    }
  }

  // Lock the event and its sessions so no registration or booking slips in while deleting. Without force, every
  // delete also requires the event to still be empty, so a registration made a moment ago is never lost.
  const empty = force
    ? sql`true`
    : sql`not exists (select 1 from registrations where event_id = ${id}::uuid)
        and not exists (select 1 from sub_event_bookings b join sub_events s on s.id = b.sub_event_id where s.event_id = ${id}::uuid)`
  const results = await db.batch([
    db.execute(sql`select id from events where id = ${id}::uuid for update`),
    db.execute(sql`select id from sub_events where event_id = ${id}::uuid for update`),
    db.execute(sql`delete from sub_event_bookings where sub_event_id in (select id from sub_events where event_id = ${id}::uuid) and ${empty}`),
    db.execute(sql`delete from registrations where event_id = ${id}::uuid and ${empty}`),
    db.execute(sql`delete from sub_events where event_id = ${id}::uuid and ${empty}`),
    db.execute(sql`delete from events where id = ${id}::uuid and ${empty} returning id`),
  ])
  if (!results.at(-1).rows.length) return fail(res, 409, 'Someone registered for this event just now, so it was not deleted.')

  // Only if no other event uses the same image
  await removeUploaded('upi-qr', event.upiQrUrl)
  await removeUploaded('banner', event.bannerUrl)
  res.json({ success: true, data: { id, title: event.title, deleted: { registrations: regCount, bookings: bookingCount } } })
}

export async function getEventById(req, res) {
  if (!isUuid(req.params.id)) return fail(res, 404, 'Event not found.')

  const [event] = await db.select().from(events).where(eq(events.id, req.params.id)).limit(1)
  if (!event) return fail(res, 404, 'Event not found.')
  res.json({ success: true, data: event })
}
