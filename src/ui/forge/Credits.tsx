import { useEffect, useState } from 'react'
import type { CreditsView, ForgeDeps } from './forge-api'

const money = (cents: number, currency: string) => new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase() }).format(cents / 100)

/** Balance, the one free hero, and prepaid packs (R3, AE2). */
export function Credits({ deps, balance, need, onBalance }: { deps: ForgeDeps; balance: number; need?: number; onBalance: (n: number) => void }) {
  const [view, setView] = useState<CreditsView>()
  const [error, setError] = useState('')

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
    try {
      onBalance(await deps.claimFree())
      setView((v) => v && { ...v, freeClaimed: true })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'could not claim')
    }
  }

  async function buy(pack: string) {
    try {
      const { url } = await deps.purchase(pack)
      window.location.assign(url)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'purchase failed')
    }
  }

  const short = need !== undefined && balance < need
  return (
    <section className="panel credits" aria-label="Credits">
      <p className="points">
        {balance} credits{short ? ` · this step needs ${need}` : ''}
      </p>
      {view && !view.freeClaimed && (
        <button className="primary" onClick={claim}>
          Claim your free hero ({view.freeGrant} credits)
        </button>
      )}
      {short && view && (
        <div className="packs">
          {view.packs.map((p) => (
            <button key={p.id} onClick={() => buy(p.id)}>
              Buy {p.credits} credits · {money(p.amountCents, p.currency)}
            </button>
          ))}
        </div>
      )}
      {error && <p className="inline-error">{error}</p>}
    </section>
  )
}
