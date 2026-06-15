import { useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

export default function LoginPage() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const from = location.state?.from?.pathname || '/'

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
      setError(err.status === 401 ? 'Incorrect username or password.' : 'Could not sign in. Try again.')
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
          <label>Username</label>
          <input value={username} onChange={e => setUsername(e.target.value)}
                 placeholder="you" autoFocus autoComplete="username" />
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
