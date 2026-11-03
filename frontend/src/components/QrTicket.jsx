// The student's master ticket for an event: one QR code that admits them to the main event and to the sub-events
// they booked. Fetched from GET /api/registrations/events/:eventId/ticket.
import { useEffect, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { api } from '../api/client'
import { Alert, Loading } from './ui'

export function useMasterTicket(eventId) {
  const [state, setState] = useState({ ticket: null, error: null, status: 0, loading: true })
  useEffect(() => {
    let live = true
    setState({ ticket: null, error: null, status: 0, loading: true })
    api(`/registrations/events/${eventId}/ticket`)
      .then((ticket) => live && setState({ ticket, error: null, status: 200, loading: false }))
      .catch((err) => live && setState({ ticket: null, error: err.message, status: err.status, loading: false }))
    return () => {
      live = false
    }
  }, [eventId])
  return state
}

export const passNote = (ticket) =>
  ticket.kind === 'MAIN' ? 'Main pass: admits you to the event and the sessions you booked.' : 'Sub-event pass: admits you to the sessions you booked.'

// The code for an already loaded ticket (useMasterTicket's state)
export function QrCode({ ticket, error, loading }) {
  if (loading) return <Loading>Loading your ticket</Loading>
  if (error) return <Alert tone="info">{error}</Alert>
  return (
    <>
      <div className="qr">
        <QRCodeSVG value={ticket.qrPayload} size={220} level="M" title="Your entry QR code" />
      </div>
      <p className="small muted">{passNote(ticket)}</p>
    </>
  )
}

export default function QrTicket({ eventId }) {
  return <QrCode {...useMasterTicket(eventId)} />
}
