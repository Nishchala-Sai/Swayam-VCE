// Every account with its student details and the events it holds a seat for (ADMIN only, GET /api/analytics/students).
// Searchable and sortable, downloadable as .xlsx, with the phone numbers ready to copy for WhatsApp.
import { useEffect, useMemo, useState } from 'react'
import { api } from '../../api/client'
import { Alert, Loading } from '../../components/ui'
import { formatPhone, yearLabel } from '../../lib/profile'
import { copyPhones, downloadWorkbook, istShort, useSorted } from '../../lib/sheet'

const ROLE = { STUDENT: 'Student', EVENT_HEAD: 'Event head', ADMIN: 'Admin' }
const roleOf = (p) => (p.isActive ? ROLE[p.role] : `${ROLE[p.role]} (deactivated)`)

export default function Students({ onBack }) {
  const [people, setPeople] = useState(null)
  const [error, setError] = useState('')
  const [query, setQuery] = useState('')
  const [show, setShow] = useState('registered') // registered | everyone | incomplete
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api('/analytics/students').then(setPeople).catch((err) => setError(err.message))
  }, [])

  const columns = useMemo(() => [
    { key: 'name', header: 'Name', width: 24, value: (p) => p.name || p.email },
    { key: 'phone', header: 'Phone', width: 15, value: (p) => p.phone },
    { key: 'rollNumber', header: 'Roll number', width: 18, value: (p) => p.rollNumber },
    { key: 'branch', header: 'Branch', width: 16, value: (p) => p.branch },
    { key: 'year', header: 'Year', width: 7, type: 'number', value: (p) => p.year },
    { key: 'email', header: 'Email', width: 30, value: (p) => p.email },
    { key: 'events', header: 'Events', width: 8, type: 'number', value: (p) => p.events.length, sortValue: (p) => p.events.length },
    { key: 'eventTitles', header: 'Registered for', width: 50, value: (p) => p.events.map((e) => e.title).join(', ') },
    { key: 'role', header: 'Role', width: 11, value: roleOf },
    { key: 'createdAt', header: 'Joined', width: 18, type: 'date', value: (p) => p.createdAt, sortValue: (p) => p.createdAt },
  ], [])

  const rows = useMemo(() => {
    if (!people) return []
    const q = query.trim().toLowerCase()
    return people.filter((p) => {
      if (show === 'registered' && !p.events.length) return false
      if (show === 'incomplete' && p.phone && p.rollNumber && p.branch && p.year) return false
      return !q || [p.name, p.email, p.phone, p.rollNumber, p.branch, ...p.events.map((e) => e.title)].some((v) => v?.toLowerCase().includes(q))
    })
  }, [people, query, show])
  const { sorted, sort, toggle } = useSorted(rows, columns, { key: 'createdAt', dir: 'desc' })

  async function excel() {
    setBusy(true)
    setNote('')
    try {
      await downloadWorkbook([{ name: 'Students', columns, rows: sorted }], 'Swayam students')
    } catch (err) {
      setNote(`Could not create the Excel file: ${err.message}`)
    } finally {
      setBusy(false)
    }
  }
  async function phones() {
    try {
      const n = await copyPhones(sorted)
      setNote(n ? `Copied ${n} phone number${n === 1 ? '' : 's'}.` : 'No phone numbers in this view.')
    } catch {
      setNote('Your browser blocked copying. Download the Excel file instead.')
    }
  }

  return (
    <div className="stack">
      <div>
        <button className="link-btn small muted" onClick={onBack}>&larr; Dashboard</button>
        <h2 className="mt-sm">All students</h2>
        <p className="muted mb-0">Everyone with a Swayam account, their details and the events they hold a seat for.</p>
      </div>
      <Alert>{error}</Alert>
      {!people ? !error && <Loading /> : (
        <>
          <section aria-label="Filters" className="sheet-tools">
            <input className="log-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, phone, roll number, event…" aria-label="Search students" />
            <div className="chips" role="group" aria-label="Show">
              {[['registered', 'Registered for an event'], ['everyone', 'Everyone'], ['incomplete', 'Missing details']].map(([id, label]) => (
                <button key={id} className="chip" aria-pressed={show === id} onClick={() => setShow(id)}>{label}</button>
              ))}
            </div>
            <div className="actions mt-0">
              <button className="btn btn--sm" onClick={excel} disabled={busy || !sorted.length}>{busy ? 'Preparing…' : 'Download Excel'}</button>
              <button className="btn btn--sm btn--ghost" onClick={phones} disabled={!sorted.length}>Copy phone numbers</button>
            </div>
            {note && <p className="small muted mb-0" role="status">{note}</p>}
          </section>
          <p className="small muted mb-0">Showing {sorted.length} of {people.length} accounts.</p>
          {sorted.length > 0 && (
            <div className="sheet-wrap" role="region" aria-label="Students" tabIndex={0}>
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
                  {sorted.map((p) => (
                    <tr key={p.id} className={p.isActive ? '' : 'is-cancelled'}>
                      <th scope="row">{p.name || '—'}</th>
                      <td className="nowrap">{p.phone ? <a href={`https://wa.me/91${p.phone}`} target="_blank" rel="noreferrer">{formatPhone(p.phone)}</a> : '—'}</td>
                      <td className="mono nowrap">{p.rollNumber ?? '—'}</td>
                      <td>{p.branch ?? '—'}</td>
                      <td className="nowrap">{p.year ? yearLabel(p.year) : '—'}</td>
                      <td>{p.email}</td>
                      <td>{p.events.length}</td>
                      <td>{p.events.map((e) => e.title).join(', ')}</td>
                      <td className="nowrap">{roleOf(p)}</td>
                      <td className="nowrap">{istShort(p.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}
