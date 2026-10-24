import { useEffect, useState } from 'react'
import { GEAR_SLOTS, SLOT_KINDS, type GearPiece, type GearSlot, type HeroLook, type PieceKind } from '../../charter/look.js'
import { fits, slotFor, wearing, type PieceEntry } from '../../kit/pieces.js'
import type { GearGap } from '../../kit/resolve.js'
import type { PieceDeps } from '../api'
import { PieceGenerator } from './PieceGenerator'

export const SLOT_LABEL: Record<GearSlot, string> = { head: 'Head', face: 'Face', hand_r: 'Right hand', hand_l: 'Left hand', back: 'Back' }

interface Props {
  gear: HeroLook['gear']
  /** Every piece the rows can offer: the built-ins, then community pieces from the repository. */
  catalog: readonly PieceEntry[]
  onWear: (slot: GearSlot, piece: GearPiece | undefined) => void
  /** The repository: search it and generate what it lacks. Without it the rows offer the built-ins alone. */
  pieces?: PieceDeps
  /** What the prompt asked for that the repository doesn't have. */
  gaps?: GearGap[]
  /** An uploaded reference image a generated piece can be modelled from. */
  referenceUrl?: string
  /** Pieces found in a search or just generated, for the catalog. */
  onFound?: (entries: PieceEntry[]) => void
}

const matches = (p: PieceEntry, q: string) => !q || p.name.toLowerCase().includes(q) || p.tags.some((t) => t.includes(q))

/** A worn community piece the catalog hasn't loaded (a saved hero's): enough to show it, its thumbnail beside its model. */
const stub = (piece: GearPiece, slot: GearSlot): PieceEntry => ({ id: piece.id, name: 'Community piece', kind: SLOT_KINDS[slot][0], tags: [], url: piece.url, thumb: piece.url.replace(/\.glb$/, '.webp'), tint: null, source: 'community' })

/**
 * The hero's gear, one row per socket: nothing, or any piece of a kind that fits it. Everything in the repository is
 * free to wear; search reaches the community's pieces too, and anything missing can be generated. A piece with a
 * colour slot takes the colour picked beside its row. Cosmetic like the rest of the look.
 */
export function GearPanel({ gear, catalog, onWear, pieces, gaps = [], referenceUrl, onFound }: Props) {
  const [query, setQuery] = useState('')
  const [making, setMaking] = useState<{ phrase: string; kind: PieceKind } | null>(null)
  const q = query.trim().toLowerCase()

  // the community's pieces for a search, a moment after typing stops
  useEffect(() => {
    if (!pieces || !q) return
    const timer = setTimeout(() => {
      pieces.searchPieces(q).then((found) => onFound?.(found), () => undefined)
    }, 250)
    return () => clearTimeout(timer)
  }, [q, pieces]) // eslint-disable-line react-hooks/exhaustive-deps

  // a gap whose slot the player has since filled is no longer missing
  const open = gaps.filter((g) => !(g.kind === 'hand' ? gear?.hand_r && gear?.hand_l : gear?.[slotFor(g.kind)]))

  return (
    <section className="look-panel gear-panel" aria-label="Gear">
      <header className="look-head gear-head">
        <h2 className="section-title">Gear</h2>
        <p className="muted">Free from the repository. Cosmetic, like the rest of the look.</p>
        {pieces && <input className="gear-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search gear" aria-label="Search gear" />}
      </header>
      <div className="gear-rows">
        {GEAR_SLOTS.map((slot) => {
          const worn = gear?.[slot]
          const entry = worn ? (catalog.find((p) => p.id === worn.id) ?? stub(worn, slot)) : undefined
          const offered = catalog.filter((p) => fits(p.kind, slot) && (matches(p, q) || p.id === worn?.id))
          if (entry && !offered.some((p) => p.id === entry.id)) offered.unshift(entry)
          return (
            <div key={slot} className="gear-row">
              <span className="field-label">{SLOT_LABEL[slot]}</span>
              <div className="gear-strip" role="radiogroup" aria-label={SLOT_LABEL[slot]}>
                <button type="button" role="radio" aria-checked={!worn} className={`gear-tile none${worn ? '' : ' on'}`} title="Nothing" onClick={() => onWear(slot, undefined)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
                    <path d="M6.5 17.5l11-11" stroke="currentColor" strokeWidth="1.8" />
                  </svg>
                  <span className="sr-only">Nothing</span>
                </button>
                {offered.map((p) => {
                  const on = worn?.id === p.id
                  return (
                    <button key={p.id} type="button" role="radio" aria-checked={on} className={`gear-tile${on ? ' on' : ''}${p.source === 'community' ? ' community' : ''}`} title={p.source === 'community' ? `${p.name} (from the community)` : p.name} onClick={() => onWear(slot, on ? undefined : wearing(p, worn?.color))}>
                      {p.thumb ? <img src={p.thumb} alt="" loading="lazy" draggable={false} /> : <span className="gear-initial" aria-hidden="true">{p.name[0]}</span>}
                      <span className="sr-only">{p.name}</span>
                    </button>
                  )
                })}
              </div>
              {worn && entry?.tint ? (
                <label className="gear-color" title={`${entry.name} colour`}>
                  <input type="color" aria-label={`${entry.name} colour`} value={worn.color ?? entry.tint} onChange={(e) => onWear(slot, { ...worn, color: e.target.value })} />
                </label>
              ) : (
                <span className="gear-color" aria-hidden="true" />
              )}
            </div>
          )
        })}
      </div>
      {pieces && open.length > 0 && !making && (
        <div className="gear-gaps">
          <span className="field-label">Not in the repository yet</span>
          {open.map((g) => (
            <button key={g.phrase} type="button" className="gap-chip" onClick={() => setMaking(g)}>
              {g.phrase}
              <span>Generate</span>
            </button>
          ))}
        </div>
      )}
      {pieces &&
        (making ? (
          <PieceGenerator
            deps={pieces}
            start={making}
            referenceUrl={referenceUrl}
            onClose={() => setMaking(null)}
            onDone={(piece) => {
              onFound?.([piece])
              const slot = piece.kind === 'hand' && gear?.hand_r && !gear?.hand_l ? 'hand_l' : slotFor(piece.kind)
              onWear(slot, wearing(piece))
              setMaking(null)
            }}
          />
        ) : (
          <button type="button" className="btn ghost sm gear-make" onClick={() => setMaking({ phrase: query.trim(), kind: 'head' })}>
            Generate a piece
          </button>
        ))}
    </section>
  )
}
