// Manual UPI payments for main-event registrations and sub-event bookings. Both tables have the same payment
// columns and rules, so each handler is written once and parameterised by a KIND.
import { sql } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { camelRow, canManageEvent } from '../../db/fragments.js'
import { isUuid } from '../../utils/isUuid.js'
import { isHttpsUrl } from '../../utils/isHttpsUrl.js'
import { readAmount } from '../registrations/team.js'

const fail = (res, status, message) => res.status(status).json({ success: false, message })

const UTR = /^\d{12}$/ // UPI transaction references are 12 digits

// PostgreSQL unique_violation. Drizzle wraps driver errors, so the code may be on err.cause.
const isUniqueViolation = (err) => (err?.cause?.code ?? err?.code) === '23505'

// table: the payment rows. parent: what holds the seats (has `capacity`), joined on fk.
// event: expression for the parent's events.id, to check who manages it. Identifiers are constants, never input.
const KINDS = {
  registration: {
    noun: 'registration',
    param: 'registrationId',
    table: sql.raw('registrations'),
    other: sql.raw('sub_event_bookings'),
    parent: sql.raw('events'),
    fk: sql.raw('event_id'),
    event: sql.raw('p.id'),
    parentParam: 'eventId',
    parentNoun: 'event',
  },
  booking: {
    noun: 'booking',
    param: 'bookingId',
    table: sql.raw('sub_event_bookings'),
    other: sql.raw('registrations'),
    parent: sql.raw('sub_events'),
    fk: sql.raw('sub_event_id'),
    event: sql.raw('p.event_id'),
    parentParam: 'subEventId',
    parentNoun: 'sub-event',
  },
}

const describe = (status) => status.toLowerCase().replace('_', ' ')

// The row as the caller is allowed to see it, for explaining why an update matched nothing
async function lookup(kind, id, user) {
  const { rows } = await db.execute(sql`
    select l.status, l.payment_status, l.utr_number, l.total_amount_paid, l.team_id, l.is_group_leader,
           l.reviewed_by, l.user_id, ${canManageEvent(user, sql`e.created_by`)} as manages
    from ${kind.table} l join ${kind.parent} p on p.id = l.${kind.fk} join events e on e.id = ${kind.event}
    where l.id = ${id}::uuid`)
  return rows[0] && camelRow(rows[0])
}

// Student (or team leader) submits or corrects their UTR, optional screenshot link and totalAmountPaid while the
// payment is PENDING. totalAmountPaid is required by now, unless it was already sent when registering.
const submitProof = (kind) => async (req, res) => {
  const id = req.params[kind.param]
  if (!isUuid(id)) return fail(res, 404, `${kind.noun[0].toUpperCase() + kind.noun.slice(1)} not found.`)

  const { utrNumber, paymentScreenshotUrl } = req.body ?? {}
  const utr = typeof utrNumber === 'string' ? utrNumber.trim() : ''
  if (!UTR.test(utr)) return fail(res, 400, 'utrNumber must be the 12-digit UTR from your UPI app.')
  if (paymentScreenshotUrl != null && !isHttpsUrl(paymentScreenshotUrl)) {
    return fail(res, 400, 'paymentScreenshotUrl must be an https URL.')
  }
  const { amount, error } = readAmount(req.body?.totalAmountPaid)
  if (error) return fail(res, 400, error)

  // utr_number is unique within each table; this covers the same UTR being reused across the two
  const { rows: usedElsewhere } = await db.execute(sql`select 1 from ${kind.other} where utr_number = ${utr} limit 1`)
  if (usedElsewhere.length) return fail(res, 409, 'This UTR has already been used for another registration.')

  let rows
  try {
    ;({ rows } = await db.execute(sql`
      update ${kind.table} r set
        utr_number = ${utr}, payment_screenshot_url = ${paymentScreenshotUrl ?? null},
        total_amount_paid = coalesce(${amount}::int, r.total_amount_paid)
      where r.id = ${id}::uuid and r.user_id = ${req.user.id}::uuid
        and r.status = 'CONFIRMED' and r.payment_status = 'PENDING' and (r.team_id is null or r.is_group_leader)
        and coalesce(${amount}::int, r.total_amount_paid) is not null
      returning r.*`))
  } catch (err) {
    if (isUniqueViolation(err)) return fail(res, 409, 'This UTR has already been used for another registration.')
    throw err
  }
  if (rows.length) return res.json({ success: true, data: camelRow(rows[0]) })

  const row = await lookup(kind, id, req.user)
  // Another student's row looks the same as a missing one
  if (!row || row.userId !== req.user.id) return fail(res, 404, `${kind.noun[0].toUpperCase() + kind.noun.slice(1)} not found.`)
  if (row.teamId && !row.isGroupLeader) return fail(res, 403, 'Only your team leader can submit the payment.')
  if (row.status === 'CANCELLED') return fail(res, 409, `This ${kind.noun} has been cancelled.`)
  if (row.paymentStatus === 'VERIFIED' && !row.reviewedBy) return fail(res, 400, 'This is free; no payment is needed.')
  if (row.paymentStatus !== 'PENDING') return fail(res, 409, `This payment has already been ${describe(row.paymentStatus)}.`)
  return fail(res, 400, 'totalAmountPaid is required: the total you paid in rupees, as shown in your UPI app.')
}

// Staff queue: one entry per solo row or team leader still PENDING, with what the student says they paid.
// ADMIN sees every event, EVENT_HEAD only events they created. Ones with a UTR first, oldest first.
const getPending = (kind) => async (req, res) => {
  const { rows } = await db.execute(sql`
    select l.*,
      (case when l.team_id is null then 1 else
        (select count(*) from ${kind.table} m where m.team_id = l.team_id and m.status = 'CONFIRMED') end)::int as team_size,
      u.email as x_email, e.id as x_event_id, e.title as x_event_title, e.date as x_event_date, e.price as x_event_price, e.group_size as x_group_size, e.group_price as x_group_price,
      ${kind === KINDS.booking ? sql`p.title` : sql`null`} as x_sub_event_title,
      ${kind === KINDS.booking ? sql`p.price_for_pass_holders` : sql`null`} as x_pass_price,
      ${kind === KINDS.booking ? sql`p.price_for_standalone` : sql`null`} as x_standalone_price
    from ${kind.table} l join ${kind.parent} p on p.id = l.${kind.fk} join events e on e.id = ${kind.event}
      join users u on u.id = l.user_id
    where l.payment_status = 'PENDING' and l.status = 'CONFIRMED' and (l.team_id is null or l.is_group_leader)
      and ${canManageEvent(req.user, sql`e.created_by`)}
    order by l.utr_number is null, l.created_at`)

  const data = rows.map((raw) => {
    const r = camelRow(raw)
    const { xEmail, xEventId, xEventTitle, xEventDate, xEventPrice, xGroupSize, xGroupPrice, xSubEventTitle, xPassPrice, xStandalonePrice, ...row } = r
    return {
      ...row,
      user: { id: row.userId, email: xEmail },
      event: { id: xEventId, title: xEventTitle, date: xEventDate, price: xEventPrice, groupSize: xGroupSize, groupPrice: xGroupPrice },
      ...(kind === KINDS.booking && {
        subEvent: { id: row.subEventId, title: xSubEventTitle, priceForPassHolders: xPassPrice, priceForStandalone: xStandalonePrice },
      }),
    }
  })
  res.json({ success: true, data })
}

// APPROVE → VERIFIED, unless the verified seats plus this team already exceed capacity: then REFUND_REQUIRED and
// CANCELLED, so the student is refunded instead of being admitted to a full event. REJECT → REJECTED and CANCELLED.
// The decision on a leader's row applies to the whole team. APPROVE needs a UTR and totalAmountPaid to check.
//
// One transaction: lock the parent (event or sub-event) row so two approvals can't both take the last seat, then a
// single UPDATE whose WHERE re-checks everything. If two staff act at once, the second finds nothing PENDING (409).
const verify = (kind) => async (req, res) => {
  const id = req.params[kind.param]
  if (!isUuid(id)) return fail(res, 404, `${kind.noun[0].toUpperCase() + kind.noun.slice(1)} not found.`)

  const { action } = req.body ?? {}
  if (action !== 'APPROVE' && action !== 'REJECT') return fail(res, 400, "action must be 'APPROVE' or 'REJECT'.")
  const approve = action === 'APPROVE'
  const fits = sql`t.verified + t.size <= t.capacity`

  const [, decided] = await db.batch([
    db.execute(sql`
      select p.id from ${kind.parent} p join ${kind.table} l on l.${kind.fk} = p.id
      where l.id = ${id}::uuid for update of p`),
    db.execute(sql`
      with t as (
        select l.id, l.team_id, p.capacity,
          (select count(*) from ${kind.table} v
            where v.${kind.fk} = l.${kind.fk} and v.status = 'CONFIRMED' and v.payment_status = 'VERIFIED') as verified,
          (select count(*) from ${kind.table} s
            where (s.id = l.id or s.team_id = l.team_id) and s.status = 'CONFIRMED' and s.payment_status = 'PENDING') as size
        from ${kind.table} l join ${kind.parent} p on p.id = l.${kind.fk} join events e on e.id = ${kind.event}
        where l.id = ${id}::uuid and l.status = 'CONFIRMED' and l.payment_status = 'PENDING'
          and (l.team_id is null or l.is_group_leader)
          and ${canManageEvent(req.user, sql`e.created_by`)}
          ${approve ? sql`and l.utr_number is not null and l.total_amount_paid is not null` : sql``}
      )
      update ${kind.table} r set
        payment_status = ${approve ? sql`case when ${fits} then 'VERIFIED' else 'REFUND_REQUIRED' end` : sql`'REJECTED'`}::payment_status,
        status = ${approve ? sql`case when ${fits} then 'CONFIRMED' else 'CANCELLED' end` : sql`'CANCELLED'`}::registration_status,
        reviewed_by = ${req.user.id}::uuid, reviewed_at = now()
      from t
      where (r.id = t.id or r.team_id = t.team_id) and r.status = 'CONFIRMED' and r.payment_status = 'PENDING'
      returning r.*`),
  ])

  if (decided.rows.length) {
    const rows = decided.rows.map(camelRow)
    const leader = rows.find((r) => r.id === id)
    const teammates = rows.filter((r) => r.id !== id)
    const message =
      leader.paymentStatus === 'REFUND_REQUIRED'
        ? `It is full, so this payment was marked REFUND_REQUIRED and the ${kind.noun} cancelled. Refund the student.`
        : undefined
    return res.json({ success: true, ...(message && { message }), data: { ...leader, teammates } })
  }

  const row = await lookup(kind, id, req.user)
  if (!row) return fail(res, 404, `${kind.noun[0].toUpperCase() + kind.noun.slice(1)} not found.`)
  if (!row.manages) return fail(res, 403, 'You can only manage payments for events you created.')
  if (row.paymentStatus === 'VERIFIED' && !row.reviewedBy) return fail(res, 400, 'This is free; there is no payment to verify.')
  if (row.teamId && !row.isGroupLeader) {
    return fail(res, 400, `This is a teammate's ${kind.noun}. Approve or reject the team leader's ${kind.noun} instead.`)
  }
  if (row.paymentStatus !== 'PENDING') return fail(res, 409, `This payment has already been ${describe(row.paymentStatus)}.`)
  if (row.status === 'CANCELLED') return fail(res, 409, `This ${kind.noun} has been cancelled.`)
  if (!row.utrNumber) return fail(res, 400, 'The student has not submitted a UTR yet, so there is nothing to approve.')
  return fail(res, 400, 'The student has not submitted totalAmountPaid yet, so there is nothing to check it against.')
}

// Staff confirm the money was sent back: REFUND_REQUIRED → REFUNDED for the solo row or the whole team.
// After this the students may register or book again.
const refund = (kind) => async (req, res) => {
  const id = req.params[kind.param]
  if (!isUuid(id)) return fail(res, 404, `${kind.noun[0].toUpperCase() + kind.noun.slice(1)} not found.`)

  const { rows } = await db.execute(sql`
    with t as (
      select l.id, l.team_id
      from ${kind.table} l join ${kind.parent} p on p.id = l.${kind.fk} join events e on e.id = ${kind.event}
      where l.id = ${id}::uuid and l.payment_status = 'REFUND_REQUIRED' and (l.team_id is null or l.is_group_leader)
        and ${canManageEvent(req.user, sql`e.created_by`)}
    )
    update ${kind.table} r set payment_status = 'REFUNDED', refunded_by = ${req.user.id}::uuid, refunded_at = now()
    from t
    where (r.id = t.id or r.team_id = t.team_id) and r.payment_status = 'REFUND_REQUIRED'
    returning r.*`)

  if (rows.length) {
    const all = rows.map(camelRow)
    return res.json({ success: true, data: { ...all.find((r) => r.id === id), teammates: all.filter((r) => r.id !== id) } })
  }

  const row = await lookup(kind, id, req.user)
  if (!row) return fail(res, 404, `${kind.noun[0].toUpperCase() + kind.noun.slice(1)} not found.`)
  if (!row.manages) return fail(res, 403, 'You can only manage payments for events you created.')
  if (row.teamId && !row.isGroupLeader) return fail(res, 400, `Refund the team leader's ${kind.noun}; it covers the whole team.`)
  return fail(res, 409, row.paymentStatus === 'REFUNDED' ? 'This has already been refunded.' : `No refund is due: the payment is ${describe(row.paymentStatus)}.`)
}

// GET /api/payments/refunds: payments marked REFUND_REQUIRED (no seat was left when approved, or payments were closed),
// one entry per solo row or team leader, registrations and session bookings together, oldest first. ADMIN sees every
// event, EVENT_HEAD only events they created. Staff then send the money back and mark it REFUNDED.
export async function getRefunds(req, res) {
  const manages = canManageEvent(req.user, sql`e.created_by`)
  const { rows } = await db.execute(sql`
    select * from (
      select 'registration' as kind, l.id, l.total_amount_paid, l.utr_number, l.team_name, l.reviewed_at,
        (case when l.team_id is null then 1 else (select count(*) from registrations m where m.team_id = l.team_id) end)::int as team_size,
        u.email, u.name, e.id as event_id, e.title as event_title, null::text as session_title
      from registrations l join events e on e.id = l.event_id join users u on u.id = l.user_id
      where l.payment_status = 'REFUND_REQUIRED' and (l.team_id is null or l.is_group_leader) and ${manages}
      union all
      select 'booking', l.id, l.total_amount_paid, l.utr_number, l.team_name, l.reviewed_at,
        (case when l.team_id is null then 1 else (select count(*) from sub_event_bookings m where m.team_id = l.team_id) end)::int,
        u.email, u.name, e.id, e.title, s.title
      from sub_event_bookings l join sub_events s on s.id = l.sub_event_id join events e on e.id = s.event_id join users u on u.id = l.user_id
      where l.payment_status = 'REFUND_REQUIRED' and (l.team_id is null or l.is_group_leader) and ${manages}
    ) r order by r.reviewed_at nulls first`)
  res.json({ success: true, data: rows.map(camelRow) })
}

export const submitPaymentProof = submitProof(KINDS.registration)
export const getPendingPayments = getPending(KINDS.registration)
export const verifyPayment = verify(KINDS.registration)
export const markRefunded = refund(KINDS.registration)

export const submitBookingProof = submitProof(KINDS.booking)
export const getPendingBookingPayments = getPending(KINDS.booking)
export const verifyBookingPayment = verify(KINDS.booking)
export const markBookingRefunded = refund(KINDS.booking)

// Closes payments for an event: every registration still PENDING is cancelled. Those who submitted a UTR (for a team,
// the leader did) may have paid, so they become REFUND_REQUIRED; those who never submitted one become REJECTED.
// The parent (event or sub-event) row is locked first, so this can't interleave with a registration, booking or
// approval for the same parent. All cancelled rows free their seats.
const closePayments = (kind) => async (req, res) => {
  const parentId = req.params[kind.parentParam]
  const notFound = `${kind.parentNoun[0].toUpperCase() + kind.parentNoun.slice(1)} not found.`
  if (!isUuid(parentId)) return fail(res, 404, notFound)

  const { rows: found } = await db.execute(sql`
    select ${canManageEvent(req.user, sql`e.created_by`)} as manages
    from ${kind.parent} p join events e on e.id = ${kind.event} where p.id = ${parentId}::uuid`)
  if (!found.length) return fail(res, 404, notFound)
  if (!found[0].manages) return fail(res, 403, 'You can only manage payments for events you created.')

  const [, closed] = await db.batch([
    db.execute(sql`select id from ${kind.parent} where id = ${parentId}::uuid for update`),
    db.execute(sql`
      update ${kind.table} r set
        status = 'CANCELLED',
        payment_status = (case
          when r.utr_number is not null
            or exists (select 1 from ${kind.table} l where l.team_id = r.team_id and l.utr_number is not null)
          then 'REFUND_REQUIRED' else 'REJECTED' end)::payment_status,
        reviewed_by = ${req.user.id}::uuid, reviewed_at = now()
      where r.${kind.fk} = ${parentId}::uuid and r.status = 'CONFIRMED' and r.payment_status = 'PENDING'
      returning r.id, r.payment_status as "paymentStatus"`),
  ])

  const count = (s) => closed.rows.filter((r) => r.paymentStatus === s).length
  res.json({
    success: true,
    data: { refundRequired: count('REFUND_REQUIRED'), rejected: count('REJECTED'), [`${kind.noun}Ids`]: closed.rows.map((r) => r.id) },
  })
}

// Closes payments for an event (main registrations) or a sub-event (its bookings): every row still PENDING is
// cancelled. Those who submitted a UTR (for a team, the leader did) may have paid, so they become REFUND_REQUIRED;
// those who never submitted one become REJECTED, so the refund list contains only real payments.
export const rejectRemaining = closePayments(KINDS.registration)
export const rejectRemainingBookings = closePayments(KINDS.booking)
