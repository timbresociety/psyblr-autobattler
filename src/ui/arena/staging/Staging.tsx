import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ENGINE } from '../../../arena/engine/calibration'
import { RUINS } from '../../../arena/engine/cover'
import type { Team } from '../../../arena/engine/state'
import { shortName } from '../hud/format'
import { RoleIcon } from '../../common/RoleIcon'
import { ArmyPanel, DetailsPanel } from './Panels'
import { MAX_PER_SIDE, deployHeroes, emptyFormation, inRuins, move, onOwnHalf, place, remove, SPACING, type Formation } from './formation'
import { bust, demoLoadout, liveLoadout, preloadBusts, type LoadoutDeps, type LoadoutEntry } from './loadout'
import { FACTION_NAME, MATCHUPS, defaultLineup, hasFactions, lineupName, matchup, type MatchupId } from './presets'
import './staging.css'

/**
 * Staging (U16, F1): pick a side, set up both halves (a matchup in one click, auto-deploy, or by hand: drag heroes
 * from the row onto the board), then start. The board is a top-down map of the arena and its ruins.
 */

export interface StagingResult {
  side: Team
  formation: Formation
  loadout: LoadoutEntry[]
}

const { halfWidth: W, halfLength: L } = ENGINE.arena
const TEAM = ['Blue', 'Red'] as const
const TOKEN_R = 1.55

type Selected = { kind: 'loadout'; index: number } | { kind: 'placed'; side: Team; index: number }

/** One placed hero on the board: its bust in a team ring, numbered by the key that takes it over (R38). */
function Token({ x, z, side, n, img, initials, selected, ghost, onPointerDown, testId }: { x: number; z: number; side: Team; n: number; img?: string; initials: string; selected?: boolean; ghost?: 'ok' | 'bad'; onPointerDown?: (e: ReactPointerEvent) => void; testId?: string }) {
  return (
    <g transform={`translate(${x} ${-z})`} onPointerDown={onPointerDown} className={`token team-${side}${selected ? ' selected' : ''}${ghost ? ` ghost ${ghost}` : ''}`} data-testid={testId}>
      <circle className="token-shadow" r={TOKEN_R + 0.15} cx={0.25} cy={0.35} />
      {selected && <circle className="token-halo" r={TOKEN_R + 0.55} />}
      <circle className="token-base" r={TOKEN_R} />
      {img ? <image href={img} x={-TOKEN_R} y={-TOKEN_R} width={TOKEN_R * 2} height={TOKEN_R * 2} clipPath="url(#token-clip)" preserveAspectRatio="xMidYMid slice" /> : <text className="token-initials" y={0.5} textAnchor="middle">{initials}</text>}
      <circle className="token-ring" r={TOKEN_R} />
      {n > 0 && (
        <g transform={`translate(${TOKEN_R * 0.78} ${TOKEN_R * 0.78})`} className="token-key">
          <circle r={0.62} />
          <text y={0.27} textAnchor="middle">
            {n % 10}
          </text>
        </g>
      )}
    </g>
  )
}

type Group = 'Your heroes' | 'Forged' | 'Moguls' | 'World leaders'
const groupOf = (entry: LoadoutEntry): Group => (entry.faction ? (FACTION_NAME[entry.faction] as Group) : entry.pkg ? 'Forged' : 'Your heroes')
const GROUP_RANK: Record<Group, number> = { 'Your heroes': 0, Forged: 1, Moguls: 2, 'World leaders': 3 }

const initialsOf = (name: string) =>
  name
    .replace(/["“”].*?["“”]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')

export function Staging({ onStart, deps = liveLoadout, demo = true, initial }: { onStart: (r: StagingResult) => void; deps?: LoadoutDeps; demo?: boolean; initial?: StagingResult }) {
  const [side, setSide] = useState<Team | undefined>(initial?.side)
  const [editing, setEditing] = useState<Team>(initial?.side ?? 0)
  const [formation, setFormation] = useState<Formation>(initial?.formation ?? emptyFormation())
  const [loadout, setLoadout] = useState<LoadoutEntry[]>(initial?.loadout ?? (demo ? demoLoadout() : []))
  const [searching, setSearching] = useState(!initial)
  const [selected, setSelected] = useState<Selected>()
  const [brush, setBrush] = useState<number>()
  const [count, setCount] = useState(10)
  const [notice, setNotice] = useState<string>()
  const [preset, setPreset] = useState<MatchupId>()
  // the hero being dragged across the board, drawn under the pointer
  const [dragAt, setDragAt] = useState<{ x: number; z: number }>()
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
  const ghost = useRef<SVGGElement>(null)
  const drag = useRef<{ side: Team; index: number } | undefined>(undefined)

  // the player's own heroes (made in the Creator or forged) join the demo roster (R2); appended, so a formation
  // already on the board keeps pointing at the same heroes, and shown first in the row
  useEffect(() => {
    if (initial) return
    let live = true
    deps
      .search('')
      .then((found) => live && setLoadout((l) => [...l, ...found.filter((f) => !l.some((x) => x.key === f.key))]))
      .catch(() => undefined)
      .finally(() => live && setSearching(false))
    return () => {
      live = false
    }
  }, [deps, initial])

  // Delete removes the selected placed hero (R37)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.key === 'Delete' || e.key === 'Backspace') && selected?.kind === 'placed' && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        setFormation((f) => remove(f, selected.side, selected.index))
        setSelected(undefined)
      }
      if (e.key === 'Escape') setBrush(undefined)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [selected])

  // the board keeps the arena's proportions; where its box is a different shape, the map is centred inside it
  const frame = () => {
    const r = board.current!.getBoundingClientRect()
    const scale = Math.min(r.width / (2 * W), r.height / (2 * L)) || 1
    return { r, scale, left: r.left + (r.width - 2 * W * scale) / 2, top: r.top + (r.height - 2 * L * scale) / 2 }
  }
  const world = (clientX: number, clientY: number) => {
    const { scale, left, top } = frame()
    return { x: (clientX - left) / scale - W, z: -((clientY - top) / scale - L) }
  }
  const offBoard = (clientX: number, clientY: number) => {
    const { r } = frame()
    return clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom
  }
  const say = (reason: string) =>
    setNotice(reason === 'wrong-half' ? 'That spot is on the other half.' : reason === 'full' ? `A side holds at most ${MAX_PER_SIDE} heroes.` : reason === 'in-ruins' ? 'That spot is inside the ruins.' : 'Too close to another hero.')

  const changed = () => {
    setPreset(undefined)
    setNotice(undefined)
  }
  const drop = (hero: number, clientX: number, clientY: number) => {
    const { x, z } = world(clientX, clientY)
    const r = place(formation, editing, hero, x, z)
    if (r.ok) {
      setFormation(r.formation)
      changed()
    } else say(r.reason)
  }

  const onTokenDown = (e: ReactPointerEvent, s: Team, index: number) => {
    e.stopPropagation()
    try {
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
    } catch {
      // a synthetic pointer has no capture to take; the board still sees the release
    }
    drag.current = { side: s, index }
    setSelected({ kind: 'placed', side: s, index })
  }
  const onBoardMove = (e: ReactPointerEvent) => {
    if (drag.current) return setDragAt(world(e.clientX, e.clientY))
    // with a hero in hand, a ghost follows the pointer and shows whether it can stand there
    const g = ghost.current
    if (!g || brush === undefined) return
    const { x, z } = world(e.clientX, e.clientY)
    const free = onOwnHalf(editing, x, z) && !inRuins(x, z) && !formation[editing].some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < SPACING ** 2) && formation[editing].length < MAX_PER_SIDE
    g.setAttribute('transform', `translate(${x} ${-z})`)
    g.setAttribute('class', `token team-${editing} ghost ${free ? 'ok' : 'bad'}`)
    g.style.display = ''
  }
  const onBoardLeave = () => {
    if (ghost.current) ghost.current.style.display = 'none'
  }
  const onBoardUp = (e: ReactPointerEvent) => {
    const d = drag.current
    drag.current = undefined
    setDragAt(undefined)
    if (!d) return
    // dragging a placed hero off the field sends it back to the row (R37)
    if (offBoard(e.clientX, e.clientY)) {
      setFormation((f) => remove(f, d.side, d.index))
      setSelected(undefined)
      changed()
      return
    }
    const { x, z } = world(e.clientX, e.clientY)
    const r = move(formation, d.side, d.index, x, z)
    if (r.ok) {
      setFormation(r.formation)
      changed()
    } else say(r.reason)
  }

  const details = selected?.kind === 'loadout' ? selected.index : selected?.kind === 'placed' ? formation[selected.side][selected.index]?.hero : undefined
  // the row: the player's own heroes first, then each faction (the loadout's order stays as it is)
  const rowOrder = useMemo(() => loadout.map((_, i) => i).sort((a, b) => GROUP_RANK[groupOf(loadout[a])] - GROUP_RANK[groupOf(loadout[b])]), [loadout])
  const sideBuilds = useMemo(() => formation[editing].map((p) => loadout[p.hero].build), [formation, editing, loadout])
  const ready = formation[0].length > 0 && formation[1].length > 0 && !searching
  const factions = hasFactions(loadout)

  if (side === undefined)
    return (
      <div className="side-pick">
        <h2 className="side-pick-title">Pick your side</h2>
        <p className="side-pick-lead">You set up both halves. Yours is the one you can take over in the fight.</p>
        <div className="side-cards">
          {([0, 1] as const).map((s) => (
            <button key={s} className={`side-card team-${s}`} aria-label={s === 0 ? 'Blue side' : 'Red side'} onClick={() => (setSide(s), setEditing(s))}>
              <span className="side-card-name">{TEAM[s]} side</span>
              <span className="side-card-where">{s === 0 ? 'The near half of the ruins' : 'The far half of the ruins'}</span>
              {factions && <span className="side-card-army">Fields the {FACTION_NAME.mogul.toLowerCase()} by default</span>}
            </button>
          ))}
        </div>
        {factions && (
          <button
            className="btn big primary quick-battle"
            onClick={() => {
              // one click from the menu to a ready fight: the blue side, moguls against the world leaders
              setSide(0)
              setEditing(0)
              setFormation((f) => matchup('factions', loadout, 0, f))
              setPreset('factions')
            }}
          >
            Quick battle · Moguls vs Leaders
          </button>
        )}
      </div>
    )

  const enemy = (1 - side) as Team
  const plate = (s: Team) => {
    const heroes = formation[s].map((p) => p.hero)
    return (
      <button key={s} role="radio" aria-checked={editing === s} className={`team-plate team-${s}${editing === s ? ' on' : ''}${s === side ? ' mine' : ''}`} onClick={() => setEditing(s)}>
        <span className="plate-who">{s === side ? 'Your side' : 'Enemy side'}</span>{' '}
        <span className="plate-army">{lineupName(loadout, heroes)}</span>{' '}
        <span className="plate-count">
          ({heroes.length}/{MAX_PER_SIDE})
        </span>
      </button>
    )
  }

  return (
    <div className="staging">
      <header className="staging-bar">
        <div className="matchup" role="radiogroup" aria-label="Side to set up">
          {plate(side)}
          <span className="vs" aria-hidden="true">
            vs
          </span>
          {plate(enemy)}
        </div>
        <div className="presets" role="group" aria-label="Quick matchups">
          {MATCHUPS.map((m) => (
            <button
              key={m.id}
              className={`preset${preset === m.id ? ' on' : ''}`}
              aria-pressed={preset === m.id}
              disabled={!loadout.length || (m.needsFactions && !factions)}
              onClick={() => {
                setFormation((f) => matchup(m.id, loadout, side, f))
                setPreset(m.id)
                setSelected(undefined)
                setNotice(undefined)
              }}
            >
              {m.label}
            </button>
          ))}
        </div>
        <button className="btn primary big start" disabled={!ready} onClick={() => onStart({ side, formation, loadout })}>
          {searching ? 'Loading heroes…' : 'Start'}
        </button>
      </header>

      <ArmyPanel builds={sideBuilds} title={editing === side ? 'Your army' : 'Enemy army'} />

      <div className="staging-board">
        <div className="board-frame">
          <svg
            ref={board}
            viewBox={`${-W} ${-L} ${2 * W} ${2 * L}`}
            className={`board editing-${editing}${brush !== undefined ? ' has-brush' : ''}`}
            role="application"
            aria-label="Arena board"
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault()
              const hero = Number(e.dataTransfer.getData('text/hero'))
              if (Number.isInteger(hero)) drop(hero, e.clientX, e.clientY)
            }}
            onClick={(e) => brush !== undefined && drop(brush, e.clientX, e.clientY)}
            onPointerMove={onBoardMove}
            onPointerLeave={onBoardLeave}
            onPointerUp={onBoardUp}
          >
            <defs>
              <clipPath id="token-clip">
                <circle r={TOKEN_R} />
              </clipPath>
              <linearGradient id="half-blue" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0" stopColor="#1d3550" />
                <stop offset="1" stopColor="#24304a" />
              </linearGradient>
              <linearGradient id="half-red" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" stopColor="#4a2630" />
                <stop offset="1" stopColor="#3a2a38" />
              </linearGradient>
              <pattern id="board-grid" width="5" height="5" patternUnits="userSpaceOnUse">
                <path d="M5 0H0V5" fill="none" stroke="rgba(255,236,214,0.07)" strokeWidth="0.08" />
              </pattern>
              <pattern id="timber" width="1" height="1" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <rect width="1" height="1" fill="#9b6a37" />
                <rect width="0.45" height="1" fill="#b98049" />
              </pattern>
              <radialGradient id="stone" cx="0.38" cy="0.32" r="0.8">
                <stop offset="0" stopColor="#e8dcc4" />
                <stop offset="1" stopColor="#a99a80" />
              </radialGradient>
            </defs>
            <rect className={`half half-1${editing === 1 ? ' on' : ''}`} x={-W} y={-L} width={2 * W} height={L} fill="url(#half-red)" />
            <rect className={`half half-0${editing === 0 ? ' on' : ''}`} x={-W} y={0} width={2 * W} height={L} fill="url(#half-blue)" />
            <rect x={-W} y={-L} width={2 * W} height={2 * L} fill="url(#board-grid)" pointerEvents="none" />
            <text className="half-label team-1" x={0} y={-L / 2 + 3} textAnchor="middle" aria-hidden="true">
              {side === 1 ? 'Your side' : 'Enemy side'}
            </text>
            <text className="half-label team-0" x={0} y={L / 2 + 3} textAnchor="middle" aria-hidden="true">
              {side === 0 ? 'Your side' : 'Enemy side'}
            </text>
            <line className="midline" x1={-W} x2={W} y1={0} y2={0} />
            {/* the ruins, seen from above: grey stone is cover that never breaks, striped timber is a barricade that does */}
            <g aria-hidden="true" className="ruins">
              {RUINS.filter((p) => p.base <= 0).map((p, i) =>
                p.shape.kind === 'column' ? (
                  <g key={i}>
                    <circle cx={p.shape.x + 0.3} cy={-p.shape.z + 0.4} r={p.shape.r} className="ruin-shadow" />
                    <circle cx={p.shape.x} cy={-p.shape.z} r={p.shape.r} fill="url(#stone)" className="ruin stone" />
                  </g>
                ) : (
                  <g key={i}>
                    <rect x={p.shape.x - p.shape.hx + 0.3} y={-p.shape.z - p.shape.hz + 0.4} width={p.shape.hx * 2} height={p.shape.hz * 2} rx={0.2} className="ruin-shadow" />
                    <rect x={p.shape.x - p.shape.hx} y={-p.shape.z - p.shape.hz} width={p.shape.hx * 2} height={p.shape.hz * 2} rx={0.2} fill={p.health ? 'url(#timber)' : 'url(#stone)'} className={`ruin ${p.health ? 'timber' : 'stone'}`} />
                  </g>
                ),
              )}
            </g>
            {([0, 1] as const).map((s) =>
              formation[s].map((p, i) => {
                const entry = loadout[p.hero]
                const moving = dragAt && drag.current?.side === s && drag.current.index === i
                const at = moving ? dragAt : p
                return (
                  <Token
                    key={`${s}-${i}`}
                    x={at.x}
                    z={at.z}
                    side={s}
                    n={i + 1}
                    img={entry ? bust(entry, p.hero) : undefined}
                    initials={entry ? initialsOf(entry.build.heroName) : '?'}
                    selected={selected?.kind === 'placed' && selected.side === s && selected.index === i}
                    onPointerDown={(e) => onTokenDown(e, s, i)}
                    testId={`token-${s}-${i}`}
                  />
                )
              }),
            )}
            {brush !== undefined && loadout[brush] && (
              <g ref={ghost} className={`token team-${editing} ghost ok`} style={{ display: 'none' }} pointerEvents="none">
                <circle className="token-base" r={TOKEN_R} />
                {bust(loadout[brush], brush) && <image href={bust(loadout[brush], brush)} x={-TOKEN_R} y={-TOKEN_R} width={TOKEN_R * 2} height={TOKEN_R * 2} clipPath="url(#token-clip)" preserveAspectRatio="xMidYMid slice" />}
                <circle className="token-ring" r={TOKEN_R} />
              </g>
            )}
          </svg>
          {formation[0].length + formation[1].length === 0 && (
            <p className="board-empty">Pick a quick matchup above, auto-deploy a side, or choose a hero below and click its spot.</p>
          )}
        </div>
        <div className="board-tools">
          <ul className="legend" aria-label="Map key">
            <li>
              <i className="key-dot team-0" /> Blue
            </li>
            <li>
              <i className="key-dot team-1" /> Red
            </li>
            <li>
              <i className="key-block stone" /> Stone cover
            </li>
            <li>
              <i className="key-block timber" /> Barricade, breaks
            </li>
          </ul>
          {notice ? (
            <p className="inline-error board-notice" role="status">
              {notice}
            </p>
          ) : brush !== undefined && loadout[brush] ? (
            <p className="board-hint">
              {formation[editing].length >= MAX_PER_SIDE
                ? `${editing === side ? 'Your' : 'The enemy'} side is full. Remove a hero to make room.`
                : `Placing ${shortName(loadout[brush].build.heroName)} on ${editing === side ? 'your' : 'the enemy'} half. Click spots to place more; Esc stops.`}
            </p>
          ) : null}
          <div className="deploy">
            <label className="deploy-count">
              <span>Auto-deploy</span>
              <select value={count} onChange={(e) => setCount(Number(e.target.value))} aria-label="Heroes to deploy">
                {Array.from({ length: MAX_PER_SIDE }, (_, i) => i + 1).map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="btn sm"
              onClick={() => {
                setFormation((f) => deployHeroes(f, editing, defaultLineup(loadout, editing, side, count)))
                changed()
              }}
              disabled={!loadout.length}
            >
              Auto-deploy {editing === side ? 'your side' : 'enemy side'}
            </button>
            <button
              className="btn sm ghost"
              onClick={() => {
                setFormation((f) => deployHeroes(f, editing, []))
                setSelected(undefined)
                changed()
              }}
              disabled={!formation[editing].length}
            >
              Clear
            </button>
          </div>
        </div>
      </div>

      <DetailsPanel build={details !== undefined ? loadout[details]?.build : undefined} entry={details !== undefined ? loadout[details] : undefined} portrait={details !== undefined && loadout[details] ? bust(loadout[details], details) : undefined} />

      <div className="bust-row" role="list" aria-label="Loadout">
        {loadout.length === 0 && (
          <p className="muted">
            No heroes yet. <a href="?">Make one in the Creator</a> or{' '}
            <button className="link-btn" onClick={() => setLoadout(demoLoadout())}>
              use the demo roster
            </button>
          </p>
        )}
        {rowOrder.map((i, at) => {
          const entry = loadout[i]
          const img = bust(entry, i)
          const group = groupOf(entry)
          const prevGroup = at > 0 ? groupOf(loadout[rowOrder[at - 1]]) : undefined
          const placed = formation[editing].filter((p) => p.hero === i).length
          return [
            group !== prevGroup && (
              <span key={`group-${group}`} className="bust-group" aria-hidden="true">
                {group}
              </span>
            ),
            <button
              key={entry.key}
              role="listitem"
              draggable
              className={`bust role-${entry.build.roleId}${brush === i ? ' on' : ''}${details === i ? ' viewing' : ''}`}
              onDragStart={(e) => (e.dataTransfer.setData('text/hero', String(i)), setSelected({ kind: 'loadout', index: i }))}
              onClick={() => (setBrush(brush === i ? undefined : i), setSelected({ kind: 'loadout', index: i }))}
              aria-label={`${entry.build.heroName}, ${entry.build.roleId}`}
              title={entry.build.heroName}
            >
              <span className="bust-face">
                {img ? <img src={img} alt="" draggable={false} /> : <span className="initials">{initialsOf(entry.build.heroName)}</span>}
                {placed > 0 && <span className="bust-placed">×{placed}</span>}
              </span>
              <span className="bust-name">{shortName(entry.build.heroName)}</span>
              <span className="bust-symbol" aria-hidden="true">
                <RoleIcon role={entry.build.roleId} />
              </span>
            </button>,
          ]
        })}
      </div>
    </div>
  )
}
