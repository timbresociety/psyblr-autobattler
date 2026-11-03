import { useEffect, useState } from 'react'
import { GEAR_SLOTS, type GearSlot, type HeroLook } from '../../charter/look.js'
import { PIECE_PRICE } from '../../forge/pricing.js'
import { BUILT_IN, builtIn, fits, wearing, type PieceEntry } from '../../kit/pieces.js'
import type { PieceDeps } from '../api'
import { PieceGenerator } from './PieceGenerator'

const SLOT_LABEL: Record<GearSlot, string> = { hand_r: 'Right hand', hand_l: 'Left hand' }

interface Props {
  look: HeroLook
  onLook: (change: (look: HeroLook) => HeroLook) => void
  /** The repository: community pieces, and generating what it lacks. Without it the strips offer the built-ins alone. */
  pieces?: PieceDeps
  /** An uploaded reference image a new piece can be modelled on. */
  referenceUrl?: string
}

/** The look with a piece in a hand, or the hand emptied. */
export function holdIn(look: HeroLook, slot: GearSlot, piece: PieceEntry | undefined, color?: string): HeroLook {
  const gear = { ...look.gear }
  if (piece) gear[slot] = wearing(piece, color)
  else delete gear[slot]
  const { gear: _gear, ...rest } = look
  return Object.keys(gear).length ? { ...rest, gear } : rest
}

/**
 * What each hand holds: the built-in pieces and the community's that fit it, the piece's colour, and generating a new
 * one for credits. Heroes are drawn bare (2026-11-04), so the hands are all a hero carries; the forge rework after the
 * map and movement work redoes weapons to fit their animations.
 */
export function GearPanel({ look, onLook, pieces, referenceUrl }: Props) {
  const [community, setCommunity] = useState<PieceEntry[]>([])
  const [making, setMaking] = useState<GearSlot | null>(null)

  useEffect(() => {
    if (!pieces) return
    let live = true
    pieces.searchPieces('').then(
      (found) => live && setCommunity(found.filter((p) => p.source === 'community')),
      () => undefined,
    )
    return () => {
      live = false
    }
  }, [pieces])

  const known = (id: string) => builtIn(id) ?? community.find((p) => p.id === id)
  return (
    <section className="look-panel" aria-label="Gear">
      <div className="gear-panel">
        {GEAR_SLOTS.map((slot) => {
          const held = look.gear?.[slot]
          const entry = held ? known(held.id) : undefined
          const offered = [...BUILT_IN, ...community].filter((p) => fits(p.kind, slot))
          return (
            <div key={slot} className="gear-hand">
              <span className="field-label">{SLOT_LABEL[slot]}</span>
              <div className="gear-strip" role="radiogroup" aria-label={SLOT_LABEL[slot]}>
                <button type="button" role="radio" aria-checked={!held} className={`gear-tile none${held ? '' : ' on'}`} title="Nothing" onClick={() => onLook((l) => holdIn(l, slot, undefined))}>
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
                    <path d="M6.5 17.5l11-11" stroke="currentColor" strokeWidth="1.8" />
                  </svg>
                  <span className="sr-only">Nothing</span>
                </button>
                {offered.map((p) => {
                  const on = held?.id === p.id
                  return (
                    <button key={p.id} type="button" role="radio" aria-checked={on} className={`gear-tile${on ? ' on' : ''}${p.source === 'community' ? ' community' : ''}`} title={p.source === 'community' ? `${p.name} (from the community)` : p.name} onClick={() => !on && onLook((l) => holdIn(l, slot, p))}>
                      {p.thumb ? <img src={p.thumb} alt="" loading="lazy" draggable={false} /> : <span className="gear-initial" aria-hidden="true">{p.name[0]}</span>}
                      <span className="sr-only">{p.name}</span>
                    </button>
                  )
                })}
              </div>
              {held && entry?.tint && (
                <label className="swatch inline">
                  <input type="color" aria-label={`${entry.name} colour`} value={held.color ?? entry.tint} onChange={(e) => onLook((l) => holdIn(l, slot, entry, e.target.value))} />
                  <span>Colour</span>
                </label>
              )}
              {pieces && making !== slot && (
                <button type="button" className="btn ghost sm gear-make" onClick={() => setMaking(slot)}>
                  Generate for the {SLOT_LABEL[slot].toLowerCase()} · {PIECE_PRICE} credits
                </button>
              )}
              {pieces && making === slot && (
                <PieceGenerator
                  deps={pieces}
                  start={{ phrase: '', kind: 'hand' }}
                  referenceUrl={referenceUrl}
                  onClose={() => setMaking(null)}
                  onDone={(made) => {
                    setCommunity((have) => (have.some((p) => p.id === made.id) ? have : [...have, made]))
                    // an off-hand piece only ever goes in the left hand
                    onLook((l) => holdIn(l, fits(made.kind, slot) ? slot : 'hand_l', made))
                    setMaking(null)
                  }}
                />
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}
