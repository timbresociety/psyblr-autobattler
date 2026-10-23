import { memo } from 'react'
import type { HudHero, HudState } from '../../../arena/client/match-view'
import type { Team } from '../../../arena/engine/state'
import { TEAM_NAME, clock } from './format'
import type { HudHeroInfo } from './model'
import { Portrait } from './parts'

/** Health shown on a pip moves in 2% steps, so a pip re-renders only when its sliver visibly changes. */
const sliver = (h: HudHero) => (h.alive ? Math.round((h.hp / Math.max(1, h.maxHp)) * 50) / 50 : 0)

const Pip = memo(function Pip({ info, alive, hp }: { info: HudHeroInfo; alive: boolean; hp: number }) {
  return (
    <li className={`hud-pip team-${info.team}${alive ? '' : ' dead'}${alive && hp < 0.3 ? ' low' : ''}`}>
      <Portrait src={info.portrait} initials={info.initials} team={info.team} />
      <i className="hud-pip-hp" style={{ transform: `scaleX(${hp})` }} />
    </li>
  )
})

function TeamPlate({ team, heroes, info, mine }: { team: Team; heroes: HudHero[]; info: readonly HudHeroInfo[]; mine: boolean }) {
  const alive = heroes.filter((h) => h.alive).length
  return (
    <div className={`hud-plate team-${team}${mine ? ' mine' : ''}`}>
      <div className="hud-plate-count">
        <b>{alive}</b>
        <small>{mine ? 'You' : TEAM_NAME[team]}</small>
      </div>
      <ol className="hud-pips" aria-label={`${TEAM_NAME[team]} heroes`}>
        {heroes.map((h) => (
          <Pip key={h.id} info={info[h.id]} alive={h.alive} hp={sliver(h)} />
        ))}
      </ol>
    </div>
  )
}

/** Top centre (R38): the clock, and each side's heroes as portrait pips with a health sliver; the fallen crossed out. */
export function ScoreBanner({ state, heroes, side }: { state: HudState; heroes: readonly HudHeroInfo[]; side: Team }) {
  const left = Math.max(0, state.timerSeconds - state.seconds)
  // in overtime every hit lands harder, so a stalled fight ends in a fight; the banner says by how much
  const overtime = state.winner === undefined && (state.overtime ?? 0) > 0 ? state.overtime! : 0
  const byTeam = ([0, 1] as const).map((t) => state.heroes.filter((h) => h.team === t))
  const alive = byTeam.map((list) => list.filter((h) => h.alive).length)
  return (
    <header className="hud-banner">
      <TeamPlate team={0} heroes={byTeam[0]} info={heroes} mine={side === 0} />
      <div className={`hud-timer${left <= 30 && state.winner === undefined ? ' hurry' : ''}${overtime ? ' overtime' : ''}`} role="timer">
        <small>{overtime ? 'Overtime' : 'Time'}</small>
        <b>{clock(left)}</b>
        {overtime ? <em className="hud-overtime">+{Math.round(overtime * 100)}% damage</em> : null}
      </div>
      <TeamPlate team={1} heroes={byTeam[1]} info={heroes} mine={side === 1} />
      <p className="hud-sr" aria-live="polite">
        {TEAM_NAME[0]} {alive[0]} alive, {TEAM_NAME[1]} {alive[1]} alive
      </p>
    </header>
  )
}
