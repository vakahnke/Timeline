import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, ApiError } from '../api'
import { BRAND } from '../constants'

// Step 1 of a password reset: ask for a link. The answer is deliberately the same whether or not
// the address has an account, so this page cannot be used to find out who has one.
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [busy, setBusy]   = useState(false)
  const [sent, setSent]   = useState('')
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setError(''); setBusy(true)
    try {
      const r = await api.auth.requestPasswordReset(email.trim())
      setSent(r.detail)
    } catch (err) {
      setError(err instanceof ApiError && err.status === 429
        ? 'Too many requests. Wait a while before asking again.'
        : 'Could not send the request. Check your connection and try again.')
    } finally { setBusy(false) }
  }

  return (
    <div className="auth-screen scroll-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">{BRAND}</div>
        <h1 className="auth-title">Forgot your password?</h1>
        {sent ? (
          <>
            <p className="auth-sub" role="status">{sent}</p>
            <p className="auth-sub">Check your inbox, and your spam folder. Nothing changes until you use the link.</p>
          </>
        ) : (
          <>
            <p className="auth-sub">Enter the email address on your account and we’ll send you a link to choose a new one.</p>
            <div className="field">
              <label htmlFor="fp-email">Email</label>
              <input id="fp-email" type="email" value={email} onChange={e => setEmail(e.target.value)} required
                     placeholder="you@example.com" autoFocus autoComplete="email" />
            </div>
            {error && <div className="field-error">✕ {error}</div>}
            <button className="btn-primary btn-block" type="submit" disabled={busy || !email.trim()}>
              {busy ? 'Sending…' : 'Send reset link'}
            </button>
          </>
        )}
        <p className="auth-foot"><Link to="/login">Back to sign in</Link></p>
      </form>
    </div>
  )
}
