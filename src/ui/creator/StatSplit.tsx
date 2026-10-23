import type { CSSProperties } from 'react'
import { getRole } from '../../charter/roles'
import { ATTRIBUTES, POOL_SIZE, deriveSheet, spentPoints } from '../../charter/stats'
import type { Build } from '../../charter/build'
import type { Attribute, SecondaryStat } from '../../charter/types'
import { LOCOMOTION_HINT } from '../../charter/locomotion'
import { STAT_LABEL } from './labels'

/** The sheet in three families, so a glance finds survival, weapon or spirit. */
const GROUPS: { title: string; rgb: string; stats: SecondaryStat[] }[] = [
  { title: 'Survival', rgb: '141, 255, 176', stats: ['maxHealth', 'armor', 'magicResist', 'regen'] },
  { title: 'Weapon', rgb: '255, 184, 102', stats: ['weaponDamage', 'attackSpeed', 'fireRate', 'ammo', 'lifesteal'] },
  { title: 'Spirit and speed', rgb: '200, 156, 255', stats: ['spiritPower', 'cooldownReduction', 'moveSpeed'] },
]

/** Units as the Charter defines them (roles.ts). */
const UNIT: Partial<Record<SecondaryStat, string>> = {
  armor: '%',
  magicResist: '%',
  lifesteal: '%',
  cooldownReduction: '%',
  moveSpeed: 'm/s',
  attackSpeed: '/s',
  fireRate: '/s',
  regen: '/s',
}

const ATTR: Record<Attribute, { short: string; name: string }> = {
  strength: { short: 'Str', name: 'Strength' },
  agility: { short: 'Agi', name: 'Agility' },
  intellect: { short: 'Int', name: 'Intellect' },
}

/** The fixed pool as pips: each point coloured by the attribute it went to, free points dark (R12). */
function PointPool({ spread }: { spread: Build['spread'] }) {
  const pips = ATTRIBUTES.flatMap((attr) => Array.from({ length: spread[attr] }, () => attr))
  return (
    <div className="pool">
      <div className="pool-pips" aria-hidden="true">
        {Array.from({ length: POOL_SIZE }, (_, i) => (
          <i key={i} className={pips[i] ? `attr-${pips[i]}` : ''} />
        ))}
      </div>
      <dl className="pool-attrs">
        {ATTRIBUTES.map((attr) => (
          <div key={attr} className={`attr-${attr}`} title={ATTR[attr].name}>
            <dt>{ATTR[attr].short}</dt>
            <dd>{spread[attr]}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

/** The always-visible stat split (R14): drag any detailed stat; the engine solves the points underneath. */
export function StatSplit({ build, onTarget }: { build: Build; onTarget: (stat: SecondaryStat, value: number) => void }) {
  const role = getRole(build.roleId)
  const { sheet } = deriveSheet(role, build.spread, build.sizeClass)
  const left = POOL_SIZE - spentPoints(build.spread)
  return (
    <section className="stat-split" aria-label="Stat split">
      <header className="stat-head">
        <h2 className="section-title">Stats</h2>
        <p className={`points${left > 0 ? ' has-free' : ''}`} aria-live="polite">
          {left} of {POOL_SIZE} points free
        </p>
        <PointPool spread={build.spread} />
      </header>
      <div className="stat-groups">
        {GROUPS.map((group) => (
          <div key={group.title} className="stat-group" style={{ '--bar-rgb': group.rgb } as CSSProperties}>
            <h3>{group.title}</h3>
            <ul className="stats">
              {group.stats.map((stat) => {
                const cap = role.caps[stat]
                const shown = Math.round(sheet[stat] * 10) / 10
                const pct = `${Math.max(0, Math.min(100, (sheet[stat] / cap) * 100)).toFixed(1)}%`
                return (
                  <li key={stat} className="stat">
                    <label htmlFor={`stat-${stat}`} title={stat === 'moveSpeed' ? LOCOMOTION_HINT : undefined}>
                      {STAT_LABEL[stat]}
                    </label>
                    <input
                      id={`stat-${stat}`}
                      className="stat-range"
                      type="range"
                      min={0}
                      max={cap}
                      step={cap / 200}
                      value={sheet[stat]}
                      style={{ '--v': pct } as CSSProperties}
                      aria-valuetext={`${shown} of ${cap}`}
                      onChange={(e) => onTarget(stat, Number(e.target.value))}
                    />
                    <output htmlFor={`stat-${stat}`}>
                      <b>{shown}</b>
                      {UNIT[stat] && <small>{UNIT[stat]}</small>}
                      <span className="cap"> / {cap}</span>
                    </output>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
