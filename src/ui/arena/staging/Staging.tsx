import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import type { Team } from '../../../arena/engine/state'
import { shortName } from '../hud/format'
import { RoleIcon } from '../../common/RoleIcon'
import { DetailsPanel, TraitPanel } from './Panels'
import { Board2D, initialsOf } from './Board2D'
import { Board3D, canDraw3D, type Board3DHandle } from './Board3D'
import { refine, type Reason } from './board-math'
import type { BoardState } from './board-scene'
import { MAX_PER_SIDE, deployHeroes, emptyFormation, move, place, remove, type Formation } from './formation'
import { bust, demoLoadout, liveLoadout, onCharacters, preloadBusts, type LoadoutDeps, type LoadoutEntry } from './loadout'
import { FACTION_NAME, MATCHUPS, defaultLineup, hasFactions, lineupName, matchup, type MatchupId } from './presets'
import './staging.css'

/**
 * Staging (U16, F1): pick a side, set up both halves (a matchup in one click, auto-deploy, or by hand: drag heroes
 * from the row onto the arena), then start. The board is the arena itself in 3D, seen from above at an angle, with the
 * heroes standing as their arena characters; where the browser cannot draw it, a flat map of the arena stands in.
 */

export interface StagingResult {
  side: Team
  formation: Formation
  loadout: LoadoutEntry[]
}

const TEAM = ['Blue', 'Red'] as const

type Selected = { kind: 'loadout'; index: number } | { kind: 'placed'; side: Team; index: number }

type Group = 'Your heroes' | 'Forged' | 'Moguls' | 'World leaders'
const groupOf = (entry: LoadoutEntry): Group => (entry.faction ? (FACTION_NAME[entry.faction] as Group) : entry.pkg ? 'Forged' : 'Your heroes')
const GROUP_RANK: Record<Group, number> = { 'Your heroes': 0, Forged: 1, Moguls: 2, 'World leaders': 3 }

/** Why a spot was refused, as the notice under the board says it. */
const NOTICE: Record<Reason, string> = {
  'wrong-half': 'That spot is on the other half.',
  full: `A side holds at most ${MAX_PER_SIDE} heroes.`,
  'in-ruins': 'That spot is inside the ruins.',
  crowded: 'Too close to another hero.',
  edge: 'That spot is too close to the wall.',
  'off-arena': 'That spot is off the arena.',
}

/** Pixels a press on a hero in the row must travel before it becomes a drag (less is a click). */
const CARRY_SLOP = 6

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
  // the 3D arena where the browser can draw it; the flat map where it cannot, or once the 3D board fails to start
  const [flat, setFlat] = useState(() => !canDraw3D())
  const board3d = useRef<Board3DHandle>(null)
  // a placed hero is in the hand: the row lights up as somewhere to drop it
  const [dragging, setDragging] = useState(false)
  // a hero being carried from the row to the 3D board, drawn as a chip under the pointer until it is over the arena
  const [carrying, setCarrying] = useState<number>()
  const chip = useRef<HTMLDivElement | null>(null)
  const carryAt = useRef({ x: 0, y: 0, over: false })
  const endCarry = useRef<(() => void) | undefined>(undefined)
  const swallowClickUntil = useRef(0)
  const starting = useRef(false)
  // the busts are drawn from the arena's own characters; until their files load, a stand-in figure shows
  const [, setCharactersLoaded] = useState(0)
  useEffect(() => {
    let live = true
    void preloadBusts().then((ok) => ok && live && setCharactersLoaded((n) => n + 1))
    // bodies the row needs beyond the preload, and photo faces, arrive later: redraw the busts as they do
    const stop = onCharacters(() => live && setCharactersLoaded((n) => n + 1))
    return () => {
      live = false
      stop()
    }
  }, [])

  // the player's own heroes (made in the Forge or added in the Loadout) join the demo roster (R2); appended, so a formation
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

  // a carry in progress ends with the screen
  useEffect(() => () => endCarry.current?.(), [])

  const changed = () => {
    setPreset(undefined)
    setNotice(undefined)
  }
  const say = (reason: Parameters<typeof refine>[0], x: number, z: number) => setNotice(NOTICE[refine(reason, { x, z })])

  // what either board asks for; the formation's rules decide, and a refused spot says why
  const placeHero = (hero: number, x: number, z: number) => {
    const r = place(formation, editing, hero, x, z)
    if (r.ok) {
      setFormation(r.formation)
      changed()
    } else say(r.reason, x, z)
  }
  const moveHero = (s: Team, index: number, x: number, z: number) => {
    const r = move(formation, s, index, x, z)
    if (r.ok) {
      setFormation(r.formation)
      changed()
    } else say(r.reason, x, z)
  }
  // dragging a placed hero off the field sends it back to the row (R37)
  const removeHero = (s: Team, index: number) => {
    setFormation((f) => remove(f, s, index))
    setSelected(undefined)
    changed()
  }
  // selecting a placed hero shows it in the details panel, and sets up its side
  const selectPlaced = (p: { side: Team; index: number } | undefined) => {
    if (!p) return setSelected(undefined)
    setSelected({ kind: 'placed', ...p })
    setEditing(p.side)
  }
  const placeRef = useRef(placeHero)
  placeRef.current = placeHero

  const boardState = useMemo<BoardState>(
    () => ({ formation, loadout, side: side ?? 0, editing, brush, selected: selected?.kind === 'placed' ? { side: selected.side, index: selected.index } : undefined }),
    [formation, loadout, side, editing, brush, selected],
  )

  /** The chip under the pointer while a hero is carried from the row; hidden over the arena, where the hero itself shows. */
  const placeChip = () => {
    const el = chip.current
    if (!el) return
    el.style.transform = `translate3d(${carryAt.current.x}px, ${carryAt.current.y}px, 0)`
    el.classList.toggle('over-board', carryAt.current.over)
  }
  /** Press on a hero in the row: a click picks it (to place with clicks); a drag carries it onto the 3D arena. */
  const onBustDown = (e: ReactPointerEvent<HTMLButtonElement>, hero: number) => {
    if (flat || e.button !== 0 || e.isPrimary === false) return
    endCarry.current?.()
    const id = e.pointerId
    const x0 = e.clientX
    const y0 = e.clientY
    let live = false
    const onMove = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return
      if (!live) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < CARRY_SLOP) return
        live = true
        setCarrying(hero)
        setSelected({ kind: 'loadout', index: hero })
      }
      ev.preventDefault()
      const over = board3d.current?.carry(hero, ev.clientX, ev.clientY) ?? false
      carryAt.current = { x: ev.clientX, y: ev.clientY, over }
      placeChip()
    }
    const finish = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', onCancel)
      window.removeEventListener('keydown', onKey)
      endCarry.current = undefined
      setCarrying(undefined)
    }
    const onUp = (ev: PointerEvent) => {
      if (ev.pointerId !== id) return
      finish()
      if (!live) return
      // the click that may follow a drag is not a pick
      swallowClickUntil.current = performance.now() + 400
      const spot = board3d.current?.drop(ev.clientX, ev.clientY)
      if (spot) placeRef.current(hero, spot.x, spot.z)
    }
    const abandon = () => {
      board3d.current?.cancelCarry()
      finish()
    }
    const onCancel = (ev: PointerEvent) => ev.pointerId === id && abandon()
    const onKey = (ev: KeyboardEvent) => ev.key === 'Escape' && live && abandon()
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', onCancel)
    window.addEventListener('keydown', onKey)
    endCarry.current = abandon
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
  const start = () => {
    if (starting.current) return
    const result = { side, formation, loadout }
    const board = board3d.current
    if (!board) return onStart(result)
    // the board gives its renderer back before the match makes its own
    starting.current = true
    void board
      .release()
      .catch(() => undefined)
      .then(() => onStart(result))
  }
  const carried = carrying !== undefined ? loadout[carrying] : undefined
  const carriedImg = carried && carrying !== undefined ? bust(carried, carrying) : undefined

  return (
    <div className={`staging${flat ? ' flat' : ' arena3d'}${carried ? ' carrying' : ''}`}>
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
        <button className="btn primary big start" disabled={!ready} onClick={start}>
          {searching ? 'Loading heroes…' : 'Start'}
        </button>
      </header>

      <TraitPanel builds={sideBuilds} title={editing === side ? 'Your army' : 'Enemy army'} />

      <div className="staging-board">
        <div className="board-frame">
          {flat ? (
            <Board2D formation={formation} loadout={loadout} side={side} editing={editing} selected={boardState.selected} brush={brush} onPlace={placeHero} onMove={moveHero} onRemove={removeHero} onSelect={selectPlaced} />
          ) : (
            <Board3D ref={board3d} state={boardState} handlers={{ place: placeHero, move: moveHero, remove: removeHero, select: selectPlaced, dragging: setDragging }} onUnavailable={() => setFlat(true)} />
          )}
          {formation[0].length + formation[1].length === 0 && (
            <p className="board-empty">{flat ? 'Pick a quick matchup above, auto-deploy a side, or choose a hero below and click its spot.' : 'Pick a quick matchup above, auto-deploy a side, or drag a hero from the row onto your half.'}</p>
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
            {flat ? (
              <>
                <li>
                  <i className="key-block stone" /> Stone cover
                </li>
                <li>
                  <i className="key-block timber" /> Barricade, breaks
                </li>
              </>
            ) : (
              <>
                <li>
                  <i className="key-block keep-out" /> No standing
                </li>
                <li className="key-controls">Right-drag turns · Scroll zooms</li>
              </>
            )}
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

      <DetailsPanel view3d={!flat} build={details !== undefined ? loadout[details]?.build : undefined} entry={details !== undefined ? loadout[details] : undefined} portrait={details !== undefined && loadout[details] ? bust(loadout[details], details) : undefined} army={sideBuilds} />

      <div className={`bust-row${dragging ? ' drop-off' : ''}`} role="list" aria-label="Loadout">
        {dragging && (
          <span className="drop-off-label" aria-hidden="true">
            Drop here to send the hero back
          </span>
        )}
        {loadout.length === 0 && (
          <p className="muted">
            No heroes yet. <a href="?">Make one in the Forge</a>, <a href="?loadout">add some in the Loadout</a> or{' '}
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
              draggable={flat}
              className={`bust role-${entry.build.roleId}${brush === i ? ' on' : ''}${details === i ? ' viewing' : ''}${carrying === i ? ' lifted' : ''}`}
              onDragStart={flat ? (e) => (e.dataTransfer.setData('text/hero', String(i)), setSelected({ kind: 'loadout', index: i })) : undefined}
              onPointerDown={flat ? undefined : (e) => onBustDown(e, i)}
              onClick={() => {
                if (performance.now() < swallowClickUntil.current) return
                setBrush(brush === i ? undefined : i)
                setSelected({ kind: 'loadout', index: i })
              }}
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

      {carried && (
        <div
          className="carry-chip"
          aria-hidden="true"
          ref={(el) => {
            chip.current = el
            placeChip()
          }}
        >
          <span className="carry-face">{carriedImg ? <img src={carriedImg} alt="" draggable={false} /> : <span className="initials">{initialsOf(carried.build.heroName)}</span>}</span>
          <span className="carry-name">{shortName(carried.build.heroName)}</span>
        </div>
      )}
    </div>
  )
}
