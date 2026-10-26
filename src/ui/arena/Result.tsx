import type { HudHero, HudState } from '../../arena/client/match-view'
import { getRole } from '../../charter/roles'
import { TEAM_NAME, initials, shortName } from './hud/format'
import type { HudHeroInfo } from './hud/model'
import { Portrait } from './hud/parts'

/** Why the match ended, in words a viewer gets at a glance (R13). */
export function resultReason(state: HudState): string {
  if (state.reason === 'wipe') return 'Last side standing'
  const alive = ([0, 1] as const).map((t) => state.heroes.filter((h) => h.team === t && h.alive).length)
  if (alive[0] !== alive[1]) return `Time out · ${Math.max(...alive)} heroes alive to ${Math.min(...alive)}`
  if (state.winner === 'draw' || state.winner === undefined) return 'Time out · dead even'
  const pct = (t: number) => `${Math.round(state.healthShare[t] * 100)}%`
  return `Time out · same heroes alive, more health left (${pct(state.winner)} to ${pct(1 - state.winner)})`
}

const dps = (h: HudHero, seconds: number) => (seconds > 0 ? Math.round(h.damageDealt / seconds) : 0)

/** The match's top damage dealer, on a card of its own. */
function MvpCard({ hero, info, seconds }: { hero: HudHero; info?: HudHeroInfo; seconds: number }) {
  return (
    <div className={`hud-mvp team-${hero.team}`}>
      <span className="hud-mvp-tag" aria-hidden="true">
        MVP
      </span>
      <Portrait src={info?.portrait} initials={info?.initials ?? initials(hero.name)} team={hero.team} className="huge" />
      <p className="hud-mvp-name">
        <span className="hud-sr">Most valuable: </span>
        {info?.short ?? shortName(hero.name)}
      </p>
      <p className="hud-mvp-full">{hero.name}</p>
      <p className="hud-mvp-role">
        {info ? `${getRole(info.role).name} · ` : ''}
        {TEAM_NAME[hero.team]}
      </p>
      <dl className="hud-mvp-stats">
        <div>
          <dt>Damage</dt>
          <dd>{Math.round(hero.damageDealt).toLocaleString('en-US')}</dd>
        </div>
        <div>
          <dt>DPS</dt>
          <dd>{dps(hero, seconds)}</dd>
        </div>
      </dl>
    </div>
  )
}

/** The end of a match (U18): winner, reason, the MVP, per-hero numbers, and a rematch from the same staging. */
export function Result({ state, side, heroes, onRematch, onBack }: { state: HudState; side: 0 | 1; heroes?: readonly HudHeroInfo[]; onRematch: () => void; onBack: () => void }) {
  const outcome = state.winner === 'draw' ? 'draw' : state.winner === side ? 'win' : 'loss'
  const title = outcome === 'draw' ? 'Draw' : outcome === 'win' ? 'Your side wins' : 'Enemy side wins'
  const ranked = [...state.heroes].sort((a, b) => b.damageDealt - a.damageDealt)
  const mvp = ranked[0]
  return (
    <div className={`arena-overlay result hud-screen is-${outcome}`} role="dialog" aria-label="Match result">
      <div className="result-banner" aria-hidden="true">
        <span>{outcome === 'draw' ? 'Draw' : outcome === 'win' ? 'Victory' : 'Defeat'}</span>
      </div>
      <h2>{title}</h2>
      <p className="hud-reason">{resultReason(state)}</p>
      <div className="result-body">
        {mvp && <MvpCard hero={mvp} info={heroes?.[mvp.id]} seconds={state.seconds} />}
        <div className="result-table">
          <table>
            <thead>
              <tr>
                <th>Hero</th>
                <th>Damage</th>
                <th>DPS</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map((h) => (
                <tr key={h.id} className={`team-${h.team} ${h.alive ? '' : 'dead'}`}>
                  <td>
                    <span className="hud-stats-hero">
                      <Portrait src={heroes?.[h.id]?.portrait} initials={heroes?.[h.id]?.initials ?? initials(h.name)} team={h.team} />
                      {h.name}
                    </span>
                  </td>
                  <td>{Math.round(h.damageDealt)}</td>
                  <td>{dps(h, state.seconds)}</td>
                  <td>{h.alive ? `${Math.round((h.hp / h.maxHp) * 100)}% health` : 'Down'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="hud-actions">
        <button className="hud-btn primary big" onClick={onRematch}>
          Rematch
        </button>
        <button className="hud-btn big" onClick={onBack}>
          Back to staging
        </button>
      </div>
    </div>
  )
}
