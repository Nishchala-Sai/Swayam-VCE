import { useState } from 'react'
import { Link } from 'react-router-dom'
import QrTicket from '../components/QrTicket'
import { Alert, Empty, Loading, Modal, Pill } from '../components/ui'
import { useAuth } from '../context/auth'
import { registrationState, useMyRegistrations } from '../hooks/useMyRegistrations'
import { dayOf, fmtDate, fmtDateTime, monthOf } from '../lib/events'

const ROLE_LABEL = { STUDENT: 'Student', EVENT_HEAD: 'Event head', ADMIN: 'Admin' }

export default function Profile() {
  const { user, updateName } = useAuth()
  const { items, loading, error } = useMyRegistrations()
  const [qrFor, setQrFor] = useState(null) // registration whose QR is open
  const now = new Date()

  // Active registrations only: cancelled and refunded ones are neither upcoming nor attended
  const active = items.filter((r) => r.status === 'CONFIRMED')
  const upcoming = active.filter((r) => new Date(r.event.date) >= now).sort((a, b) => new Date(a.event.date) - new Date(b.event.date))
  const past = active.filter((r) => new Date(r.event.date) < now).sort((a, b) => new Date(b.event.date) - new Date(a.event.date))

  return (
    <div className="w page">
      <div className="profile-head">
        <span className="avatar" aria-hidden="true">{(user.name || user.email)[0].toUpperCase()}</span>
        <div>
          <h1 className="mb-0">{user.name || 'Your profile'}</h1>
          <p className="muted mb-0">{user.email}</p>
        </div>
      </div>

      <div className="split">
        <div className="stack">
          <section>
            <h2 className="mb-md">Upcoming events</h2>
            {loading ? <Loading /> : error ? <Alert>{error}</Alert> : upcoming.length === 0 ? (
              <Empty title="Nothing coming up" actions={<Link className="btn btn--sm" to="/events/upcoming">Find an event</Link>}>
                Events you register for will appear here with their entry QR code.
              </Empty>
            ) : (
              <div className="ticket-list">
                {upcoming.map((r) => {
                  const start = new Date(r.event.date)
                  const s = registrationState(r)
                  const ready = r.paymentStatus === 'VERIFIED'
                  return (
                    <div key={r.id} className="ticket-row">
                      <span className="row-date"><b>{dayOf(start)}</b><span>{monthOf(start)}</span></span>
                      <div>
                        <h3><Link to={`/events/${r.event.id}`}>{r.event.title}</Link></h3>
                        <p>{fmtDateTime(start)}{r.event.location && `, ${r.event.location}`}</p>
                      </div>
                      <div className="actions">
                        {ready ? (
                          <button className="btn btn--sm" onClick={() => setQrFor(r)}>View QR code</button>
                        ) : (
                          <><Pill tone={s.tone}>{s.label}</Pill><Link className="btn btn--sm btn--ghost" to="/dashboard">Details</Link></>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-md">Past events</h2>
            {loading ? <Loading /> : past.length === 0 ? (
              <p className="muted">No past events yet. Events you take part in will be listed here afterwards.</p>
            ) : (
              <div className="ticket-list">
                {past.map((r) => {
                  const start = new Date(r.event.date)
                  return (
                    <div key={r.id} className="ticket-row">
                      <span className="row-date"><b>{dayOf(start)}</b><span>{monthOf(start)} {start.getFullYear()}</span></span>
                      <div>
                        <h3><Link to={`/events/${r.event.id}`}>{r.event.title}</Link></h3>
                        <p>{r.event.location}</p>
                      </div>
                      <div className="actions">
                        {r.attendedAt ? <Pill tone="ok">Attended</Pill> : <Pill>Registered</Pill>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>

        <aside className="panel aside">
          <h2 className="mb-md">Account</h2>
          <NameForm current={user.name} onSave={updateName} />
          <dl className="defs mt-md">
            <div><dt>Email</dt><dd>{user.email}</dd></div>
            <div><dt>Role</dt><dd>{ROLE_LABEL[user.role] ?? user.role}</dd></div>
            <div><dt>Member since</dt><dd>{fmtDate(new Date(user.createdAt))}</dd></div>
            <div><dt>Events</dt><dd>{upcoming.length} upcoming, {past.length} past</dd></div>
          </dl>
          <p className="small muted mt-md">You sign in with Google, so there is no password to manage here.</p>
        </aside>
      </div>

      {qrFor && (
        <Modal label={`Ticket for ${qrFor.event.title}`} onClose={() => setQrFor(null)}>
          <div className="center">
            <h2>{qrFor.event.title}</h2>
            <p className="muted">{fmtDateTime(new Date(qrFor.event.date))}</p>
            <QrTicket eventId={qrFor.event.id} />
            <div className="actions mt-md">
              <Link className="btn btn--sm" to={`/tickets/${qrFor.event.id}`}>Open full ticket</Link>
              <button className="btn btn--sm btn--ghost" onClick={() => setQrFor(null)}>Close</button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  )
}

function NameForm({ current, onSave }) {
  const [name, setName] = useState(current ?? '')
  const [state, setState] = useState({ busy: false, error: '', saved: false })

  async function submit(e) {
    e.preventDefault()
    if (!name.trim()) return setState({ busy: false, error: 'Enter your name.', saved: false })
    setState({ busy: true, error: '', saved: false })
    try {
      await onSave(name.trim())
      setState({ busy: false, error: '', saved: true })
    } catch (err) {
      setState({ busy: false, error: err.message, saved: false })
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <div className="field">
        <label htmlFor="pname">Name</label>
        <input id="pname" autoComplete="name" value={name} onChange={(e) => { setName(e.target.value); setState((s) => ({ ...s, saved: false })) }} />
      </div>
      <Alert>{state.error}</Alert>
      {state.saved && <Alert tone="ok">Saved.</Alert>}
      <button className="btn btn--sm" type="submit" disabled={state.busy || name.trim() === (current ?? '')}>{state.busy ? 'Saving…' : 'Save name'}</button>
    </form>
  )
}
