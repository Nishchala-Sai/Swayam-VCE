// Sub-events (workshops, hackathon, auction) of a live event, with booking. Students with a verified registration for
// the main event pay the pass-holder price; everyone else pays the standalone price. Paid bookings go through the same
// manual UPI step as registrations; free ones are confirmed at once. Entry is with the student's master ticket.
// Team competitions (teamSize > 1) are booked under a team name with up to teamSize people; the organisers may
// later couple short teams into full ones, shown to the student as their competing team.
import { useCallback, useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/auth'
import { registrationState } from '../hooks/useMyRegistrations'
import { sessionWindows, useClashes } from '../lib/clashes'
import { fmtRange, inr } from '../lib/events'
import ClashNotice from './ClashNotice'
import PaymentForm from './PaymentForm'
import { Alert, Modal, Pill } from './ui'

const EMAIL = /^[^s@]+@[^s@]+.[^s@]+$/

export default function SubEvents({ event, registration }) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const [subs, setSubs] = useState(null)
  const [bookings, setBookings] = useState([])
  const [booking, setBooking] = useState(null) // { sub, startAt, bookingId?, amount? }

  const load = useCallback(() => {
    api(`/events/${event.key}/sub-events`).then((s) => setSubs(s ?? [])).catch(() => setSubs([]))
    if (user) api('/registrations/bookings/me').then((b) => setBookings(b ?? [])).catch(() => setBookings([]))
  }, [event.key, user])
  useEffect(() => load(), [load])

  if (!subs?.length) return null
  const passHolder = registration?.status === 'CONFIRMED' && registration?.paymentStatus === 'VERIFIED'
  const open = event.phase !== 'past'

  function book(sub) {
    if (!user) return navigate('/login', { state: { from: location.pathname } })
    setBooking({ sub, startAt: 'confirm' })
  }

  return (
    <section className="mt-lg" aria-labelledby="subevents-title">
      <h2 id="subevents-title" className="mb-md">Sessions you can book</h2>
      <p className="muted mb-md">
        Some sessions need their own booking. Students registered for {event.name} pay the event-pass price; anyone can
        book at the standalone price. Your event ticket's QR code gets you into the sessions you book.
      </p>
      <div className="ticket-list">
        {subs.map((s) => {
          const mine = bookings.find((b) => b.subEvent.id === s.id)
          const state = mine && registrationState(mine)
          const yourPrice = passHolder ? s.priceForPassHolders : s.priceForStandalone
          const full = s.seatsLeft <= 0
          const locked = s.passHoldersOnly && !passHolder // ticket holders only, and this student has no confirmed ticket
          return (
            <div key={s.id} className="ticket-row">
              <span className="row-date">
                {s.startTime ? <><b>{new Date(s.startTime).getDate()}</b><span>{new Date(s.startTime).toLocaleDateString('en-IN', { month: 'short' })}</span></> : <b>·</b>}
              </span>
              <div>
                <h3>
                  {s.title}
                  {s.teamSize > 1 && <span className="pill pill--accent pill--inline">Teams of {s.teamSize}</span>}
                  {s.passHoldersOnly && <span className="pill pill--inline">Ticket holders only</span>}
                </h3>
                <p>{[s.venue, s.startTime && fmtRange(new Date(s.startTime), s.endTime && new Date(s.endTime)), `${Math.max(0, s.seatsLeft)} of ${s.capacity} seats left`].filter(Boolean).join(' · ')}</p>
                <p>
                  {s.passHoldersOnly ? <>With an event ticket: <b>{inr(s.priceForPassHolders)}</b></> : <>With an event ticket: <b>{inr(s.priceForPassHolders)}</b> · Without: <b>{inr(s.priceForStandalone)}</b></>}
                  {user && !mine && !locked && <> · Your price: <b className="accent">{inr(yourPrice)}</b>{s.teamSize > 1 && ' each'}</>}
                </p>
                {mine?.status === 'CONFIRMED' && (mine.groupName || mine.teamName) && (
                  <p>
                    Your team: <b>{mine.groupName || mine.teamName}</b>{mine.groupName && mine.teamName && mine.groupName !== mine.teamName && ` (booked as ${mine.teamName})`}
                    {mine.teamId && !mine.isGroupLeader && mine.teamLeader && ` · booked for you by ${mine.teamLeader}`}
                  </p>
                )}
              </div>
              <div className="actions">
                {mine ? (
                  <>
                    <Pill tone={state.tone}>{state.label}</Pill>
                    {mine.status === 'CONFIRMED' && mine.paymentStatus === 'PENDING' && !mine.utrNumber && (mine.isGroupLeader || !mine.teamId) && (
                      <button className="btn btn--sm" onClick={() => setBooking({ sub: s, startAt: 'pay', bookingId: mine.id, amount: mine.totalAmountPaid ?? yourPrice })}>Submit payment</button>
                    )}
                  </>
                ) : (
                  <button className="btn btn--sm" onClick={() => book(s)} disabled={!open || full || locked} title={locked ? `Register for ${event.name} first; this session opens once your payment is confirmed.` : undefined}>
                    {!open ? 'Ended' : full ? 'Full' : locked ? 'Ticket needed' : 'Book'}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {booking && (
        <BookModal
          event={event}
          sub={booking.sub}
          passHolder={passHolder}
          startAt={booking.startAt}
          existingId={booking.bookingId}
          existingAmount={booking.amount}
          onClose={() => setBooking(null)}
          onChanged={load}
        />
      )}
    </section>
  )
}

function BookModal({ event, sub, passHolder, startAt, existingId, existingAmount, onClose, onChanged }) {
  const clashes = useClashes({ kind: 'session', id: sub.id, eventId: event.key, windows: sessionWindows(sub) })
  const { user } = useAuth()
  const teamSize = sub.teamSize ?? 1
  const asTeam = teamSize > 1
  const [teamName, setTeamName] = useState('')
  const [mates, setMates] = useState([])
  const [step, setStep] = useState(startAt)
  const [bookingId, setBookingId] = useState(existingId ?? null)
  const [amount, setAmount] = useState(existingAmount ?? (passHolder ? sub.priceForPassHolders : sub.priceForStandalone))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const price = passHolder ? sub.priceForPassHolders : sub.priceForStandalone

  // The team part of the request body, or { error }
  function readTeam() {
    if (!asTeam) return { body: {} }
    if (!teamName.trim()) return { error: 'Give your team a name.' }
    const emails = mates.map((m) => m.trim().toLowerCase()).filter(Boolean)
    if (emails.some((m) => !EMAIL.test(m))) return { error: 'One of the teammate emails is not valid.' }
    if (new Set(emails).size !== emails.length) return { error: 'The same teammate email is listed twice.' }
    if (emails.includes(user.email)) return { error: "Don't list your own email; you're already in the team." }
    return { body: { teamName: teamName.trim(), ...(emails.length && { teammateEmails: emails }) } }
  }

  async function confirm() {
    const team = readTeam()
    if (team.error) return setError(team.error)
    setBusy(true)
    setError('')
    try {
      const b = await api('/registrations/book-sub-event', { method: 'POST', body: { subEventId: sub.id, ...team.body } })
      setBookingId(b.id)
      // Each member is priced on their own pass; the leader pays for the whole team
      setAmount([b, ...(b.teammates ?? [])].reduce((sum, m) => sum + (m.price ?? price), 0))
      onChanged()
      setStep(b.paymentStatus === 'VERIFIED' ? 'done' : 'pay')
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal label={`Book ${sub.title}`} onClose={onClose}>
      {step === 'confirm' && (
        <>
          <h2>Book {sub.title}</h2>
          <p className="muted">{[event.name, sub.venue, sub.startTime && fmtRange(new Date(sub.startTime), sub.endTime && new Date(sub.endTime))].filter(Boolean).join(' · ')}</p>
          <p>Your price: <b>{inr(price)}</b> {passHolder ? '(with your event ticket)' : '(without an event ticket)'}</p>
          {asTeam && (
            <div className="team-box">
              <p className="small mt-0">
                <b>{sub.title} is played in teams of {teamSize}, including you.</b> You book for the whole team: add up to {teamSize - 1} teammate
                {teamSize > 2 ? 's' : ''} below (not yourself), and they don't book separately. Short of {teamSize}? Book anyway: the organisers may pair you with another short team.
              </p>
              <div className="field">
                <label htmlFor="sub-team-name">Team name</label>
                <input id="sub-team-name" maxLength={100} value={teamName} onChange={(e) => setTeamName(e.target.value)} placeholder="Team A" />
              </div>
              <fieldset className="field mates">
                <legend>Teammates <span className="muted">(you + {mates.length} = team of {1 + mates.length}, at most {teamSize})</span></legend>
                {mates.map((m, i) => (
                  <div className="mate-row" key={i}>
                    <input type="email" aria-label={`Teammate ${i + 1} email`} placeholder="teammate@email.com" value={m} onChange={(e) => setMates((ms) => ms.map((x, j) => (j === i ? e.target.value : x)))} />
                    <button type="button" className="btn btn--sm btn--ghost" onClick={() => setMates((ms) => ms.filter((_, j) => j !== i))} aria-label={`Remove teammate ${i + 1}`}>Remove</button>
                  </div>
                ))}
                {mates.length < teamSize - 1 && (
                  <button type="button" className="link-btn" onClick={() => setMates((ms) => [...ms, ''])}>+ Add a teammate</button>
                )}
                <p className="hint">Teammates need a Swayam account.{sub.passHoldersOnly ? ' Every teammate also needs a confirmed event ticket.' : ' Each is priced on their own event ticket.'} You pay for the team.</p>
              </fieldset>
            </div>
          )}
          {!passHolder && sub.priceForPassHolders < sub.priceForStandalone && (
            <p className="small muted">
              Students with a confirmed {event.name} registration pay {inr(sub.priceForPassHolders)}. If you plan to attend
              the main event, register for it first.
            </p>
          )}
          {price > 0 && <p className="small muted">You will pay by UPI on the next step. Your seat is held while the organisers verify it.</p>}
          <ClashNotice clashes={clashes} />
          <Alert>{error}</Alert>
          <div className="actions">
            <button className="btn" onClick={confirm} disabled={busy}>{busy ? 'Booking…' : price > 0 ? 'Book and pay' : 'Book now'}</button>
            <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          </div>
        </>
      )}
      {step === 'pay' && (
        <PaymentForm
          kind="booking"
          id={bookingId}
          amount={amount}
          upiQrUrl={event.raw?.upiQrUrl}
          upiId={event.raw?.upiId}
          upiPayeeName={event.raw?.upiPayeeName}
          instructions={event.raw?.paymentInstructions}
          onSubmitted={() => { onChanged(); setStep('submitted') }}
          onLater={onClose}
        />
      )}
      {step === 'submitted' && (
        <>
          <h2>Payment submitted</h2>
          <p>The organisers will verify your payment. Once it is confirmed, your event ticket's QR code gets you into {sub.title}.</p>
          <div className="actions">
            <Link className="btn" to="/dashboard" onClick={onClose}>Go to your dashboard</Link>
            <button className="btn btn--ghost" onClick={onClose}>Close</button>
          </div>
        </>
      )}
      {step === 'done' && (
        <>
          <h2>You're booked</h2>
          <p>Your place in {sub.title} is confirmed. Show your ticket's QR code at the session.</p>
          <div className="actions">
            <Link className="btn" to={`/tickets/${event.key}`} onClick={onClose}>View ticket</Link>
            <button className="btn btn--ghost" onClick={onClose}>Close</button>
          </div>
        </>
      )}
    </Modal>
  )
}
