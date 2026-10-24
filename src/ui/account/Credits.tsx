import { useEffect, useState } from 'react'
import type { CreditsView, PieceDeps } from '../api'

const money = (cents: number, currency: string) => new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)

/**
 * Credits for generating, shown only when a piece costs more than the balance: the one free grant if it's unclaimed,
 * then prepaid packs.
 */
export function Credits({ deps, balance, need, onBalance, onCancel }: { deps: Pick<PieceDeps, 'credits' | 'claimFree' | 'purchase'>; balance: number; need: number; onBalance: (n: number) => void; onCancel: () => void }) {
  const [view, setView] = useState<CreditsView>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  // a refused claim (already claimed, or one per network a day) is not offered again
  const [refused, setRefused] = useState(false)

  useEffect(() => {
    let live = true
    deps.credits().then(
      (v) => live && setView(v),
      () => live && setError("couldn't load credits"),
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
      setError(e instanceof Error ? e.message : "couldn't claim")
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
      setError(e instanceof Error ? e.message : 'the purchase failed')
    } finally {
      setBusy(false)
    }
  }

  const unclaimed = !!view && !view.freeClaimed && !refused
  return (
    <section className={`credits${unclaimed ? ' free' : ''}`} aria-label="Credits">
      <p className="points">
        {balance} credits · this piece needs {need}
      </p>
      {unclaimed && (
        <div className="free-offer">
          <p>Your first pieces are on us.</p>
          <button type="button" className="btn primary sm" onClick={claim} disabled={busy}>
            Claim {view.freeGrant} free credits
          </button>
        </div>
      )}
      {view && !unclaimed && (
        <div className="packs">
          {view.packs.map((p) => (
            <button type="button" key={p.id} className="btn sm" disabled={busy} onClick={() => buy(p.id)}>
              Buy {p.credits} credits · {money(p.amountCents, p.currency)}
            </button>
          ))}
        </div>
      )}
      {error && <p className="inline-error">{error}</p>}
      <button type="button" className="btn quiet sm" onClick={onCancel}>
        Back
      </button>
    </section>
  )
}
