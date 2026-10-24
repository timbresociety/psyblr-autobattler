import { useEffect, useRef, useState } from 'react'
import { PIECE_KINDS, type PieceKind } from '../../charter/look.js'
import { PIECE_PRICE } from '../../forge/pricing.js'
import type { PieceEntry } from '../../kit/pieces.js'
import { Credits } from '../account/Credits'
import { SignIn } from '../account/SignIn'
import { ApiError, type PieceDeps, type PieceJob } from '../api'

export const KIND_LABEL: Record<PieceKind, string> = { head: 'Head', face: 'Face', hand: 'Hand', offhand: 'Off hand', back: 'Back' }

const POLL_MS = 3000

type Step = { at: 'form' } | { at: 'signin' } | { at: 'credits'; balance: number } | { at: 'running'; job: PieceJob } | { at: 'failed'; error: string }

interface Props {
  deps: PieceDeps
  /** What to make, when the prompt already asked for it. */
  start?: { phrase: string; kind: PieceKind }
  /** An uploaded reference image the piece can be modelled from. */
  referenceUrl?: string
  onDone: (piece: PieceEntry) => void
  onClose: () => void
}

/**
 * Generate a piece the repository doesn't have yet. It asks for an account only now, and for credits only when the
 * balance is short; the job then runs on the server while the player keeps editing, and the finished piece is worn
 * and joins the repository, free for everyone after this.
 */
export function PieceGenerator({ deps, start, referenceUrl, onDone, onClose }: Props) {
  const [prompt, setPrompt] = useState(start?.phrase ?? '')
  const [kind, setKind] = useState<PieceKind>(start?.kind ?? 'head')
  const [fromImage, setFromImage] = useState(false)
  const [step, setStep] = useState<Step>({ at: 'form' })
  const [busy, setBusy] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const done = useRef(onDone)
  done.current = onDone

  async function generate() {
    setBusy(true)
    try {
      const session = await deps.session()
      if (!session.signedIn) return setStep({ at: 'signin' })
      const { job } = await deps.startPiece({ prompt: prompt.trim(), kind, ...(fromImage && referenceUrl ? { imageUrl: referenceUrl } : {}) })
      setSeconds(0)
      setStep({ at: 'running', job })
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) return setStep({ at: 'signin' })
      if (e instanceof ApiError && e.status === 402) return setStep({ at: 'credits', balance: (await deps.credits().catch(() => undefined))?.balance ?? 0 })
      setStep({ at: 'failed', error: e instanceof Error ? e.message : "couldn't start that piece" })
    } finally {
      setBusy(false)
    }
  }

  // the job runs on the server; poll it until the piece is in the repository
  const jobId = step.at === 'running' ? step.job.id : undefined
  useEffect(() => {
    if (!jobId) return
    let live = true
    let polling = false
    const tick = setInterval(() => setSeconds((s) => s + 1), 1000)
    const poll = setInterval(async () => {
      if (polling) return
      polling = true
      try {
        const { job } = await deps.pollPiece(jobId)
        if (!live) return
        if (job.status === 'done' && job.piece) {
          live = false
          done.current(job.piece)
        } else if (job.status === 'failed') setStep({ at: 'failed', error: job.error ?? 'the piece failed, and nothing was charged' })
      } catch {
        // a dropped poll is tried again on the next tick
      } finally {
        polling = false
      }
    }, POLL_MS)
    return () => {
      live = false
      clearInterval(tick)
      clearInterval(poll)
    }
  }, [jobId, deps])

  if (step.at === 'signin') return <SignIn deps={deps} onCancel={() => setStep({ at: 'form' })} onSignedIn={() => (setStep({ at: 'form' }), void generate())} />
  if (step.at === 'credits') return <Credits deps={deps} balance={step.balance} need={PIECE_PRICE} onBalance={(n) => (n >= PIECE_PRICE ? (setStep({ at: 'form' }), void generate()) : setStep({ at: 'credits', balance: n }))} onCancel={() => setStep({ at: 'form' })} />
  if (step.at === 'running')
    return (
      <section className="generator running" aria-label="Generating" aria-live="polite">
        <span className="gen-spinner" aria-hidden="true" />
        <div>
          <p className="gen-title">Making {step.job.name}…</p>
          <p className="muted">Usually a minute or two ({seconds} s so far). Keep editing; it goes on your hero when it's ready.</p>
        </div>
      </section>
    )
  return (
    <section className="generator" aria-label="Generate a piece">
      <header className="gen-head">
        <h3 className="field-label">Generate a piece</h3>
        <span className="gen-price">{PIECE_PRICE} credits</span>
      </header>
      <label className="field">
        <span>What is it?</span>
        <input value={prompt} maxLength={300} onChange={(e) => setPrompt(e.target.value)} placeholder="a wide straw hat with a red band" aria-label="What is it?" />
      </label>
      <div className="field">
        <span>Where it goes</span>
        <div className="seg" role="radiogroup" aria-label="Where it goes">
          {PIECE_KINDS.map((k) => (
            <button key={k} type="button" role="radio" aria-checked={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
              {KIND_LABEL[k]}
            </button>
          ))}
        </div>
      </div>
      {referenceUrl && (
        <label className="gen-check">
          <input type="checkbox" checked={fromImage} onChange={(e) => setFromImage(e.target.checked)} />
          <span>Model it from my reference image</span>
        </label>
      )}
      {step.at === 'failed' && (
        <p className="inline-error" role="alert">
          {step.error}
        </p>
      )}
      <div className="row">
        <button type="button" className="btn primary sm" disabled={busy || prompt.trim().length < 3} onClick={generate}>
          Generate · {PIECE_PRICE} credits
        </button>
        <button type="button" className="btn quiet sm" onClick={onClose}>
          Cancel
        </button>
      </div>
      <p className="muted gen-note">You pay once. After that it's in the repository, and anyone can wear it free.</p>
    </section>
  )
}
