// One event, for the staff who manage it: the live registrations sheet, analytics, the pending-payments queue,
// sessions, and the door scanner.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../api/client'
import { Alert, Loading } from '../../components/ui'
import { fmtDateTime, inr, rupees } from '../../lib/events'
import PendingPayments from './PendingPayments'
import Sessions, { CapacityEditor } from './Sessions'
import DeleteControl from './DeleteControl'
import Analytics from './Analytics'
import Registrations from './Registrations'
import EventForm from './EventForm'

export const TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'registrations', label: 'Registrations' },
  { id: 'payments', label: 'Pending payments' },
  { id: 'sessions', label: 'Sessions' },
  { id: 'analytics', label: 'Analytics' },
]

export function Stat({ label, value, note }) {
  return (
    <div className="stat">
      <span className="stat-label">{label}</span>
      <b className="stat-value">{value}</b>
      {note && <span className="stat-note">{note}</span>}
    </div>
  )
}

export default function ManageEvent({ event, tab, setTab, pending, pendingCount, onBack, onEventChanged, onDeleted, venues, admin }) {
  const [editing, setEditing] = useState(false)
  const [saved, setSaved] = useState('')
  const [analytics, setAnalytics] = useState(null)
  const [error, setError] = useState('')

  const load = useCallback(() => {
    api(`/events/${event.key}/analytics`).then(setAnalytics).catch((err) => setError(err.message))
  }, [event.key])
  useEffect(() => {
    load()
  }, [load])

  const refreshAfterDecision = () => {
    pending.reload()
    load()
    onEventChanged()
  }

  return (
    <div>
      <button className="link-btn small muted" onClick={onBack}>&larr; All events</button>
      <div className="sec-head mt-sm">
        <div>
          <h2>{event.name}</h2>
          <p className="muted mb-0">{fmtDateTime(event.start)} · {event.venue} · {inr(event.fee)}</p>
        </div>
        <div className="actions mt-0">
          <Link className="btn btn--sm" to={`/admin/scan?event=${event.key}`}>Open scanner</Link>
          <button className="btn btn--sm btn--ghost" onClick={() => { setEditing(true); setSaved('') }} disabled={editing}>Edit event</button>
          <Link className="btn btn--sm btn--ghost" to={event.href}>Public page</Link>
        </div>
      </div>
      {saved && <Alert tone="ok">{saved}</Alert>}
      {editing && (
        <EventForm
          key={event.key}
          event={event}
          venues={venues}
          admin={admin}
          onCancel={() => setEditing(false)}
          onSaved={(updated) => {
            setEditing(false)
            setSaved(`Saved the changes to ${updated.title}.`)
            onEventChanged()
            load()
          }}
        />
      )}
      <div className="mb-md">
        <DeleteControl
          kind="event"
          name={event.name}
          onDelete={(confirm) => api(`/events/${event.key}`, { method: 'DELETE', body: { confirm } })}
          onDeleted={(d) => onDeleted(d)}
        />
      </div>

      <div className="chips mb-md" role="group" aria-label="Manage this event">
        {TABS.map((t) => (
          <button key={t.id} className="chip" aria-pressed={tab === t.id} onClick={() => setTab(t.id)}>
            {t.label}
            {t.id === 'payments' && pendingCount > 0 && <span className="count">{pendingCount}</span>}
            {t.id === 'sessions' && analytics?.subEvents.length > 0 && <span className="count count--muted">{analytics.subEvents.length}</span>}
          </button>
        ))}
      </div>

      <Alert>{error}</Alert>
      {tab === 'payments' ? (
        <PendingPayments eventId={event.key} pending={pending} onDecided={refreshAfterDecision} />
      ) : tab === 'registrations' ? (
        <Registrations event={event} />
      ) : !analytics ? (
        !error && <Loading />
      ) : tab === 'analytics' ? (
        <Analytics event={event} a={analytics} onRefresh={load} />
      ) : tab === 'sessions' ? (
        <Sessions event={event} venues={venues} sessions={analytics.subEvents} onChanged={load} />
      ) : (
        <Overview event={event} a={analytics} onChanged={() => { load(); onEventChanged() }} />
      )}
    </div>
  )
}

function Overview({ event, a, onChanged }) {
  return (
    <div className="stack">
      <div className="stats">
        <Stat label="Seats filled" value={`${a.seatsFilled} / ${a.totalSeats}`} note={`${Math.max(0, a.totalSeats - a.seatsFilled)} left`} />
        <Stat label="Tickets confirmed" value={a.ticketsSold} note={a.awaitingPayment ? `${a.awaitingPayment} awaiting payment` : 'None awaiting payment'} />
        <Stat label="Checked in" value={a.mainEventAttended} note={a.ticketsSold ? `${Math.round((a.mainEventAttended / a.ticketsSold) * 100)}% of tickets` : undefined} />
        <Stat label="Revenue" value={rupees(a.totalRevenue)} note={`${rupees(a.mainEventRevenue)} event · ${rupees(a.subEventRevenue)} sessions`} />
        <Stat label="Refunds due" value={a.refundRequiredCount} note={a.refundedCount ? `${a.refundedCount} refunded` : undefined} />
      </div>
      <section className="panel panel--tight">
        <h3 className="mb-md">Capacity</h3>
        <p className="muted small">
          You can lower it below the seats already taken. Nobody loses a seat, but new registrations are refused and
          later approvals past the limit are marked for a refund.
        </p>
        <CapacityEditor
          current={a.totalSeats}
          save={(capacity) => api(`/events/${event.key}/capacity`, { method: 'PATCH', body: { capacity } })}
          onSaved={onChanged}
        />
      </section>
    </div>
  )
}
