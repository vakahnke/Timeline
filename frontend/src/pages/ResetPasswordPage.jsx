import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { api, ApiError } from '../api'
import { useAuth } from '../auth/AuthContext'
import { BRAND } from '../constants'

// Step 2 of a password reset: the page an emailed link opens. The token is read once and then
// removed from the address bar, and the page asks browsers not to send a Referer, so the secret
// does not end up in history, screenshots or another site's logs.
export default function ResetPasswordPage() {
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const link = useRef(null)
  if (link.current === null) {
    const q = new URLSearchParams(window.location.search)
    link.current = { uid: q.get('uid') || '', token: q.get('token') || '' }
  }
  const [state, setState]       = useState('checking')      // checking | ready | bad
  const [password, setPassword] = useState('')
  const [show, setShow]         = useState(false)
  const [busy, setBusy]         = useState(false)
  const [errors, setErrors]     = useState([])

  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'referrer'; meta.content = 'no-referrer'
    document.head.appendChild(meta)
    window.history.replaceState(null, '', '/reset-password')
    let alive = true
    api.auth.confirmPasswordReset(link.current)               // no password: only checks the link
      .then(() => alive && setState('ready'))
      .catch(() => alive && setState('bad'))
    return () => { alive = false; meta.remove() }
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    setErrors([]); setBusy(true)
    try {
      await api.auth.confirmPasswordReset({ ...link.current, new_password: password })
      if (user) logout()                                      // this browser's session was just revoked too
      navigate('/login', { replace: true, state: { notice: 'Password changed. Sign in with your new password.' } })
    } catch (err) {
      let body = null
      try { body = JSON.parse(err.body) } catch { /* not JSON */ }
      if (body?.code === 'bad_link') setState('bad')
      else if (body?.new_password) setErrors(body.new_password)
      else setErrors([err instanceof ApiError && err.status === 429 ? 'Too many attempts. Wait a while and try again.' : 'Could not change the password. Try again.'])
      setBusy(false)
    }
  }

  return (
    <div className="auth-screen scroll-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">{BRAND}</div>
        <h1 className="auth-title">Choose a new password</h1>
        {state === 'checking' && <p className="auth-sub">Checking your link…</p>}
        {state === 'bad' && (
          <>
            <p className="auth-sub" role="alert">This reset link is invalid or has expired. Links work once, for one hour.</p>
            <Link className="btn-primary btn-block" to="/forgot-password">Ask for a new link</Link>
          </>
        )}
        {state === 'ready' && (
          <>
            <p className="auth-sub">At least 8 characters, not all numbers, and not a common password. You’ll be signed out everywhere else.</p>
            <div className="field">
              <label htmlFor="rp-password">New password</label>
              <input id="rp-password" type={show ? 'text' : 'password'} value={password} onChange={e => setPassword(e.target.value)}
                     autoFocus autoComplete="new-password" minLength={8} required />
              <label className="auth-check"><input type="checkbox" checked={show} onChange={e => setShow(e.target.checked)} /> Show password</label>
            </div>
            {errors.map(m => <div className="field-error" key={m}>✕ {m}</div>)}
            <button className="btn-primary btn-block" type="submit" disabled={busy || password.length < 8}>
              {busy ? 'Saving…' : 'Change password'}
            </button>
          </>
        )}
        <p className="auth-foot"><Link to="/login">Back to sign in</Link></p>
      </form>
    </div>
  )
}
