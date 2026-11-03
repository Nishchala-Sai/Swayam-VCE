// Sub-event bookings (workshops, hackathons, auctions): RSVP in advance, alone or as a team, with pass-holder pricing.
import { and, desc, eq, inArray, sql } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { events, registrations, subEventBookings, subEvents } from '../../db/schema.js'
import { camelRow } from '../../db/fragments.js'
import { isUuid } from '../../utils/isUuid.js'
import { readTeam, resolveMembers, readAmount } from './team.js'
import { PROFILE_REQUIRED } from '../auth/profile.js'

const fail = (res, status, message) => res.status(status).json({ success: false, message })

// Books a sub-event for the current user, or for a team they lead. Every member is priced on their own pass:
// a CONFIRMED + VERIFIED registration for the parent event means priceForPassHolders, anything else
// priceForStandalone. If every member's price is 0 the booking is VERIFIED at once; otherwise it is PENDING and the
// leader submits a UTR and totalAmountPaid, which staff verify (the total is never calculated by the server).
//
// Team-competition sessions (teamSize > 1): every booking needs a team name and holds at most teamSize people.
// A student may book alone under a team name (a team of one); staff can later auto-group short teams.
//
// Same transaction shape as registerForEvent: lock the sub-event row, then one INSERT ... SELECT that creates (or
// reactivates) every member's row only if there are enough seats and no member already holds one.
export async function bookSubEvent(req, res) {
  const { subEventId } = req.body ?? {}
  if (!isUuid(subEventId)) return fail(res, 400, 'subEventId must be a valid sub-event id.')
  if (!req.user.profileComplete) return fail(res, 403, PROFILE_REQUIRED)
  const [sub] = await db.select().from(subEvents).where(eq(subEvents.id, subEventId)).limit(1)
  if (!sub) return fail(res, 404, 'Sub-event not found.')

  const { team, error } = readSessionTeam(req.body, req.user.email, sub)
  if (error) return fail(res, 400, error)
  const { amount, error: amountError } = readAmount(req.body?.totalAmountPaid)
  if (amountError) return fail(res, 400, amountError)

  const { members, error: memberError } = await resolveMembers(req.user, team)
  if (memberError) return fail(res, 400, memberError)
  const memberIds = members.map((m) => m.userId)

  const passes = await db
    .select({ id: registrations.id, userId: registrations.userId })
    .from(registrations)
    .where(
      and(
        eq(registrations.eventId, sub.eventId),
        inArray(registrations.userId, memberIds),
        eq(registrations.status, 'CONFIRMED'),
        eq(registrations.paymentStatus, 'VERIFIED'),
      ),
    )
  const priced = members.map((m) => {
    const pass = passes.find((p) => p.userId === m.userId)
    return { ...m, registrationId: pass?.id ?? null, price: pass ? sub.priceForPassHolders : sub.priceForStandalone }
  })
  if (sub.passHoldersOnly) {
    const without = priced.filter((m) => !m.registrationId).map((m) => m.email)
    if (without.length) {
      return fail(res, 403, team
        ? `${sub.title} is only for students with a confirmed event ticket. These team members don't have one yet: ${without.join(', ')}`
        : `${sub.title} is only for students with a confirmed event ticket. Register for the event, and book once your payment is confirmed.`)
    }
  }
  const needsPayment = priced.some((m) => m.price > 0)
  const memberList = sql.join(memberIds.map((id) => sql`${id}::uuid`), sql`, `)
  const teamId = team ? crypto.randomUUID() : null

  const [, inserted] = await db.batch([
    db.execute(sql`select id from sub_events where id = ${subEventId}::uuid for update`),
    db.execute(sql`
      with se as (select id, capacity from sub_events where id = ${subEventId}::uuid),
      members (user_id, registration_id, is_leader, pays) as (
        values ${sql.join(priced.map((m, i) => sql`(${m.userId}::uuid, ${m.registrationId}::uuid, ${m.isLeader}::boolean, ${i === 0}::boolean)`), sql`, `)}
      ),
      allowed as (
        select 1 from se
        where (select count(*) from sub_event_bookings x where x.sub_event_id = se.id and x.status = 'CONFIRMED')
              + ${priced.length}::int <= se.capacity
          and not exists (
            select 1 from sub_event_bookings x
            where x.sub_event_id = se.id and x.user_id in (${memberList})
              and (x.status = 'CONFIRMED' or x.payment_status = 'REFUND_REQUIRED')
          )
      )
      insert into sub_event_bookings as r
        (user_id, registration_id, sub_event_id, status, payment_status, is_pass_holder,
         team_id, team_name, is_group_leader, teammate_emails, total_amount_paid)
      select m.user_id, m.registration_id, se.id, 'CONFIRMED', ${needsPayment ? 'PENDING' : 'VERIFIED'}::payment_status,
             m.registration_id is not null, ${teamId}::uuid, ${team?.name ?? null}, m.is_leader,
             case when m.is_leader then ${team?.emails.length ? team.emails.join(', ') : null} end,
             case when m.pays and ${needsPayment}::boolean then ${amount}::int end
      from members m cross join se
      where exists (select 1 from allowed)
      on conflict (user_id, sub_event_id) do update set
        registration_id = excluded.registration_id, status = 'CONFIRMED', payment_status = excluded.payment_status,
        is_pass_holder = excluded.is_pass_holder, utr_number = null, payment_screenshot_url = null,
        reviewed_by = null, reviewed_at = null, refunded_by = null, refunded_at = null, attended_at = null,
        team_id = excluded.team_id, team_name = excluded.team_name, is_group_leader = excluded.is_group_leader,
        teammate_emails = excluded.teammate_emails, total_amount_paid = excluded.total_amount_paid, created_at = now(),
        group_id = null, group_name = null, grouped_at = null
      returning r.*`),
  ])

  if (inserted.rows.length) {
    // price is shown so the frontend can tell each member what applies to them; it is not stored.
    // There is no per-booking ticket: members scan their master ticket (GET /api/registrations/events/:eventId/ticket).
    const rows = inserted.rows.map(camelRow).map((r) => ({ ...r, price: priced.find((m) => m.userId === r.userId).price }))
    const leader = rows.find((r) => r.userId === req.user.id)
    const teammates = rows.filter((r) => r.userId !== req.user.id)
    return res.status(201).json({ success: true, data: { ...leader, teammates } })
  }

  const blocking = await db
    .select({ paymentStatus: subEventBookings.paymentStatus, status: subEventBookings.status })
    .from(subEventBookings)
    .where(and(eq(subEventBookings.subEventId, subEventId), inArray(subEventBookings.userId, memberIds)))
  if (blocking.some((r) => r.status === 'CONFIRMED')) {
    return fail(res, 409, team ? 'One or more emails have already booked this sub-event.' : 'You have already booked this sub-event.')
  }
  if (blocking.some((r) => r.paymentStatus === 'REFUND_REQUIRED')) {
    return fail(res, 409, 'A refund for this sub-event is still being processed for you or a teammate. Contact the organisers.')
  }
  return fail(res, 400, team ? `Sub-event is full: not enough seats for a team of ${priced.length}.` : 'Sub-event is full')
}

// The team for a booking. Ordinary sessions use readTeam as before. Team competitions (teamSize > 1) require a team
// name, allow no teammates (a team of one), and cap the team at teamSize people.
function readSessionTeam(body, leaderEmail, sub) {
  const size = sub.teamSize ?? 1
  if (size <= 1) return readTeam(body, leaderEmail)
  const { teamName, teammateEmails } = body ?? {}
  const alone = teammateEmails == null || (Array.isArray(teammateEmails) && teammateEmails.length === 0)
  if (typeof teamName !== 'string' || !teamName.trim() || teamName.trim().length > 100) {
    return { error: `${sub.title} is played in teams of ${size}: teamName is required (up to 100 characters).` }
  }
  if (alone) return { team: { name: teamName.trim(), emails: [] } }
  const read = readTeam(body, leaderEmail)
  if (read.error) return read
  if (read.team.emails.length + 1 > size) {
    return { error: `Teams for ${sub.title} have at most ${size} people, including you.` }
  }
  return read
}

export async function getMyBookings(req, res) {
  const rows = await db
    .select({
      id: subEventBookings.id,
      status: subEventBookings.status,
      paymentStatus: subEventBookings.paymentStatus,
      isPassHolder: subEventBookings.isPassHolder,
      utrNumber: subEventBookings.utrNumber,
      paymentScreenshotUrl: subEventBookings.paymentScreenshotUrl,
      totalAmountPaid: subEventBookings.totalAmountPaid,
      teamId: subEventBookings.teamId,
      teamName: subEventBookings.teamName,
      isGroupLeader: subEventBookings.isGroupLeader,
      teammateEmails: subEventBookings.teammateEmails,
      // Who booked for the team, so teammates can see it was done for them
      teamLeader: sql`(select u.email from sub_event_bookings l join users u on u.id = l.user_id
        where l.team_id = ${subEventBookings.teamId} and l.is_group_leader limit 1)`,
      groupName: subEventBookings.groupName,
      attendedAt: subEventBookings.attendedAt,
      createdAt: subEventBookings.createdAt,
      subEvent: { id: subEvents.id, title: subEvents.title, startTime: subEvents.startTime, endTime: subEvents.endTime, teamSize: subEvents.teamSize, venue: subEvents.venue, passHoldersOnly: subEvents.passHoldersOnly },
      event: { id: events.id, title: events.title, date: events.date, location: events.location, schedule: events.schedule },
    })
    .from(subEventBookings)
    .innerJoin(subEvents, eq(subEventBookings.subEventId, subEvents.id))
    .innerJoin(events, eq(subEvents.eventId, events.id))
    .where(eq(subEventBookings.userId, req.user.id))
    .orderBy(desc(subEventBookings.createdAt))
  res.json({ success: true, data: rows })
}
