// Registering for a live event, alone or as a team. Free events confirm straight away; paid events take a manual UPI
// payment that the organisers verify (PaymentForm). Opened from an event (step 'confirm') or from My tickets to finish
// a pending payment (step 'pay').
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../api/client'
import { useAuth } from '../context/auth'
import { eventWindows, useClashes } from '../lib/clashes'
import { fmtDateTime, inr, priceForTeam, rupees } from '../lib/events'
import ClashNotice from './ClashNotice'
import PaymentForm from './PaymentForm'
import { Alert, Modal } from './ui'

const MAX_TEAMMATES = 10
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export default function RegisterModal({ event, registrationId: existingId = null, amountDue = null, startAt = 'confirm', onClose, onChanged }) {
  const { user } = useAuth()
  const [step, setStep] = useState(startAt)
  const [registrationId, setRegistrationId] = useState(existingId)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [asTeam, setAsTeam] = useState(false)
  const clashes = useClashes({ kind: 'event', id: event.key, eventId: event.key, windows: eventWindows({ date: event.raw?.date ?? event.start, schedule: event.raw?.schedule }) })
  const [teamName, setTeamName] = useState('')
  const [mates, setMates] = useState([''])
  const [teamSize, setTeamSize] = useState(1)
  const paid = event.fee > 0

  const setMate = (i, v) => setMates((m) => m.map((x, j) => (j === i ? v : x)))
  // You (the leader) count as one member. With a group offer, a team is at most the offer's size.
  const teamCap = event.teamCap ?? (event.raw?.maxTeamSize ?? event.raw?.groupSize ?? null) // null: individuals only
  const maxMates = Math.min((teamCap ?? 1) - 1, MAX_TEAMMATES)
  const addMate = () => setMates((m) => (m.length < maxMates ? [...m, ''] : m))
  const removeMate = (i) => setMates((m) => (m.length > 1 ? m.filter((_, j) => j !== i) : ['']))

  function readTeam() {
    const emails = mates.map((m) => m.trim().toLowerCase()).filter(Boolean)
    if (!teamName.trim()) return { error: 'Enter a team name.' }
    if (!emails.length) return { error: 'Add at least one teammate email.' }
    if (emails.some((m) => !EMAIL.test(m))) return { error: 'One of the teammate emails is not valid.' }
    if (new Set(emails).size !== emails.length) return { error: 'The same teammate email is listed twice.' }
    if (emails.includes(user.email.toLowerCase())) return { error: "Don't add your own email; you are included as the team leader." }
    // The team pays the group offer if it is exactly the offer's size, otherwise the individual price per member
    const total = paid ? priceForTeam(event, 1 + emails.length) : null
    return { body: { teamName: teamName.trim(), teammateEmails: emails, ...(total && { totalAmountPaid: total }) } }
  }

  async function register() {
    let body = {}
    if (asTeam) {
      const team = readTeam()
      if (team.error) return setError(team.error)
      body = team.body
    }
    setBusy(true)
    setError('')
    try {
      const r = await api(`/registrations/${event.key}`, { method: 'POST', body })
      setRegistrationId(r.id)
      setTeamSize(1 + (r.teammates?.length ?? 0))
      onChanged?.()
      setStep(r.paymentStatus === 'VERIFIED' ? 'done' : 'pay')
    } catch (err) {
      setError(err.status === 409 ? `${err.message} Open your dashboard to see your registration.` : err.message)
    } finally {
      setBusy(false)
    }
  }

  // What to prefill as the amount paid
  const expected = amountDue ?? priceForTeam(event, teamSize)
  const people = 1 + mates.filter((m) => m.trim()).length
  const offerApplies = event.groupSize === people

  return (
    <Modal label={`Register for ${event.name}`} onClose={onClose}>
      {step === 'confirm' && (
        <>
          <h2>Confirm registration</h2>
          <p className="mb-0"><b>{event.name}</b></p>
          <p className="muted">{fmtDateTime(event.start)}{event.venue && `, ${event.venue}`}</p>
          <p className="muted small">Registering as {user?.name ? `${user.name} (${user.email})` : user?.email}</p>
          <p className={event.groupSize ? 'mb-0' : undefined}>Fee: <b>{inr(event.fee)}</b>{paid && ' per person'}</p>
          {event.groupSize && <p className="small accent">Group offer: {event.groupSize} people for {rupees(event.groupPrice)} in total. Register as a team of {event.groupSize} to get it.</p>}

          {teamCap && (
            <label className="switch">
              <input type="checkbox" checked={asTeam} onChange={(e) => { setAsTeam(e.target.checked); setError('') }} />
              <span className="switch-track" aria-hidden="true" />
              <span>Registering as a team? <span className="muted small">(up to {teamCap} people)</span></span>
            </label>
          )}

          {teamCap && asTeam && (
            <div className="team-box">
              <div className="field">
                <label htmlFor="team-name">Team name</label>
                <input id="team-name" maxLength={100} value={teamName} onChange={(e) => setTeamName(e.target.value)} />
              </div>
              <fieldset className="field mates">
                <legend>Teammates <span className="muted">(you + {mates.length} = team of {1 + mates.length}, at most {maxMates + 1})</span></legend>
                <p className="hint mt-0 mb-md">You are the team leader and already counted. Add only the other members' emails: you register and pay for everyone, and they don't register themselves.</p>
                {mates.map((m, i) => (
                  <div className="mate-row" key={i}>
                    <input type="email" aria-label={`Teammate ${i + 1} email`} placeholder="teammate@email.com" value={m} onChange={(e) => setMate(i, e.target.value)} />
                    <button type="button" className="btn btn--sm btn--ghost" onClick={() => removeMate(i)} aria-label={`Remove teammate ${i + 1}`}>Remove</button>
                  </div>
                ))}
                {mates.length < maxMates && (
                  <button type="button" className="link-btn" onClick={addMate}>+ Add another teammate</button>
                )}
                <p className="hint">Every teammate needs to have signed in to Swayam once with this Google account. Their ticket appears on their own dashboard.</p>
              </fieldset>
              {paid && (
                <div className="field team-total" aria-live="polite">
                  <p className="mb-0">
                    Team of {people}: <b>{rupees(priceForTeam(event, people))}</b>
                    {offerApplies && <span className="pill pill--accent pill--inline">Group offer</span>}
                  </p>
                  <p className="hint">
                    {offerApplies
                      ? `Group offer applied: ${people} people for ${rupees(event.groupPrice)} instead of ${rupees(event.fee * people)}.`
                      : event.groupSize
                        ? `${inr(event.fee)} per person. A team of exactly ${event.groupSize} pays ${rupees(event.groupPrice)} in total.`
                        : `${inr(event.fee)} per person.`}{' '}
                    You pay for the whole team in one UPI payment.
                  </p>
                </div>
              )}
            </div>
          )}

          {paid && <p className="small muted">You will pay by UPI on the next step. Seats are held while the organisers verify the payment.</p>}
          {step === 'confirm' && <ClashNotice clashes={clashes} />}
          <Alert>{error}</Alert>
          <div className="actions">
            <button className="btn" onClick={register} disabled={busy}>
              {busy ? 'Registering…' : paid ? 'Register and pay' : asTeam ? 'Register team' : 'Register now'}
            </button>
            <button className="btn btn--ghost" onClick={onClose}>Cancel</button>
          </div>
        </>
      )}

      {step === 'pay' && (
        <PaymentForm
          kind="registration"
          id={registrationId}
          amount={expected}
          upiQrUrl={event.raw?.upiQrUrl}
          upiId={event.raw?.upiId}
          upiPayeeName={event.raw?.upiPayeeName}
          instructions={event.raw?.paymentInstructions}
          onSubmitted={() => { onChanged?.(); setStep('submitted') }}
          onLater={onClose}
        />
      )}

      {step === 'submitted' && (
        <>
          <h2>Payment submitted</h2>
          <p>Thanks. The organisers will check your payment against their UPI statement. {teamSize > 1 ? 'Every team member' : 'You'} will see the ticket on their dashboard as soon as it is verified.</p>
          <div className="actions">
            <Link className="btn" to="/dashboard" onClick={onClose}>Go to your dashboard</Link>
            <button className="btn btn--ghost" onClick={onClose}>Close</button>
          </div>
        </>
      )}

      {step === 'done' && (
        <>
          <h2>{teamSize > 1 ? 'Your team is registered' : "You're registered"}</h2>
          <p>
            {teamSize > 1
              ? `All ${teamSize} members of your team are registered for ${event.name}. Each member can open their own ticket from their dashboard.`
              : <>Your ticket for <b>{event.name}</b> is ready. Show its QR code at the entrance.</>}
          </p>
          <div className="actions">
            <Link className="btn" to={`/tickets/${event.key}`} onClick={onClose}>View ticket</Link>
            <button className="btn btn--ghost" onClick={onClose}>Close</button>
          </div>
        </>
      )}
    </Modal>
  )
}
