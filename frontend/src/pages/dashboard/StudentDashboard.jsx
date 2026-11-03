// The student's dashboard: payments still to submit, upcoming events with their master QR ticket, session bookings,
// and past events they were checked in at. Staff see the same view under their dashboard's "My tickets" tab.
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import PaymentForm from '../../components/PaymentForm'
import RegisterModal from '../../components/RegisterModal'
import { Alert, Empty, Loading, Modal, Pill } from '../../components/ui'
import { useLiveEvents } from '../../hooks/useLiveEvents'
import { registrationState, useMyRegistrations } from '../../hooks/useMyRegistrations'
import { dayOf, fmtDateTime, inr, monthOf } from '../../lib/events'

const ONGOING_MS = 12 * 3600e3 // an event stays under "Upcoming" this long after it starts, as on the events pages

// Solo rows and team leaders submit the UTR; teammates wait for their leader
const canPay = (r) => r.status === 'CONFIRMED' && r.paymentStatus === 'PENDING' && !r.utrNumber && (!r.teamId || r.isGroupLeader)

// Payment decisions the student hasn't dismissed yet. No emails are sent, so this is where they find out. Dismissed
// ones are remembered in this browser only; on another device they show once more, which is harmless.
const SEEN_KEY = 'swayam:seen-updates'
function readSeen() {
  try {
    return new Set(JSON.parse(localStorage.getItem(SEEN_KEY)) ?? [])
  } catch {
    return new Set()
  }
}
function decisionsFor(items, bookings, since) {
  const out = []
  for (const r of items) {
    if (new Date(r.event.date).getTime() < since || !(r.event.price > 0)) continue
    const title = r.event.title
    if (r.status === 'CONFIRMED' && r.paymentStatus === 'VERIFIED') {
      out.push({ key: `${r.id}:VERIFIED`, tone: 'ok', text: `Payment approved for ${title}. Your ticket is ready.`, to: `/tickets/${r.event.id}`, action: 'View ticket' })
    } else if (r.status === 'CANCELLED' && r.paymentStatus === 'REJECTED') {
      out.push({ key: `${r.id}:REJECTED`, tone: 'error', text: `Your payment for ${title} could not be verified, so the registration was cancelled. You can register again.`, to: `/events/${r.event.id}`, action: 'Open event' })
    }
  }
  for (const b of bookings) {
    if (!b.utrNumber || new Date(b.subEvent.startTime ?? b.event.date).getTime() < since) continue
    if (b.status === 'CONFIRMED' && b.paymentStatus === 'VERIFIED') {
      out.push({ key: `${b.id}:VERIFIED`, tone: 'ok', text: `Payment approved for ${b.subEvent.title}. Your event ticket now admits you to it.`, to: `/tickets/${b.event.id}`, action: 'View ticket' })
    } else if (b.status === 'CANCELLED' && b.paymentStatus === 'REJECTED') {
      out.push({ key: `${b.id}:REJECTED`, tone: 'error', text: `Your payment for ${b.subEvent.title} could not be verified, so the booking was cancelled.`, to: `/events/${b.event.id}`, action: 'Open event' })
    }
  }
  return out
}

export default function StudentDashboard() {
  const { items, loading, error, reload } = useMyRegistrations()
  const { live, reload: reloadLive } = useLiveEvents()
  const [paying, setPaying] = useState(null) // { event, registrationId, amountDue }
  const [payingBooking, setPayingBooking] = useState(null)
  const [bookingPaid, setBookingPaid] = useState(false)
  const [bookings, setBookings] = useState([])
  const [seen, setSeen] = useState(readSeen)
  const dismiss = (key) =>
    setSeen((s) => {
      const next = new Set(s).add(key)
      try {
        localStorage.setItem(SEEN_KEY, JSON.stringify([...next].slice(-200)))
      } catch {
        // storage unavailable (private mode): dismissed for this visit only
      }
      return next
    })

  const loadBookings = () => api('/registrations/bookings/me').then((b) => setBookings(b ?? [])).catch(() => setBookings([]))
  useEffect(() => {
    loadBookings()
  }, [])

  const now = Date.now()
  const startOf = (r) => new Date(r.event.date).getTime()
  const toPay = items.filter(canPay)
  const bookingsToPay = bookings.filter(canPay)
  const upcoming = items
    .filter((r) => r.status === 'CONFIRMED' && startOf(r) > now - ONGOING_MS)
    .sort((a, b) => startOf(a) - startOf(b))
  const attended = items.filter((r) => r.attendedAt).sort((a, b) => startOf(b) - startOf(a))
  const closed = items.filter((r) => r.status === 'CANCELLED')
  const updates = decisionsFor(items, bookings, now - ONGOING_MS).filter((u) => !seen.has(u.key))
  // The event behind a session booking being paid for: its UPI QR, ID and payee name
  const payingEvent = payingBooking && live.find((e) => e.key === payingBooking.event.id)?.raw

  // The pay step needs the event's UPI QR, which comes with the event itself
  function pay(r) {
    const event = live.find((e) => e.key === r.event.id) ?? {
      key: r.event.id,
      name: r.event.title,
      fee: r.event.price,
      start: new Date(r.event.date),
      venue: r.event.location,
      raw: {},
    }
    setPaying({ event, registrationId: r.id, amountDue: r.totalAmountPaid ?? r.event.price })
  }

  if (loading) return <Loading />
  if (error) return <Alert>{error}</Alert>

  return (
    <div className="stack">
      {updates.length > 0 && (
        <section aria-label="Payment updates" className="updates">
          {updates.map((u) => (
            <div key={u.key} className={`alert alert--${u.tone} update`} role="status">
              <span>{u.text}</span>
              <span className="actions mt-0">
                <Link className="btn btn--sm" to={u.to}>{u.action}</Link>
                <button className="btn btn--sm btn--ghost" onClick={() => dismiss(u.key)}>Dismiss</button>
              </span>
            </div>
          ))}
        </section>
      )}

      {(toPay.length > 0 || bookingsToPay.length > 0) && (
        <section aria-labelledby="pay-title">
          <h2 id="pay-title" className="mb-md">Pending payments</h2>
          <div className="ticket-list">
            {toPay.map((r) => (
              <Row key={r.id} date={new Date(r.event.date)} title={<Link to={`/events/${r.event.id}`}>{r.event.title}</Link>}
                lines={[`${inr(r.totalAmountPaid ?? r.event.price)}${r.teamName ? ` · Team ${r.teamName}` : ''}`, 'Pay by UPI, then submit the transaction details.']}>
                <button className="btn btn--sm" onClick={() => pay(r)}>Submit payment</button>
              </Row>
            ))}
            {bookingsToPay.map((b) => (
              <Row key={b.id} date={new Date(b.subEvent.startTime ?? b.event.date)} title={b.subEvent.title}
                lines={[`${b.event.title} · ${inr(b.totalAmountPaid)}`, 'Session booking: pay by UPI, then submit the details.']}>
                <button className="btn btn--sm" onClick={() => setPayingBooking(b)}>Submit payment</button>
              </Row>
            ))}
          </div>
        </section>
      )}

      <section aria-labelledby="upcoming-title">
        <h2 id="upcoming-title" className="mb-md">Upcoming events</h2>
        {upcoming.length === 0 ? (
          <Empty title="Nothing coming up" actions={<Link className="btn btn--sm" to="/events/upcoming">Browse events</Link>}>
            When you register for an event, it shows up here with your master QR ticket.
          </Empty>
        ) : (
          <div className="ticket-list">
            {upcoming.map((r) => {
              const s = registrationState(r)
              const leaderPays = r.teamId && !r.isGroupLeader && r.paymentStatus === 'PENDING'
              return (
                <Row key={r.id} date={new Date(r.event.date)} title={<Link to={`/events/${r.event.id}`}>{r.event.title}</Link>}
                  lines={[
                    `${fmtDateTime(new Date(r.event.date))}${r.event.location ? `, ${r.event.location}` : ''}${r.teamName ? ` · Team ${r.teamName}` : ''}`,
                    r.teamId && !r.isGroupLeader && r.teamLeader && `Registered for your team by ${r.teamLeader}`,
                    leaderPays ? 'Your team leader submits the payment for the team.' : s.detail,
                  ]}>
                  {r.paymentStatus === 'VERIFIED' ? (
                    <Link className="btn btn--sm" to={`/tickets/${r.event.id}`}>View master QR ticket</Link>
                  ) : (
                    <Pill tone={s.tone}>{s.label}</Pill>
                  )}
                </Row>
              )
            })}
          </div>
        )}
      </section>

      {bookings.length > 0 && (
        <section aria-labelledby="sessions-title">
          <h2 id="sessions-title" className="mb-md">Session bookings</h2>
          <p className="muted small">Your event's master QR ticket also admits you to these sessions.</p>
          <div className="ticket-list">
            {bookings.map((b) => {
              const s = registrationState(b)
              return (
                <Row key={b.id} date={new Date(b.subEvent.startTime ?? b.event.date)} title={b.subEvent.title}
                  lines={[
                    [b.event.title, b.subEvent.venue, b.isPassHolder && 'Pass holder'].filter(Boolean).join(' · '),
                    b.teamId && [b.groupName || b.teamName, !b.isGroupLeader && b.teamLeader && `booked for you by ${b.teamLeader}`].filter(Boolean).join(' · '),
                  ]}>
                  <Pill tone={s.tone}>{s.label}</Pill>
                  {b.status === 'CONFIRMED' && b.paymentStatus === 'VERIFIED' && <Link className="btn btn--sm btn--ghost" to={`/tickets/${b.event.id}`}>Ticket</Link>}
                </Row>
              )
            })}
          </div>
        </section>
      )}

      <section aria-labelledby="past-title">
        <h2 id="past-title" className="mb-md">Past events attended</h2>
        {attended.length === 0 ? (
          <p className="muted">Events you are checked in at will be listed here.</p>
        ) : (
          <div className="ticket-list">
            {attended.map((r) => (
              <Row key={r.id} date={new Date(r.event.date)} year title={<Link to={`/events/${r.event.id}`}>{r.event.title}</Link>}
                lines={[`${r.event.location ?? ''}${r.teamName ? ` · Team ${r.teamName}` : ''}`]}>
                <Pill tone="ok">Attended</Pill>
              </Row>
            ))}
          </div>
        )}
      </section>

      {closed.length > 0 && (
        <section aria-labelledby="closed-title">
          <h2 id="closed-title" className="mb-md">Cancelled and refunds</h2>
          <div className="ticket-list">
            {closed.map((r) => {
              const s = registrationState(r)
              return (
                <Row key={r.id} date={new Date(r.event.date)} year title={<Link to={`/events/${r.event.id}`}>{r.event.title}</Link>} lines={[s.detail]}>
                  <Pill tone={s.tone}>{s.label}</Pill>
                </Row>
              )
            })}
          </div>
        </section>
      )}

      {paying && (
        <RegisterModal
          event={paying.event}
          registrationId={paying.registrationId}
          amountDue={paying.amountDue}
          startAt="pay"
          onClose={() => setPaying(null)}
          onChanged={() => { reload(); reloadLive() }}
        />
      )}

      {payingBooking && (
        <Modal label={`Pay for ${payingBooking.subEvent.title}`} onClose={() => { setPayingBooking(null); setBookingPaid(false) }}>
          {bookingPaid ? (
            <>
              <h2>Payment submitted</h2>
              <p>The organisers will verify it, usually within a few hours. Your master ticket admits you to {payingBooking.subEvent.title} once it is confirmed. Check back here: we don't send emails.</p>
              <button className="btn" onClick={() => { setPayingBooking(null); setBookingPaid(false) }}>Close</button>
            </>
          ) : (
            <PaymentForm
              kind="booking"
              id={payingBooking.id}
              amount={payingBooking.totalAmountPaid}
              upiQrUrl={payingEvent?.upiQrUrl}
              upiId={payingEvent?.upiId}
              upiPayeeName={payingEvent?.upiPayeeName}
              instructions={payingEvent?.paymentInstructions}
              onSubmitted={() => { setBookingPaid(true); loadBookings() }}
            />
          )}
        </Modal>
      )}
    </div>
  )
}

function Row({ date, year = false, title, lines, children }) {
  return (
    <div className="ticket-row">
      <span className="row-date"><b>{dayOf(date)}</b><span>{monthOf(date)}{year && ` ${date.getFullYear()}`}</span></span>
      <div>
        <h3>{title}</h3>
        {lines.filter(Boolean).map((l) => <p key={l}>{l}</p>)}
      </div>
      <div className="actions">{children}</div>
    </div>
  )
}
