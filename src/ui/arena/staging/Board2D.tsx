import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { ENGINE } from '../../../arena/engine/calibration'
import { RUINS } from '../../../arena/engine/cover'
import type { Team } from '../../../arena/engine/state'
import { MAX_PER_SIDE, SPACING, inRuins, onOwnHalf, type Formation } from './formation'
import { bust, type LoadoutEntry } from './loadout'

/**
 * The flat board (U16): a top-down map of the arena and its ruins, kept for browsers that cannot draw the 3D board
 * (no WebGPU or WebGL2, and the tests). Heroes come from the row by drag or by click, move by drag, and leave by
 * being dragged off the board.
 */

const { halfWidth: W, halfLength: L } = ENGINE.arena
const TOKEN_R = 1.55

export const initialsOf = (name: string) =>
  name
    .replace(/["“”].*?["“”]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')

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

export interface BoardProps {
  formation: Formation
  loadout: readonly LoadoutEntry[]
  /** The player's side. */
  side: Team
  /** The side being set up: heroes from the row go to its half. */
  editing: Team
  selected?: { side: Team; index: number }
  /** A hero picked in the row, placed with a click on the board. */
  brush?: number
  /** Put `hero` on the side being set up at (x, z); the staging screen applies the rules and says why a spot is refused. */
  onPlace: (hero: number, x: number, z: number) => void
  onMove: (side: Team, index: number, x: number, z: number) => void
  onRemove: (side: Team, index: number) => void
  onSelect: (placed: { side: Team; index: number } | undefined) => void
}

export function Board2D({ formation, loadout, side, editing, selected, brush, onPlace, onMove, onRemove, onSelect }: BoardProps) {
  // the hero being dragged across the board, drawn under the pointer
  const [dragAt, setDragAt] = useState<{ x: number; z: number }>()
  const board = useRef<SVGSVGElement>(null)
  const ghost = useRef<SVGGElement>(null)
  const drag = useRef<{ side: Team; index: number } | undefined>(undefined)

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
  const drop = (hero: number, clientX: number, clientY: number) => {
    const { x, z } = world(clientX, clientY)
    onPlace(hero, x, z)
  }

  const onTokenDown = (e: ReactPointerEvent, s: Team, index: number) => {
    e.stopPropagation()
    try {
      ;(e.target as Element).setPointerCapture?.(e.pointerId)
    } catch {
      // a synthetic pointer has no capture to take; the board still sees the release
    }
    drag.current = { side: s, index }
    onSelect({ side: s, index })
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
    if (offBoard(e.clientX, e.clientY)) return onRemove(d.side, d.index)
    const { x, z } = world(e.clientX, e.clientY)
    onMove(d.side, d.index, x, z)
  }

  return (
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
              selected={selected?.side === s && selected.index === i}
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
  )
}
