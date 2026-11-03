import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import { AuthProvider } from './context/auth'
import './index.css'

// After a deploy, a tab opened earlier still asks for the previous build's script files, which no longer exist, and
// the page it opens stays blank. Vite reports that as vite:preloadError: reload once to get the new build. The flag
// stops a reload loop if the files are missing for another reason.
window.addEventListener('vite:preloadError', (event) => {
  try {
    if (sessionStorage.getItem('swayam:reloaded-for-update')) return
    sessionStorage.setItem('swayam:reloaded-for-update', '1')
  } catch {
    // storage unavailable: still reload, at worst once per failure
  }
  event.preventDefault()
  location.reload()
})
window.addEventListener('load', () => setTimeout(() => {
  try {
    sessionStorage.removeItem('swayam:reloaded-for-update')
  } catch {
    // ignore
  }
}, 10000))

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
