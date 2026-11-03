// Dashboard for ADMIN (every event, club-wide analytics, creating events) and EVENT_HEAD (the events they created).
// The open event and tab live in the URL (?event=<id>&tab=payments), so the back button and shared links work.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { api } from '../../api/client'
import { Alert, Empty, Loading } from '../../components/ui'
import { useAuth } from '../../context/auth'
import { useLiveEvents } from '../../hooks/useLiveEvents'
import { dayOf, inr, monthOf, rupees } from '../../lib/events'
import EventForm from './EventForm'
import ManageEvent, { Stat, TABS } from './ManageEvent'
import { usePendingPayments } from './PendingPayments'
import Students from './Students'
import Venues from './Venues'

export default function StaffDashboard({ admin }) {
  const { user } = useAuth()
  const { live, loading, error, reload } = useLiveEvents()
  const pending = usePendingPayments()
  const [params, setParams] = useSearchParams()
  const [creating, setCreating] = useState(false)
  const [notice, setNotice] = useState('')
  const [venues, setVenues] = useState([])
  const loadVenues = useCallback(() => api('/venues').then((v) => setVenues(v ?? [])).catch(() => setVenues([])), [])
  useEffect(() => {
    loadVenues()
  }, [loadVenues])

  const events = useMemo(() => (admin ? live : live.filter((e) => e.raw.createdBy === user.id)), [admin, live, user.id])
  const current = events.filter((e) => e.phase !== 'past').sort((a, b) => a.start - b.start)
  const past = events.filter((e) => e.phase === 'past').sort((a, b) => b.start - a.start)

  // Entries waiting for a decision, per event (a team counts once)
  const pendingByEvent = useMemo(() => {
    const counts = {}
    for (const r of [...pending.registration, ...pending.booking]) counts[r.event.id] = (counts[r.event.id] ?? 0) + 1
    return counts
  }, [pending.registration, pending.booking])

  const openId = params.get('event')
  const open = openId && events.find((e) => e.key === openId)
  const tab = TABS.some((t) => t.id === params.get('tab')) ? params.get('tab') : 'overview'
  const go = (eventId, nextTab = 'overview') => setParams(eventId ? { event: eventId, tab: nextTab } : {})

  if (admin && params.get('view') === 'students') return <Students onBack={() => setParams({})} />
  if (loading) return <Loading />
  if (error) return <Alert>{error}</Alert>
  if (openId && !open) {
    return (
      <Empty title="Event not found" actions={<button className="btn btn--sm" onClick={() => go(null)}>All events</button>}>
        {admin ? 'This event no longer exists.' : 'You can only manage events you created.'}
      </Empty>
    )
  }
  if (open) {
    return (
      <ManageEvent
        event={open}
        tab={tab}
        setTab={(t) => go(open.key, t)}
        pending={pending}
        pendingCount={pendingByEvent[open.key] ?? 0}
        onBack={() => go(null)}
        onEventChanged={reload}
        onDeleted={(d) => {
          const counts = d.deleted.registrations + d.deleted.bookings
          setNotice(`${d.title} was deleted${counts ? `, with ${d.deleted.registrations} registrations and ${d.deleted.bookings} session bookings` : ''}.`)
          pending.reload()
          reload()
          go(null)
        }}
        venues={venues}
        admin={admin}
      />
    )
  }

  const row = (e) => (
    <div key={e.key} className="ticket-row">
      <span className="row-date"><b>{dayOf(e.start)}</b><span>{monthOf(e.start)} {e.start.getFullYear()}</span></span>
      <div>
        <h3><button className="link-btn" onClick={() => go(e.key)}>{e.name}</button></h3>
        <p>
          {e.venue} · {inr(e.fee)} · {e.taken ?? 0} / {e.capacity} seats
          {admin && e.raw.createdBy === user.id && ' · Created by you'}
        </p>
      </div>
      <div className="actions">
        <button className="btn btn--sm btn--ghost" onClick={() => go(e.key, 'registrations')}>Registrations</button>
        <button className="btn btn--sm btn--ghost" onClick={() => go(e.key, 'payments')}>
          Pending payments{pendingByEvent[e.key] ? <span className="count">{pendingByEvent[e.key]}</span> : null}
        </button>
        <button className="btn btn--sm btn--ghost" onClick={() => go(e.key, 'sessions')}>Sessions</button>
        <Link className="btn btn--sm" to={`/admin/scan?event=${e.key}`}>Scanner</Link>
      </div>
    </div>
  )

  return (
    <div className="stack">
      {admin && <ClubOverview onStudents={() => setParams({ view: 'students' })} />}

      <section aria-labelledby="events-title">
        <div className="sec-head mb-md">
          <h2 id="events-title">{admin ? 'All events' : 'Your events'}</h2>
          {!creating && <button className="btn btn--sm" onClick={() => { setCreating(true); setNotice('') }}>Create event</button>}
        </div>
        {notice && <Alert tone="ok">{notice}</Alert>}
        {creating && (
          <EventForm
            venues={venues}
            admin={admin}
            onCancel={() => setCreating(false)}
            onCreated={(created) => {
              setCreating(false)
              setNotice(`${created.title} was created. Students can register now.`)
              reload()
            }}
          />
        )}
        {events.length === 0 ? (
          <Empty title="No events yet">
            Create an event to start taking registrations.
          </Empty>
        ) : (
          <>
            {current.length > 0 ? <div className="ticket-list">{current.map(row)}</div> : <p className="muted">No upcoming or ongoing events.</p>}
            {past.length > 0 && (
              <>
                <h3 className="mt-lg mb-md muted">Past events</h3>
                <div className="ticket-list">{past.map(row)}</div>
              </>
            )}
          </>
        )}
      </section>

      {admin && <Venues venues={venues} onChanged={loadVenues} />}
    </div>
  )
}

// Club-wide numbers (ADMIN only): GET /api/analytics/overview
function ClubOverview({ onStudents }) {
  const [o, setO] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    api('/analytics/overview').then(setO).catch((err) => setError(err.message))
  }, [])

  return (
    <section aria-labelledby="overview-title">
      <div className="sec-head mb-md">
        <h2 id="overview-title">Overview</h2>
        <button className="btn btn--sm btn--ghost" onClick={onStudents}>All students</button>
      </div>
      <Alert>{error}</Alert>
      {!o ? !error && <Loading /> : (
        <div className="stats">
          <Stat label="Total revenue" value={rupees(o.totalRevenue)} note="Verified payments, events and sessions" />
          <Stat label="Total users" value={o.totalUsers.toLocaleString('en-IN')} />
          <Stat label="Tickets confirmed" value={o.totalTicketsSold.toLocaleString('en-IN')} note={`${o.totalSubEventBookings} session bookings`} />
          <Stat label="Events" value={o.totalEvents} />
          <Stat label="Pending payments" value={o.pendingPayments} note={o.refundsDue ? `${o.refundsDue} refunds due` : 'No refunds due'} />
        </div>
      )}
    </section>
  )
}
