// GET /api/events/:eventId/registrations: everyone registered for an event and every session booking, with the
// student details, for the live Registrations dashboard (ADMIN, or the EVENT_HEAD who created the event). Polled every
// few seconds while the tab is open, so it is two plain indexed queries in one round trip.
// Cancelled rows are included (with their status) so payment history is complete; the dashboard filters them.
import { sql } from 'drizzle-orm'
import { db } from '../../db/index.js'
import { camelRow } from '../../db/fragments.js'
import { managedEvent } from './subEvents.controller.js'

export async function listRegistrations(req, res) {
  const event = await managedEvent(req, res, req.params.eventId)
  if (!event) return

  const [{ rows: regs }, { rows: bookings }] = await db.batch([
    db.execute(sql`
      select r.id, r.status, r.payment_status, r.utr_number, r.total_amount_paid, r.team_id, r.team_name, r.is_group_leader,
             r.created_at, r.reviewed_at, r.attended_at,
             u.name, u.email, u.phone, u.roll_number, u.branch, u.year,
             coalesce((select json_agg(s.title order by s.start_time nulls last, s.title)
                       from sub_event_bookings b join sub_events s on s.id = b.sub_event_id
                       where b.user_id = r.user_id and s.event_id = r.event_id and b.status = 'CONFIRMED'), '[]'::json) as sessions
      from registrations r join users u on u.id = r.user_id
      where r.event_id = ${event.id}::uuid
      order by r.created_at desc`),
    db.execute(sql`
      select b.id, b.status, b.payment_status, b.utr_number, b.total_amount_paid, b.is_pass_holder, b.team_name, b.group_name,
             b.created_at, b.attended_at, s.title as session_title, s.start_time as session_start,
             u.name, u.email, u.phone, u.roll_number, u.branch, u.year
      from sub_event_bookings b join sub_events s on s.id = b.sub_event_id join users u on u.id = b.user_id
      where s.event_id = ${event.id}::uuid
      order by s.start_time nulls last, s.title, b.created_at desc`),
  ])

  res.set('Cache-Control', 'no-store')
  res.json({
    success: true,
    data: {
      event: { id: event.id, title: event.title, capacity: event.capacity, price: event.price },
      registrations: regs.map(camelRow).map((r) => ({ ...r, code: r.id.slice(0, 8).toUpperCase() })),
      bookings: bookings.map(camelRow),
      updatedAt: new Date().toISOString(),
    },
  })
}

// GET /api/analytics/students (ADMIN): every account with its student details and the events it holds a seat for
export async function listStudents(req, res) {
  const { rows } = await db.execute(sql`
    select u.id, u.name, u.email, u.phone, u.roll_number, u.branch, u.year, u.role, u.is_active, u.created_at,
           coalesce(json_agg(json_build_object('eventId', e.id, 'title', e.title, 'date', e.date,
                                               'paymentStatus', r.payment_status, 'attended', r.attended_at is not null)
                             order by e.date desc) filter (where r.id is not null), '[]'::json) as events
    from users u
    left join registrations r on r.user_id = u.id and r.status = 'CONFIRMED'
    left join events e on e.id = r.event_id
    group by u.id
    order by u.created_at desc`)
  res.set('Cache-Control', 'no-store')
  res.json({ success: true, data: rows.map(camelRow) })
}
