import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'
import { api, assetUrl } from '../api/client'
import RegisterModal from '../components/RegisterModal'
import SubEvents from '../components/SubEvents'
import { Alert, Crumbs, Loading, Modal, Pill, SeatBar, toneForSeats } from '../components/ui'
import { useAuth } from '../context/auth'
import { useLiveEvents } from '../hooks/useLiveEvents'
import { registrationState, useMyRegistrations } from '../hooks/useMyRegistrations'
import { canRegister, findArchive, fmtDateTime, fromLive, inr, PHASE_LABEL, rupees, seatStatus } from '../lib/events'
import NotFound from './NotFound'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// /events/:id — an archive slug (documented past event) or a live event id from the backend
export default function EventDetail() {
  const { id } = useParams()
  const archived = findArchive(id)
  if (archived) return <ArchiveEvent e={archived} />
  if (UUID.test(id)) return <LiveEvent id={id.toLowerCase()} />
  return <NotFound />
}

const crumbsFor = (e) => [
  { label: 'Events', to: '/events' },
  { label: PHASE_LABEL[e.phase], to: `/events/${e.phase}` },
  { label: e.name },
]

/* ---- Archive (documented past events) -------------------------------------------------------------------------- */

function ArchiveEvent({ e }) {
  const r = e.raw
  const schedule = r.flow ?? r.schedule
  return (
    <div className="w page">
      <Crumbs items={crumbsFor(e)} />
      <h1 className="page-title">{e.name}</h1>
      <div className="detail-meta">
        <Pill tone="accent">{e.category}</Pill>
        <Pill>{e.dateLabel}</Pill>
        {r.academicYear && <Pill>{r.academicYear}</Pill>}
        {e.mode && <Pill>{e.mode}</Pill>}
      </div>

      {e.poster && (
        <div className="detail-hero"><img src={e.poster} alt={`${e.name} poster`} /></div>
      )}

      <div className="split">
        <article className="prose">
          <h2>About</h2>
          <p>{r.about || r.summary}</p>

          <List title="Objectives" items={r.objectives} />
          {schedule?.length > 0 && (
            <>
              <h2>Schedule</h2>
              <dl className="sched">
                {schedule.map((s, i) => (
                  <div key={i}>
                    <dt>{s.day || s.time || s.session || `Part ${i + 1}`}</dt>
                    <dd>{s.events || s.activity || s.description || s.title}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          {r.activities?.length > 0 && (
            <>
              <h2>Activities</h2>
              <dl className="sched">
                {r.activities.map((a, i) => (
                  <div key={a.name ?? i}>
                    <dt>{a.name}</dt>
                    <dd>{a.description}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          <List title="Rules" items={r.rules} />
          <List title="Highlights" items={r.highlights} />

          {r.speakers?.length > 0 && (
            <>
              <h2>Speakers and mentors</h2>
              <ul className="people">
                {r.speakers.map((s) => (
                  <li key={s.name}><b>{s.name}</b>{s.role && <span>{s.role}</span>}</li>
                ))}
              </ul>
            </>
          )}

          <Prizes r={r} />

          {r.outcomes && (<><h2>Outcomes</h2><p>{r.outcomes}</p></>)}
          {r.feedback && (<><h2>Participant feedback</h2><p>{r.feedback}</p></>)}
          {r.conclusion && (<><h2>Conclusion</h2><p>{r.conclusion}</p></>)}

          {r.gallery?.length > 0 && <Gallery items={r.gallery} name={e.name} />}
          {r.sourceNote && <p className="source-note">Source note: {r.sourceNote}</p>}
        </article>

        <aside className="panel aside">
          <p className={`price ${e.groupSize ? 'mb-0' : ''}`}>{inr(e.fee)}{e.groupSize && <small className="muted"> per person</small>}</p>
          {e.groupSize && <p className="accent">Group of {e.groupSize}: {rupees(e.groupPrice)} total</p>}
          {e.raw.maxTeamSize && <p className="small muted">Teams of up to {e.raw.maxTeamSize} can register together.</p>}
          <p className="muted small">This event has ended.</p>
          <dl className="defs mt-md">
            <Def label="Date">{e.dateLabel}</Def>
            <Def label={r.duration && !r.time ? 'Duration' : 'Time'}>{r.time || r.duration}</Def>
            <Def label="Venue">{e.venue}</Def>
            <Def label="Mode">{e.mode}</Def>
            <Def label="Participants">{r.participants}</Def>
            <Def label="Organisers">{r.jointOrganizers}</Def>
            <Def label="Coordinator">{r.coordinator}</Def>
            <Def label="Supervision">{r.supervision}</Def>
          </dl>
          <div className="aside-links">
            {r.officialReportUrl && <a className="btn btn--sm btn--ghost" href={r.officialReportUrl} target="_blank" rel="noreferrer">Official report (PDF)</a>}
            {r.photosLink && <a className="btn btn--sm btn--ghost" href={r.photosLink} target="_blank" rel="noreferrer">All photos</a>}
            {r.officialWebsiteUrl && <a className="btn btn--sm btn--ghost" href={r.officialWebsiteUrl} target="_blank" rel="noreferrer">Event website</a>}
            {r.externalLinks?.map((l) => (
              <a key={l.url} className="btn btn--sm btn--ghost" href={l.url} target="_blank" rel="noreferrer">{l.title}</a>
            ))}
          </div>
        </aside>
      </div>
    </div>
  )
}

function List({ title, items }) {
  if (!items?.length) return null
  return (
    <>
      <h2>{title}</h2>
      <ul>{items.map((t, i) => <li key={i}>{t}</li>)}</ul>
    </>
  )
}

function Def({ label, children }) {
  if (!children) return null
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function Prizes({ r }) {
  if (!r.winners?.length && !r.totalPrizePool && !r.prizes) return null
  const places = [['first', 'Winner'], ['second', 'Runner-up'], ['third', 'Third']]
  return (
    <>
      <h2>Prizes and winners</h2>
      {r.totalPrizePool && <p>Total prize pool: <b className="accent">{r.totalPrizePool}</b></p>}
      {r.prizes && <p>{r.prizes}</p>}
      {r.winners?.length > 0 && (
        <div className="table-scroll">
          <table className="winners">
            <thead>
              <tr><th scope="col">Competition</th><th scope="col">Results</th></tr>
            </thead>
            <tbody>
              {r.winners.map((w, i) => (
                <tr key={w.event ?? i}>
                  <td><b>{w.event}</b>{w.pool && <><br /><span className="muted small">{w.pool}</span></>}</td>
                  <td>
                    {places.filter(([k]) => w[k]).map(([k, label]) => (
                      <div key={k}>
                        <span className="muted">{label}: </span>{w[k]}{w[`${k}Amount`] && <span className="muted"> ({w[`${k}Amount`]})</span>}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {r.prizeNote && <p className="source-note">{r.prizeNote}</p>}
    </>
  )
}

function Gallery({ items, name }) {
  const [open, setOpen] = useState(null)
  return (
    <>
      <h2>Gallery</h2>
      <div className="gallery">
        {items.map((g, i) => (
          <figure key={i}>
            <button onClick={() => setOpen(i)} aria-label={`Open photo: ${g.caption}`}>
              <img src={g.img} alt={g.caption} loading="lazy" />
            </button>
            <figcaption>{g.caption}</figcaption>
          </figure>
        ))}
      </div>
      {open !== null && (
        <Modal label={`${name} photo`} wide onClose={() => setOpen(null)}>
          <figure className="lightbox">
            <img src={items[open].img} alt={items[open].caption} />
            <figcaption>{items[open].caption} · {open + 1} of {items.length}</figcaption>
          </figure>
          <div className="actions">
            <button className="btn btn--sm btn--ghost" onClick={() => setOpen((open - 1 + items.length) % items.length)}>Previous</button>
            <button className="btn btn--sm btn--ghost" onClick={() => setOpen((open + 1) % items.length)}>Next</button>
            <button className="btn btn--sm" onClick={() => setOpen(null)}>Close</button>
          </div>
        </Modal>
      )}
    </>
  )
}

/* ---- Live events (from the backend, with registration) --------------------------------------------------------- */

// "10:00" -> "10:00 am"; the schedule's times are the event's local (IST) clock times
const clock = (hhmm) => new Date(`2000-01-01T${hhmm}:00`).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })

function LiveSchedule({ days }) {
  return (
    <>
      <h2>Schedule</h2>
      {days.map((d, i) => (
        <section key={d.date} className="sched-day">
          <h3>
            {days.length > 1 && <span className="accent">Day {i + 1} · </span>}
            {new Date(`${d.date}T00:00:00`).toLocaleDateString('en-IN', { weekday: 'long', day: 'numeric', month: 'long' })}
          </h3>
          <dl className="sched">
            {d.slots.map((s) => (
              <div key={s.start + s.title} className={s.kind === 'break' ? 'sched-break' : undefined}>
                <dt>{clock(s.start)} – {clock(s.end)}</dt>
                <dd>{s.title}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}
    </>
  )
}

function LiveEvent({ id }) {
  const { live, loading: listLoading, reload } = useLiveEvents()
  const { user } = useAuth()
  const mine = useMyRegistrations()
  const navigate = useNavigate()
  const location = useLocation()
  const [fetched, setFetched] = useState(null)
  const [missing, setMissing] = useState(false)
  const [modal, setModal] = useState(null) // 'confirm' | 'pay'

  const fromList = live.find((e) => e.key === id)
  useEffect(() => {
    if (listLoading || fromList) return
    api(`/events/${id}`).then((e) => setFetched(fromLive(e))).catch(() => setMissing(true))
  }, [id, listLoading, fromList])

  const e = fromList ?? fetched
  if (missing) return <NotFound />
  if (!e) return <div className="w page"><Loading /></div>

  const reg = mine.forEvent(e.key)
  const state = reg && registrationState(reg)
  const status = seatStatus(e)
  const description = e.raw.description ?? ''

  function start() {
    if (!user) return navigate('/login', { state: { from: location.pathname } })
    setModal('confirm')
  }

  return (
    <div className="w page">
      <Crumbs items={crumbsFor(e)} />
      <h1 className="page-title">{e.name}</h1>
      <div className="detail-meta">
        <Pill tone={toneForSeats(status)}>{status}</Pill>
        <Pill>{fmtDateTime(e.start)}</Pill>
        {e.venue && <Pill>{e.venue}</Pill>}
      </div>

      {e.raw.bannerUrl && (
        <div className="detail-hero"><img src={assetUrl(e.raw.bannerUrl)} alt={`${e.name} banner`} /></div>
      )}

      <div className="split">
        <article className="prose">
          <h2>About</h2>
          {description.split(/\n{2,}/).map((para, i) => <p key={i}>{para}</p>)}
          {e.raw.schedule?.length > 0 && <LiveSchedule days={e.raw.schedule} />}
          {e.fee > 0 && (
            <>
              <h2>Payment</h2>
              <p>
                This event costs {inr(e.fee)} per person{e.groupSize ? `, or ${rupees(e.groupPrice)} in total for a team of exactly ${e.groupSize}` : ''}. After you register, pay by UPI using the QR code shown, then enter your
                UPI transaction reference (UTR). Your seat is held while the organisers verify the payment, and your
                ticket appears on your dashboard once it is confirmed.
              </p>
              {e.raw.upiId && (
                <p>
                  UPI ID: <span className="mono">{e.raw.upiId}</span>
                  {e.raw.upiPayeeName && <> (payee name <b>{e.raw.upiPayeeName}</b>)</>}
                </p>
              )}
              {e.raw.paymentInstructions && <p>{e.raw.paymentInstructions}</p>}
            </>
          )}
        </article>

        <aside className="panel aside">
          <p className={`price ${e.groupSize ? 'mb-0' : ''}`}>{inr(e.fee)}{e.groupSize && <small className="muted"> per person</small>}</p>
          {e.groupSize && <p className="accent">Group of {e.groupSize}: {rupees(e.groupPrice)} total</p>}
          {e.raw.maxTeamSize && <p className="small muted">Teams of up to {e.raw.maxTeamSize} can register together.</p>}
          <p className="mb-0">{fmtDateTime(e.start)}</p>
          <p className="muted">{e.venue}</p>
          <SeatBar taken={e.taken} capacity={e.capacity} className="seatbar--panel" />
          {e.taken != null && <p className="small muted">{e.taken} of {e.capacity} seats taken · {status}</p>}

          {reg ? (
            <>
              <Alert tone={state.tone === 'ok' ? 'ok' : 'info'}>{state.label}: {state.detail}</Alert>
              {reg.status === 'CONFIRMED' && reg.paymentStatus === 'VERIFIED' && <Link className="btn btn--block" to={`/tickets/${e.key}`}>View ticket</Link>}
              {reg.status === 'CONFIRMED' && reg.paymentStatus === 'PENDING' && !reg.utrNumber && (reg.isGroupLeader || !reg.teamId) && (
                <button className="btn btn--block" onClick={() => setModal('pay')}>Submit payment details</button>
              )}
              {reg.status === 'CANCELLED' && reg.paymentStatus !== 'REFUND_REQUIRED' && canRegister(e) && (
                <button className="btn btn--block" onClick={start}>Register again</button>
              )}
            </>
          ) : (
            <button className="btn btn--block" onClick={start} disabled={!canRegister(e)}>
              {canRegister(e) ? 'Register' : status}
            </button>
          )}
        </aside>
      </div>

      <SubEvents event={e} registration={reg} />

      {modal && (
        <RegisterModal
          event={e}
          startAt={modal}
          registrationId={reg?.id ?? null}
          amountDue={reg ? reg.totalAmountPaid ?? e.fee : null}
          onClose={() => setModal(null)}
          onChanged={() => { reload(); mine.reload() }}
        />
      )}
    </div>
  )
}
