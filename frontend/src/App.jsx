import { lazy, Suspense, useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Navbar from './components/Navbar'
import Footer from './components/Footer'
import Spotlight from './components/Spotlight'
import { Loading } from './components/ui'
import { useAuth } from './context/auth'
import Home from './pages/Home'
import Events from './pages/Events'
import EventDetail from './pages/EventDetail'
import About from './pages/About'
import DepartmentDetail from './pages/DepartmentDetail'
import { Login } from './pages/Auth'
import Dashboard from './pages/Dashboard'
import Ticket from './pages/Ticket'
import Profile from './pages/Profile'
import NotFound from './pages/NotFound'

// The scanner pulls in the camera library, so it is only downloaded by staff who open it
const Scanner = lazy(() => import('./pages/Scanner'))
export const STAFF_ROLES = ['ADMIN', 'EVENT_HEAD']

// Pages that need a session. Waits for the session check, then sends logged-out visitors to /login and back again.
function RequireAuth({ children }) {
  const { user, ready } = useAuth()
  const location = useLocation()
  if (!ready) return <div className="w page"><Loading /></div>
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  return children
}

// Signed-in pages for some roles only. Others see a plain explanation rather than a blank page.
function RequireRole({ roles, children }) {
  const { user } = useAuth()
  if (!roles.includes(user.role)) {
    return (
      <div className="w page narrow">
        <span className="eyebrow">Staff only</span>
        <h1 className="page-title">You don't have access</h1>
        <p className="intro">This page is for Swayam admins and event heads. If you are one, ask an admin to update your account's role.</p>
      </div>
    )
  }
  return children
}

// New page: start at the top, unless the link points at a section (#partner)
function ScrollManager() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (hash) {
      const el = document.getElementById(hash.slice(1))
      if (el) return el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
    window.scrollTo(0, 0)
  }, [pathname, hash])
  return null
}

export default function App() {
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <ScrollManager />
      <Spotlight />
      <Navbar />
      <main id="main">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/events" element={<Events />} />
          <Route path="/events/upcoming" element={<Events phase="upcoming" />} />
          <Route path="/events/ongoing" element={<Events phase="ongoing" />} />
          <Route path="/events/past" element={<Events phase="past" />} />
          <Route path="/events/:id" element={<EventDetail />} />
          <Route path="/about" element={<About />} />
          <Route path="/teams/:departmentId" element={<DepartmentDetail />} />
          <Route path="/login" element={<Login />} />
          {/* Sign-in is Google-only; older links to the password pages land on the sign-in page */}
          {['/signup', '/forgot-password', '/reset-password'].map((path) => (
            <Route key={path} path={path} element={<Navigate to="/login" replace />} />
          ))}
          <Route path="/dashboard" element={<RequireAuth><Dashboard /></RequireAuth>} />
          <Route path="/tickets/:eventId" element={<RequireAuth><Ticket /></RequireAuth>} />
          <Route path="/profile" element={<RequireAuth><Profile /></RequireAuth>} />
          <Route
            path="/admin/scan"
            element={
              <RequireAuth>
                <RequireRole roles={STAFF_ROLES}>
                  <Suspense fallback={<div className="w page"><Loading>Loading scanner</Loading></div>}><Scanner /></Suspense>
                </RequireRole>
              </RequireAuth>
            }
          />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <Footer />
    </>
  )
}
