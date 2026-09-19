import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  // Where to go after sign-in comes from the URL the visitor arrived on, so treat it as untrusted:
  // only a plain in-app path is accepted. "//host" and "/\host" are read by browsers as another
  // site, which would turn a crafted link into a redirect off this site right after signing in.
  const wanted = location.state?.from?.pathname
  const from = typeof wanted === 'string' && /^\/(?![/\\])[^\\]*$/.test(wanted) ? wanted : '/'

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [busy,     setBusy]     = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      await login(username.trim(), password)
      navigate(from, { replace: true })
    } catch (err) {
      // Prefer the server's message (e.g. "awaiting approval"); fall back to friendly text.
      let msg = null
      try { const d = JSON.parse(err.body); msg = d.detail || Object.values(d).flat()[0] } catch { /* none */ }
      if (!msg || /no active account/i.test(msg)) {
        msg = err.status === 401
          ? 'Incorrect email/username or password.'
          : 'Could not sign in. Please try again.'
      }
      setError(msg)
      setBusy(false)
    }
  }

  return (
    <div className="auth-screen scroll-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">Timeline</div>
        <h1 className="auth-title">Welcome back</h1>
        <p className="auth-sub">Sign in to plan your projects.</p>

        <div className="field">
          <label>Email or username</label>
          <input value={username} onChange={e => setUsername(e.target.value)}
                 placeholder="you@example.com" autoFocus autoComplete="username" />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                 placeholder="••••••••" autoComplete="current-password" />
        </div>

        {error && <div className="field-error">✕ {error}</div>}

        <button className="btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>

        <p className="auth-foot">
          New here? <Link to="/register">Create an account</Link>
        </p>
      </form>
    </div>
  )
}
