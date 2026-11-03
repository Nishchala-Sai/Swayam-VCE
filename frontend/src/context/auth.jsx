// The signed-in user. The session itself is the backend's httpOnly cookie, which JavaScript can't read; this context
// asks GET /api/auth/me on load and after every sign-in, and keeps the answer. Sign-in is Google-only.
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [ready, setReady] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const me = await api('/auth/me')
      setUser(me)
      return me
    } catch {
      setUser(null)
      return null
    }
  }, [])

  useEffect(() => {
    refresh().finally(() => setReady(true))
  }, [refresh])

  const value = useMemo(
    () => ({
      user,
      ready,
      refresh,
      async googleLogin(idToken) {
        await api('/auth/google-login', { method: 'POST', body: { idToken } })
        return refresh()
      },
      async updateName(name) {
        const me = await api('/auth/me', { method: 'PATCH', body: { name } })
        setUser(me)
        return me
      },
      async logout() {
        await api('/auth/logout', { method: 'POST' }).catch(() => {})
        setUser(null)
      },
    }),
    [user, ready, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => useContext(AuthContext)

// First name or the part of the email before @, for greetings
export const displayName = (user) => (user?.name || user?.email?.split('@')[0] || '').split(' ')[0]
