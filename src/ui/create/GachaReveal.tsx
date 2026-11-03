import { useEffect, useState } from 'react'
import type { Build } from '../../charter/build'
import { ROLES } from '../../charter/roles'
import './create.css'

type Beat = 'drop' | 'pop' | 'card'

/** How long each beat of the reveal lasts, ms: the capsule drops and rattles, then splits open. */
export const REVEAL_BEATS: Record<Exclude<Beat, 'card'>, number> = { drop: 1300, pop: 700 }

/**
 * The gacha reveal (GAME.md §1, §2: "create a character → gacha reveal → Forge the kit"): a new hero's capsule drops
 * out of the machine, rattles, splits open, and the hero's card comes out. A click skips ahead; with reduced motion
 * asked for, the card is there at once.
 */
export function GachaReveal({ build, onDone }: { build: Build; onDone: () => void }) {
  const still = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  const [beat, setBeat] = useState<Beat>(still ? 'card' : 'drop')
  useEffect(() => {
    if (beat === 'card') return
    const t = window.setTimeout(() => setBeat(beat === 'drop' ? 'pop' : 'card'), REVEAL_BEATS[beat])
    return () => window.clearTimeout(t)
  }, [beat])
  const role = ROLES.find((r) => r.id === build.roleId)
  return (
    <div className={`gacha is-${beat}`} role="dialog" aria-modal="true" aria-label={`${build.heroName} is ready`} onClick={() => beat !== 'card' && setBeat('card')}>
      <div className="gacha-stage" aria-hidden={beat !== 'card'}>
        <div className="gacha-capsule">
          <span className="gacha-half gacha-top" />
          <span className="gacha-half gacha-bottom" />
        </div>
        <div className="gacha-burst" />
        {beat === 'card' && (
          <div className="gacha-card">
            <p className="gacha-kicker">New hero</p>
            <h2>{build.heroName}</h2>
            <p className="gacha-role">
              {role?.name ?? build.roleId}
              {build.sizeClass ? ` · ${build.sizeClass}` : ''}
            </p>
            {role && <p className="gacha-line">{role.description}</p>}
            <button className="btn primary big" autoFocus onClick={onDone}>
              Forge the kit
            </button>
          </div>
        )}
      </div>
      {beat !== 'card' && <p className="gacha-skip">Click to skip</p>}
    </div>
  )
}
