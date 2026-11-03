// Create a live (bookable) event: POST /api/events. The venue comes from the admin-managed list, the day-by-day
// schedule is optional (any times, with breaks), paid events need an uploaded image of the UPI QR code, and any event
// can have a banner image for the top of its page.
import { useState } from 'react'
import { api, assetUrl, upload } from '../../api/client'
import { Alert } from '../../components/ui'
import VenuePicker from '../../components/VenuePicker'

const EMPTY = { title: '', description: '', date: '', location: '', capacity: '', price: '0', groupSize: '', groupPrice: '', allowTeams: false, maxTeamSize: '4', upiId: '', upiPayeeName: '', paymentInstructions: '' }
const MAX_TEAM = 11 // a team leader and up to 10 teammates
const MAX_QR_BYTES = 2 * 1024 * 1024
const MAX_BANNER_BYTES = 5 * 1024 * 1024
const UPI_ID = /^(?=.{3,100}$)[\w.-]+@[a-z][a-z0-9.-]*$/i // handle@bank, as the API checks it

// A new day starts from a typical summit day; every time and title can be changed
const typicalDay = (date = '') => ({
  date,
  slots: [
    { start: '10:00', end: '12:40', title: 'Sessions', kind: 'session' },
    { start: '12:40', end: '13:20', title: 'Lunch break', kind: 'break' },
    { start: '13:20', end: '16:20', title: 'Sessions', kind: 'session' },
  ],
})

const nextDate = (date) => {
  if (!date) return ''
  const d = new Date(`${date}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

// The event starts at the earliest slot of the earliest day
function scheduleStart(days) {
  const dated = days.filter((d) => d.date && d.slots.length)
  if (!dated.length) return ''
  const first = [...dated].sort((a, b) => a.date.localeCompare(b.date))[0]
  const earliest = [...first.slots].map((s) => s.start).filter(Boolean).sort()[0]
  return earliest ? `${first.date}T${earliest}` : ''
}

function validate(f, days, qr, banner) {
  const capacity = Number(f.capacity)
  const price = f.price === '' ? 0 : Number(f.price)
  const start = days.length ? scheduleStart(days) : f.date
  if (!f.title.trim()) return { error: 'Give the event a title.' }
  if (!f.description.trim()) return { error: 'Add a description: students read it before registering.' }
  for (const d of days) {
    if (!d.date) return { error: 'Every schedule day needs a date.' }
    if (!d.slots.length) return { error: `${d.date}: add at least one time slot, or remove the day.` }
    for (const s of d.slots) {
      if (!s.start || !s.end) return { error: `${d.date}: every slot needs a start and end time.` }
      if (s.end <= s.start) return { error: `${d.date}: "${s.title || 'A slot'}" must end after it starts.` }
      if (!s.title.trim()) return { error: `${d.date} ${s.start}: give the slot a title.` }
    }
  }
  if (!start) return { error: days.length ? 'Add a time slot to the schedule.' : 'Choose the date and start time.' }
  if (!f.location.trim()) return { error: 'Choose the venue, or type one under Other.' }
  if (!Number.isInteger(capacity) || capacity < 1) return { error: 'Capacity must be a whole number of at least 1.' }
  if (!Number.isInteger(price) || price < 0) return { error: 'Price must be whole rupees, 0 for a free event.' }
  const groupSize = f.groupSize === '' ? null : Number(f.groupSize)
  const groupPrice = f.groupPrice === '' ? null : Number(f.groupPrice)
  if ((groupSize == null) !== (groupPrice == null)) return { error: 'Fill in both the group size and the group price, or leave both empty.' }
  if (groupSize != null) {
    if (price === 0) return { error: 'Group offers are for paid events: set the individual price first.' }
    if (!Number.isInteger(groupSize) || groupSize < 2 || groupSize > MAX_TEAM) return { error: `Group size must be 2 to ${MAX_TEAM} people (a leader and up to 10 teammates).` }
    if (!Number.isInteger(groupPrice) || groupPrice < 1) return { error: 'Group price must be whole rupees.' }
    if (groupPrice >= price * groupSize) return { error: `The group price must be less than ${groupSize} × ₹${price} = ₹${price * groupSize}, or it isn't an offer.` }
  }
  const maxTeamSize = f.allowTeams ? Number(f.maxTeamSize) : null
  if (maxTeamSize != null) {
    if (!Number.isInteger(maxTeamSize) || maxTeamSize < 2 || maxTeamSize > MAX_TEAM) return { error: `A team can have 2 to ${MAX_TEAM} people.` }
    if (groupSize != null && groupSize > maxTeamSize) return { error: `The group offer is for ${groupSize} people, so teams must allow at least ${groupSize}.` }
  }
  if (price > 0 && !qr) return { error: 'Paid events need the UPI QR code image. Upload it below.' }
  if (f.upiId.trim() && !UPI_ID.test(f.upiId.trim())) return { error: 'The UPI ID should look like swayam@okaxis.' }
  return {
    body: {
      title: f.title.trim(),
      description: f.description.trim(),
      date: new Date(start).toISOString(), // the browser's local time (IST for the team)
      location: f.location.trim(),
      capacity,
      price,
      ...(groupSize != null && { groupSize, groupPrice }),
      ...(maxTeamSize != null && { maxTeamSize }),
      ...(qr && { upiQrUrl: qr }),
      ...(f.upiId.trim() && { upiId: f.upiId.trim() }),
      ...(f.upiPayeeName.trim() && { upiPayeeName: f.upiPayeeName.trim() }),
      ...(banner && { bannerUrl: banner }),
      ...(f.paymentInstructions.trim() && { paymentInstructions: f.paymentInstructions.trim() }),
      ...(days.length && { schedule: days.map((d) => ({ date: d.date, slots: d.slots.map((s) => ({ ...s, title: s.title.trim() })) })) }),
    },
  }
}

// Optional group price, e.g. a 5+2 offer: 7 people pay ₹2,500 in total instead of 7 × ₹500
function GroupOffer({ f, set }) {
  const price = Number(f.price)
  const free = !(price > 0)
  const size = Number(f.groupSize)
  const total = Number(f.groupPrice)
  const complete = Number.isInteger(size) && size >= 2 && Number.isInteger(total) && total > 0
  return (
    <div className="field span-2">
      <span className="label">Group price (optional)</span>
      <div className="inline-form mt-sm">
        <input id="ev-gsize" disabled={free} aria-label="Group size (people)" type="number" min="2" max={MAX_TEAM} inputMode="numeric" value={f.groupSize} onChange={set('groupSize')} placeholder="7" />
        <span className="muted">people pay</span>
        <input id="ev-gprice" disabled={free} aria-label="Group price (₹ in total)" type="number" min="1" inputMode="numeric" value={f.groupPrice} onChange={set('groupPrice')} placeholder="2500" />
        <span className="muted">₹ in total</span>
      </div>
      <p className={`hint ${complete && total >= price * size ? 'danger' : ''}`}>
        {free
          ? 'Set an individual price above 0 to offer a group price.'
          : complete
          ? total < price * size
            ? `A team of ${size} pays ₹${total.toLocaleString('en-IN')} instead of ₹${(price * size).toLocaleString('en-IN')} (₹${Math.round(total / size).toLocaleString('en-IN')} each, saving ₹${(price * size - total).toLocaleString('en-IN')}).`
            : `That is not cheaper than ${size} × ₹${price}. The group price must be lower.`
          : 'For a 5+2 offer at ₹500, enter 7 people and ₹2,500. Only teams of exactly this size get it; individuals and other team sizes pay the individual price.'}
      </p>
    </div>
  )
}

// ISO time -> the value a datetime-local input shows (the browser's local time)
const toLocalInput = (iso) => {
  if (!iso) return ''
  const d = new Date(iso)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

// The form's starting values: empty for a new event, or the saved event's details when editing
function initialValues(raw) {
  if (!raw) return { f: EMPTY, days: [], qr: null, banner: null }
  return {
    f: {
      title: raw.title,
      description: raw.description,
      date: raw.schedule?.length ? '' : toLocalInput(raw.date),
      location: raw.location,
      capacity: String(raw.capacity),
      price: String(raw.price),
      groupSize: raw.groupSize ? String(raw.groupSize) : '',
      groupPrice: raw.groupPrice ? String(raw.groupPrice) : '',
      allowTeams: raw.maxTeamSize != null,
      maxTeamSize: String(raw.maxTeamSize ?? 4),
      upiId: raw.upiId ?? '',
      upiPayeeName: raw.upiPayeeName ?? '',
      paymentInstructions: raw.paymentInstructions ?? '',
    },
    days: (raw.schedule ?? []).map((d) => ({ date: d.date, slots: d.slots.map((s) => ({ ...s })) })),
    qr: raw.upiQrUrl ?? null,
    banner: raw.bannerUrl ?? null,
  }
}

// Creates an event (POST), or edits one when `event` is given (PATCH with every field). Edits apply from now on:
// registrations already made keep what they paid.
export default function EventForm({ venues, admin, event = null, onCreated, onSaved, onCancel }) {
  const editing = Boolean(event)
  const [start] = useState(() => initialValues(event?.raw))
  const [f, setF] = useState(start.f)
  const [days, setDays] = useState(start.days)
  const [qr, setQr] = useState(start.qr) // uploaded path or link
  const [qrState, setQrState] = useState({ busy: false, error: '' })
  const [banner, setBanner] = useState(start.banner) // uploaded path or link
  const [bannerState, setBannerState] = useState({ busy: false, error: '' })
  const [state, setState] = useState({ busy: false, error: '' })
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }))
  const paid = Number(f.price) > 0

  const setDay = (i, patch) => setDays((ds) => ds.map((d, j) => (j === i ? { ...d, ...patch } : d)))
  // Moving a slot swaps its place in the day's timeline with its neighbour. Each keeps its own length, and any gap
  // between them stays, so the times stay in order (e.g. moving a 40-minute lunch above a 10:00-12:40 talk gives
  // lunch 10:00-10:40 and the talk 10:40-13:20).
  const moveSlot = (i, k, dir) => setDays((ds) => ds.map((d, j) => {
    const other = k + dir
    if (j !== i || other < 0 || other >= d.slots.length) return d
    const [a, b] = dir < 0 ? [other, k] : [k, other] // a comes first in the list
    const slots = [...d.slots]
    const first = slots[a]
    const second = slots[b]
    const times = [first.start, first.end, second.start, second.end]
    if (times.every(Boolean) && first.start <= second.start) {
      const mins = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3))
      const clock = (m) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
      const gap = Math.max(0, mins(second.start) - mins(first.end))
      const start = mins(first.start)
      const end2 = start + (mins(second.end) - mins(second.start))
      const start1 = end2 + gap
      const end1 = start1 + (mins(first.end) - mins(first.start))
      if (end1 < 24 * 60) {
        slots[a] = { ...second, start: clock(start), end: clock(end2) }
        slots[b] = { ...first, start: clock(start1), end: clock(end1) }
        return { ...d, slots }
      }
    }
    slots[a] = second // times missing or out of order: just swap the rows
    slots[b] = first
    return { ...d, slots }
  }))
  const setSlot = (i, k, patch) => setDays((ds) => ds.map((d, j) => (j === i ? { ...d, slots: d.slots.map((s, m) => (m === k ? { ...s, ...patch } : s)) } : d)))
  const addSlot = (i, kind) => setDays((ds) => ds.map((d, j) => {
    if (j !== i) return d
    const last = d.slots.at(-1)?.end ?? '10:00'
    return { ...d, slots: [...d.slots, { start: last, end: last, title: kind === 'break' ? 'Break' : '', kind }] }
  }))
  // A new day copies the previous day's slots, the usual case for a multi-day summit
  const addDay = () => setDays((ds) => (ds.length ? [...ds, { date: nextDate(ds.at(-1).date), slots: ds.at(-1).slots.map((s) => ({ ...s })) }] : [typicalDay(f.date.slice(0, 10))]))

  // Uploads the chosen file to /api/uploads/<kind> and keeps the returned path
  const chooseImage = (kind, maxBytes, setUrl, setStatus) => async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > maxBytes) return setStatus({ busy: false, error: `The image must be ${maxBytes / 1024 / 1024} MB or smaller.` })
    setStatus({ busy: true, error: '' })
    try {
      const { path } = await upload(`/uploads/${kind}`, file)
      setUrl(path)
      setStatus({ busy: false, error: '' })
      setState((s) => ({ ...s, error: '' })) // e.g. "Paid events need the UPI QR code image"
    } catch (err) {
      setStatus({ busy: false, error: err.message })
    }
  }
  const chooseQr = chooseImage('upi-qr', MAX_QR_BYTES, setQr, setQrState)
  const chooseBanner = chooseImage('banner', MAX_BANNER_BYTES, setBanner, setBannerState)

  async function submit(e) {
    e.preventDefault()
    const { body, error } = validate(f, days, qr, banner)
    if (error) return setState({ busy: false, error })
    setState({ busy: true, error: '' })
    try {
      if (editing) onSaved(await api(`/events/${event.key}`, { method: 'PATCH', body }))
      else onCreated(await api('/events', { method: 'POST', body }))
    } catch (err) {
      setState({ busy: false, error: err.message })
    }
  }

  return (
    <form className="panel mb-md" onSubmit={submit} noValidate>
      <h3 className="mb-md">{editing ? `Edit ${event.name}` : 'New event'}</h3>
      {editing && <p className="muted small">Changes apply from now on. Students who already registered keep the price and team they registered with.</p>}
      <div className="form-grid">
        <div className="field span-2">
          <label htmlFor="ev-title">Title</label>
          <input id="ev-title" value={f.title} onChange={set('title')} maxLength={200} placeholder="E-Summit 2027" />
        </div>
        <div className="field span-2">
          <label htmlFor="ev-desc">Description</label>
          <textarea id="ev-desc" rows={4} value={f.description} onChange={set('description')} maxLength={10000} />
          <p className="hint">The first sentence is used as the summary on event cards.</p>
        </div>
        <div className="field span-2">
          <label htmlFor="ev-banner">Banner image (optional)</label>
          {banner ? (
            <div className="banner-upload">
              <img src={assetUrl(banner)} alt="Uploaded event banner" />
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setBanner(null)}>Remove</button>
            </div>
          ) : (
            <input id="ev-banner" type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseBanner} disabled={bannerState.busy} />
          )}
          <p className="hint">{bannerState.busy ? 'Uploading…' : 'PNG, JPEG or WebP, up to 5 MB. Shown across the top of the event page; a wide image (about 3:1) works best.'}</p>
          {bannerState.error && <p className="hint danger">{bannerState.error}</p>}
        </div>
        <VenuePicker
          id="ev-loc"
          venues={venues}
          value={f.location}
          onChange={(location) => setF((x) => ({ ...x, location }))}
          hint={venues.length ? 'Pick from the list, or choose Other to type any place.' : admin ? 'No venues in the list yet: type one, or add them under Venues below.' : 'No venues in the list yet: type the venue.'}
        />
        <div className="field">
          {days.length ? (
            <>
              <span className="label">Starts</span>
              <p className="mb-0 mt-sm">{scheduleStart(days) ? new Date(scheduleStart(days)).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : 'Set in the schedule below'}</p>
              <p className="hint">Taken from the first slot of the schedule.</p>
            </>
          ) : (
            <>
              <label htmlFor="ev-date">Date and start time</label>
              <input id="ev-date" type="datetime-local" value={f.date} onChange={set('date')} />
            </>
          )}
        </div>
        <div className="field">
          <label htmlFor="ev-cap">Capacity</label>
          <input id="ev-cap" type="number" min="1" inputMode="numeric" value={f.capacity} onChange={set('capacity')} />
        </div>
        <div className="field">
          <label htmlFor="ev-price">Individual price (₹ per person)</label>
          <input id="ev-price" type="number" min="0" inputMode="numeric" value={f.price} onChange={set('price')} />
          <p className="hint">0 makes the event free.</p>
        </div>
        <GroupOffer f={f} set={set} />
        <div className="field span-2">
          <label className="switch mb-0">
            <input type="checkbox" checked={f.allowTeams} onChange={(e) => setF((x) => ({ ...x, allowTeams: e.target.checked }))} />
            <span className="switch-track" aria-hidden="true" />
            Allow team registration
          </label>
          {f.allowTeams && (
            <div className="inline-form mt-sm">
              <span className="muted">Up to</span>
              <input id="ev-maxteam" aria-label="Most people per team" type="number" min="2" max={MAX_TEAM} inputMode="numeric" value={f.maxTeamSize} onChange={set('maxTeamSize')} />
              <span className="muted">people per team, including the leader</span>
            </div>
          )}
          <p className="hint">
            {f.allowTeams
              ? 'One student registers the whole team and pays for everyone.'
              : f.groupSize
                ? `Off: students register individually, except groups of up to ${f.groupSize} for the group price.`
                : 'Off: students register individually. Turn on for events like hackathons that people attend as teams.'}
          </p>
        </div>
      </div>

      <fieldset className="schedule">
        <legend>Schedule <span className="muted small">(optional)</span></legend>
        <p className="hint mt-0">Add a day for each day of the event. Any times work; use breaks for lunch and gaps. ↑ and ↓ move a slot earlier or later, keeping its length.</p>
        {days.map((d, i) => (
          <div key={i} className="schedule-day">
            <div className="schedule-day-head">
              <label className="visually-hidden" htmlFor={`day-${i}`}>Day {i + 1} date</label>
              <span className="schedule-day-label">Day {i + 1}</span>
              <input id={`day-${i}`} type="date" value={d.date} onChange={(e) => setDay(i, { date: e.target.value })} />
              <button type="button" className="link-btn small" onClick={() => setDays((ds) => ds.filter((_, j) => j !== i))}>Remove day</button>
            </div>
            {d.slots.map((s, k) => (
              <div key={k} className={`slot-row ${s.kind === 'break' ? 'slot-row--break' : ''}`}>
                <input type="time" aria-label={`Day ${i + 1} slot ${k + 1} start`} value={s.start} onChange={(e) => setSlot(i, k, { start: e.target.value })} />
                <span className="muted" aria-hidden="true">to</span>
                <input type="time" aria-label={`Day ${i + 1} slot ${k + 1} end`} value={s.end} onChange={(e) => setSlot(i, k, { end: e.target.value })} />
                <input aria-label={`Day ${i + 1} slot ${k + 1} title`} value={s.title} maxLength={120} placeholder={s.kind === 'break' ? 'Lunch break' : 'What happens'} onChange={(e) => setSlot(i, k, { title: e.target.value })} />
                <select aria-label={`Day ${i + 1} slot ${k + 1} kind`} value={s.kind} onChange={(e) => setSlot(i, k, { kind: e.target.value })}>
                  <option value="session">Session</option>
                  <option value="break">Break</option>
                </select>
                <span className="slot-move">
                  <button type="button" className="slot-move-btn" disabled={k === 0} onClick={() => moveSlot(i, k, -1)} aria-label={`Move day ${i + 1} slot ${k + 1} up`} title="Move up">↑</button>
                  <button type="button" className="slot-move-btn" disabled={k === d.slots.length - 1} onClick={() => moveSlot(i, k, 1)} aria-label={`Move day ${i + 1} slot ${k + 1} down`} title="Move down">↓</button>
                </span>
                <button type="button" className="link-btn" aria-label={`Remove day ${i + 1} slot ${k + 1}`} onClick={() => setDay(i, { slots: d.slots.filter((_, m) => m !== k) })}>Remove</button>
              </div>
            ))}
            <div className="actions mt-sm">
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => addSlot(i, 'session')}>+ Add slot</button>
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => addSlot(i, 'break')}>+ Add break</button>
            </div>
          </div>
        ))}
        <button type="button" className="btn btn--sm btn--ghost" onClick={addDay}>{days.length ? '+ Add another day' : '+ Add a schedule'}</button>
      </fieldset>

      <div className="form-grid mt-md">
        <div className="field span-2">
          <label htmlFor="ev-qr">UPI QR code image{paid ? '' : ' (only for paid events)'}</label>
          {qr ? (
            <div className="qr-upload">
              <img src={assetUrl(qr)} alt="Uploaded UPI QR code" />
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setQr(null)}>Remove</button>
            </div>
          ) : (
            <input id="ev-qr" type="file" accept="image/png,image/jpeg,image/webp" onChange={chooseQr} disabled={qrState.busy} />
          )}
          <p className="hint">{qrState.busy ? 'Uploading…' : 'PNG, JPEG or WebP, up to 2 MB. Students scan it to pay; paid sessions of this event use it too.'}</p>
          {qrState.error && <p className="hint danger">{qrState.error}</p>}
        </div>
        <div className="field">
          <label htmlFor="ev-upi">UPI ID (optional)</label>
          <input id="ev-upi" value={f.upiId} onChange={set('upiId')} maxLength={100} autoComplete="off" spellCheck={false} placeholder="swayam@okaxis" />
          <p className="hint">Shown under the QR code, for students who pay by typing the ID.</p>
        </div>
        <div className="field">
          <label htmlFor="ev-payee">Payee name (optional)</label>
          <input id="ev-payee" value={f.upiPayeeName} onChange={set('upiPayeeName')} maxLength={100} placeholder="Swayam E-Cell" />
          <p className="hint">The name students should see in their UPI app before paying.</p>
        </div>
        <div className="field span-2">
          <label htmlFor="ev-instr">Payment instructions (optional)</label>
          <textarea id="ev-instr" rows={2} value={f.paymentInstructions} onChange={set('paymentInstructions')} maxLength={2000} placeholder="Write your roll number in the UPI note." />
        </div>
      </div>
      <Alert>{state.error}</Alert>
      <div className="actions">
        <button className="btn btn--sm" disabled={state.busy || qrState.busy || bannerState.busy}>{state.busy ? 'Saving' : editing ? 'Save changes' : 'Create event'}</button>
        <button type="button" className="btn btn--sm btn--ghost" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}
