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
 * The gate samples a fixed set of seeds, so a measured rate carries sampling noise (about +-3 points at 180 fights).
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
  /** Duels against each field member, alternating sides. */
  duelsPerMember?: number
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

const DEFAULTS = { duelsPerMember: 30, seed: 1 }

/** One fight scored for side `me`: a win is 1, a draw is half. */
export function scoreFor(result: BattleResult, me: 0 | 1): number {
  return result.winner === me ? 1 : result.winner === 'draw' ? 0.5 : 0
}

/** Fight `mine` against `theirs`, swapping starting sides when `flip` is set, and score it for `mine`. */
export function playScored(mine: Combatant[], theirs: Combatant[], flip: boolean, seed: number): number {
  return flip ? scoreFor(simulate(theirs, mine, seed), 1) : scoreFor(simulate(mine, theirs, seed), 0)
}

/** Win rate of a build against the field; draws count half. */
export function winRateVsField(build: Build, options: GateOptions = {}): number {
  const { duelsPerMember, seed } = { ...DEFAULTS, ...options }
  const field = options.field ?? referenceField()
  const me: Combatant = { build, powerScale: options.candidateScale ?? 1 }
  let score = 0
  let fights = 0
  field.forEach((opponent, f) => {
    const them: Combatant[] = [{ build: opponent }]
    for (let i = 0; i < duelsPerMember; i++) {
      score += playScored([me], them, i % 2 === 1, seed * 100_003 + f * 1009 + i)
      fights++
    }
  })
  return score / fights
}

const withSteps = (build: Build, steps: number): Build => ({
  ...build,
  slots: Object.fromEntries(BUILD_SLOTS.map((s) => [s, { ...build.slots[s], retuneSteps: steps }])) as Build['slots'],
})

/** The slot whose template matters most: swapping it to the role default drops the win rate the most. */
function strongestSlot(build: Build, base: number, options: GateOptions): BuildSlot {
  let best: { slot: BuildSlot; drop: number } = { slot: 'ultimate', drop: -Infinity }
  for (const slot of BUILD_SLOTS) {
    const fallback = defaultTemplate(build.roleId, SLOT_KIND[slot]).id
    if (build.slots[slot].templateId === fallback) continue
    const swapped = { ...build, slots: { ...build.slots, [slot]: { ...build.slots[slot], templateId: fallback } } }
    const drop = base - winRateVsField(swapped, options)
    if (drop > best.drop) best = { slot, drop }
  }
  return best.slot
}

/**
 * The balance gate (KTD7): measure the build, retune every slot down one budget step at a time until it sits at or
 * under the ceiling, and block it if the retune limit is reached first. A build far under the field is lifted the same
 * way in reverse, up to the floor.
 */
/** The versions a gate result was earned against, plus its rounded win rate; `isGateStale` checks the same three. */
export const gateStamp = (winRate: number) => ({ catalogVersion: CATALOG_VERSION, calibrationVersion: CALIBRATION_VERSION, aiCalibrationVersion: AI_CALIBRATION_VERSION, winRate: Math.round(winRate * 1000) / 1000 })

/**
 * Lift a weak build toward the floor, one budget step at a time. Fights can turn on a few points of damage, so a whole
 * step that overshoots the pass line is split: the largest part of it that keeps the build fair is taken.
 */
function lift(input: Build, start: number, options: GateOptions): { steps: number; build: Build; winRate: number } {
  let lo = 0
  let loRate = start
  let hi: number | undefined
  for (let s = 1; s <= MAX_LIFT_STEPS && loRate < GATE_FLOOR; s++) {
    const rate = winRateVsField(withSteps(input, -s), options)
    if (rate > PASS_LINE) {
      hi = s
      break
    }
    ;[lo, loRate] = [s, rate]
  }
  for (let i = 0; hi !== undefined && i < 3 && loRate < GATE_FLOOR; i++) {
    const mid = (lo + hi) / 2
    const rate = winRateVsField(withSteps(input, -mid), options)
    if (rate > PASS_LINE) hi = mid
    else [lo, loRate] = [mid, rate]
  }
  return { steps: -lo, build: withSteps(input, -lo), winRate: loRate }
}

/** The slot holding a weak build back: swapping it to the role default raises the win rate the most. */
function weakestSlot(build: Build, base: number, options: GateOptions): BuildSlot {
  let best: { slot: BuildSlot; gain: number } = { slot: 'basic', gain: -Infinity }
  for (const slot of BUILD_SLOTS) {
    const fallback = defaultTemplate(build.roleId, SLOT_KIND[slot]).id
    if (build.slots[slot].templateId === fallback) continue
    const swapped = { ...build, slots: { ...build.slots, [slot]: { ...build.slots[slot], templateId: fallback } } }
    const gain = winRateVsField(swapped, options) - base
    if (gain > best.gain) best = { slot, gain }
  }
  return best.slot
}

export function runGate(input: Build, options: GateOptions = {}): GateOutcome {
  let steps = 0
  let build = withSteps(input, 0)
  let winRate = winRateVsField(build, options)
  if (winRate < GATE_FLOOR) ({ steps, build, winRate } = lift(input, winRate, options))
  if (winRate < GATE_HOPELESS) {
    const slot = weakestSlot(build, winRate, options)
    return {
      state: 'blocked',
      winRate,
      build: { ...build, gate: { state: 'blocked', strongestSlot: slot, blockedFor: 'weak', ...gateStamp(winRate) } },
      strongestSlot: slot,
      alternatives: swapAlternatives(input, slot),
    }
  }
  while (winRate > PASS_LINE && steps < MAX_RETUNE_STEPS) {
    steps++
    build = withSteps(input, steps)
    winRate = winRateVsField(build, options)
  }
  const stamp = gateStamp(winRate)
  if (winRate <= PASS_LINE) return { state: 'ready', winRate, build: { ...build, gate: { state: 'ready', ...stamp } } }
  const slot = strongestSlot(build, winRate, options)
  return {
    state: 'blocked',
    winRate,
    build: { ...build, gate: { state: 'blocked', strongestSlot: slot, blockedFor: 'strong', ...stamp } },
    strongestSlot: slot,
    alternatives: swapAlternatives(input, slot),
  }
}

/** True when a stored gate result was earned against older catalogue, engine or AI numbers. */
export function isGateStale(build: Build): boolean {
  const g = build.gate
  return g.state !== 'draft' && (g.catalogVersion !== CATALOG_VERSION || g.calibrationVersion !== CALIBRATION_VERSION || g.aiCalibrationVersion !== AI_CALIBRATION_VERSION)
}
