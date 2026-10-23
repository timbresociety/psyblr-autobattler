import { memo, type CSSProperties } from 'react'
import type { Team } from '../../../arena/engine/state'
import { cdLabel, segmentPct, served } from './format'
import { AbilityIcon } from './icons'
import type { HudSkill } from './model'

/** A hero's face: the staged 3D bust, or initials until it exists. */
export const Portrait = memo(function Portrait({ src, initials, team, className = '' }: { src?: string; initials: string; team: Team; className?: string }) {
  return (
    <span className={`hud-portrait team-${team} ${className}`} aria-hidden="true">
      {src ? <img src={src} alt="" draggable={false} /> : <span className="hud-initials">{initials}</span>}
    </span>
  )
})

const clamp01 = (x: number) => (Number.isFinite(x) ? Math.max(0, Math.min(1, x)) : 0)

/** Health in the hero's team colour, a tick every 250 health, and a white shield overlay on the end. */
export function HpBar({ hp, maxHp, shield = 0, className = '' }: { hp: number; maxHp: number; shield?: number; className?: string }) {
  const f = clamp01(hp / maxHp)
  const s = clamp01(shield / maxHp)
  return (
    <span className={`hud-hp${f < 0.3 ? ' low' : ''} ${className}`} style={{ '--seg': segmentPct(maxHp) } as CSSProperties} role="meter" aria-label="Health" aria-valuemin={0} aria-valuemax={Math.round(maxHp)} aria-valuenow={Math.ceil(Math.max(0, hp))}>
      <i className="hud-hp-fill" style={{ transform: `scaleX(${f.toFixed(4)})` }} />
      {s > 0 && <i className="hud-hp-sh" style={{ transform: `translateX(${(Math.min(f, 1 - s) * 100).toFixed(2)}%) scaleX(${s.toFixed(4)})` }} />}
    </span>
  )
}

/**
 * One ability: its icon, a cooldown sweep that fills clockwise, the seconds left, and its key. The ultimate gets a
 * ring that lights up gold when it is ready.
 */
export const AbilityChip = memo(function AbilityChip({ skill, left, total, keyLabel, size = 'sm' }: { skill: HudSkill; left: number; total?: number; keyLabel?: string; size?: 'xs' | 'sm' | 'md' | 'lg' }) {
  const wait = left > 0.05
  const ult = skill.slot === 'ultimate'
  const done = served(left, total ?? skill.cooldown)
  const label = `${keyLabel ? `${keyLabel} ` : ''}${skill.name}: ${wait ? `${cdLabel(left)} s` : 'ready'}`
  return (
    <span
      role="img"
      aria-label={label}
      title={skill.name === skill.mechanic ? skill.name : `${skill.name} (${skill.mechanic})`}
      className={`hud-ab size-${size} tone-${skill.tone} ${wait ? 'is-cd' : 'is-ready'}${ult ? ' is-ult' : ''}`}
      style={{ '--done': `${(done * 100).toFixed(1)}%` } as CSSProperties}
    >
      <AbilityIcon icon={skill.icon} />
      {wait && <b className="hud-ab-sec">{cdLabel(left)}</b>}
      {keyLabel && <kbd className="hud-ab-key">{keyLabel}</kbd>}
    </span>
  )
})
