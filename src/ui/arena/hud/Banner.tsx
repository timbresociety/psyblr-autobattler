import { memo } from 'react'
import type { HudHero, HudHouse, HudState } from '../../../arena/client/match-view'
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

/**
 * Under the clock, the house's rules (GAME.md §2): when the edge next moves and where it closes, the vault (shut, open,
 * the squad holding the jackpot, a squad filling its meter), and a warning while the player's hero is outside the edge.
 */
export function HouseStrip({ house, side }: { house: HudHouse; side: Team }) {
  const v = house.vault
  const edge = house.closing ? `Edge closing on ${house.spot}` : house.nextIn === undefined ? `Edge closed on ${house.spot}` : house.phase === 0 ? `Edge closes in ${clock(house.nextIn)}` : `Edge holds · ${clock(house.nextIn)}`
  const vault = !v.open ? `Vault opens in ${clock(v.opensIn)}` : v.holder === undefined ? 'Jackpot up for grabs' : v.holder === side ? 'Your squad holds the jackpot' : `${TEAM_NAME[v.holder]} holds the jackpot`
  return (
    <div className="hud-house">
      <span className={`hud-edge${house.closing ? ' closing' : ''}`}>{edge}</span>
      <span className={`hud-vault${v.holder !== undefined ? ` team-${v.holder}` : ''}`}>
        {vault}
        {v.by !== undefined && v.fill > 0 ? <i className={`hud-vault-fill team-${v.by}`} style={{ transform: `scaleX(${Math.min(1, v.fill)})` }} /> : null}
      </span>
      {house.outside ? <strong className="hud-outside">Outside the edge · −{Math.round(house.dps * 100)}% a second</strong> : null}
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
      {state.house && state.winner === undefined ? <HouseStrip house={state.house} side={side} /> : null}
      <p className="hud-sr" aria-live="polite">
        {TEAM_NAME[0]} {alive[0]} alive, {TEAM_NAME[1]} {alive[1]} alive
      </p>
    </header>
  )
}
