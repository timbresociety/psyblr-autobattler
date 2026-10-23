import { memo, useMemo, useState } from 'react'
import type { Build } from '../../charter/build'
import { DIVERSITY_MIN, describeSynergy } from '../../charter/synergy'
import type { HudHero, HudState } from '../../arena/client/match-view'
import type { Team } from '../../arena/engine/state'
import { SynergyPanel } from './staging/Panels'
import { VolumeControl } from './PauseMenu'
import { ScoreBanner } from './hud/Banner'
import { AbilityCluster, Crosshair, HealthBlock, TargetFrame } from './hud/Control'
import type { HudController } from './hud/controller'
import { TEAM_NAME } from './hud/format'
import { KillFeed } from './hud/KillFeed'
import { infoFromHud, type HudHeroInfo } from './hud/model'
import { HpBar, Portrait } from './hud/parts'
import { AllyRoster, EnemyRoster } from './hud/Rosters'

/** The model when one was passed, else stand-ins built from the snapshot (tests, or before the model exists). */
function useInfo(state: HudState, heroes?: readonly HudHeroInfo[]): readonly HudHeroInfo[] {
  const count = state.heroes.length
  const fallback = useMemo(() => (heroes ? undefined : state.heroes.map(infoFromHud)), [heroes, count]) // eslint-disable-line react-hooks/exhaustive-deps
  return heroes ?? fallback!
}

/**
 * Synergies (R4) folded into one line under the banner; open it for the full panel. Depends only on the roster, not
 * on the 10 Hz match state.
 */
const Synergies = memo(function Synergies({ builds }: { builds: Build[] }) {
  const s = describeSynergy(builds)
  return (
    <details className="hud-syn">
      <summary className="hud-btn">
        <span>Synergies</span>
        <b className={s.teamBonus ? 'lit' : ''}>{s.teamBonus ? `+${Math.round(s.teamBonus * 100)}% damage` : `${s.distinctRoles}/${DIVERSITY_MIN} roles`}</b>
        {s.penalties.length > 0 && <b className="warn">stacked</b>}
      </summary>
      <SynergyPanel builds={builds} />
    </details>
  )
})

/**
 * The HUD while a fight runs (R38): the score banner, the streamer's roster numbered 1-0, the enemy roster, the
 * kill feed, synergies and toggleable stats. Everything here follows the 10 Hz store; the per-frame layer is WorldHud.
 */
export function MatchHud({ state, side, builds, heroes, controller }: { state: HudState; side: Team; builds: Build[]; heroes?: readonly HudHeroInfo[]; controller?: HudController }) {
  const [stats, setStats] = useState(false)
  const info = useInfo(state, heroes)
  const mine = state.heroes.filter((h) => h.team === side)
  const foes = state.heroes.filter((h) => h.team !== side)
  return (
    <>
      <ScoreBanner state={state} heroes={info} side={side} />
      <div className="hud-util">
        <Synergies builds={builds} />
        <button className="hud-btn" aria-pressed={stats} onClick={() => setStats(!stats)}>
          {stats ? 'Hide stats' : 'Stats'}
        </button>
        <VolumeControl compact />
      </div>
      {stats && <StatsPanel heroes={state.heroes} seconds={state.seconds} info={info} />}
      {controller && <KillFeed controller={controller} heroes={info} />}
      <EnemyRoster heroes={foes} info={info} team={(1 - side) as Team} />
      <AllyRoster heroes={mine} info={info} controlled={state.controlled} side={side} />
    </>
  )
}

/** Per-hero numbers (R38), a scoreboard per side: damage per second, damage and health. */
export function StatsPanel({ heroes, seconds, info }: { heroes: HudHero[]; seconds: number; info?: readonly HudHeroInfo[] }) {
  return (
    <section className="arena-panel hud-stats" aria-label="Hero stats">
      {([0, 1] as const).map((team) => (
        <table key={team} className={`team-${team}`}>
          <caption>{TEAM_NAME[team]}</caption>
          <thead>
            <tr>
              <th>Hero</th>
              <th>DPS</th>
              <th>Damage</th>
              <th>Health</th>
            </tr>
          </thead>
          <tbody>
            {heroes
              .filter((h) => h.team === team)
              .map((h) => {
                const me = info?.[h.id]
                return (
                  <tr key={h.id} className={`team-${h.team} ${h.alive ? '' : 'dead'}`}>
                    <td>
                      <span className="hud-stats-hero">
                        <Portrait src={me?.portrait} initials={me?.initials ?? h.name.slice(0, 2)} team={h.team} />
                        {h.name}
                      </span>
                    </td>
                    <td>{seconds > 0 ? Math.round(h.damageDealt / seconds) : 0}</td>
                    <td>{Math.round(h.damageDealt)}</td>
                    <td>
                      <span className="hud-stats-hp">
                        <HpBar hp={h.alive ? h.hp : 0} maxHp={h.maxHp} />
                        {Math.round(h.hp)}
                      </span>
                    </td>
                  </tr>
                )
              })}
          </tbody>
        </table>
      ))}
    </section>
  )
}

/** While controlling: health, abilities, the reticle at screen centre (R14, R42) and the target under it. */
export function ControlHud({ hero, info, controller, state, heroes }: { hero: HudHero; info?: HudHeroInfo; controller?: HudController; state?: HudState; heroes?: readonly HudHeroInfo[] }) {
  const me = useMemo(() => info ?? infoFromHud(hero), [info, hero.id]) // eslint-disable-line react-hooks/exhaustive-deps
  // shields are not in the 10 Hz snapshot; read them from the engine when the snapshot renders
  const shield = controller?.arena.match.heroes[hero.id]?.shield ?? 0
  return (
    <>
      <Crosshair controller={controller} />
      <div className={`control-hud team-${hero.team}`} role="group" aria-label="Controlled hero">
        <HealthBlock hero={hero} info={me} shield={shield} />
        <AbilityCluster hero={hero} info={me} />
      </div>
      {state && heroes && <TargetFrame controller={controller} state={state} heroes={heroes} team={hero.team} />}
    </>
  )
}
