// /welcome: right after the first Google sign-in (and for older accounts missing details), the student fills in
// phone, roll number, branch and year. Every other page sends signed-in users here until it's done (see App.jsx).
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import ProfileForm from '../components/ProfileForm'
import { Loading } from '../components/ui'
import { displayName, useAuth } from '../context/auth'

export default function Welcome() {
  const { user, ready, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = location.state?.from
  const returnTo = typeof from === 'string' && from.startsWith('/') && !from.startsWith('//') && from !== '/welcome' ? from : '/dashboard'

  if (!ready) return <div className="w page"><Loading /></div>
  if (!user) return <Navigate to="/login" replace />
  if (user.profileComplete) return <Navigate to={returnTo} replace />

  return (
    <div className="w page narrow">
      <span className="eyebrow">One last step</span>
      <h1 className="page-title">Welcome{displayName(user) ? `, ${displayName(user)}` : ''}</h1>
      <p className="muted mb-md">Tell us who you are so the organisers can find your registration and reach you about events. You only do this once.</p>
      <ProfileForm submitLabel="Continue" onSaved={() => navigate(returnTo, { replace: true })} />
      <p className="small muted mt-md">
        Signed in as {user.email}. <button className="link-btn small" onClick={logout}>Not you? Sign out</button>
      </p>
    </div>
  )
}
