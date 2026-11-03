// Analytics for one event (GET /api/events/:id/analytics, already loaded by ManageEvent): headline numbers, the
// main-entrance check-in log, and booked vs attended for every session, with the teams of team competitions.
// While the tab is open it refreshes every 30 seconds, so it can stay up on a laptop at the door.
import { useEffect, useMemo, useState } from 'react'
import { download } from '../../api/client'
import { Alert, Empty } from '../../components/ui'
import { fmtRange, rupees } from '../../lib/events'
import { Stat } from './ManageEvent'

const REFRESH_MS = 30000
const time = (iso) => new Date(iso).toLocaleTimeString('en-US', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true })
const day = (iso) => new Date(iso).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })
const pct = (part, whole) => (whole ? Math.round((part / whole) * 100) : 0)

function downloadCsv(name, rows) {
  const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
  const csv = [['Name', 'Email', 'Ticket ID', 'Team', 'Checked in (IST)'], ...rows.map((c) => [c.name, c.email, c.ticketId, c.teamName, `${day(c.checkedInAt)} ${time(c.checkedInAt)}`])]
    .map((r) => r.map(cell).join(','))
    .join('\r\n')
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: name })
  a.click()
  URL.revokeObjectURL(url)
}

export default function Analytics({ event, a, onRefresh }) {
  const [query, setQuery] = useState('')
  const [updated, setUpdated] = useState(() => new Date())
  const [csv, setCsv] = useState({ busy: false, error: '' })

  // Everyone registered, built by the server (GET /api/events/:id/export)
  async function exportAttendees() {
    setCsv({ busy: true, error: '' })
    try {
      await download(`/events/${event.key}/export`, `${event.name} attendees.csv`)
      setCsv({ busy: false, error: '' })
    } catch (err) {
      setCsv({ busy: false, error: err.message })
    }
  }

  useEffect(() => {
    const id = setInterval(() => { onRefresh(); setUpdated(new Date()) }, REFRESH_MS)
    return () => clearInterval(id)
  }, [onRefresh])

  const log = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? a.checkIns.filter((c) => [c.name, c.email, c.ticketId, c.teamName].some((v) => v?.toLowerCase().includes(q))) : a.checkIns
  }, [a.checkIns, query])
  const multiDay = new Set(a.checkIns.map((c) => day(c.checkedInAt))).size > 1

  return (
    <div className="stack">
      <section aria-label="Headline numbers">
        <div className="stats">
          <Stat label="Total revenue" value={rupees(a.totalRevenue)} note={`${rupees(a.mainEventRevenue)} event · ${rupees(a.subEventRevenue)} sessions`} />
          <Stat label="Tickets sold" value={a.ticketsSold} note={`${a.seatsFilled} of ${a.totalSeats} seats filled · ${a.seatsAvailable} available`} />
          <Stat label="Checked in" value={a.mainEventAttended} note={a.ticketsSold ? `${pct(a.mainEventAttended, a.ticketsSold)}% of tickets` : 'No tickets yet'} />
        </div>
        <p className="small muted mt-sm">
          Updates every 30 seconds · last {updated.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}{' '}
          <button className="link-btn small accent" onClick={() => { onRefresh(); setUpdated(new Date()) }}>Refresh now</button>
        </p>
        <div className="actions">
          <button className="btn btn--sm" disabled={csv.busy} onClick={exportAttendees}>{csv.busy ? 'Preparing…' : 'Download CSV'}</button>
          <span className="small muted">Everyone registered: name, email, registration code, payment status and check-in time.</span>
        </div>
        <Alert>{csv.error}</Alert>
      </section>

      <section aria-labelledby="log-title">
        <div className="sec-head mb-md">
          <h3 id="log-title">Check-in log <span className="muted small">({a.checkIns.length})</span></h3>
          <div className="actions mt-0">
            <input className="log-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, email or ticket" aria-label="Search the check-in log" />
            <button className="btn btn--sm btn--ghost" disabled={!a.checkIns.length} onClick={() => downloadCsv(`${event.name} check-ins.csv`, a.checkIns)}>Export check-ins</button>
          </div>
        </div>
        {a.checkIns.length === 0 ? (
          <Empty title="Nobody checked in yet">People appear here as soon as their ticket is scanned at the main entrance.</Empty>
        ) : log.length === 0 ? (
          <p className="muted">No check-ins match "{query}".</p>
        ) : (
          <div className="dtable dtable--log" role="table" aria-label="Check-in log">
            <div className="dtable-head" role="row">
              <span role="columnheader">Name</span>
              <span role="columnheader">Email</span>
              <span role="columnheader">Ticket ID</span>
              <span role="columnheader">Checked in</span>
            </div>
            {log.map((c) => (
              <div key={c.ticketId} className="dtable-row" role="row">
                <span role="cell" data-label="Name"><b>{c.name || '—'}</b>{c.teamName && <small>Team {c.teamName}</small>}</span>
                <span role="cell" data-label="Email"><small>{c.email}</small></span>
                <span role="cell" data-label="Ticket ID"><span className="mono small" title={c.ticketId}>{c.ticketId.slice(0, 8).toUpperCase()}</span></span>
                <span role="cell" data-label="Checked in"><b>{time(c.checkedInAt)}</b>{multiDay && <small>{day(c.checkedInAt)}</small>}</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section aria-labelledby="sessions-breakdown">
        <h3 id="sessions-breakdown" className="mb-md">Sessions <span className="muted small">({a.subEvents.length})</span></h3>
        {a.subEvents.length === 0 ? (
          <p className="muted">This event has no sessions.</p>
        ) : (
          <div className="session-stats">
            {a.subEvents.map((s) => (
              <article key={s.id} className="session-stat">
                <div className="session-stat-head">
                  <div>
                    <h4>{s.title}</h4>
                    <p className="small muted mb-0">{[s.venue, s.startTime && fmtRange(new Date(s.startTime), s.endTime && new Date(s.endTime))].filter(Boolean).join(' · ')}</p>
                  </div>
                  <p className="small mb-0">{rupees(s.revenue)}</p>
                </div>
                <Meter label="Booked" value={s.bookingsCount} max={s.capacity} note={`${s.bookingsCount} of ${s.capacity} seats`} />
                <Meter label="Attended" value={s.attendedCount} max={s.bookingsCount} note={`${s.attendedCount} of ${s.bookingsCount} booked (${pct(s.attendedCount, s.bookingsCount)}%)`} />
                {s.teams && (
                  <details className="session-teams">
                    <summary>{s.teams.length} team{s.teams.length === 1 ? '' : 's'} (teams of {s.teamSize})</summary>
                    {s.teams.length === 0 ? <p className="small muted">No teams yet.</p> : (
                      <ul className="team-cards mt-sm">
                        {s.teams.map((t) => (
                          <li key={t.name + t.members[0]?.email}>
                            <b>{t.name}</b>
                            <span className="small muted">{t.members.length} of {s.teamSize}{t.grouped ? '' : ' · not grouped yet'}</span>
                            <ul>{t.members.map((m) => <li key={m.email}>{m.name || m.email}{m.attended && <span className="accent"> · checked in</span>}</li>)}</ul>
                          </li>
                        ))}
                      </ul>
                    )}
                  </details>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  )
}

function Meter({ label, value, max, note }) {
  return (
    <div className="meter-row">
      <span className="small muted">{label}</span>
      <div className="meter" role="img" aria-label={`${label}: ${note}`}><i style={{ width: `${Math.min(100, pct(value, max))}%` }} /></div>
      <span className="small">{note}</span>
    </div>
  )
}
