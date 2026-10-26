import { useEffect, useState } from 'react'
import { TRAITS, TRAIT_TIERS } from '../../charter/traits'

/** One line each, read in the second it takes a hero to load. Every one is true of the game as built. */
export const LOADING_TIPS = [
  'Keys 1 to 0 take over your heroes. Tab hands one back to the AI.',
  'P pauses the fight. Esc frees the mouse.',
  `Every role is a synergy: ${TRAIT_TIERS.join(', ')} heroes of one role light its tiers.`,
  `${TRAITS.tank.name}: ${TRAIT_TIERS[1]} tanks harden the whole side, not only themselves.`,
  `${TRAITS.assassin.name}: ${TRAIT_TIERS[1]} assassins start the fight unseen.`,
  'Timber barricades break under fire. The stone of the ruins never does.',
  'A glowing ring around R means that hero’s ultimate is ready.',
  'Fly the free camera with W A S D, Space to rise and Z to sink.',
  'If the hero you steer falls, the camera goes back to watching.',
] as const

/** The loading overlay (R40): progress while heroes load, so a stream never shows pop-in or a blank arena. */
export function Loading({ done, total, label = 'Loading heroes' }: { done: number; total: number; label?: string }) {
  const pct = total ? Math.round((done / total) * 100) : 0
  const [tip, setTip] = useState(0)
  useEffect(() => {
    const t = window.setInterval(() => setTip((i) => (i + 1) % LOADING_TIPS.length), 4000)
    return () => window.clearInterval(t)
  }, [])
  return (
    <div className="arena-overlay hud-screen hud-loading">
      <p className="hud-kicker" aria-hidden="true">
        Entering the arena
      </p>
      <p className="hud-loading-title" aria-hidden="true">
        Roman ruins
      </p>
      <div className="arena-progress" aria-hidden="true">
        <div style={{ width: `${pct}%` }} />
      </div>
      <p className="hud-loading-label" role="status" aria-live="polite">
        {label}… {done} of {total}
      </p>
      <p key={tip} className="hud-tip">
        <b>Tip</b>
        {LOADING_TIPS[tip]}
      </p>
    </div>
  )
}

export function Unsupported() {
  return (
    <div className="arena-overlay" role="alert">
      <p>This browser can’t run the arena: it needs WebGPU or WebGL2. Try a current Chrome, Safari or Firefox.</p>
    </div>
  )
}
