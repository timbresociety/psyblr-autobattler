import { useState } from 'react'
import type { PieceDeps } from '../api'

/** The single-use token inside a sign-in link, or undefined when the link has none. */
export function signInToken(link: string): string | undefined {
  try {
    return new URL(link, window.location.origin).searchParams.get('signin') ?? undefined
  } catch {
    return undefined
  }
}

/**
 * Email magic-link sign-in, asked for only when a player generates something: wearing pieces from the repository needs
 * no account. The local dev server sends no email, so it hands the link back and the player can follow it here.
 */
export function SignIn({ deps, onCancel, onSignedIn }: { deps: Pick<PieceDeps, 'startSignIn' | 'verifySignIn'>; onCancel: () => void; onSignedIn?: () => void }) {
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
      setError(e instanceof Error ? e.message : "couldn't send the link")
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
      setError(e instanceof Error ? e.message : "that sign-in link didn't work")
    } finally {
      setBusy(false)
    }
  }

  if (sent)
    return (
      <section className="sign-in sent" aria-label="Sign-in link sent">
        <h3 className="field-label">Check your inbox</h3>
        <p className="notice">We sent a sign-in link to {email}. It works once, for 15 minutes. Come back here after you follow it.</p>
        {devLink && (
          <div className="dev-link">
            <p className="muted">This is the local dev server, so no email went out. Follow the link from here instead.</p>
            <button type="button" className="btn primary sm" onClick={follow} disabled={busy}>
              Open sign-in link (dev)
            </button>
          </div>
        )}
        {error && <p className="inline-error">{error}</p>}
        <div className="row">
          <button type="button" className="btn ghost sm" onClick={() => (setSent(false), setDevLink(undefined))}>
            Use another email
          </button>
          <button type="button" className="btn quiet sm" onClick={onCancel}>
            Back
          </button>
        </div>
      </section>
    )
  return (
    <form className="sign-in" onSubmit={send} aria-label="Sign in">
      <h3 className="field-label">Sign in to generate</h3>
      <p className="muted">Generating costs credits, so it needs an account. We email you a one-time link, no password.</p>
      <label className="field">
        <span>Email</span>
        <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" />
      </label>
      {error && <p className="inline-error">{error}</p>}
      <div className="row">
        <button className="btn primary sm" disabled={busy || !email}>
          Email me a link
        </button>
        <button type="button" className="btn quiet sm" onClick={onCancel}>
          Back
        </button>
      </div>
    </form>
  )
}
