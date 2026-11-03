// Live spreadsheet of everyone registered for one event (GET /api/events/:id/registrations): student details,
// payment and check-in, refreshed every 15 seconds while the tab is visible. Sort, search and filter, then download
// exactly that view as .xlsx (with a second sheet of session bookings) or copy the phone numbers for WhatsApp.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api, download } from '../../api/client'
import { Alert, Empty, Loading } from '../../components/ui'
import { rupees } from '../../lib/events'
import { formatPhone, yearLabel } from '../../lib/profile'
import { copyPhones, downloadWorkbook, istShort, useSorted } from '../../lib/sheet'

const REFRESH_MS = 15000
const NEW_FOR_MS = 8000

// What a row's payment means, in the words the organisers use
export function statusOf(r, free) {
  if (r.status === 'CANCELLED') {
    return { REJECTED: 'Rejected', REFUND_REQUIRED: 'Refund due', REFUNDED: 'Refunded' }[r.paymentStatus] ?? 'Cancelled'
  }
  if (r.paymentStatus === 'VERIFIED') return free ? 'Registered' : 'Paid'
  if (r.utrNumber) return 'Verifying'
  return r.teamId && !r.isGroupLeader ? 'Leader to pay' : 'Awaiting payment'
}
const TONE = { Paid: 'ok', Registered: 'ok', Verifying: 'accent', 'Awaiting payment': 'accent', 'Leader to pay': 'accent' }

const FILTERS = [
  { id: 'active', label: 'Active', test: (r) => r.status === 'CONFIRMED' },
  { id: 'confirmed', label: 'Confirmed', test: (r) => r.status === 'CONFIRMED' && r.paymentStatus === 'VERIFIED' },
  { id: 'pending', label: 'Pending payment', test: (r) => r.status === 'CONFIRMED' && r.paymentStatus === 'PENDING' },
  { id: 'cancelled', label: 'Cancelled & refunds', test: (r) => r.status === 'CANCELLED' },
  { id: 'all', label: 'Everything', test: () => true },
]
const ATTENDANCE = { any: () => true, in: (r) => Boolean(r.attendedAt), out: (r) => !r.attendedAt }

export default function Registrations({ event }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [fresh, setFresh] = useState(new Set()) // ids that appeared since the previous refresh
  const known = useRef(null)
  const [, tick] = useState(0) // re-renders the "updated 5s ago" label
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('active')
  const [attendance, setAttendance] = useState('any')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState('')

  const load = useCallback(async () => {
    try {
      const d = await api(`/events/${event.key}/registrations`)
      const ids = d.registrations.map((r) => r.id)
      if (known.current) {
        const added = ids.filter((id) => !known.current.has(id))
        if (added.length) {
          setFresh(new Set(added))
          setTimeout(() => setFresh(new Set()), NEW_FOR_MS)
        }
      }
      known.current = new Set(ids)
      setData(d)
      setError('')
    } catch (err) {
      setError(err.message) // keep showing the last good data
    }
  }, [event.key])

  // Poll while the browser tab is visible; refresh at once when it comes back
  useEffect(() => {
    load()
    const poll = setInterval(() => document.visibilityState === 'visible' && load(), REFRESH_MS)
    const clock = setInterval(() => tick((n) => n + 1), 1000)
    const onVisible = () => document.visibilityState === 'visible' && load()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(poll)
      clearInterval(clock)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [load])

  const free = !(data?.event.price > 0)
  const columns = useMemo(() => [
    { key: 'name', header: 'Name', width: 24, value: (r) => r.name || r.email },
    { key: 'phone', header: 'Phone', width: 15, value: (r) => r.phone },
    { key: 'rollNumber', header: 'Roll number', width: 18, value: (r) => r.rollNumber },
    { key: 'branch', header: 'Branch', width: 16, value: (r) => r.branch },
    { key: 'year', header: 'Year', width: 7, type: 'number', value: (r) => r.year },
    { key: 'email', header: 'Email', width: 30, value: (r) => r.email },
    { key: 'code', header: 'Code', width: 11, value: (r) => r.code },
    { key: 'status', header: 'Status', width: 16, value: (r) => statusOf(r, free) },
    ...(free ? [] : [
      { key: 'utrNumber', header: 'UTR', width: 16, value: (r) => r.utrNumber },
      { key: 'totalAmountPaid', header: 'Amount (₹)', width: 11, type: 'number', value: (r) => r.totalAmountPaid },
    ]),
    { key: 'teamName', header: 'Team', width: 16, value: (r) => r.teamName && `${r.teamName}${r.isGroupLeader ? ' (leader)' : ''}` },
    { key: 'sessions', header: 'Sessions', width: 30, value: (r) => r.sessions.join(', '), sortValue: (r) => r.sessions.length || null },
    { key: 'createdAt', header: 'Registered', width: 18, type: 'date', value: (r) => r.createdAt, sortValue: (r) => r.createdAt },
    { key: 'attendedAt', header: 'Checked in', width: 18, type: 'date', value: (r) => r.attendedAt, sortValue: (r) => r.attendedAt },
  ], [free])

  const rows = useMemo(() => {
    if (!data) return []
    const f = FILTERS.find((x) => x.id === filter).test
    const q = query.trim().toLowerCase()
    return data.registrations.filter((r) => f(r) && ATTENDANCE[attendance](r)
      && (!q || [r.name, r.email, r.phone, r.rollNumber, r.branch, r.code, r.utrNumber, r.teamName].some((v) => v?.toLowerCase().includes(q))))
  }, [data, filter, attendance, query])
  const { sorted, sort, toggle } = useSorted(rows, columns, { key: 'createdAt', dir: 'desc' })

  if (!data) return error ? <Alert>{error}</Alert> : <Loading>Loading registrations</Loading>

  const all = data.registrations
  const active = all.filter((r) => r.status === 'CONFIRMED')
  const confirmed = active.filter((r) => r.paymentStatus === 'VERIFIED').length
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(data.updatedAt)) / 1000))

  async function excel() {
    setBusy('excel')
    setNote('')
    try {
      const bookingColumns = [
        { header: 'Session', width: 26, value: (b) => b.sessionTitle },
        { header: 'Starts', width: 18, type: 'date', value: (b) => b.sessionStart },
        { header: 'Name', width: 24, value: (b) => b.name || b.email },
        { header: 'Phone', width: 15, value: (b) => b.phone },
        { header: 'Roll number', width: 18, value: (b) => b.rollNumber },
        { header: 'Branch', width: 16, value: (b) => b.branch },
        { header: 'Year', width: 7, type: 'number', value: (b) => b.year },
        { header: 'Email', width: 30, value: (b) => b.email },
        { header: 'Status', width: 16, value: (b) => statusOf(b, !(b.totalAmountPaid > 0) && !b.utrNumber) },
        { header: 'UTR', width: 16, value: (b) => b.utrNumber },
        { header: 'Amount (₹)', width: 11, type: 'number', value: (b) => b.totalAmountPaid },
        { header: 'Team', width: 18, value: (b) => b.groupName || b.teamName },
        { header: 'Pass holder', width: 11, value: (b) => (b.isPassHolder ? 'Yes' : 'No') },
        { header: 'Booked', width: 18, type: 'date', value: (b) => b.createdAt },
        { header: 'Checked in', width: 18, type: 'date', value: (b) => b.attendedAt },
      ]
      const sheets = [{ name: 'Registrations', columns, rows: sorted }]
      if (data.bookings.length) sheets.push({ name: 'Session bookings', columns: bookingColumns, rows: data.bookings })
      await downloadWorkbook(sheets, `${event.name} registrations`)
    } catch (err) {
      setNote(`Could not create the Excel file: ${err.message}`)
    } finally {
      setBusy('')
    }
  }

  async function csv() {
    setBusy('csv')
    setNote('')
    try {
      await download(`/events/${event.key}/export`, `${event.name} attendees.csv`)
    } catch (err) {
      setNote(err.message)
    } finally {
      setBusy('')
    }
  }

  async function phones() {
    try {
      const n = await copyPhones(sorted)
      setNote(n ? `Copied ${n} phone number${n === 1 ? '' : 's'}. Paste them into WhatsApp.` : 'No phone numbers in this view.')
    } catch {
      setNote('Your browser blocked copying. Download the Excel file instead.')
    }
  }

  return (
    <div className="stack">
      <section aria-label="Totals">
        <div className="sheet-totals">
          <span><b>{active.length}</b> registered</span>
          <span><b>{confirmed}</b> {free ? 'confirmed' : 'paid'}</span>
          {!free && <span><b>{active.length - confirmed}</b> pending</span>}
          <span><b>{active.filter((r) => r.attendedAt).length}</b> checked in</span>
          <span><b>{all.length - active.length}</b> cancelled</span>
          <span className="live" title="Refreshes every 15 seconds while this tab is open">
            <i aria-hidden="true" /> Live · updated {seconds < 5 ? 'just now' : `${seconds}s ago`}
          </span>
        </div>
        {error && <p className="small muted">Couldn't refresh ({error}). Showing the last update; it keeps trying.</p>}
      </section>

      <section aria-label="Filters" className="sheet-tools">
        <input className="log-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, phone, roll number, code…" aria-label="Search registrations" />
        <div className="chips" role="group" aria-label="Payment status">
          {FILTERS.map((x) => (
            <button key={x.id} className="chip" aria-pressed={filter === x.id} onClick={() => setFilter(x.id)}>{x.label}</button>
          ))}
        </div>
        <select value={attendance} onChange={(e) => setAttendance(e.target.value)} aria-label="Check-in">
          <option value="any">Checked in or not</option>
          <option value="in">Checked in</option>
          <option value="out">Not checked in</option>
        </select>
        <div className="actions mt-0">
          <button className="btn btn--sm" onClick={excel} disabled={busy === 'excel' || !sorted.length}>{busy === 'excel' ? 'Preparing…' : 'Download Excel'}</button>
          <button className="btn btn--sm btn--ghost" onClick={phones} disabled={!sorted.length}>Copy phone numbers</button>
          <button className="btn btn--sm btn--ghost" onClick={csv} disabled={busy === 'csv'}>CSV</button>
        </div>
        {note && <p className="small muted mb-0" role="status">{note}</p>}
      </section>

      {all.length === 0 ? (
        <Empty title="No registrations yet">They appear here within 15 seconds of someone registering.</Empty>
      ) : sorted.length === 0 ? (
        <p className="muted">Nobody matches these filters.</p>
      ) : (
        <>
          <p className="small muted mb-0">Showing {sorted.length} of {all.length}. Click a column to sort. The download contains exactly this view.</p>
          <div className="sheet-wrap" role="region" aria-label="Registrations" tabIndex={0}>
            <table className="sheet">
              <thead>
                <tr>
                  {columns.map((c) => (
                    <th key={c.key} scope="col" aria-sort={sort.key === c.key ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}>
                      <button onClick={() => toggle(c.key)}>{c.header}{sort.key === c.key && <span aria-hidden="true">{sort.dir === 'asc' ? ' ↑' : ' ↓'}</span>}</button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => {
                  const status = statusOf(r, free)
                  return (
                    <tr key={r.id} className={`${fresh.has(r.id) ? 'is-new' : ''} ${r.status === 'CANCELLED' ? 'is-cancelled' : ''}`}>
                      <th scope="row">{r.name || '—'}</th>
                      <td className="nowrap">{r.phone ? <a href={`https://wa.me/91${r.phone}`} target="_blank" rel="noreferrer">{formatPhone(r.phone)}</a> : '—'}</td>
                      <td className="mono nowrap">{r.rollNumber ?? '—'}</td>
                      <td>{r.branch ?? '—'}</td>
                      <td className="nowrap">{r.year ? yearLabel(r.year) : '—'}</td>
                      <td>{r.email}</td>
                      <td className="mono">{r.code}</td>
                      <td><span className={`pill ${TONE[status] ? `pill--${TONE[status]}` : status === 'Rejected' || status === 'Refund due' ? 'pill--danger' : ''}`}>{status}</span></td>
                      {!free && <td className="mono">{r.utrNumber ?? ''}</td>}
                      {!free && <td className="nowrap">{r.totalAmountPaid != null ? rupees(r.totalAmountPaid) : ''}</td>}
                      <td>{r.teamName ? `${r.teamName}${r.isGroupLeader ? ' (leader)' : ''}` : ''}</td>
                      <td>{r.sessions.join(', ')}</td>
                      <td className="nowrap">{istShort(r.createdAt)}</td>
                      <td className="nowrap">{r.attendedAt ? istShort(r.attendedAt) : <span className="muted">Not yet</span>}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
