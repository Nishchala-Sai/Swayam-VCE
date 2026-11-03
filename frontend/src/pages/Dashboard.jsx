// /dashboard: a different dashboard for each role. Students see their tickets and payments; event heads manage the
// events they created; admins see the whole club. Staff can still reach their own tickets from the "My tickets" tab.
import { useSearchParams } from 'react-router-dom'
import { displayName, useAuth } from '../context/auth'
import StaffDashboard from './dashboard/StaffDashboard'
import StudentDashboard from './dashboard/StudentDashboard'
import Refunds from './dashboard/Refunds'

const TITLES = {
  ADMIN: { eyebrow: 'Admin', intro: 'Club-wide numbers, every event, and the tools to run them.' },
  EVENT_HEAD: { eyebrow: 'Event manager', intro: 'Your events: approve payments, manage sessions and scan tickets at the door.' },
  STUDENT: { eyebrow: 'Dashboard', intro: 'Your registrations and tickets. Show your master QR ticket at the entrance.' },
}

export default function Dashboard() {
  const { user } = useAuth()
  const [params, setParams] = useSearchParams()
  const staff = user.role === 'ADMIN' || user.role === 'EVENT_HEAD'
  const myTickets = staff && params.get('view') === 'tickets'
  const refunds = staff && params.get('view') === 'refunds'
  const students = user.role === 'ADMIN' && params.get('view') === 'students' // shown by StaffDashboard
  const t = TITLES[user.role] ?? TITLES.STUDENT

  return (
    <div className="w page">
      <span className="eyebrow">{t.eyebrow}</span>
      <h1 className="page-title">Hi, {displayName(user)}</h1>
      <p className="intro">{myTickets ? TITLES.STUDENT.intro : t.intro}</p>

      {staff && (
        <div className="chips mt-md" role="group" aria-label="Dashboard view">
          <button className="chip" aria-pressed={!myTickets && !refunds && !students} onClick={() => setParams({})}>
            {user.role === 'ADMIN' ? 'Manage the club' : 'Manage events'}
          </button>
          {user.role === 'ADMIN' && (
            <button className="chip" aria-pressed={students} onClick={() => setParams({ view: 'students' })}>
              All students
            </button>
          )}
          <button className="chip" aria-pressed={refunds} onClick={() => setParams({ view: 'refunds' })}>
            Refunds
          </button>
          <button className="chip" aria-pressed={myTickets} onClick={() => setParams({ view: 'tickets' })}>
            My tickets
          </button>
        </div>
      )}

      <div className="mt-lg">
        {!staff || myTickets ? <StudentDashboard /> : refunds ? <Refunds /> : <StaffDashboard admin={user.role === 'ADMIN'} />}
      </div>
    </div>
  )
}
