import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { events, registrations } from '../../db/schema.js'
import { camelRow } from '../../db/fragments.js'
import { isUuid } from '../../utils/isUuid.js'
import { generateTicket, generateStandaloneTicket } from '../../utils/generateTicket.js'
import { readTeam, resolveMembers, readAmount } from './team.js'
import { PROFILE_REQUIRED } from '../auth/profile.js'

const fail = (res, status, message) => res.status(status).json({ success: false, message })

export const withTicket = (r) =>
  r.status === 'CONFIRMED' && r.paymentStatus === 'VERIFIED' ? { ...r, ticket: generateTicket(r.id) } : r

// Body is optional: {} registers just the current user; { teamName, teammateEmails } registers a team. Either may send
// totalAmountPaid (stored on the leader's or solo row; it can also be sent later with the payment proof).
// Every row is created, or none are.
//
// The batch is one transaction. Statement 1 locks the event row, so registrations, approvals and closures for the
// same event run one at a time. Statement 2 then checks, with a fresh snapshot, that (a) no member already holds a
// seat or awaits a refund for this event and (b) CONFIRMED seats + team size <= capacity, and inserts all rows only
// if both hold. A member with an old CANCELLED row (rejected or refunded) has it reactivated in place, because the
// (user_id, event_id) unique constraint allows only one row per student per event.
export async function registerForEvent(req, res) {
  const { eventId } = req.params
  if (!isUuid(eventId)) return fail(res, 404, 'Event not found.')
  if (!req.user.profileComplete) return fail(res, 403, PROFILE_REQUIRED)

  const { team, error } = readTeam(req.body, req.user.email)
  if (error) return fail(res, 400, error)
  const { amount, error: amountError } = readAmount(req.body?.totalAmountPaid)
  if (amountError) return fail(res, 400, amountError)
  // Teams only where the event allows them: up to maxTeamSize, or with a group offer up to the offer's size (a 5+2
  // offer is for groups of up to 7). Other events take individual registrations.
  if (team) {
    const [ev] = await db.select({ groupSize: events.groupSize, maxTeamSize: events.maxTeamSize }).from(events).where(eq(events.id, eventId)).limit(1)
    if (ev) {
      const cap = ev.maxTeamSize ?? ev.groupSize
      if (!cap) return fail(res, 400, 'This event takes individual registrations only. Register without teammates.')
      if (team.emails.length + 1 > cap) return fail(res, 400, `Teams for this event have at most ${cap} people, including you.`)
    }
  }

  const { members, error: memberError } = await resolveMembers(req.user, team)
  if (memberError) return fail(res, 400, memberError)
  const memberIds = members.map((m) => m.userId)
  const memberList = sql.join(memberIds.map((id) => sql`${id}::uuid`), sql`, `)
  const teamId = team ? crypto.randomUUID() : null

  const [locked, inserted] = await db.batch([
    db.execute(sql`select id from events where id = ${eventId}::uuid for update`),
    db.execute(sql`
      with ev as (select id, price, capacity from events where id = ${eventId}::uuid),
      members (user_id, is_leader, pays) as (
        values ${sql.join(members.map((m, i) => sql`(${m.userId}::uuid, ${m.isLeader}::boolean, ${i === 0}::boolean)`), sql`, `)}
      ),
      allowed as (
        select 1 from ev
        where (select count(*) from registrations x where x.event_id = ev.id and x.status = 'CONFIRMED')
              + ${members.length}::int <= ev.capacity
          and not exists (
            select 1 from registrations x
            where x.event_id = ev.id and x.user_id in (${memberList})
              and (x.status = 'CONFIRMED' or x.payment_status = 'REFUND_REQUIRED')
          )
      )
      insert into registrations as r
        (user_id, event_id, status, payment_status, team_id, team_name, is_group_leader, teammate_emails, total_amount_paid)
      select m.user_id, ev.id, 'CONFIRMED',
             (case when ev.price = 0 then 'VERIFIED' else 'PENDING' end)::payment_status,
             ${teamId}::uuid, ${team?.name ?? null}, m.is_leader,
             case when m.is_leader then ${team?.emails.join(', ') ?? null} end,
             case when m.pays and ev.price > 0 then ${amount}::int end
      from members m cross join ev
      where exists (select 1 from allowed)
      on conflict (user_id, event_id) do update set
        status = 'CONFIRMED', payment_status = excluded.payment_status,
        utr_number = null, payment_screenshot_url = null, reviewed_by = null, reviewed_at = null,
        refunded_by = null, refunded_at = null, attended_at = null,
        team_id = excluded.team_id, team_name = excluded.team_name, is_group_leader = excluded.is_group_leader,
        teammate_emails = excluded.teammate_emails, total_amount_paid = excluded.total_amount_paid, created_at = now()
      returning r.*`),
  ])

  if (inserted.rows.length) {
    const rows = inserted.rows.map(camelRow).map(withTicket)
    const leader = rows.find((r) => r.userId === req.user.id)
    const teammates = rows.filter((r) => r.userId !== req.user.id)
    return res.status(201).json({ success: true, data: { ...leader, teammates } })
  }
  if (!locked.rows.length) return fail(res, 404, 'Event not found.')

  // Nothing inserted: say why. These reads are only for the message; the decision was made under the lock.
  const blocking = await db
    .select({ paymentStatus: registrations.paymentStatus, status: registrations.status })
    .from(registrations)
    .where(and(eq(registrations.eventId, eventId), inArray(registrations.userId, memberIds)))
  if (blocking.some((r) => r.status === 'CONFIRMED')) {
    return fail(res, 409, team ? 'One or more emails are already registered for this event.' : 'You are already registered for this event.')
  }
  if (blocking.some((r) => r.paymentStatus === 'REFUND_REQUIRED')) {
    return fail(res, 409, 'A refund for this event is still being processed for you or a teammate. Contact the organisers.')
  }
  return fail(res, 400, team ? `Event is full: not enough seats for a team of ${members.length}.` : 'Event is full')
}

export async function getMyRegistrations(req, res) {
  const rows = await db
    .select({
      id: registrations.id,
      status: registrations.status,
      paymentStatus: registrations.paymentStatus,
      utrNumber: registrations.utrNumber,
      paymentScreenshotUrl: registrations.paymentScreenshotUrl,
      totalAmountPaid: registrations.totalAmountPaid,
      teamId: registrations.teamId,
      teamName: registrations.teamName,
      isGroupLeader: registrations.isGroupLeader,
      teammateEmails: registrations.teammateEmails,
      // Who registered the team, so teammates can see it was done for them
      teamLeader: sql`(select u.email from registrations l join users u on u.id = l.user_id
        where l.team_id = ${registrations.teamId} and l.is_group_leader limit 1)`,
      attendedAt: registrations.attendedAt,
      createdAt: registrations.createdAt,
      event: {
        id: events.id,
        title: events.title,
        date: events.date,
        location: events.location,
        price: events.price,
        schedule: events.schedule,
      },
    })
    .from(registrations)
    .innerJoin(events, eq(registrations.eventId, events.id))
    .where(eq(registrations.userId, req.user.id))
    .orderBy(desc(registrations.createdAt))
  res.json({ success: true, data: rows })
}

// The QR payload for the signed-in student's own registration. Only a paid-up, active registration gets one;
// every team member fetches their own, and all of them become available when the leader's payment is approved.
export async function getTicket(req, res) {
  const { registrationId } = req.params
  if (!isUuid(registrationId)) return fail(res, 404, 'Registration not found.')

  const [reg] = await db
    .select({ id: registrations.id, status: registrations.status, paymentStatus: registrations.paymentStatus })
    .from(registrations)
    .where(and(eq(registrations.id, registrationId), eq(registrations.userId, req.user.id)))
    .limit(1)
  if (!reg) return fail(res, 404, 'Registration not found.')
  if (reg.status !== 'CONFIRMED') return fail(res, 409, 'This registration has been cancelled.')
  if (reg.paymentStatus !== 'VERIFIED') return fail(res, 409, 'Your ticket will be available once your payment is verified.')

  res.json({ success: true, data: { registrationId: reg.id, qrPayload: generateTicket(reg.id) } })
}

// The student's one QR code for an event. A verified main registration gives the MAIN pass (main event + every
// sub-event they booked). Without one, a verified sub-event booking gives a STANDALONE pass (only their booked
// sub-events). Either way the same code is scanned at every door; check-in decides what it admits to.
export async function getMasterTicket(req, res) {
  const { eventId } = req.params
  if (!isUuid(eventId)) return fail(res, 404, 'Event not found.')

  const { rows } = await db.execute(sql`
    select
      (select r.id from registrations r
        where r.event_id = ${eventId}::uuid and r.user_id = ${req.user.id}::uuid
          and r.status = 'CONFIRMED' and r.payment_status = 'VERIFIED') as main_id,
      exists (select 1 from registrations r
        where r.event_id = ${eventId}::uuid and r.user_id = ${req.user.id}::uuid and r.status = 'CONFIRMED') as main_pending,
      exists (select 1 from sub_event_bookings b join sub_events s on s.id = b.sub_event_id
        where s.event_id = ${eventId}::uuid and b.user_id = ${req.user.id}::uuid
          and b.status = 'CONFIRMED' and b.payment_status = 'VERIFIED') as has_booking,
      exists (select 1 from sub_event_bookings b join sub_events s on s.id = b.sub_event_id
        where s.event_id = ${eventId}::uuid and b.user_id = ${req.user.id}::uuid and b.status = 'CONFIRMED') as booking_pending`)
  const t = camelRow(rows[0])

  if (t.mainId) {
    return res.json({ success: true, data: { eventId, kind: 'MAIN', registrationId: t.mainId, qrPayload: generateTicket(t.mainId) } })
  }
  if (t.hasBooking) {
    return res.json({ success: true, data: { eventId, kind: 'STANDALONE', qrPayload: generateStandaloneTicket(eventId, req.user.id) } })
  }
  if (t.mainPending || t.bookingPending) return fail(res, 409, 'Your ticket will be available once your payment is verified.')
  return fail(res, 404, 'You have no registration or booking for this event.')
}
