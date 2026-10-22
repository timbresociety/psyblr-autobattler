import type { HudState } from '../../arena/client/match-view'

/** Why the match ended, in words a viewer gets at a glance (R13). */
export function resultReason(state: HudState): string {
  if (state.reason === 'wipe') return 'Last side standing'
  const alive = ([0, 1] as const).map((t) => state.heroes.filter((h) => h.team === t && h.alive).length)
  if (alive[0] !== alive[1]) return `Time out · ${Math.max(...alive)} heroes alive to ${Math.min(...alive)}`
  if (state.winner === 'draw' || state.winner === undefined) return 'Time out · dead even'
  const pct = (t: number) => `${Math.round(state.healthShare[t] * 100)}%`
  return `Time out · same heroes alive, more health left (${pct(state.winner)} to ${pct(1 - state.winner)})`
}

/** The end of a match (U18): winner, reason, per-hero numbers, and a rematch from the same staging. */
export function Result({ state, side, onRematch, onBack }: { state: HudState; side: 0 | 1; onRematch: () => void; onBack: () => void }) {
  const title = state.winner === 'draw' ? 'Draw' : state.winner === side ? 'Your side wins' : 'Enemy side wins'
  const heroes = [...state.heroes].sort((a, b) => b.damageDealt - a.damageDealt)
  return (
    <div className="arena-overlay result" role="dialog" aria-label="Match result">
      <h2>{title}</h2>
      <p className="muted">{resultReason(state)}</p>
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
          {heroes.map((h) => (
            <tr key={h.id} className={`team-${h.team} ${h.alive ? '' : 'dead'}`}>
              <td>{h.name}</td>
              <td>{Math.round(h.damageDealt)}</td>
              <td>{state.seconds > 0 ? Math.round(h.damageDealt / state.seconds) : 0}</td>
              <td>{h.alive ? `${Math.round((h.hp / h.maxHp) * 100)}% health` : 'Down'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="row">
        <button className="primary" onClick={onRematch}>
          Rematch
        </button>
        <button onClick={onBack}>Back to staging</button>
      </div>
    </div>
  )
}
