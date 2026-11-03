import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/auth'

const navClass = ({ isActive }) => (isActive ? 'active' : undefined)

export default function Navbar() {
  const { user, ready, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const { pathname } = useLocation()
  const navigate = useNavigate()

  useEffect(() => setOpen(false), [pathname])

  async function onLogout() {
    await logout()
    navigate('/')
  }

  return (
    <header className="nav">
      <div className="w nav-inner">
        <Link to="/" className="brand" aria-label="Swayam E-Cell home">
          Swayam <small>E-Cell</small>
        </Link>
        <button className="menu-btn" aria-expanded={open} aria-controls="site-nav" onClick={() => setOpen((o) => !o)}>
          {open ? 'Close' : 'Menu'}
        </button>
        <nav id="site-nav" className={`nav-links ${open ? 'open' : ''}`} aria-label="Main">
          <NavLink to="/events" className={() => (pathname.startsWith('/events') ? 'active' : undefined)}>Events</NavLink>
          <NavLink to="/about" className={() => (pathname.startsWith('/about') || pathname.startsWith('/teams') ? 'active' : undefined)}>About</NavLink>
          <Link to="/#partner">Partner</Link>
          {ready && user && (
            <>
              {['ADMIN', 'EVENT_HEAD'].includes(user.role) && <NavLink to="/admin/scan" className={navClass}>Scan</NavLink>}
              <NavLink to="/dashboard" className={navClass}>Dashboard</NavLink>
              <NavLink to="/profile" className={navClass}>Profile</NavLink>
              <button className="link-btn" onClick={onLogout}>Log out</button>
            </>
          )}
          {ready && !user && <Link className="btn btn--sm" to="/login">Sign in</Link>}
        </nav>
      </div>
    </header>
  )
}
