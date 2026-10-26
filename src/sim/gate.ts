import { BUILD_SLOTS, SLOT_KIND, swapAlternatives, type Build } from '../charter/build'
import { MAX_RETUNE_STEPS } from '../charter/budget'
import { CATALOG_VERSION, defaultTemplate } from '../charter/templates/catalog'
import type { BuildSlot, Template } from '../charter/types'
import { AI_CALIBRATION_VERSION, CALIBRATION_VERSION } from './calibration'
import { simulate, type BattleResult, type Combatant } from './engine'
import { referenceField } from './field'

/** The R15 ceiling: no build may beat the reference field more often than this. */
export const GATE_CEILING = 0.55

/**
 * The gate samples a fixed set of seeds, so a measured rate carries sampling noise (about +-3 points at 200 fights).
 * A build must measure at least this far under the ceiling to pass, so its true rate stays under it.
 */
export const GATE_MARGIN = 0.03
const PASS_LINE = GATE_CEILING - GATE_MARGIN

/**
 * The floor: a build measuring under this against the field is lifted, one budget step at a time (never past the pass
 * line), so a player's hero is never sent in hopeless. A kit whose skills scale off stats its role lacks (a Ki Blast
 * fighter, a ninja with shadow bolts) used to win one duel in five or fewer.
 */
export const GATE_FLOOR = 0.42
/** Most a weak build is lifted: twelve steps, every number up 72%. */
export const MAX_LIFT_STEPS = 12
/** Still under this at the full lift, a kit cannot hold its own: it is blocked and its weakest skill named. */
export const GATE_HOPELESS = 0.3

export interface GateOptions {
  /** Fights for each turn of the field (each member leads the opposing side once), alternating sides. */
  duelsPerMember?: number
  /**
   * Heroes a side. 3, the default, is a skirmish: the candidate fights beside two field members against three others,
   * so control, protection and soaking count the way they do in a real match. 1 is a plain duel, which measured
   * a taunt-and-root tank at 0% and a stun-and-sleep controller at 6% while both did their job in team fights.
   */
  team?: number
  seed?: number
  /** Test hook: scales the candidate's whole kit, to model an overtuned build. */
  candidateScale?: number
  field?: Build[]
}

export interface GateOutcome {
  state: 'ready' | 'blocked'
  winRate: number
  build: Build
  strongestSlot?: BuildSlot
  alternatives?: Template[]
}

const DEFAULTS = { duelsPerMember: 25, seed: 1, team: 3 }

/** One fight scored for side `me`: a win is 1, a draw is half. */
export function scoreFor(result: BattleResult, me: 0 | 1): number {
  return result.winner === me ? 1 : result.winner === 'draw' ? 0.5 : 0
}

/** Fight `mine` against `theirs`, swapping starting sides when `flip` is set, and score it for `mine`. */
export function playScored(mine: Combatant[], theirs: Combatant[], flip: boolean, seed: number): number {
  return flip ? scoreFor(simulate(theirs, mine, seed), 1) : scoreFor(simulate(mine, theirs, seed), 0)
}

/**
 * A build's score against the field over some of its turns; draws count half. Turn f puts field members f, f+1, ...
 * on the other side and the members after them beside the candidate, so over all turns every member is met as an
 * opponent and as a partner. Workers each take some turns of one measurement (see `runGateAsync`).
 */
export function scoreVsField(build: Build, options: GateOptions = {}, turns?: readonly number[]): { score: number; fights: number } {
  const { duelsPerMember, seed, team } = { ...DEFAULTS, ...options }
  const field = options.field ?? referenceField()
  const me: Combatant = { build, powerScale: options.candidateScale ?? 1 }
  const member = (k: number): Combatant => ({ build: field[k % field.length] })
  let score = 0
  let fights = 0
  for (const f of turns ?? field.map((_, i) => i)) {
    const theirs = Array.from({ length: team }, (_, k) => member(f + k))
    const mine = [me, ...Array.from({ length: team - 1 }, (_, k) => member(f + team + k))]
    for (let i = 0; i < duelsPerMember; i++) {
      score += playScored(mine, theirs, i % 2 === 1, seed * 100_003 + f * 1009 + i)
      fights++
    }
  }
  return { score, fights }
}

/** Win rate of a build against the whole field; draws count half. */
export function winRateVsField(build: Build, options: GateOptions = {}): number {
  const { score, fights } = scoreVsField(build, options)
  return score / fights
}

const withSteps = (build: Build, steps: number): Build => ({
  ...build,
  slots: Object.fromEntries(BUILD_SLOTS.map((s) => [s, { ...build.slots[s], retuneSteps: steps }])) as Build['slots'],
})

/**
 * The gate's decisions, written once: each `yield` hands over builds to measure and gets back their win rates, so the
 * same steps run synchronously here and spread over web workers in the browser (`runGateAsync`).
 */
type Steps<T> = Generator<Build[], T, number[]>

/** The slot whose template matters most: swapping it to the role default moves the win rate the most, in `sign`'s direction. */
function* decisiveSlot(build: Build, base: number, sign: 1 | -1): Steps<BuildSlot> {
  const candidates = BUILD_SLOTS.filter((slot) => build.slots[slot].templateId !== defaultTemplate(build.roleId, SLOT_KIND[slot]).id)
  if (!candidates.length) return sign === 1 ? 'ultimate' : 'basic'
  const swapped = candidates.map((slot) => ({ ...build, slots: { ...build.slots, [slot]: { ...build.slots[slot], templateId: defaultTemplate(build.roleId, SLOT_KIND[slot]).id } } }))
  const rates = yield swapped
  let best = 0
  candidates.forEach((_, i) => {
    if (sign * (base - rates[i]) > sign * (base - rates[best])) best = i
  })
  return candidates[best]
}

/**
 * Lift a weak build toward the floor: the smallest lift that reaches it, found by halving (fights are slow), never past
 * the pass line. Fights can turn on a few points of damage, so the search works in half steps.
 */
function* lift(input: Build, start: number): Steps<{ build: Build; winRate: number }> {
  const [full] = yield [withSteps(input, -MAX_LIFT_STEPS)]
  // the full lift is still short of the floor: take it, and let the hopeless check judge it
  if (full < GATE_FLOOR) return { build: withSteps(input, -MAX_LIFT_STEPS), winRate: full }
  let lo = 0
  let loRate = start
  let hi = MAX_LIFT_STEPS
  let hiRate = full
  while (hi - lo > 0.5) {
    const mid = Math.round(((lo + hi) / 2) * 2) / 2
    const [rate] = yield [withSteps(input, -mid)]
    if (rate < GATE_FLOOR) [lo, loRate] = [mid, rate]
    else [hi, hiRate] = [mid, rate]
  }
  // the smallest lift that reaches the floor, unless it overshoots the pass line; then the most that stays fair
  return hiRate <= PASS_LINE ? { build: withSteps(input, -hi), winRate: hiRate } : { build: withSteps(input, -lo), winRate: loRate }
}

/** The fewest retune steps that bring a strong build to the pass line, found by halving; the most there is if none does. */
function* retune(input: Build): Steps<{ build: Build; winRate: number }> {
  const [most] = yield [withSteps(input, MAX_RETUNE_STEPS)]
  if (most > PASS_LINE) return { build: withSteps(input, MAX_RETUNE_STEPS), winRate: most }
  let lo = 0
  let hi = MAX_RETUNE_STEPS
  let hiRate = most
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    const [rate] = yield [withSteps(input, mid)]
    if (rate > PASS_LINE) lo = mid
    else [hi, hiRate] = [mid, rate]
  }
  return { build: withSteps(input, hi), winRate: hiRate }
}

/** The versions a gate result was earned against, plus its rounded win rate; `isGateStale` checks the same three. */
export const gateStamp = (winRate: number) => ({ catalogVersion: CATALOG_VERSION, calibrationVersion: CALIBRATION_VERSION, aiCalibrationVersion: AI_CALIBRATION_VERSION, winRate: Math.round(winRate * 1000) / 1000 })

/**
 * The balance gate (KTD7): measure the build, lift it toward the floor if it is far under the field, retune it down to
 * the pass line if it is over, and block it if neither reaches a fair rate, naming the slot responsible.
 */
function* gate(input: Build): Steps<GateOutcome> {
  let build = withSteps(input, 0)
  let [winRate] = yield [build]
  if (winRate < GATE_FLOOR) ({ build, winRate } = yield* lift(input, winRate))
  if (winRate < GATE_HOPELESS) {
    const slot = yield* decisiveSlot(build, winRate, -1)
    return {
      state: 'blocked',
      winRate,
      build: { ...build, gate: { state: 'blocked', strongestSlot: slot, blockedFor: 'weak', ...gateStamp(winRate) } },
      strongestSlot: slot,
      alternatives: swapAlternatives(input, slot),
    }
  }
  if (winRate > PASS_LINE) ({ build, winRate } = yield* retune(input))
  const stamp = gateStamp(winRate)
  if (winRate <= PASS_LINE) return { state: 'ready', winRate, build: { ...build, gate: { state: 'ready', ...stamp } } }
  const slot = yield* decisiveSlot(build, winRate, 1)
  return {
    state: 'blocked',
    winRate,
    build: { ...build, gate: { state: 'blocked', strongestSlot: slot, blockedFor: 'strong', ...stamp } },
    strongestSlot: slot,
    alternatives: swapAlternatives(input, slot),
  }
}

/** Run the gate here, measuring each build in turn. */
export function runGate(input: Build, options: GateOptions = {}): GateOutcome {
  const steps = gate(input)
  let step = steps.next()
  while (!step.done) step = steps.next(step.value.map((b) => winRateVsField(b, options)))
  return step.value
}

/** Run the gate with measurements done elsewhere (the browser's worker pool), several builds at a time. */
export async function runGateAsync(input: Build, measure: (builds: Build[]) => Promise<number[]>): Promise<GateOutcome> {
  const steps = gate(input)
  let step = steps.next()
  while (!step.done) step = steps.next(await measure(step.value))
  return step.value
}

/** True when a stored gate result was earned against older catalogue, engine or AI numbers. */
export function isGateStale(build: Build): boolean {
  const g = build.gate
  return g.state !== 'draft' && (g.catalogVersion !== CATALOG_VERSION || g.calibrationVersion !== CALIBRATION_VERSION || g.aiCalibrationVersion !== AI_CALIBRATION_VERSION)
}
