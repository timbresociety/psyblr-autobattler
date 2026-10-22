import { useState } from 'react'
import type { ForgeDeps } from './forge-api'

/** Email magic-link sign-in; forging needs an account, the creator does not (KTD5, KTD12). */
export function SignIn({ deps, onCancel }: { deps: ForgeDeps; onCancel: () => void }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function send(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      await deps.startSignIn(email)
      setSent(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not send the link')
    } finally {
      setBusy(false)
    }
  }

  if (sent) return <p className="notice">Check {email} for a sign-in link. It works once, for 15 minutes.</p>
  return (
    <form className="panel sign-in" onSubmit={send} aria-label="Sign in">
      <h2>Sign in to forge</h2>
      <p className="muted">Your first hero is free. We email you a one-time link; no password.</p>
      <label className="field">
        <span>Email</span>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      </label>
      {error && <p className="inline-error">{error}</p>}
      <div className="row">
        <button className="primary" disabled={busy || !email}>
          Email me a link
        </button>
        <button type="button" className="ghost" onClick={onCancel}>
          Back
        </button>
      </div>
    </form>
  )
}
