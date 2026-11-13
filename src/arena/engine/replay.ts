import { aiCommands } from '../ai/brain.js'
import type { AiLevel } from '../ai/calibration.js'
import type { MatchEvent } from './events.js'
import { labArena, labCommands, labTeams, type LabSetup } from './lab.js'
import { LIVE_PROFILE, PRACTICE_PROFILE, createMatch, matchRules, type Arena, type Combatant } from './match.js'
import type { MapId } from './maps.js'
import type { Vec3 } from './maths.js'
import { hashState } from './snapshot.js'
import type { Command, Team } from './state.js'
import { tick, type TickRules } from './tick.js'

/**
 * Session recording and replay (owner, 2026-11-03): a played match is its setup plus what the player pressed each
 * tick, because everything else — the AI, the dice, the house — follows from the seed. A recording plays back to the
 * same state, tick for tick, in the browser or headless, so a playtester's "this felt wrong" (a mark) becomes an exact
 * repro. A state hash every second checks the replay stays on the recorded match and says where it left it.
 *
 * The one rule that keeps this true: every tick goes through `advance`, live or replayed. It asks the AI for its
 * commands (which move the AI's dice), so calling the AI on a tick that doesn't run — a paused match — would move
 * them and fork the match from its recording.
 */

export const RECORDING_VERSION = 1
/** A state hash every second of match. */
export const CHECK_EVERY = 60

/** What builds the match: enough to make it again from nothing. */
export interface RecordedSetup {
  teams: [Combatant[], Combatant[]]
  seed: number
  formations?: [Vec3[]?, Vec3[]?]
  idle?: readonly number[]
  aiLevels?: [AiLevel, AiLevel]
  side: Team
  map: MapId
  /** John's lab (lab.ts): the house's blue deck set up for the checklist, and John's buttons. */
  lab?: LabSetup
  /**
   * The full kit's rules (GAME.md §4, MatchState.fullKit): on in every match played in the browser, where a person may
   * take a hero. Part of what builds the match, so a recording made before they were on plays back as it was played.
   */
  fullKit?: boolean
}

/**
 * One tick's input where it changed from the tick before: the tick it applies to (the engine's tick after it runs),
 * the hero played (-1 for none) and its command. A tick missing from the list repeats the last one.
 */
export type InputRow = [tick: number, human: number, moveX: number, moveZ: number, moves: number, aimYaw: number, aimPitch: number, buttons: number]

export interface Mark {
  tick: number
  note?: string
}

export interface Recording {
  version: number
  /** When it was made (ms since 1970) and on what build: a replay on another build may part from it. */
  made: number
  build?: string
  setup: RecordedSetup
  inputs: InputRow[]
  /** [tick, state hash] every `CHECK_EVERY` ticks. */
  checks: [number, number][]
  marks: Mark[]
  /** The last tick played. */
  end: number
  /** What the client needs to draw the match again (the staged heroes and their looks); the engine never reads it. */
  view?: unknown
}

/** The match a recorded setup makes; the same call the live arena makes. */
export function arenaFor(setup: RecordedSetup): Arena {
  const teams = setup.lab ? labTeams(setup.teams) : setup.teams
  const arena = createMatch(teams[0], teams[1], setup.seed, {
    profile: setup.idle?.length || setup.lab ? PRACTICE_PROFILE : LIVE_PROFILE,
    formations: setup.formations,
    map: setup.map,
  })
  if (setup.aiLevels) arena.match.aiLevels = setup.aiLevels
  if (setup.fullKit) arena.match.fullKit = true
  if (setup.lab) labArena(arena, setup.lab)
  return arena
}

/**
 * One engine tick with the AI driving every hero but the played one: the live loop, a replay and a headless run all
 * step through here. Nothing runs (and the AI is not asked) while the match is paused or over. After the tick, a
 * played hero that died goes back to the AI (AE1); `released` says so.
 */
export function advance(arena: Arena, rules: TickRules, idle: readonly number[] | undefined, human: Command | undefined): { events: MatchEvent[]; released: boolean } {
  const m = arena.match
  if (m.paused || m.winner !== undefined) return { events: [], released: false }
  const commands = aiCommands(arena)
  for (const i of idle ?? []) commands[i] = undefined
  labCommands(arena, commands)
  if (m.human !== undefined) commands[m.human] = human
  const events = tick(m, arena.setups, commands, rules)
  const released = m.human !== undefined && !m.heroes[m.human].alive
  if (released) m.human = undefined
  return { events, released }
}

const rowOf = (at: number, human: number | undefined, c: Command | undefined): InputRow => {
  const k = c ?? {
    moveX: 0,
    moveZ: 0,
    moves: 0,
    aimYaw: 0,
    aimPitch: 0,
    buttons: 0,
  }
  return [at, human ?? -1, k.moveX, k.moveZ, k.moves, k.aimYaw, k.aimPitch, k.buttons]
}
const sameInput = (a: InputRow, b: InputRow) => a.every((v, i) => i === 0 || v === b[i])

/** Records a live match: call `input` before each `advance` and `after` once it ran. */
export function createRecorder(setup: RecordedSetup, build?: string) {
  const rec: Recording = {
    version: RECORDING_VERSION,
    made: Date.now(),
    build,
    setup: structuredClone(setup),
    inputs: [],
    checks: [],
    marks: [],
    end: 0,
  }
  let last: InputRow | undefined
  return {
    recording: rec,
    /** The input about to be ticked (before `advance`). */
    input(arena: Arena, command: Command | undefined) {
      const m = arena.match
      if (m.paused || m.winner !== undefined) return
      const row = rowOf(m.tick + 1, m.human, m.human === undefined ? undefined : command)
      if (!last || !sameInput(last, row)) rec.inputs.push(row)
      last = row
    },
    /** After a tick ran: the hash every second. */
    after(arena: Arena) {
      const t = arena.match.tick
      if (t === rec.end) return
      rec.end = t
      if (t % CHECK_EVERY === 0) rec.checks.push([t, hashState(arena.match)])
    },
    mark(arena: Arena, note?: string) {
      rec.marks.push(note ? { tick: arena.match.tick, note } : { tick: arena.match.tick })
    },
  }
}
export type Recorder = ReturnType<typeof createRecorder>

/**
 * A recording's inputs, read tick by tick: `next` puts the recorded player on the hero it played (or none) and returns
 * its command for the tick about to run. It may start part way: the input in force is the last one at or before.
 */
export function playback(rec: Recording) {
  let row = 0
  let current: InputRow | undefined
  return {
    next(arena: Arena): Command | undefined {
      const at = arena.match.tick + 1
      while (row < rec.inputs.length && rec.inputs[row][0] <= at) current = rec.inputs[row++]
      // past the recording's end the player is gone: the AI plays every hero on
      const human = current && current[1] >= 0 && at <= rec.end ? current[1] : undefined
      arena.match.human = human
      return current && human !== undefined
        ? {
            moveX: current[2],
            moveZ: current[3],
            moves: current[4],
            aimYaw: current[5],
            aimPitch: current[6],
            buttons: current[7],
          }
        : undefined
    },
  }
}
export type Playback = ReturnType<typeof playback>

/**
 * Plays a recording into a fresh match (or one passed in, already at an earlier tick of it): tick by tick to `until`
 * (the recording's end by default), checking every recorded hash on the way. Returns the match and the first tick
 * where the state stopped matching, if it did.
 */
export function replay(
  rec: Recording,
  until = rec.end,
  options: {
    arena?: Arena
    onTick?: (arena: Arena, events: MatchEvent[]) => void
  } = {},
) {
  const arena = options.arena ?? arenaFor(rec.setup)
  const rules = matchRules(arena)
  const checks = new Map(rec.checks)
  const feed = playback(rec)
  let diverged: { tick: number; expected: number; got: number } | undefined
  while (arena.match.tick < until && arena.match.winner === undefined) {
    const { events } = advance(arena, rules, rec.setup.idle, feed.next(arena))
    options.onTick?.(arena, events)
    const expected = checks.get(arena.match.tick)
    if (expected !== undefined && !diverged) {
      const got = hashState(arena.match)
      if (got !== expected) diverged = { tick: arena.match.tick, expected, got }
    }
  }
  return { arena, diverged }
}
