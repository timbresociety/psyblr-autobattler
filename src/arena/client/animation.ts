import type { BuildSlot } from '../../charter/types.js'
import type { MeleeBlow } from '../engine/combat.js'
import type { MatchEvent } from '../engine/events.js'
import { ENGINE } from '../engine/calibration.js'
import type { HeroState } from '../engine/state.js'

/**
 * Each hero's animation state (KTD9), driven only by engine events and state: run, slide or hang in the air while
 * moving, a jump, a second jump, a dash or a landing as each happens, a cast pose for a slot, a flinch on a heavy hit,
 * stunned, and dead for good. `seq` on a movement counts them, so a second dash straight after the first starts over.
 *
 * A cast runs on the engine's clock (Forge goal, phase 1): `prep` is how much of the wind-up is done and `recover` how
 * much of the recovery, each 0 to 1, so the clip's release frame lands on the engine's release tick. `seq` counts the
 * hero's casts, so a second swing of the same skill restarts its clip. Previews that only name a slot play the clip
 * as it was made.
 */
export type AnimState =
  | { kind: 'idle' | 'run' | 'air' | 'slide' | 'hit' | 'stunned' | 'dead' | HeldKind; wound?: number }
  | { kind: MoveKind; seq: number; way?: Way }
  | { kind: 'cast'; slot: BuildSlot; seq?: number; prep?: number; recover?: number; air?: boolean; melee?: MeleeBlow }

/**
 * Which way a jump, a second jump or a roll goes from where the hero aims, picked as it starts (owner, 2026-11-04: one
 * clip for every jump made platforming hard to read). Straight up, ahead, to its left or right, or back. Ahead, the
 * body turns along the move; any other way it keeps facing the aim and plays that way's clip, as third-person
 * shooters and parkour games do.
 */
export type Way = 'up' | 'forward' | 'left' | 'right' | 'back'
/** The movements that pick a way as they start. */
export const WAYED: ReadonlySet<string> = new Set(['jump', 'air_jump', 'roll'])

/** The movements that play once as they happen (Forge goal, phase 2), named as their clips are. */
export type MoveKind = 'jump' | 'air_jump' | 'dash' | 'land' | 'roll' | 'toggle' | 'mantle' | 'land_roll' | 'land_heavy'

/**
 * The canon's held states, each looping its own clip while it lasts: a guard, crouched or prone (still or moving), a
 * melee launch out of control, and a heavy blow's charge.
 */
export type HeldKind = 'block' | 'crouch' | 'crouch_move' | 'prone' | 'prone_move' | 'launched' | 'charge' | 'zip' | 'rail'
export const HELD_KINDS: readonly HeldKind[] = ['block', 'crouch', 'crouch_move', 'prone', 'prone_move', 'launched', 'charge', 'zip', 'rail']

/**
 * Seconds each movement holds the body before running, hanging in the air or standing takes over: about its clip's
 * length, less the blend out. A landing gives way at once to a hero that moves on, and lasts longer the harder it was.
 */
/** The engine's move names that the animator spells differently. */
const MOVE_KIND: Partial<Record<string, MoveKind>> = { 'air-jump': 'air_jump', 'land-roll': 'land_roll', 'land-heavy': 'land_heavy' }

export const MOVE_SECONDS: Record<MoveKind, number> = { jump: 0.42, air_jump: 0.4, dash: 0.24, land: 0.16, roll: ENGINE.move.roll.time, toggle: 0.5, mantle: ENGINE.move.mantle.time, land_roll: 0.55, land_heavy: 0.45 }
const HARD_LANDING = { speed: 12, seconds: 0.34 }

export interface Animator {
  state: AnimState
  /** Seconds the current flinch keeps playing. */
  hold: number
  /** The cast in progress, in engine ticks: pressed at `started`, released at `release`, over at `ends`. */
  cast?: { slot: BuildSlot; started: number; release: number; ends: number; melee?: MeleeBlow }
  /** Casts so far. */
  casts: number
  /** Movements so far. */
  moves: number
  /** The way of the last jump, second jump or roll, held while it carries the hero (in the air or rolling). */
  way?: Way
  /** The movement `way` was picked for. */
  waySeq?: number
  /** How far into its heavy blow's wind-up a charge has drawn the hero (0 to 1), so the blow goes on from there. */
  wound?: number
}

export const HIT_SECONDS = 0.25

export const createAnimator = (): Animator => ({ state: { kind: 'idle' }, hold: 0, casts: 0, moves: 0 })

/** Apply one tick's events for one hero; `tick` is the tick they happened on. */
export function onEvents(a: Animator, hero: number, events: readonly MatchEvent[], tick: number) {
  if (a.state.kind === 'dead') return
  for (const e of events) {
    if (e.type === 'death' && e.hero === hero) {
      a.state = { kind: 'dead' }
      a.cast = undefined
      return
    }
    if (e.type === 'cast' && e.hero === hero) {
      a.cast = { slot: e.slot, started: tick, release: e.release, ends: e.ends, melee: e.melee }
      a.casts++
      a.state = { kind: 'cast', slot: e.slot, seq: a.casts, prep: 0, recover: 0, melee: e.melee }
      a.hold = 0
    } else if (e.type === 'interrupt' && e.hero === hero && a.cast?.slot === e.slot) {
      a.cast = undefined
    } else if (e.type === 'hit' && e.target === hero && e.heavy && !a.cast) {
      a.state = { kind: 'hit' }
      a.hold = HIT_SECONDS
    } else if (e.type === 'passive' && e.hero === hero && !a.cast) {
      // the passive's toggle, on or off, is one flourish every hero shares (COMMON_MOTIONS); its effects say which
      a.state = { kind: 'toggle', seq: ++a.moves }
      a.hold = MOVE_SECONDS.toggle
    } else if (e.type === 'move' && e.hero === hero && e.move !== 'slide' && e.move !== 'zip-on' && e.move !== 'zip-off') {
      // a ride shows while it lasts (settle reads it off the hero), so catching and letting go play nothing of their own
      const kind = MOVE_KIND[e.move] ?? (e.move as MoveKind)
      a.state = { kind, seq: ++a.moves }
      a.hold = kind === 'land' && (e.speed ?? 0) >= HARD_LANDING.speed ? HARD_LANDING.seconds : MOVE_SECONDS[kind]
    }
  }
}

/**
 * Settle the state for this frame. `now` is the engine's clock in ticks, fractional between ticks, so a cast's clip
 * moves as smoothly as the heroes do; `dt` (seconds) runs down a flinch.
 */
export function settle(a: Animator, hero: HeroState, moved: number, now: number, dt: number): AnimState {
  if (a.state.kind === 'dead') return a.state
  const c = a.cast
  if (c && now < c.ends) {
    const drawn = Math.min(1, Math.max(0, (now - c.started) / Math.max(1, c.release - c.started)))
    // a charged blow swings on from the wind-up the charge held, not from its guard again
    const from = c.melee?.heavy !== undefined ? (a.wound ?? 0) : 0
    const prep = from + (1 - from) * drawn
    const recover = now <= c.release ? 0 : Math.min(1, (now - c.release) / Math.max(1, c.ends - c.release))
    a.state = { kind: 'cast', slot: c.slot, seq: a.casts, prep, recover, air: hero.airborne, melee: c.melee }
    return a.state
  }
  a.cast = undefined
  a.wound = undefined
  // a jump, a second jump or a roll picks its way on its first frame, from where the engine sent it; the way holds
  // while the move carries the hero and lets go back on its feet
  if ('seq' in a.state && WAYED.has(a.state.kind) && a.waySeq !== a.state.seq) {
    a.way = wayOf(hero)
    a.waySeq = a.state.seq
    a.state = { kind: a.state.kind as MoveKind, seq: a.state.seq!, way: a.way }
  } else if (a.way && !hero.airborne && !hero.roll && !('seq' in a.state && WAYED.has(a.state.kind))) a.way = undefined
  // a landing or a toggle holds only a hero that stands there; one running on keeps its stride
  if ((a.state.kind === 'land' || a.state.kind === 'toggle') && moved > 0.01) a.hold = 0
  // a ride shows at once, whatever one-shot was playing; a roll off an edge gives way to the fall
  if (hero.zip || (a.state.kind === 'roll' && hero.airborne)) a.hold = 0
  if (a.hold > 0) {
    a.hold -= dt
    if (a.hold > 0) return a.state
  }
  const moving = moved > 0.01
  const kind: AnimState['kind'] = hero.launch?.regain
    ? 'launched'
    : hero.stunnedUntil > now
      ? 'stunned'
      : hero.basicSince >= 0 && hero.action === undefined && now - hero.basicSince >= CHARGE_TICKS
        ? 'charge'
        : hero.zip
          ? hero.zip.hang ? 'zip' : 'rail'
          : hero.airborne
            ? 'air'
          : hero.slide
            ? 'slide'
            : hero.blocking
              ? 'block'
              : hero.stance === 'prone'
                ? moving ? 'prone_move' : 'prone'
                : hero.stance === 'crouch'
                  ? moving ? 'crouch_move' : 'crouch'
                  : moving ? 'run' : 'idle'
  if (kind === 'charge') {
    // the heavy blow's wind-up draws back as the charge fills and holds short of the release (owner, 2026-11-04: the
    // charge read as raising a guard)
    const fill = Math.min(1, (now - hero.basicSince) / (CHARGE.full * ENGINE.tickHz))
    a.wound = CHARGE.from + (CHARGE.to - CHARGE.from) * fill
    a.state = { kind, wound: a.wound }
  } else if (a.state.kind !== kind) a.state = { kind }
  return a.state
}

const DEG = Math.PI / 180
/** Off its aim by less than this a move goes ahead, by more than `back` it goes back; between, to the side. */
const WAYS = { ahead: 55 * DEG, back: 125 * DEG, still: 1.5 }

/** The way a hero is going from its aim (a quarter turn of yaw is its left), or up when it's barely moving across. */
export function wayOf(hero: Pick<HeroState, 'velocity' | 'yaw'>): Way {
  const { x, z } = hero.velocity
  if (Math.hypot(x, z) < WAYS.still) return 'up'
  const off = Math.atan2(Math.sin(Math.atan2(x, z) - hero.yaw), Math.cos(Math.atan2(x, z) - hero.yaw))
  return Math.abs(off) <= WAYS.ahead ? 'forward' : Math.abs(off) >= WAYS.back ? 'back' : off > 0 ? 'left' : 'right'
}
/**
 * The charge shows from `show` seconds of holding, well before the engine counts it (ENGINE.melee.heavyHold), as a tap
 * is over by then: the heavy blow's wind-up drawn from `from` of the way to its release to `to` at a full charge.
 */
const CHARGE = { show: 0.12, from: 0.25, to: 0.85, full: ENGINE.melee.heavyHold + ENGINE.melee.chargeFull }
const CHARGE_TICKS = Math.ceil(CHARGE.show * ENGINE.tickHz)

/**
 * How fast hips turn (radians a second) and how far the chest twists from them. Running, the hips turn at most `warp`
 * toward where the hero goes and the legs run the rest of the way at an angle under them, at most `legs`, easing
 * there at `swing` radians a second; so a hero strafing past its aim runs on a diagonal with its chest square to the
 * aim, the way a player strafes, instead of turning its hips side on and wringing its spine round (Forge goal, phase
 * 2). A hero moving further than `back.enter` from its aim runs backwards, and runs forwards again under `back.leave`,
 * so a hero strafing near the line doesn't flip between the two every few frames. A hero casting while it covers more
 * than `stride` metres a second keeps running under the cast, and a standing hero's hips hold until its aim is `pivot`
 * round from them.
 */
/** `airTravel`: m/s across the ground over which a jump faces the way it travels rather than the aim. */
export const STANCE = { turn: 12, twist: 100 * DEG, warp: 55 * DEG, legs: 60 * DEG, swing: 8, back: { enter: 110 * DEG, leave: 90 * DEG }, stride: 0.6, pivot: 45 * DEG, airTravel: 1.5 }

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))

/**
 * Where a hero's hips face, how far its chest twists back toward its aim, whether it runs backwards, whether it's
 * turning on the spot to face its aim, how far its legs run at an angle to its hips, and which way it moves from its
 * hips (radians, the same way round as yaw: a quarter turn is its left; 0 when it isn't moving).
 */
export interface Stance {
  body: number
  twist: number
  back: boolean
  pivot: boolean
  legs: number
  heading: number
}

/**
 * How a hero stands this frame (Forge goal, phases 1 and 2). Running, its hips turn part of the way toward where it
 * moves, its legs run the rest at an angle, and its chest twists to where it aims, so a hero shooting while it strafes
 * or backs away doesn't skate; moving away from its aim it faces the aim and runs backwards. Standing, its feet stay
 * put: the hips hold while the chest follows the aim, and only once the aim is STANCE.pivot round do the hips turn, all
 * the way to face it. In the air the whole body faces the aim (the caller passes a jump that travels as a slide).
 * Sliding, the hips face along the slide and the chest turns toward the aim as far as it twists. `last` is last frame's stance: the hips turn from there at STANCE.turn.
 * `move` is how far the hero moved, if it did. A hero that `strafes` (its view sidesteps and backpedals on clips of
 * its own: see gait.ts) runs with its hips square to its aim whichever way it goes, its legs and the clips doing the
 * rest; it still counts as running backwards when it moves away from its aim, for the dash it hops back on.
 */
export function stance(last: Stance | undefined, aim: number, move: { x: number; z: number } | undefined, mode: 'run' | 'stand' | 'square' | 'slide', dt: number, strafes = false): Stance {
  const from = last?.body ?? aim
  let target = aim
  let back = false
  let pivot = false
  let heading: number | undefined
  if (mode === 'run' && move) {
    heading = Math.atan2(move.x, move.z)
    const off = wrap(heading - aim)
    back = Math.abs(off) > (last?.back ? STANCE.back.leave : STANCE.back.enter)
    // the hips go part of the way round toward the line the legs run along, forwards or backwards
    if (!strafes) target = wrap(aim + clamp(back ? wrap(off + Math.PI) : off, STANCE.warp))
  } else if (mode === 'slide' && move) {
    heading = Math.atan2(move.x, move.z)
    target = heading
  } else if (mode === 'stand') {
    pivot = Math.abs(wrap(aim - from)) > (last?.pivot ? 1e-3 : STANCE.pivot)
    if (!pivot) target = from
  }
  const step = wrap(target - from)
  let hips = wrap(from + Math.sign(step) * Math.min(Math.abs(step), STANCE.turn * dt))
  // the chest never twists past its limit: past it, the hips come round with it, unless they're sliding along a line
  let twist = wrap(aim - hips)
  if (Math.abs(twist) > STANCE.twist) {
    twist = Math.sign(twist) * STANCE.twist
    if (mode !== 'slide') hips = wrap(aim - twist)
  }
  // the legs make up the rest of the way to the line they run along, easing there; a strafing hero's clips run it
  const wanted = heading === undefined || strafes ? 0 : clamp(wrap((back ? heading + Math.PI : heading) - hips), STANCE.legs)
  const was = last?.legs ?? 0
  const legs = was + Math.sign(wanted - was) * Math.min(Math.abs(wanted - was), STANCE.swing * dt)
  return { body: hips, twist, back, pivot, legs, heading: heading === undefined ? 0 : wrap(heading - hips) }
}

const clamp = (a: number, limit: number) => Math.max(-limit, Math.min(limit, a))
