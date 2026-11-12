import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import type { BuildSlot } from '../../charter/types'
import type { ArenaController } from '../../arena/client/match-view'
import { equip, LAB_HEROES, type BotMode, type LabBot } from '../../arena/engine/lab'
import { E_OPTIONS, F_OPTIONS, LMB_FAMILIES, LMB_FLIGHTS, LMB_MODES, Q_OPTIONS, R_OPTIONS, ROWS, SECTIONS, V_OPTIONS, flies, lmbId, type LabOption, type LabRow, type LmbFamily, type LmbFlight, type LmbMode } from '../../arena/lab/library'
import { ATTITUDES, isAttitude } from '../../kit/anim/attitude'
import { triedHeroes, type TriedHero } from '../../kit/bench/hero-file'
import { PRESETS, type ArchetypeId } from '../../kit/body/physique'
import { Fight } from '../arena/ArenaScreen'
import { roleSymbol } from '../arena/staging/loadout'
import type { StagingResult } from '../arena/staging/Staging'
import { DUMMY } from '../arena/staging/try-it'
import { fighter, johnBuild, johnsOf, PREFS, read, savedPrefs, write, type John, type Prefs } from './john'
import './john-lab.css'

/**
 * `/dev/john` (dev builds only, session 2 plan): John on the House of Instinct's blue deck with a dummy, an enemy bot
 * and an ally bot, a marked wall, a column, a ledge, a jump pad and a zipline a few steps away (engine/lab.ts). The
 * panel picks which John (each size, on a generated mesh where the owner has one, our own body otherwise), his attitude
 * and his buttons, sets the bots, and holds the checklist, marked pass or fail per John and attitude, kept in this
 * browser. Q, E, F and most R picks go on at once; a V or LMB family, a summon or a new body restarts the fight.
 */

const MARKS = 'john-lab:marks'

interface Mark {
  pass: boolean
  note?: string
  at: number
}

function labStaging(prefs: Prefs, john: John): StagingResult {
  const ally = fighter('vanguard', 'support')
  const enemy = fighter('outlaws', 'fighter')
  return {
    side: 0,
    formation: [
      [
        { hero: 0, x: 5.5, y: 4.5, z: -40 },
        { hero: 1, x: 3.8, y: 4.5, z: -38.5 },
      ],
      [
        { hero: 2, x: 0, y: 4.5, z: -36 },
        { hero: 3, x: -5, y: 4.5, z: -20 },
      ],
    ],
    loadout: [
      { key: 'john', build: johnBuild(prefs, john), symbol: roleSymbol('fighter') },
      { key: 'ally', build: ally, symbol: roleSymbol('support') },
      { key: 'dummy', build: DUMMY, symbol: roleSymbol('tank') },
      { key: 'enemy', build: enemy, symbol: roleSymbol('fighter') },
    ],
    lab: { kit: prefs.kit, bots: prefs.bots },
  }
}

export function JohnLab() {
  const [, setParams] = useSearchParams()
  const [heroes, setHeroes] = useState<readonly TriedHero[]>()
  const [prefs, setPrefs] = useState<Prefs>(savedPrefs)
  const [marks, setMarks] = useState<Record<string, Mark>>(() => read(MARKS, {}))
  const [round, setRound] = useState(0)
  const [open, setOpen] = useState(true)
  const [staged, setStaged] = useState<StagingResult>()
  const controller = useRef<ArenaController | undefined>(undefined)
  useEffect(() => void triedHeroes().then(setHeroes), [])
  useEffect(() => write(PREFS, prefs), [prefs])
  useEffect(() => write(MARKS, marks), [marks])

  const johns = useMemo(() => johnsOf(heroes ?? []), [heroes])
  const john = johns.find((j) => j.key === prefs.john) ?? johns.find((j) => j.key === 'body:medium')!

  // the hero views read the mesh and the attitude from the address (arena/client/heroes.ts): keep it in step, then
  // start the fight
  const restart = useCallback(
    (next: Prefs) => {
      const j = johns.find((x) => x.key === next.john) ?? john
      const search = new URLSearchParams()
      if (j.hero) search.set('mesh', j.hero.label)
      if (next.attitude !== 'neutral') search.set('attitude', next.attitude)
      setParams(search, { replace: true })
      setStaged(labStaging(next, j))
      setRound((r) => r + 1)
    },
    [johns, john, setParams],
  )
  // the first fight, once the heroes are known
  useEffect(() => {
    if (heroes && !staged) restart(prefs)
  }, [heroes]) // eslint-disable-line react-hooks/exhaustive-deps

  const change = (next: Partial<Prefs>, mustRestart: boolean) => {
    const merged = { ...prefs, ...next }
    setPrefs(merged)
    if (mustRestart) restart(merged)
  }

  /** Put an option on a button: at once if it can be, or with a restart. */
  const pick = (slot: BuildSlot, id: string) => {
    const kit = { ...prefs.kit, [slot]: id }
    const c = controller.current
    const live = !!c && slot !== 'basic' && slot !== 'active1' && equip(c.arena, slot, id, true)
    change({ kit }, !live)
  }
  const pickLmb = (lmb: Prefs['lmb']) => {
    const id = lmbId(lmb.family, lmb.mode, lmb.flight)
    const c = controller.current
    // a new grip needs its clips: a restart; a new way to fire or fly goes on at once
    const live = !!c && lmb.family === prefs.lmb.family && equip(c.arena, 'active1', id, true)
    change({ lmb, kit: { ...prefs.kit, active1: id } }, !live)
  }
  const setBot = (bot: LabBot, mode: BotMode) => {
    const lab = controller.current?.arena.lab
    if (lab) lab.bots[bot] = mode
    change({ bots: { ...prefs.bots, [bot]: mode } }, false)
  }
  /** A checklist row's setup: its loadout and bots, all at once. */
  const setUp = (row: LabRow) => {
    const kit = { ...prefs.kit, ...row.kit }
    const m = row.kit?.active1 ? /^lmb-(\w+)-(\w+)-(\w+)$/.exec(row.kit.active1) : null
    const lmb = m ? { family: m[1] as LmbFamily, mode: m[2] as LmbMode, flight: m[3] as LmbFlight } : prefs.lmb
    const bots = { ...prefs.bots, ...row.bots }
    const c = controller.current
    const needs = !c || kit.basic !== prefs.kit.basic || lmb.family !== prefs.lmb.family || (Object.entries(row.kit ?? {}) as [BuildSlot, string][]).some(([slot, id]) => !equip(c.arena, slot, id, true))
    if (c?.arena.lab) Object.assign(c.arena.lab.bots, bots)
    change({ kit, lmb, bots }, needs)
  }

  const markKey = (row: LabRow) => `${row.id}|${john.key}|${prefs.attitude}`
  const mark = (row: LabRow, pass: boolean | undefined, note?: string) =>
    setMarks((all) => {
      const next = { ...all }
      if (pass === undefined) delete next[markKey(row)]
      else next[markKey(row)] = { pass, ...(note ? { note } : {}), at: Date.now() }
      return next
    })

  const onController = useCallback((c: ArenaController | undefined) => {
    controller.current = c
    // John is played from the start: click the arena to steer him
    c?.take(LAB_HEROES.john)
  }, [])

  if (!heroes || !staged) return <p className="screen-loading">Loading John's lab…</p>
  return (
    <div className="john-lab">
      <Fight key={round} staged={staged} onBack={() => history.back()} onRestart={() => restart(prefs)} back="Leave the lab" onController={onController} />
      <button className="hud-btn john-lab-toggle" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? 'Hide the lab' : "John's lab"}
      </button>
      {open && (
        <aside className="john-lab-panel" aria-label="John's lab">
          <h2>John</h2>
          <label>
            Which John
            <select value={john.key} onChange={(e) => change({ john: e.target.value }, true)}>
              {johns.map((j) => (
                <option key={j.key} value={j.key}>
                  {j.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Attitude
            <select value={prefs.attitude} onChange={(e) => isAttitude(e.target.value) && change({ attitude: e.target.value }, true)}>
              {ATTITUDES.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </label>
          {!john.hero && (
            <div className="john-lab-row">
              <label>
                Gender
                <select value={prefs.gender} onChange={(e) => change({ gender: e.target.value as 'm' | 'f' }, true)}>
                  <option value="m">Male</option>
                  <option value="f">Female</option>
                </select>
              </label>
              <label>
                Physique
                <select value={prefs.physique ?? ''} onChange={(e) => change({ physique: (e.target.value || undefined) as ArchetypeId | undefined }, true)}>
                  <option value="">As made</option>
                  {PRESETS.filter((p) => p.gender === prefs.gender).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}

          <h2>Buttons</h2>
          <OptionPick label="V" options={V_OPTIONS} value={prefs.kit.basic} onPick={(id) => pick('basic', id)} />
          <div className="john-lab-row">
            <label>
              LMB grip
              <select value={prefs.lmb.family} onChange={(e) => pickLmb({ ...prefs.lmb, family: e.target.value as LmbFamily })}>
                {LMB_FAMILIES.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Fires
              <select value={prefs.lmb.mode} onChange={(e) => pickLmb({ ...prefs.lmb, mode: e.target.value as LmbMode })}>
                {LMB_MODES.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Flies
              <select value={prefs.lmb.flight} disabled={!flies(prefs.lmb.mode)} onChange={(e) => pickLmb({ ...prefs.lmb, flight: e.target.value as LmbFlight })}>
                {LMB_FLIGHTS.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <OptionPick label="Q" options={Q_OPTIONS} value={prefs.kit.active2} onPick={(id) => pick('active2', id)} />
          <OptionPick label="E" options={E_OPTIONS} value={prefs.kit.movement} onPick={(id) => pick('movement', id)} />
          <OptionPick label="F" options={F_OPTIONS} value={prefs.kit.passive} onPick={(id) => pick('passive', id)} />
          <OptionPick label="R" options={R_OPTIONS} value={prefs.kit.ultimate} onPick={(id) => pick('ultimate', id)} />

          <h2>Bots</h2>
          <div className="john-lab-row">
            {(['ally', 'dummy', 'enemy'] as const).map((bot) => (
              <label key={bot}>
                {bot === 'ally' ? 'Ally' : bot === 'dummy' ? 'Dummy' : 'Enemy'}
                <select value={prefs.bots[bot]} onChange={(e) => setBot(bot, e.target.value as BotMode)}>
                  <option value="still">Stand still</option>
                  <option value="block">Guard</option>
                  <option value="beam">Hold a beam</option>
                  <option value="fight">Fight</option>
                </select>
              </label>
            ))}
          </div>
          <p className="muted">
            The marked wall and the column are up the right strip, the jump pad beyond them; the zipline runs down the left strip to the ledge. Lab cooldowns are short. <kbd>F9</kbd> marks a moment for replay.
          </p>

          <h2>Checklist</h2>
          <p className="muted">
            Marks are for {john.label}, {prefs.attitude}. <button className="link" onClick={() => void navigator.clipboard?.writeText(JSON.stringify(marks, null, 1))}>Copy all marks</button>
          </p>
          {SECTIONS.map((section) => (
            <Section key={section} section={section} rows={ROWS.filter((r) => r.section === section)} marks={marks} markKey={markKey} onSetUp={setUp} onMark={mark} />
          ))}
          <p>
            <Link to="/dev">All dev tools</Link>
          </p>
        </aside>
      )}
    </div>
  )
}

function OptionPick({ label, options, value, onPick }: { label: string; options: readonly LabOption[]; value: string; onPick: (id: string) => void }) {
  const groups = [...new Set(options.map((o) => o.group))]
  return (
    <label>
      {label}
      <select value={value} onChange={(e) => onPick(e.target.value)}>
        {groups.map((g) => (
          <optgroup key={g} label={g}>
            {options
              .filter((o) => o.group === g)
              .map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                  {o.restart ? ' (restarts)' : ''}
                </option>
              ))}
          </optgroup>
        ))}
      </select>
    </label>
  )
}

function Section({ section, rows, marks, markKey, onSetUp, onMark }: { section: string; rows: readonly LabRow[]; marks: Record<string, Mark>; markKey: (r: LabRow) => string; onSetUp: (r: LabRow) => void; onMark: (r: LabRow, pass: boolean | undefined, note?: string) => void }) {
  const passed = rows.filter((r) => marks[markKey(r)]?.pass === true).length
  const failed = rows.filter((r) => marks[markKey(r)]?.pass === false).length
  return (
    <details className="john-lab-section">
      <summary>
        {section} <span className="muted">{passed} pass · {failed} fail · {rows.length - passed - failed} to do</span>
      </summary>
      <ol>
        {rows.map((row) => {
          const m = marks[markKey(row)]
          return (
            <li key={row.id} className={m ? (m.pass ? 'pass' : 'fail') : undefined}>
              <span className="john-lab-label">
                {row.label}
                {row.how && <span className="muted"> · {row.how}</span>}
              </span>
              <span className="john-lab-actions">
                {(row.kit || row.bots) && (
                  <button className="hud-btn" onClick={() => onSetUp(row)}>
                    Set up
                  </button>
                )}
                <button className="hud-btn" aria-pressed={m?.pass === true} onClick={() => onMark(row, m?.pass === true ? undefined : true, m?.note)}>
                  Pass
                </button>
                <button className="hud-btn" aria-pressed={m?.pass === false} onClick={() => onMark(row, m?.pass === false ? undefined : false, m?.note)}>
                  Fail
                </button>
              </span>
              {m && <input className="john-lab-note" placeholder="Note" defaultValue={m.note} onBlur={(e) => onMark(row, m.pass, e.target.value || undefined)} />}
            </li>
          )
        })}
      </ol>
    </details>
  )
}
