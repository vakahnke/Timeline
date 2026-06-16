import { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { api, setAuthFailureHandler } from '../api'
import { tokens } from './tokenStore'

const AuthContext = createContext(null)

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within <AuthProvider>')
  return ctx
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [bootstrapping, setBootstrapping] = useState(true)

  const logout = useCallback(() => {
    const refresh = tokens.refresh
    tokens.clear()                 // clear locally first -> instant UI logout
    setUser(null)
    // Best-effort server-side revoke (blacklist the refresh token); never block logout on it.
    if (refresh) api.auth.logout(refresh).catch(() => {})
  }, [])

  // The api interceptor calls this when a refresh fails -> force logout.
  useEffect(() => {
    setAuthFailureHandler(() => setUser(null))
  }, [])

  // Bootstrap the session from a stored refresh token on first load.
  useEffect(() => {
    let cancelled = false
    async function bootstrap() {
      if (!tokens.refresh) { setBootstrapping(false); return }
      try {
        const me = await api.auth.me()   // 401 -> interceptor refreshes & retries
        if (!cancelled) setUser(me)
      } catch {
        tokens.clear()
        if (!cancelled) setUser(null)
      } finally {
        if (!cancelled) setBootstrapping(false)
      }
    }
    bootstrap()
    return () => { cancelled = true }
  }, [])

  const login = useCallback(async (username, password) => {
    const { access, refresh } = await api.auth.login({ username, password })
    tokens.set({ access, refresh })
    const me = await api.auth.me()
    setUser(me)
    return me
  }, [])

  const register = useCallback(async ({ username, email, password }) => {
    const created = await api.auth.register({ username, email, password })
    // Accounts are inactive until an admin approves them -> can't sign in yet.
    // (If approval is disabled server-side, is_active is true -> sign in seamlessly.)
    if (created?.is_active) {
      await login(username, password)
      return { pending: false }
    }
    return { pending: true }
  }, [login])

  const value = { user, bootstrapping, login, register, logout }
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
