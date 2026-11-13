import { describe, expect, it } from 'vitest'
import { armyModifiers } from '../../charter/traits.js'
import { defaultBuild } from '../../sim/fixtures.js'
import { matchRules } from './match.js'
import { CHECK_EVERY, advance, arenaFor, createRecorder, replay, type RecordedSetup } from './replay.js'
import { hashState } from './snapshot.js'
import { MOVES, slotBit, type Command } from './state.js'

const setup = (): RecordedSetup => ({
  teams: [armyModifiers([defaultBuild('fighter'), defaultBuild('mage')]), armyModifiers([defaultBuild('tank'), defaultBuild('support')])],
  seed: 4242,
  side: 0,
  map: 'house',
})

/** A player who takes hero 0 at 1 s, runs, jumps, rolls and swings, turning as it goes, and hands back at 12 s. */
const scripted = (t: number): Command => ({
  moveX: t % 240 < 120 ? 1 : -0.5,
  moveZ: 0.7,
  moves: (t % 90 === 10 ? MOVES.jump : 0) | (t % 150 === 40 ? MOVES.dodge : 0),
  aimYaw: (t * 7) % 4096,
  aimPitch: 4096,
  buttons: t % 60 < 20 ? slotBit('basic') : 0,
})

/** The live loop's order, with pauses: input, advance, after. */
function playLive(ticks: number, pauseEvery = 0) {
  const s = setup()
  const arena = arenaFor(s)
  const rules = matchRules(arena)
  const rec = createRecorder(s)
  let marked = false
  for (let frame = 0; arena.match.tick < ticks && arena.match.winner === undefined; frame++) {
    const t = arena.match.tick
    if (t === 60) arena.match.human = 0
    if (t === 720) arena.match.human = undefined
    if (t === 300 && !marked) marked = (rec.mark(arena, 'the roll went the wrong way'), true)
    // a paused stretch: frames go by, nothing ticks, and the AI must not be asked
    arena.match.paused = pauseEvery > 0 && frame % pauseEvery < 3
    const command = arena.match.human === undefined ? undefined : scripted(t)
    rec.input(arena, command)
    advance(arena, rules, s.idle, command)
    rec.after(arena)
  }
  arena.match.paused = false
  return { arena, recording: rec.recording }
}

describe('session recording and replay (owner, 2026-11-03)', () => {
  it('a recorded match replays to the same state, every second of the way, pauses and a played hero included', () => {
    const { arena, recording } = playLive(1500, 7)
    expect(recording.checks.length).toBe(Math.floor(1500 / CHECK_EVERY))
    expect(recording.marks).toEqual([{ tick: 300, note: 'the roll went the wrong way' }])
    // a few rows a tick at most, not one a frame: only changes are kept
    expect(recording.inputs.length).toBeLessThan(700)
    const back = replay(JSON.parse(JSON.stringify(recording)))
    expect(back.diverged).toBeUndefined()
    expect(back.arena.match.tick).toBe(arena.match.tick)
    expect(hashState(back.arena.match)).toBe(hashState(arena.match))
  })

  it('a paused match leaves the AI alone: its dice are where they were', () => {
    const arena = arenaFor(setup())
    const rules = matchRules(arena)
    for (let i = 0; i < 30; i++) advance(arena, rules, undefined, undefined)
    arena.match.paused = true
    const before = hashState(arena.match)
    for (let i = 0; i < 100; i++) advance(arena, rules, undefined, undefined)
    expect(hashState(arena.match)).toBe(before)
  })

  it('plays on from part way, and says the first second a changed recording parts from the match', () => {
    const { recording } = playLive(900)
    const half = replay(recording, 450)
    expect(half.arena.match.tick).toBe(450)
    const rest = replay(recording, recording.end, { arena: half.arena })
    expect(rest.diverged).toBeUndefined()
    // change one pressed input at 8 s: the replay parts from the recording at the first check after it
    const bent = structuredClone(recording)
    const row = bent.inputs.find((r) => r[0] > 480 && r[1] >= 0)!
    row[2] = -row[2] || 1
    expect(replay(bent).diverged?.tick).toBe(Math.ceil(row[0] / CHECK_EVERY) * CHECK_EVERY)
  })
})

describe('the full kit in a played match (combat and traversal pass, 2026-11-13)', () => {
  it('is on when the setup says so, and off for a recording made before it could say', () => {
    expect(arenaFor({ ...setup(), fullKit: true }).match.fullKit).toBe(true)
    expect(arenaFor(setup()).match.fullKit).toBeUndefined()
  })

  it('a recorded match with it on replays to the same state', () => {
    const s = { ...setup(), fullKit: true }
    const arena = arenaFor(s)
    const rules = matchRules(arena)
    const rec = createRecorder(s)
    arena.match.human = 0
    while (arena.match.tick < 600 && arena.match.winner === undefined) {
      const command = scripted(arena.match.tick)
      rec.input(arena, command)
      advance(arena, rules, s.idle, command)
      rec.after(arena)
    }
    const again = replay(rec.recording)
    expect(again.diverged).toBeUndefined()
    expect(hashState(again.arena.match)).toBe(hashState(arena.match))
  })
})
