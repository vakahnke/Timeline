import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'

export default function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()

  const [username, setUsername] = useState('')
  const [email,    setEmail]    = useState('')
  const [password, setPassword] = useState('')
  const [confirm,  setConfirm]  = useState('')
  const [error,    setError]    = useState('')
  const [busy,     setBusy]     = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    if (!username.trim() || !email.trim() || !password) {
      setError('All fields are required.'); return
    }
    if (password !== confirm) { setError('Passwords don’t match.'); return }
    if (password.length < 8)  { setError('Password must be at least 8 characters.'); return }

    setBusy(true)
    try {
      await register({ username: username.trim(), email: email.trim(), password })
      navigate('/', { replace: true })
    } catch (err) {
      // DRF returns field errors as JSON; surface the first useful message.
      let msg = 'Could not create the account.'
      try {
        const data = JSON.parse(err.body)
        msg = Object.values(data).flat()[0] || msg
      } catch { /* keep default */ }
      setError(msg)
      setBusy(false)
    }
  }

  return (
    <div className="auth-screen scroll-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">Timeline</div>
        <h1 className="auth-title">Create your account</h1>
        <p className="auth-sub">Start planning projects with your team.</p>

        <div className="field">
          <label>Username</label>
          <input value={username} onChange={e => setUsername(e.target.value)}
                 placeholder="you" autoFocus autoComplete="username" />
        </div>
        <div className="field">
          <label>Email</label>
          <input type="email" value={email} onChange={e => setEmail(e.target.value)}
                 placeholder="you@example.com" autoComplete="email" />
        </div>
        <div className="fields-row">
          <div className="field">
            <label>Password</label>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)}
                   placeholder="••••••••" autoComplete="new-password" />
          </div>
          <div className="field">
            <label>Confirm</label>
            <input type="password" value={confirm} onChange={e => setConfirm(e.target.value)}
                   placeholder="••••••••" autoComplete="new-password" />
          </div>
        </div>

        {error && <div className="field-error">✕ {error}</div>}

        <button className="btn-primary btn-block" type="submit" disabled={busy}>
          {busy ? 'Creating…' : 'Create account'}
        </button>

        <p className="auth-foot">
          Already have an account? <Link to="/login">Sign in</Link>
        </p>
      </form>
    </div>
  )
}
