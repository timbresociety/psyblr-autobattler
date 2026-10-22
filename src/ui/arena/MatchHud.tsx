import { memo, useState } from 'react'
import type { Build } from '../../charter/build'
import type { HudHero, HudState } from '../../arena/client/match-view'
import { SynergyPanel } from './staging/Panels'

// synergies depend only on the roster, not on the 10 Hz match state
const Synergies = memo(SynergyPanel)

const cd = (left: number) => (left > 0.05 ? Math.ceil(left).toString() : '')
const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`

/** The HUD while a fight runs (R38): timer, the streamer's roster numbered 1-0, synergies, and toggleable stats. */
export function MatchHud({ state, side, builds }: { state: HudState; side: 0 | 1; builds: Build[] }) {
  const [stats, setStats] = useState(false)
  const mine = state.heroes.filter((h) => h.team === side)
  const alive = (team: 0 | 1) => state.heroes.filter((h) => h.team === team && h.alive).length
  return (
    <>
      <div className="arena-top" aria-live="polite">
        <span className="team-a">{alive(0)} alive</span>
        <span className="timer">{clock(Math.max(0, state.timerSeconds - state.seconds))}</span>
        <span className="team-b">{alive(1)} alive</span>
      </div>
      <div className="hud-left">
        <Synergies builds={builds} />
      </div>
      <button className="hud-stats-toggle" aria-pressed={stats} onClick={() => setStats(!stats)}>
        {stats ? 'Hide stats' : 'Stats'}
      </button>
      {stats && <StatsPanel heroes={state.heroes} seconds={state.seconds} />}
      <ol className="roster" aria-label="Your heroes">
        {mine.map((h, i) => (
          <li key={h.id} className={`${h.alive ? '' : 'dead'} ${state.controlled === h.id ? 'controlled' : ''} ${h.fallback ? 'fallback' : ''}`} title={h.fallback ? 'This hero’s model failed to load; it fights as a stand-in.' : undefined}>
            <kbd>{(i + 1) % 10}</kbd>
            <span className="name">{h.name}</span>
            <span className="hp" style={{ width: `${(h.hp / h.maxHp) * 100}%` }} />
            <span className="cds">
              {(['active1', 'active2', 'ultimate'] as const).map((s) => (
                <span key={s} className={`cd ${h.cooldowns[s].left > 0.05 ? 'wait' : 'ready'} ${s}`} aria-label={`${s} ${h.cooldowns[s].left > 0.05 ? `in ${cd(h.cooldowns[s].left)} s` : 'ready'}`}>
                  {s === 'ultimate' ? 'R' : s === 'active1' ? 'Q' : 'E'}
                  {cd(h.cooldowns[s].left) && <small>{cd(h.cooldowns[s].left)}</small>}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ol>
    </>
  )
}

/** Per-hero numbers (R38): damage per second and health, for both sides. */
export function StatsPanel({ heroes, seconds }: { heroes: HudHero[]; seconds: number }) {
  return (
    <section className="arena-panel hud-stats" aria-label="Hero stats">
      <table>
        <thead>
          <tr>
            <th>Hero</th>
            <th>DPS</th>
            <th>Health</th>
          </tr>
        </thead>
        <tbody>
          {heroes.map((h) => (
            <tr key={h.id} className={`team-${h.team} ${h.alive ? '' : 'dead'}`}>
              <td>{h.name}</td>
              <td>{seconds > 0 ? Math.round(h.damageDealt / seconds) : 0}</td>
              <td>{Math.round(h.hp)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}

/** While controlling: health, cooldowns and the reticle at screen centre (R14, R42). */
export function ControlHud({ hero }: { hero: HudHero }) {
  return (
    <>
      <div className="reticle" aria-hidden="true" />
      <div className="control-hud" aria-label="Controlled hero">
        <strong>{hero.name}</strong>
        <span className="hp big" style={{ width: `${(hero.hp / hero.maxHp) * 100}%` }} />
        <span className="cds">
          {(['basic', 'active1', 'active2', 'ultimate', 'movement'] as const).map((s) => (
            <span key={s} className={`cd ${hero.cooldowns[s].left > 0.05 ? 'wait' : 'ready'}`}>
              {{ basic: 'Click', active1: 'Q', active2: 'E', ultimate: 'R', movement: 'Shift' }[s]}
              {cd(hero.cooldowns[s].left) && <small>{cd(hero.cooldowns[s].left)}</small>}
            </span>
          ))}
        </span>
        <span className="muted">Tab hands back · Esc frees the mouse</span>
      </div>
    </>
  )
}
