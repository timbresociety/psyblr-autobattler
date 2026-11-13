import { SIZES } from '../../charter/sizes.js'
import type { BuildSlot, TraverseKind } from '../../charter/types.js'
import type { MeleeBlow } from '../engine/combat.js'
import type { MatchEvent } from '../engine/events.js'
import { DT, ENGINE, ticks } from '../engine/calibration.js'
import type { HeroState } from '../engine/state.js'

/**
 * Each hero's animation state (KTD9): what the body shows this frame, worked out here and nowhere else.
 *
 * **The contract.** The simulation owns what a hero does: where it is, what it may start, what cuts it short. This
 * reads that off the engine's state each frame, and its events for the things state alone can't say (that a landing
 * just happened, and how hard). The view (characters.ts) plays exactly the state it is handed: it never holds a clip
 * past its state, and it decides no transition of its own.
 *
 * **One clock.** Everything timed is timed on the engine's clock, in ticks, fractional between ticks: a cast's wind-up
 * and recovery, a roll's or a mantle's progress, how long a landing or a flinch holds. So a pause, a slowed practice
 * room, a hit-stop and a 30, 60 or 120 Hz display all show the same pose at the same moment of the fight. A jump has
 * no timer at all: its take-off, rise, top and fall are read off how fast the body is rising (`AirPhase`).
 *
 * **Who wins** when a hero is in several states at once, first to last (`settle`): dead; knocked down; launched;
 * stunned; pulling up a ledge, hanging, running a wall or held by an E move; rolling; a cast still in progress in the
 * engine; riding a line; sliding or diving; dashing; a landing, a catch, a flinch or another one-shot still playing; a
 * heavy blow's charge; a guard; in the air; crouched or prone; running; standing.
 */
export type AnimState =
  | { kind: 'idle' | 'run' | 'slide' | 'stunned' | 'dead' | HeldKind; wound?: number }
  /** In the air: which part of the arc, and how far through it (0 to 1). Without a phase (a preview), falling. */
  | { kind: 'air'; phase?: AirPhase; t?: number }
  /** A flinch: `t` is how far through it. */
  | { kind: 'hit'; t?: number }
  /**
   * A movement that plays once. `seq` counts them, so a second dash straight after the first starts over. `t` is how
   * far through it the engine is, 0 to 1 (absent in a preview, which plays the clip at its own pace); `low`, a mantle
   * onto something low enough to step up and over rather than pull up to; `rise`, the metres a mantle or a climb goes up.
   */
  | { kind: MoveKind; seq: number; way?: Way; t?: number; low?: boolean; air?: boolean; rise?: number }
  /**
   * A cast on the engine's clock (Forge goal, phase 1): `prep` is how much of the wind-up is done, 0 to 1, so the
   * clip's contact frame lands on the engine's release tick; from there the clip plays on at its own pace, `since`
   * seconds after the release. `recover` is how much of the engine's recovery is done, 0 to 1, and `tail` says the
   * engine has let the hero go and only the follow-through is left, which anything cuts short. `seq` counts the hero's
   * casts, so a second swing of the same skill restarts its clip. Previews that only name a slot play the clip as it
   * was made.
   */
  | { kind: 'cast'; slot: BuildSlot; seq?: number; prep?: number; recover?: number; since?: number; wind?: number; tail?: boolean; air?: boolean; melee?: MeleeBlow; low?: 'crouch' | 'prone' }

/**
 * A jump's arc by how fast the body rises, never by a clock: rising, over the top (within AIR.top m/s of still, either
 * way), falling. A step off a ledge starts at the top; a knock into the air is not a jump (`launched`).
 */
export type AirPhase = 'rise' | 'apex' | 'fall'

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
export type MoveKind = 'jump' | 'air_jump' | 'dash' | 'land' | 'roll' | 'toggle' | 'mantle' | 'land_roll' | 'land_heavy' | 'catch' | 'climb' | 'dive' | 'get_up' | 'regain' | 'block_hit'

/**
 * The canon's held states, each looping its own clip while it lasts: a guard, crouched or prone (still or moving), a
 * melee launch out of control, a heavy blow's charge, a ride, a ledge, and the full kit's (GAME.md §4): lying knocked
 * down, running a wall, and the E moves that hold the body (gliding or flying, swinging on a line, crawling a wall,
 * riding an ally).
 */
export type HeldKind = 'block' | 'crouch' | 'crouch_move' | 'prone' | 'prone_move' | 'launched' | 'charge' | 'zip' | 'rail' | 'hang' | 'hang_left' | 'hang_right' | 'down' | 'wall_run' | 'glide' | 'swing' | 'crawl' | 'ride'
export const HELD_KINDS: readonly HeldKind[] = ['block', 'crouch', 'crouch_move', 'prone', 'prone_move', 'launched', 'charge', 'zip', 'rail', 'hang', 'hang_left', 'hang_right', 'down', 'wall_run', 'glide', 'swing', 'crawl', 'ride']

type Move = Extract<MatchEvent, { type: 'move' }>['move']

/**
 * What each of the engine's movement events shows, every one of them: a one-shot that plays as it happens, or nothing
 * of its own, because the state it begins shows while it lasts (`settle` reads a slide, a ride, a wall run, a held E
 * move or a fall off the hero itself). A new engine move doesn't compile until it is given one or the other here.
 */
const MOVE_SHOWS: Record<Move, MoveKind | undefined> = {
  jump: 'jump',
  'air-jump': 'air_jump',
  // a kick off a wall, a pad's throw and a jump after a launcher are take-offs like any other
  'wall-jump': 'jump',
  pad: 'jump',
  chase: 'jump',
  dash: 'dash',
  roll: 'roll',
  // rolling out of a knockdown
  'wake-roll': 'roll',
  land: 'land',
  'land-roll': 'land_roll',
  'land-heavy': 'land_heavy',
  mantle: 'mantle',
  hang: 'catch',
  climb: 'climb',
  dive: 'dive',
  // shown by the state each begins, for as long as it lasts
  slide: undefined,
  'zip-on': undefined,
  'zip-off': undefined,
  'let-go': undefined,
  'wall-run': undefined,
  swing: undefined,
  flight: undefined,
  glide: undefined,
  'wall-crawl': undefined,
  ride: undefined,
  'power-slide': undefined,
  // the hero is somewhere else at once: its effects show it (effects/player.ts), the body carries on as it stands
  teleport: undefined,
  swap: undefined,
  homing: undefined,
  burrow: undefined,
  emerge: undefined,
}

/** What a held E move shows while it holds the body (traverse.ts); the ones that only send the hero somewhere show nothing of their own. */
const TRAVERSE_SHOWS: Record<TraverseKind, HeldKind | 'slide' | undefined> = {
  swing: 'swing',
  flight: 'glide',
  glide: 'glide',
  wallCrawl: 'crawl',
  ride: 'ride',
  powerSlide: 'slide',
  // under the floor, out of sight: lying low until it comes up
  burrow: 'prone',
  teleport: undefined,
  swap: undefined,
  homing: undefined,
  wallRun: undefined,
  combatRoll: undefined,
  zipline: undefined,
}

/**
 * Seconds each timed one-shot lasts, on the engine's clock, and the one table that says so: the view fits each clip to
 * its move's time here (library-gait.ts MOVE_CUTS, motion-pack mapping) rather than keeping times of its own. A roll,
 * a dive, a mantle and a climb last as long as the engine's own move does; a dash as long as the engine carries it; a
 * jump's take-off and an air jump's are not timed at all (AIR).
 */
export const MOVE_SECONDS: Record<MoveKind, number> = { jump: 0.42, air_jump: 0.4, dash: ENGINE.move.dash.time, land: 0.3, roll: ENGINE.move.roll.time, toggle: 0.6, mantle: ENGINE.move.mantle.time, land_roll: 0.55, land_heavy: 0.45, catch: 0.45, climb: ENGINE.move.hang.climb, dive: ENGINE.move.dive.time, get_up: 0.4, regain: 0.4, block_hit: 0.3 }

/**
 * A jump by its speed. `takeOff`: the push off the ground plays over the first share of the rise's speed lost (a
 * quarter: an eighth of a second for a medium hero, sooner for one that jumps lower). `top`: within this many m/s of
 * still the body is going over the top, a quarter of a second in all.
 */
export const AIR = { takeOff: 0.25, top: 4.2 }

/**
 * Landings. A hero that lands still plays its landing whole (`still` seconds, `hard` from `hardSpeed` m/s). One that
 * lands running keeps running: nothing holds it, and the landing shows as its hips sinking over legs that go on
 * striding (`squash`: metres at `full` m/s of fall, less for a gentler one, never under `least` of it; down in `down`
 * seconds, back up by `up`).
 */
export const LANDING = { still: 0.3, hard: 0.5, hardSpeed: 12, squash: 0.2, full: 20, least: 0.3, down: 0.07, up: 0.3 }

/**
 * An air slam's blow: its clip is drawn back over `wind` seconds of the plunge, held `held` of the way to its contact
 * until the body lands, and holds the body `land` seconds on the ground (the engine's own hold there).
 */
export const SLAM = { wind: 0.12, held: 0.92, land: 0.2 }
/** Seconds a cast's follow-through may go on playing after the engine has let the hero go, while it does nothing else. */
export const CAST_TAIL = 0.6

export interface Animator {
  state: AnimState
  /** The one-shot in progress, in engine ticks: began at `from`, over at `until`. */
  shot?: { from: number; until: number }
  /**
   * The cast in progress, as the engine began it: pressed at `started`, released at `release`, over at `ends`. Kept
   * only while the engine's own action is this one, or has run its course (`settle`).
   */
  cast?: { slot: BuildSlot; started: number; release: number; ends: number; melee?: MeleeBlow; charged?: boolean; again?: boolean }
  /** Casts so far. */
  casts: number
  /** Movements so far. */
  moves: number
  /** The way of the last jump, second jump or roll, held while it carries the hero (in the air or rolling). */
  way?: Way
  /** The movement `way` was picked for. */
  waySeq?: number
  /** How far into its blow's or its cast's wind-up a charge has drawn the hero (0 to 1), so it goes on from there. */
  wound?: number
  /** The take-off in progress: the jump it belongs to, and how fast the body left the ground. */
  takeOff?: { seq: number; speed: number }
  /** The last landing: the tick it happened and how fast the body was falling, for the hips' sink (`squash`). */
  landed?: { at: number; speed: number }
  /** Metres the hips sink this frame over a landing taken at a run (LANDING); 0 otherwise. */
  squash: number
  /**
   * An air slam (V held in the air): the tick the plunge began and, once it has, the tick it landed. The engine casts
   * nothing for a slam, so its blow's clip is played off these: wound up through the plunge, landing with the landing.
   */
  slam?: { from: number; landed?: number }
}

export const HIT_SECONDS = 0.25
/**
 * How far into its wind-up a shot fired again starts: the last of the draw, a pump of the arm, not the whole of it (at
 * 0.7 a pair of guns on full auto bobbed a hand's breadth seven times a second).
 */
const REFIRE = 0.85

export const createAnimator = (): Animator => ({ state: { kind: 'idle' }, casts: 0, moves: 0, squash: 0 })

/** Apply one tick's events for one hero; `tick` is the tick they happened on. */
export function onEvents(a: Animator, hero: number, events: readonly MatchEvent[], tick: number) {
  if (a.state.kind === 'dead') return
  const once = (state: AnimState, seconds: number) => {
    a.state = state
    a.shot = { from: tick, until: tick + Math.max(1, ticks(seconds)) }
  }
  for (const e of events) {
    if (e.type === 'death' && e.hero === hero) {
      a.state = { kind: 'dead' }
      a.cast = undefined
      a.shot = undefined
      return
    }
    if (e.type === 'cast' && e.hero === hero) {
      // a shot let go again while the last one still shows (a held trigger, a burst, a beam's next pulse) goes on from
      // the aim it holds: its clip does not start over from the stance each time
      const again = !e.melee && a.cast !== undefined && a.cast.slot === e.slot && !a.cast.melee && a.state.kind === 'cast'
      a.cast = { slot: e.slot, started: tick, release: e.release, ends: e.ends, melee: e.melee, ...(again ? { again } : {}) }
      a.casts++
      a.state = { kind: 'cast', slot: e.slot, seq: a.casts, prep: 0, recover: 0, since: 0, melee: e.melee }
      a.shot = undefined
    } else if (e.type === 'charge' && e.hero === hero && e.phase === 'release' && a.cast?.slot === e.slot) {
      // a cast held to charge was let go: it goes on from the wind-up its charge held (`settle`)
      a.cast.charged = true
    } else if (e.type === 'interrupt' && e.hero === hero && a.cast?.slot === e.slot) {
      a.cast = undefined
    } else if (e.type === 'hit' && e.target === hero && e.heavy && !a.cast) {
      once({ kind: 'hit', t: 0 }, HIT_SECONDS)
    } else if (e.type === 'passive' && e.hero === hero && !a.cast) {
      // the passive's toggle, on or off, plays its aura's own flourish (heroes.ts toggleMove); its effects say which
      once({ kind: 'toggle', seq: ++a.moves, t: 0 }, MOVE_SECONDS.toggle)
    } else if (e.type === 'melee' && e.hero === hero && e.what === 'slam') {
      a.slam = { from: tick }
      a.casts++
      a.cast = undefined
      a.shot = undefined
    } else if (e.type === 'melee' && e.hero === hero && e.what === 'slam-land') {
      if (a.slam) a.slam.landed = tick
    } else if (e.type === 'melee' && e.hero === hero && (e.what === 'blocked' || e.what === 'parry')) {
      // a blow caught on the guard jolts it (the guard holds on underneath, and comes back as the jolt ends)
      once({ kind: 'block_hit', seq: ++a.moves, t: 0 }, MOVE_SECONDS.block_hit)
    } else if (e.type === 'melee' && e.hero === hero && (e.what === 'get-up' || e.what === 'regain')) {
      const kind = e.what === 'get-up' ? 'get_up' : 'regain'
      once({ kind, seq: ++a.moves, t: 0 }, MOVE_SECONDS[kind])
    } else if (e.type === 'move' && e.hero === hero) {
      const kind = MOVE_SHOWS[e.move]
      if (!kind) continue
      if (kind === 'land' || kind === 'land_roll' || kind === 'land_heavy') a.landed = { at: tick, speed: e.speed ?? 0 }
      once({ kind, seq: ++a.moves, t: 0 }, kind === 'land' ? ((e.speed ?? 0) >= LANDING.hardSpeed ? LANDING.hard : LANDING.still) : MOVE_SECONDS[kind])
    }
  }
}

/** How far through [from, until] `now` is, 0 to 1. */
const through = (from: number, until: number, now: number) => Math.min(1, Math.max(0, (now - from) / Math.max(1e-6, until - from)))

/** What the frame being drawn is, beyond the hero's state: the engine's own tick, and how far between the last two ticks it is drawn. */
export interface Drawn {
  /** The engine's tick now. Casts run on `now`, which a hit-stop holds back; whether a cast is still the engine's is judged on this. */
  tick: number
  /** How far from the last tick's state to this one's the hero is drawn, 0 to 1. */
  alpha: number
  /** Seconds the clip of the hero's cast goes on after its contact frame (the view knows its clips): its follow-through. */
  tail?: number
}

/**
 * Settle the state for this frame. `now` is the engine's clock in ticks, fractional between ticks, so a cast's clip
 * moves as smoothly as the heroes do; `moved` is how far the hero went across the ground this tick. `dt` is unused:
 * nothing here runs on the wall's clock. `drawn` says which frame this is; without it (a test, a still), the tick is
 * `now` and the hero is drawn where the engine has it.
 */
export function settle(a: Animator, hero: HeroState, moved: number, now: number, _dt = 0, drawn?: Drawn): AnimState {
  a.squash = 0
  if (a.state.kind === 'dead') return a.state
  const tick = drawn?.tick ?? Math.floor(now + 1e-6)
  const alpha = drawn?.alpha ?? 1
  // the instant drawn, on the engine's clock: the last tick's state at 0, this one's at 1
  const at = drawn ? tick - 1 + alpha : now
  const moving = moved > 0.01
  const show = (state: AnimState): AnimState => (a.state = state)
  const held = (kind: Extract<AnimState, { wound?: number }>['kind']): AnimState => (a.state.kind === kind ? a.state : show({ kind }))
  const seq = 'seq' in a.state && a.state.seq !== undefined ? a.state.seq : a.moves
  // the one-shot playing, if `kinds` has it and its time isn't up
  const shot = (...kinds: MoveKind[]) => (a.shot && at < a.shot.until && (kinds as string[]).includes(a.state.kind) ? through(a.shot.from, a.shot.until, at) : undefined)

  // a cast is the engine's action: it shows while that action is still this one, or once it has run its whole course
  // (a hit-stop holds `now` back, so the clip is still catching up to an action the engine has finished). An action
  // the engine dropped early, with or without an event to say so, is gone here at once: a blow cut short by a
  // knockback, a guard or a dodge never plays on over what the hero does next
  const c = a.cast
  const mine = c && hero.action && hero.action.slot === c.slot && hero.action.started === c.started
  if (c && !mine && tick < c.ends) a.cast = undefined

  // out of the hero's hands: down, in the air from a blow, stunned
  if (hero.down) return held('down')
  if (hero.launch) return held('launched')
  // an air slam: the blow's clip winds up as the body plunges and lands with it (the engine holds the hero a moment
  // there, which this shows as the blow following through, not as a daze). A plunge cut short before it lands is gone
  if (a.slam) {
    const blow = { step: 0, kind: 'slam' } as const
    const since = a.slam.landed === undefined ? 0 : Math.max(0, at - a.slam.landed) * DT
    if (hero.slam) return show({ kind: 'cast', slot: 'basic', seq: a.casts, prep: Math.min(SLAM.held, (at - a.slam.from) / ticks(SLAM.wind)), recover: 0, since: 0, air: true, melee: blow })
    if (a.slam.landed !== undefined && !moving && !hero.airborne && since < Math.min(CAST_TAIL, Math.max(SLAM.land, drawn?.tail ?? 0)))
      return show({ kind: 'cast', slot: 'basic', seq: a.casts, prep: 1, recover: Math.min(1, since / SLAM.land), since, ...(since > SLAM.land ? { tail: true } : {}), air: false, melee: blow })
    a.slam = undefined
  }
  const getUp = shot('get_up', 'regain')
  if (getUp !== undefined) return show({ kind: a.state.kind as MoveKind, seq, t: getUp })
  if (hero.stunnedUntil > tick || hero.grabbedBy !== undefined) return held('stunned')

  // a ledge and the moves that hold the body their own way
  if (hero.mantle) {
    // a climb from a hang says so as it starts (the engine's event); anything else is a mantle
    const kind = a.state.kind === 'climb' ? 'climb' : 'mantle'
    const rise = hero.mantle.y1 - hero.mantle.y0
    return show({ kind, seq, t: through(hero.mantle.from, hero.mantle.until, at), rise, ...(kind === 'mantle' && rise <= LOW_MANTLE * ENGINE.capsule.height * heightOf(hero) ? { low: true } : {}) })
  }
  if (hero.hang) {
    const caught = shot('catch')
    return caught !== undefined ? show({ kind: 'catch', seq, t: caught }) : held(hangKind(hero))
  }
  if (hero.wallRun) return held('wall_run')
  const carried = hero.traverse ? TRAVERSE_SHOWS[hero.traverse.how] : undefined
  if (carried) return held(carried)

  // a jump, a second jump or a roll picks its way on its first frame, from where the engine sent it; the way holds
  // while the move carries the hero and lets go back on its feet
  if ('seq' in a.state && WAYED.has(a.state.kind) && a.waySeq !== a.state.seq) {
    a.way = wayOf(hero)
    a.waySeq = a.state.seq
  } else if (a.way && !hero.airborne && !hero.roll && !('seq' in a.state && WAYED.has(a.state.kind))) a.way = undefined

  // a roll takes the whole body, whatever was being cast (the engine drops the cast as the roll starts); off an edge it
  // gives way to the fall (the engine ends it there for a played hero; the AI's tumbles on, and shows as a fall too)
  if (hero.roll && !hero.airborne) return show({ kind: 'roll', seq, way: a.way, t: through(hero.roll.from, hero.roll.until, at) })

  // a cast held to charge (§4 Systems) draws its own wind-up while the button is down, as a heavy blow's charge does:
  // the aim taken, the bow drawn, the blast gathered, where it stood idle until it was let go (kit check, 2026-11-13)
  if (hero.charging && !a.cast) {
    const fill = Math.min(1, Math.max(0, (at - hero.charging.since) / (CHARGE.cast * ENGINE.tickHz)))
    a.wound = CHARGE.from + (CHARGE.to - CHARGE.from) * smooth(fill)
    const low = hero.stance === 'stand' ? undefined : hero.stance
    return show({ kind: 'cast', slot: hero.charging.slot, seq: a.casts + 1, prep: a.wound, recover: 0, since: 0, air: hero.airborne, ...(low ? { low } : {}) })
  }

  if (a.cast) {
    const k = a.cast
    const drawnPrep = Math.min(1, Math.max(0, (now - k.started) / Math.max(1, k.release - k.started)))
    // a charged blow swings on from the wind-up the charge held, not from its guard again
    const from = k.melee?.heavy !== undefined || k.charged ? (a.wound ?? 0) : k.again ? REFIRE : 0
    // a held beam is one long release: the pose stays where the beam leaves it until it is let go
    if (hero.beam && k.slot === 'active1' && !k.melee && (k.again || now >= k.release)) return show({ kind: 'cast', slot: k.slot, seq: a.casts, prep: 1, recover: 0, since: 0, air: hero.airborne, ...(hero.stance === 'stand' ? {} : { low: hero.stance }) })
    const prep = from + (1 - from) * drawnPrep
    const since = Math.max(0, now - k.release) * DT
    const recover = now <= k.release ? 0 : Math.min(1, (now - k.release) / Math.max(1, k.ends - k.release))
    // the engine's part is over at `ends`; the follow-through plays on while the hero does nothing else with its body
    const tail = now >= k.ends
    // (a tap for the next blow of a chain doesn't end it: only a hold long enough to show as a charge does)
    const charging = hero.basicSince >= 0 && tick - hero.basicSince >= CHARGE_TICKS
    const idle = !moving && !hero.airborne && !hero.blocking && hero.stance === 'stand' && !charging
    if (!tail || (idle && since < (drawn?.tail ?? 0) && now - k.ends < CAST_TAIL * ENGINE.tickHz)) {
      // a shot or a spell from a crouch or prone stays down there (a blow stands the hero up in the engine)
      const low = hero.stance === 'stand' ? undefined : hero.stance
      // how long the engine gives the wind-up, for the view to pace the clip by; a charged blow swings on from where its
      // charge held it, at whatever pace that takes
      const wind = from > 0 && !k.again ? undefined : (k.release - k.started) * DT
      return show({ kind: 'cast', slot: k.slot, seq: a.casts, prep, recover, since, ...(wind !== undefined ? { wind } : {}), ...(tail ? { tail } : {}), air: hero.airborne, melee: k.melee, ...(low ? { low } : {}) })
    }
    a.cast = undefined
  }
  a.wound = undefined

  if (hero.zip) return held(hero.zip.hang ? 'zip' : 'rail')
  if (hero.slide && !hero.airborne) return hero.slide.prone ? show({ kind: 'dive', seq, t: through(hero.slide.from, hero.slide.until, at) }) : held('slide')
  // a dash lasts as long as the engine carries the hero, on the ground or off it
  if (tick < hero.dashUntil && a.state.kind === 'dash') return show({ kind: 'dash', seq, t: through(hero.dashUntil - ticks(ENGINE.move.dash.time), hero.dashUntil, at), air: hero.airborne })

  if (hero.airborne) {
    // rising, over the top or falling, by the speed the body is drawn at (the engine's, a part of a tick back)
    const rising = hero.velocity.y + ENGINE.move.gravity * (1 - alpha) * DT
    const jumped = a.state.kind === 'jump' || a.state.kind === 'air_jump' ? a.state : undefined
    if (jumped) {
      // the take-off: read off how much of the speed it left the ground with is spent, so it ends at the same point of
      // every jump, whoever jumps and however high
      if (a.takeOff?.seq !== jumped.seq) a.takeOff = { seq: jumped.seq, speed: Math.max(rising, 1) }
      const spent = 1 - rising / a.takeOff.speed
      if (spent < AIR.takeOff && rising > AIR.top) return show({ kind: jumped.kind, seq: jumped.seq, way: a.way, t: Math.max(0, spent / AIR.takeOff) })
    }
    const launch = a.takeOff?.speed ?? Math.sqrt(2 * ENGINE.move.gravity * ENGINE.move.jump)
    if (rising > AIR.top) return show({ kind: 'air', phase: 'rise', t: Math.min(1, Math.max(0, 1 - (rising - AIR.top) / Math.max(1e-6, launch * (1 - AIR.takeOff) - AIR.top))) })
    if (rising >= -AIR.top) return show({ kind: 'air', phase: 'apex', t: (AIR.top - rising) / (2 * AIR.top) })
    return a.state.kind === 'air' && a.state.phase === 'fall' ? a.state : show({ kind: 'air', phase: 'fall', t: 0 })
  }
  a.takeOff = undefined

  // a landing taken at a run holds nothing: the legs go on striding and the hips sink over them
  const l = a.landed
  if (l && moving) {
    const seconds = (at - l.at) * DT
    const depth = LANDING.squash * Math.min(1, Math.max(LANDING.least, l.speed / LANDING.full))
    a.squash = seconds < 0 || seconds >= LANDING.down + LANDING.up ? 0 : seconds < LANDING.down ? depth * (seconds / LANDING.down) : depth * (1 - smooth((seconds - LANDING.down) / LANDING.up))
  }
  const landing = shot('land', 'land_roll', 'land_heavy')
  if (landing !== undefined && (a.state.kind === 'land_roll' || !moving)) return show({ kind: a.state.kind as MoveKind, seq, t: landing })
  const flourish = shot('toggle')
  if (flourish !== undefined && !moving) return show({ kind: 'toggle', seq, t: flourish })
  const jolted = shot('block_hit')
  if (jolted !== undefined && hero.blocking) return show({ kind: 'block_hit', seq, t: jolted })
  if (a.state.kind === 'hit' && a.shot && at < a.shot.until) return show({ kind: 'hit', t: through(a.shot.from, a.shot.until, at) })
  a.shot = undefined

  if (hero.basicSince >= 0 && hero.action === undefined && tick - hero.basicSince >= CHARGE_TICKS) {
    // the heavy blow's wind-up draws back as the charge fills and holds short of the release (owner, 2026-11-04: the
    // charge read as raising a guard)
    const fill = Math.min(1, (at - hero.basicSince) / (CHARGE.full * ENGINE.tickHz))
    a.wound = CHARGE.from + (CHARGE.to - CHARGE.from) * fill
    return show({ kind: 'charge', wound: a.wound })
  }
  if (hero.blocking) return held('block')
  if (hero.stance === 'prone') return held(moving ? 'prone_move' : 'prone')
  if (hero.stance === 'crouch') return held(moving ? 'crouch_move' : 'crouch')
  return held(moving ? 'run' : 'idle')
}

const smooth = (x: number) => x * x * (3 - 2 * x)
/** A mantle that rises no more than this share of the hero's height steps up and over; a higher one pulls up. */
const LOW_MANTLE = 0.62
/** How tall a hero stands against the medium one (its size class's body), for what counts as low to it. */
const heightOf = (hero: Pick<HeroState, 'size'>) => SIZES[hero.size].scale

/**
 * Hanging still, or shimmying to its own left or right: facing the wall (against the drop), its left lies along
 * (-nz, nx), a quarter turn of yaw round from its facing.
 */
function hangKind(hero: Pick<HeroState, 'hang' | 'velocity'>): 'hang' | 'hang_left' | 'hang_right' {
  const g = hero.hang!
  const along = -hero.velocity.x * g.nz + hero.velocity.z * g.nx
  return Math.abs(along) < 0.1 ? 'hang' : along > 0 ? 'hang_left' : 'hang_right'
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
 * is over by then: the heavy blow's wind-up drawn from `from` of the way to its release to `to` at a full charge. A cast
 * held to charge draws its own the same way, over `cast` seconds.
 */
const CHARGE = { show: 0.12, from: 0.25, to: 0.85, full: ENGINE.melee.heavyHold + ENGINE.melee.chargeFull, cast: 0.5 }
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
