import { useEffect, useState } from 'react'
import type { CreditsView, ForgeDeps } from './forge-api'

const money = (cents: number, currency: string) => new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)

/** The balance as a coin count, for the forge's header. */
export function CreditChip({ balance }: { balance: number }) {
  return (
    <span className="credit-chip" title="Credits">
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M12 2.5 20.5 12 12 21.5 3.5 12z" fill="currentColor" />
        <path d="M12 6.5 16.6 12 12 17.5 7.4 12z" fill="#1d1206" opacity=".35" />
      </svg>
      <b>{balance}</b>
      <span>credits</span>
    </span>
  )
}

/**
 * The one free hero and prepaid packs (R3, AE2). It shows only when it has something to offer: the unclaimed free
 * credits, or packs when this step costs more than the balance.
 */
export function Credits({ deps, balance, need, onBalance }: { deps: ForgeDeps; balance: number; need?: number; onBalance: (n: number) => void }) {
  const [view, setView] = useState<CreditsView>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // a refused claim (already claimed, or one per network a day) is not offered again
  const [refused, setRefused] = useState(false)

  useEffect(() => {
    let live = true
    deps.credits().then(
      (v) => live && setView(v),
      () => live && setError('could not load credits'),
    )
    return () => {
      live = false
    }
  }, [deps])

  async function claim() {
    setBusy(true)
    try {
      onBalance(await deps.claimFree())
      setView((v) => v && { ...v, freeClaimed: true })
    } catch (e) {
      setRefused(true)
      setError(e instanceof Error ? e.message : 'could not claim')
    } finally {
      setBusy(false)
    }
  }

  async function buy(pack: string) {
    setBusy(true)
    try {
      const { url } = await deps.purchase(pack)
      // a checkout elsewhere (Stripe) returns here when paid; one that lands on this site has already granted them
      // (the development checkout), so the balance just refreshes
      if (new URL(url, window.location.href).origin !== window.location.origin) return window.location.assign(url)
      const fresh = await deps.credits()
      setView(fresh)
      onBalance(fresh.balance)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'purchase failed')
    } finally {
      setBusy(false)
    }
  }

  const short = need !== undefined && balance < need
  const unclaimed = !!view && !view.freeClaimed && !refused
  if (!short && !unclaimed && !error) return null
  return (
    <section className={`panel credits${unclaimed ? ' free' : ''}`} aria-label="Credits">
      <p className="points">
        {balance} credits{short ? ` · this step needs ${need}` : ''}
      </p>
      {unclaimed && (
        <div className="free-offer">
          <p>Your first hero is on us: enough credits for every stage, retries included.</p>
          <button className="btn primary" onClick={claim} disabled={busy}>
            Claim your free hero ({view.freeGrant} credits)
          </button>
        </div>
      )}
      {short && view && (
        <div className="packs">
          {view.packs.map((p) => (
            <button key={p.id} className="btn" disabled={busy} onClick={() => buy(p.id)}>
              Buy {p.credits} credits · {money(p.amountCents, p.currency)}
            </button>
          ))}
        </div>
      )}
      {error && <p className="inline-error">{error}</p>}
    </section>
  )
}
