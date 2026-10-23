import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ENGINE } from '../../../arena/engine/calibration'
import { RUINS } from '../../../arena/engine/cover'
import type { Team } from '../../../arena/engine/state'
import { TEAM_COLORS } from '../../../arena/client/map'
import { DetailsPanel, SynergyPanel } from './Panels'
import { MAX_PER_SIDE, autoDeploy, emptyFormation, move, place, remove, type Formation } from './formation'
import { bust, demoLoadout, liveLoadout, preloadBusts, type LoadoutDeps, type LoadoutEntry } from './loadout'

/**
 * Staging (U16, F1): pick a side, drag heroes from the loadout row onto your half, set up the enemy half the same
 * way or auto-deploy it, then start. The board is a top-down map of the two halves.
 */

export interface StagingResult {
  side: Team
  formation: Formation
  loadout: LoadoutEntry[]
}

const { halfWidth: W, halfLength: L } = ENGINE.arena
const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`

export function Staging({ onStart, deps = liveLoadout, demo = true, initial }: { onStart: (r: StagingResult) => void; deps?: LoadoutDeps; demo?: boolean; initial?: StagingResult }) {
  const [side, setSide] = useState<Team | undefined>(initial?.side)
  const [editing, setEditing] = useState<Team>(initial?.side ?? 0)
  const [formation, setFormation] = useState<Formation>(initial?.formation ?? emptyFormation())
  const [loadout, setLoadout] = useState<LoadoutEntry[]>(initial?.loadout ?? (demo ? demoLoadout() : []))
  const [searching, setSearching] = useState(!initial)
  const [selected, setSelected] = useState<{ kind: 'loadout'; index: number } | { kind: 'placed'; side: Team; index: number }>()
  const [brush, setBrush] = useState<number>()
  const [count, setCount] = useState(10)
  const [notice, setNotice] = useState<string>()
  // the busts are drawn from the arena's own characters; until their files load, a stand-in figure shows
  const [, setCharactersLoaded] = useState(false)
  useEffect(() => {
    let live = true
    void preloadBusts().then((ok) => ok && live && setCharactersLoaded(true))
    return () => {
      live = false
    }
  }, [])
  const board = useRef<SVGSVGElement>(null)
  const drag = useRef<{ side: Team; index: number } | undefined>(undefined)

  // forged heroes from the global loadout join the demo roster (R2)
  useEffect(() => {
    if (initial) return
    let live = true
    deps
      .search('')
      .then((found) => live && setLoadout((l) => [...found.filter((f) => !l.some((x) => x.key === f.key)), ...l]))
      .catch(() => undefined)
      .finally(() => live && setSearching(false))
    return () => {
      live = false
    }
  }, [deps, initial])

  // Delete removes the selected placed hero (R37)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected?.kind === 'placed') {
        setFormation((f) => remove(f, selected.side, selected.index))
        setSelected(undefined)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  const world = (clientX: number, clientY: number) => {
    const r = board.current!.getBoundingClientRect()
    return { x: ((clientX - r.left) / r.width) * 2 * W - W, z: -(((clientY - r.top) / r.height) * 2 * L - L) }
  }
  const offBoard = (clientX: number, clientY: number) => {
    const r = board.current!.getBoundingClientRect()
    return clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom
  }
  const say = (reason: string) =>
    setNotice(reason === 'wrong-half' ? 'That spot is on the other half.' : reason === 'full' ? `A side holds at most ${MAX_PER_SIDE} heroes.` : reason === 'in-ruins' ? 'That spot is inside the ruins.' : 'Too close to another hero.')

  const drop = (hero: number, clientX: number, clientY: number) => {
    const { x, z } = world(clientX, clientY)
    const r = place(formation, editing, hero, x, z)
    if (r.ok) {
      setFormation(r.formation)
      setNotice(undefined)
    } else say(r.reason)
  }

  const onTokenDown = (e: ReactPointerEvent, s: Team, index: number) => {
    e.stopPropagation()
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    drag.current = { side: s, index }
    setSelected({ kind: 'placed', side: s, index })
  }
  const onBoardUp = (e: ReactPointerEvent) => {
    const d = drag.current
    drag.current = undefined
    if (!d) return
    // dragging a placed hero off the field sends it back to the row (R37)
    if (offBoard(e.clientX, e.clientY)) {
      setFormation((f) => remove(f, d.side, d.index))
      setSelected(undefined)
      return
    }
    const { x, z } = world(e.clientX, e.clientY)
    const r = move(formation, d.side, d.index, x, z)
    if (r.ok) setFormation(r.formation)
    else say(r.reason)
  }

  const details = selected?.kind === 'loadout' ? loadout[selected.index]?.build : selected?.kind === 'placed' ? loadout[formation[selected.side][selected.index]?.hero]?.build : undefined
  const sideBuilds = useMemo(() => formation[editing].map((p) => loadout[p.hero].build), [formation, editing, loadout])
  const ready = formation[0].length > 0 && formation[1].length > 0 && !searching

  if (side === undefined)
    return (
      <div className="arena-overlay staging-pick">
        <h2>Pick your side</h2>
        <div className="row">
          {([0, 1] as const).map((s) => (
            <button key={s} className="primary" style={{ background: hex(TEAM_COLORS[s]) }} onClick={() => (setSide(s), setEditing(s))}>
              {s === 0 ? 'Blue side' : 'Red side'}
            </button>
          ))}
        </div>
      </div>
    )

  return (
    <div className="staging">
      <SynergyPanel builds={sideBuilds} />
      <div className="staging-board">
        <div className="segmented" role="radiogroup" aria-label="Side to set up">
          {([0, 1] as const).map((s) => (
            <button key={s} role="radio" aria-checked={editing === s} className={editing === s ? 'on' : ''} onClick={() => setEditing(s)}>
              {s === side ? 'Your side' : 'Enemy side'} ({formation[s].length}/{MAX_PER_SIDE})
            </button>
          ))}
        </div>
        <svg
          ref={board}
          viewBox={`${-W} ${-L} ${2 * W} ${2 * L}`}
          className="board"
          role="application"
          aria-label="Arena board"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault()
            const hero = Number(e.dataTransfer.getData('text/hero'))
            if (Number.isInteger(hero)) drop(hero, e.clientX, e.clientY)
          }}
          onClick={(e) => brush !== undefined && drop(brush, e.clientX, e.clientY)}
          onPointerUp={onBoardUp}
        >
          <rect x={-W} y={0} width={2 * W} height={L} fill={editing === 0 ? '#2c4258' : '#1e2833'} />
          <rect x={-W} y={-L} width={2 * W} height={L} fill={editing === 1 ? '#5a3a36' : '#33292a'} />
          <line x1={-W} x2={W} y1={0} y2={0} stroke="#f2e6c9" strokeWidth={0.3} />
          {/* the ruins, seen from above: grey stone blocks cover, warm timber marks barricades that can be broken */}
          <g aria-hidden="true">
            {RUINS.filter((p) => p.base <= 0).map((p, i) =>
              p.shape.kind === 'column' ? (
                <circle key={i} cx={p.shape.x} cy={-p.shape.z} r={p.shape.r} fill="#b9ad98" />
              ) : (
                <rect key={i} x={p.shape.x - p.shape.hx} y={-p.shape.z - p.shape.hz} width={p.shape.hx * 2} height={p.shape.hz * 2} rx={0.2} fill={p.health ? '#a8753e' : '#b9ad98'} />
              ),
            )}
          </g>
          {([0, 1] as const).map((s) =>
            formation[s].map((p, i) => (
              <g key={`${s}-${i}`} transform={`translate(${p.x} ${-p.z})`} onPointerDown={(e) => onTokenDown(e, s, i)} className="token" data-testid={`token-${s}-${i}`}>
                <circle r={1.3} fill={hex(TEAM_COLORS[s])} stroke={selected?.kind === 'placed' && selected.side === s && selected.index === i ? '#fff' : 'none'} strokeWidth={0.3} />
                <text y={0.55} textAnchor="middle" fontSize={1.6} fill="#fff">
                  {(i + 1) % 10}
                </text>
              </g>
            )),
          )}
        </svg>
        {notice && <p className="inline-error">{notice}</p>}
        <div className="row">
          <label>
            Auto-deploy{' '}
            <select value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label="Heroes to deploy">
              {Array.from({ length: MAX_PER_SIDE }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
          <button onClick={() => setFormation((f) => autoDeploy(f, editing, loadout.length, count))} disabled={!loadout.length}>
            Auto-deploy {editing === side ? 'your side' : 'enemy side'}
          </button>
          <button className="primary" disabled={!ready} onClick={() => onStart({ side, formation, loadout })}>
            {searching ? 'Loading heroes…' : 'Start'}
          </button>
        </div>
      </div>
      <DetailsPanel build={details} />
      <div className="bust-row" role="list" aria-label="Loadout">
        {loadout.length === 0 && (
          <p className="muted">
            No heroes yet. <a href="?">Make one in the Creator</a> or{' '}
            <button onClick={() => setLoadout(demoLoadout())}>use the demo roster</button>
          </p>
        )}
        {loadout.map((entry, i) => {
          const img = bust(entry, i)
          return (
            <button
              key={entry.key}
              role="listitem"
              draggable
              className={`bust${brush === i ? ' on' : ''}`}
              onDragStart={(e) => (e.dataTransfer.setData('text/hero', String(i)), setSelected({ kind: 'loadout', index: i }))}
              onClick={() => (setBrush(brush === i ? undefined : i), setSelected({ kind: 'loadout', index: i }))}
              aria-label={`${entry.build.heroName}, ${entry.build.roleId}`}
            >
              {img ? <img src={img} alt="" /> : <span className="initials">{entry.build.heroName.replace(/".*?"/g, '').split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join('')}</span>}
              <span className="bust-name">{entry.build.heroName}</span>
              <span className="bust-symbol" aria-hidden="true">
                {entry.symbol}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
