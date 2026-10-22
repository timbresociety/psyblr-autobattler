import { BUILD_SLOTS, SLOT_KIND, swapAlternatives, type Build } from '../charter/build'
import { MAX_RETUNE_STEPS } from '../charter/budget'
import { CATALOG_VERSION, defaultTemplate } from '../charter/templates/catalog'
import type { BuildSlot, Template } from '../charter/types'
import { CALIBRATION_VERSION } from './calibration'
import { simulate, type Combatant } from './engine'
import { referenceField } from './field'

/** The R15 ceiling: no build may beat the reference field more often than this. */
export const GATE_CEILING = 0.55

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

/** Win rate of a build against the field; draws count half. */
export function winRateVsField(build: Build, options: GateOptions = {}): number {
  const { duelsPerMember, seed } = { ...DEFAULTS, ...options }
  const field = options.field ?? referenceField()
  const me: Combatant = { build, powerScale: options.candidateScale ?? 1 }
  let score = 0
  let fights = 0
  field.forEach((opponent, f) => {
    for (let i = 0; i < duelsPerMember; i++) {
      const flip = i % 2 === 1
      const s = seed * 100_003 + f * 1009 + i
      const result = flip ? simulate([{ build: opponent }], [me], s) : simulate([me], [{ build: opponent }], s)
      const mine = flip ? 1 : 0
      score += result.winner === mine ? 1 : result.winner === 'draw' ? 0.5 : 0
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
function strongestSlot(build: Build, options: GateOptions): BuildSlot {
  let best: { slot: BuildSlot; drop: number } = { slot: 'ultimate', drop: -Infinity }
  const base = winRateVsField(build, options)
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
 * under the ceiling, and block it if the retune limit is reached first.
 */
export function runGate(input: Build, options: GateOptions = {}): GateOutcome {
  let steps = 0
  let build = withSteps(input, 0)
  let winRate = winRateVsField(build, options)
  while (winRate > GATE_CEILING && steps < MAX_RETUNE_STEPS) {
    steps++
    build = withSteps(input, steps)
    winRate = winRateVsField(build, options)
  }
  const stamp = { catalogVersion: CATALOG_VERSION, calibrationVersion: CALIBRATION_VERSION, winRate: Math.round(winRate * 1000) / 1000 }
  if (winRate <= GATE_CEILING) return { state: 'ready', winRate, build: { ...build, gate: { state: 'ready', ...stamp } } }
  const slot = strongestSlot(build, options)
  return {
    state: 'blocked',
    winRate,
    build: { ...build, gate: { state: 'blocked', strongestSlot: slot, ...stamp } },
    strongestSlot: slot,
    alternatives: swapAlternatives(input, slot),
  }
}

/** True when a stored gate result was earned against older catalogue or calibration numbers. */
export function isGateStale(build: Build): boolean {
  return build.gate.state !== 'draft' && (build.gate.catalogVersion !== CATALOG_VERSION || build.gate.calibrationVersion !== CALIBRATION_VERSION)
}
