import { getRole } from '../../charter/roles'
import { POOL_SIZE, SECONDARY_STATS, deriveSheet, spentPoints } from '../../charter/stats'
import type { Build } from '../../charter/build'
import type { SecondaryStat } from '../../charter/types'
import { STAT_LABEL } from './labels'

/** The always-visible stat split (R14): drag any detailed stat; the engine solves the points underneath. */
export function StatSplit({ build, onTarget }: { build: Build; onTarget: (stat: SecondaryStat, value: number) => void }) {
  const role = getRole(build.roleId)
  const { sheet } = deriveSheet(role, build.spread, build.sizeClass)
  const left = POOL_SIZE - spentPoints(build.spread)
  return (
    <section className="panel stat-split" aria-label="Stat split">
      <header className="panel-head">
        <h2>Stats</h2>
        <p className="points" aria-live="polite">
          {left} of {POOL_SIZE} points free · Str {build.spread.strength} · Agi {build.spread.agility} · Int {build.spread.intellect}
        </p>
      </header>
      <ul className="stats">
        {SECONDARY_STATS.map((stat) => {
          const cap = role.caps[stat]
          const shown = Math.round(sheet[stat] * 10) / 10
          return (
            <li key={stat} className="stat">
              <label htmlFor={`stat-${stat}`}>{STAT_LABEL[stat]}</label>
              <input
                id={`stat-${stat}`}
                type="range"
                min={0}
                max={cap}
                step={cap / 200}
                value={sheet[stat]}
                aria-valuetext={`${shown} of ${cap}`}
                onChange={(e) => onTarget(stat, Number(e.target.value))}
              />
              <output htmlFor={`stat-${stat}`}>
                {shown}
                <span className="cap"> / {cap}</span>
              </output>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
