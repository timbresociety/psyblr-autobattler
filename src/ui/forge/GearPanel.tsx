import { GEAR_SLOTS, type GearPiece, type GearSlot, type HeroLook } from '../../charter/look.js'
import { fits, wearing, type PieceEntry } from '../../kit/pieces.js'

export const SLOT_LABEL: Record<GearSlot, string> = { head: 'Head', face: 'Face', hand_r: 'Right hand', hand_l: 'Left hand', back: 'Back' }

interface Props {
  gear: HeroLook['gear']
  /** Every piece the pickers can offer, built-ins first. */
  catalog: readonly PieceEntry[]
  onWear: (slot: GearSlot, piece: GearPiece | undefined) => void
}

/**
 * The hero's gear, one row per socket: nothing, or any piece of a kind that fits it. Pieces from the repository are
 * free to wear, and a piece with a colour slot takes the colour picked beside its row. Cosmetic like the rest of the
 * look, so the balance check keeps its result.
 */
export function GearPanel({ gear, catalog, onWear }: Props) {
  return (
    <section className="look-panel gear-panel" aria-label="Gear">
      <header className="look-head">
        <h2 className="section-title">Gear</h2>
        <p className="muted">Free from the kit. Cosmetic, like the rest of the look.</p>
      </header>
      <div className="gear-rows">
        {GEAR_SLOTS.map((slot) => {
          const worn = gear?.[slot]
          const entry = worn ? catalog.find((p) => p.id === worn.id) : undefined
          const offered = catalog.filter((p) => fits(p.kind, slot))
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
                    <button key={p.id} type="button" role="radio" aria-checked={on} className={`gear-tile${on ? ' on' : ''}`} title={p.name} onClick={() => onWear(slot, on ? undefined : wearing(p, worn?.color))}>
                      <img src={p.thumb} alt="" loading="lazy" draggable={false} />
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
    </section>
  )
}
