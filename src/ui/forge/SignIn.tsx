import { useState } from 'react'
import type { ForgeDeps } from './forge-api'

/** The single-use token inside a sign-in link, or undefined when the link has none. */
export function signInToken(link: string): string | undefined {
  try {
    return new URL(link, window.location.origin).searchParams.get('signin') ?? undefined
  } catch {
    return undefined
  }
}

/**
 * Email magic-link sign-in; forging needs an account, the creator does not (KTD5, KTD12). The local dev server sends
 * no email, so it hands the link back and the player can follow it here.
 */
export function SignIn({ deps, onCancel, onSignedIn }: { deps: ForgeDeps; onCancel: () => void; onSignedIn?: () => void }) {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [devLink, setDevLink] = useState<string>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  async function send(event: React.FormEvent) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const started = await deps.startSignIn(email)
      setDevLink(started?.devLink)
      setSent(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not send the link')
    } finally {
      setBusy(false)
    }
  }

  async function follow() {
    if (!devLink) return
    const token = signInToken(devLink)
    if (!token) return window.location.assign(devLink)
    setBusy(true)
    setError('')
    try {
      await deps.verifySignIn(token)
      onSignedIn?.()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'that sign-in link did not work')
    } finally {
      setBusy(false)
    }
  }

  if (sent)
    return (
      <section className="panel sign-in sent" aria-label="Sign-in link sent">
        <span className="sign-in-mark" aria-hidden="true">
          <svg viewBox="0 0 24 24">
            <path d="M3 6.5h18v11H3z M3.5 7l8.5 6.5L20.5 7" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
          </svg>
        </span>
        <h2 className="section-title">Check your inbox</h2>
        <p className="notice">Check {email} for a sign-in link. It works once, for 15 minutes.</p>
        {devLink && (
          <div className="dev-link">
            <p className="muted">This is the local dev server, so no email went out. Follow the link from here instead.</p>
            <button className="btn primary" onClick={follow} disabled={busy}>
              Open sign-in link (dev)
            </button>
          </div>
        )}
        {error && <p className="inline-error">{error}</p>}
        <div className="row">
          <button className="btn ghost sm" onClick={() => (setSent(false), setDevLink(undefined))}>
            Use another email
          </button>
          <button className="btn quiet sm" onClick={onCancel}>
            Back
          </button>
        </div>
      </section>
    )
  return (
    <form className="panel sign-in" onSubmit={send} aria-label="Sign in">
      <span className="sign-in-mark" aria-hidden="true">
        <svg viewBox="0 0 24 24">
          <path d="M12 3a4 4 0 1 1 0 8 4 4 0 0 1 0-8zM4.5 20.5c.8-4 3.8-6.5 7.5-6.5s6.7 2.5 7.5 6.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
        </svg>
      </span>
      <h2 className="section-title">Sign in to forge</h2>
      <p className="muted">Your first hero is free. We email you a one-time link; no password.</p>
      <label className="field">
        <span>Email</span>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" />
      </label>
      {error && <p className="inline-error">{error}</p>}
      <div className="row">
        <button className="btn primary" disabled={busy || !email}>
          Email me a link
        </button>
        <button type="button" className="btn quiet" onClick={onCancel}>
          Back
        </button>
      </div>
    </form>
  )
}
