import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { api } from '../api/client'
import { QrCode, passNote, useMasterTicket } from '../components/QrTicket'
import { Alert, Crumbs } from '../components/ui'
import { useAuth } from '../context/auth'
import { useLiveEvents } from '../hooks/useLiveEvents'
import { fmtDateTime, fromLive } from '../lib/events'
import { saveBlob, ticketPng } from '../lib/ticketImage'

// /tickets/:eventId — the student's master QR code for one event, which they can save as an image
export default function Ticket() {
  const { eventId } = useParams()
  const { user } = useAuth()
  const { live } = useLiveEvents()
  const [fetched, setFetched] = useState(null)
  const event = live.find((e) => e.key === eventId) ?? fetched
  const state = useMasterTicket(eventId)
  const qrBox = useRef(null)
  const [saving, setSaving] = useState({ busy: false, error: '' })

  useEffect(() => {
    if (live.some((e) => e.key === eventId)) return
    api(`/events/${eventId}`).then((e) => setFetched(fromLive(e))).catch(() => {})
  }, [eventId, live])

  async function saveImage() {
    const svg = qrBox.current?.querySelector('svg')
    if (!svg || !state.ticket) return
    setSaving({ busy: true, error: '' })
    try {
      const png = await ticketPng(svg, {
        title: event?.name ?? 'Swayam event',
        when: event && fmtDateTime(event.start),
        venue: event?.venue,
        holder: user?.name || user?.email,
        email: user?.email,
        // The same code staff see in their registrations list
        code: state.ticket.registrationId && `Ticket ${state.ticket.registrationId.slice(0, 8).toUpperCase()}`,
        note: `${passNote(state.ticket)} Show this at the entrance. Keep it private: anyone with the code can use your entry.`,
      })
      saveBlob(png, `${event?.name ?? 'Swayam'} ticket.png`.replace(/[\\/:*?"<>|]/g, ''))
      setSaving({ busy: false, error: '' })
    } catch (err) {
      setSaving({ busy: false, error: err.message })
    }
  }

  return (
    <div className="w page">
      <Crumbs items={[{ label: 'Dashboard', to: '/dashboard' }, { label: event?.name ?? 'Ticket' }]} />
      <div className="panel ticket">
        <span className="eyebrow">Entry ticket</span>
        <h1>{event?.name ?? 'Your ticket'}</h1>
        {event && <p className="muted">{fmtDateTime(event.start)}<br />{event.venue}</p>}
        <div ref={qrBox}><QrCode {...state} /></div>
        <p className="mb-0"><b>{user?.name || user?.email}</b></p>
        {user?.name && <p className="small muted">{user.email}</p>}
        <p className="small muted mt-md">Show this code at the entrance. Keep it private: anyone with the code can use your entry.</p>
        <div className="actions">
          {state.ticket && <button className="btn btn--sm" onClick={saveImage} disabled={saving.busy}>{saving.busy ? 'Preparing…' : 'Download ticket'}</button>}
          <button className="btn btn--sm btn--ghost" onClick={() => window.print()}>Print</button>
          <Link className="btn btn--sm btn--ghost" to="/dashboard">All tickets</Link>
        </div>
        {state.ticket && <p className="small muted">Saves a picture of your ticket to your phone, so it works at the gate without internet.</p>}
        <Alert>{saving.error}</Alert>
      </div>
    </div>
  )
}
