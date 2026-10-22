import { createHash } from 'node:crypto'
import { BUILD_SLOTS, swapAlternatives, type Build } from '../charter/build'
import { CATALOG_VERSION } from '../charter/templates/catalog'
import type { BuildSlot } from '../charter/types'
import { AI_CALIBRATION_VERSION, CALIBRATION_VERSION } from '../sim/calibration'
import { runGate, type GateOptions, type GateOutcome } from '../sim/gate'
import type { Db } from './db'

/**
 * A cache in front of the balance gate (KTD6). The key covers only what the gate reads: role, templates, spread,
 * size, the gate options and the catalogue, engine and AI versions. Names, art and text are left out, so saving a
 * cosmetic edit or the same build twice costs a lookup instead of thousands of duels.
 */

interface Cached {
  state: GateOutcome['state']
  winRate: number
  retuneSteps: number
  strongestSlot?: BuildSlot
}

export function gateKey(build: Build, options: GateOptions = {}): string {
  const numbers = {
    roleId: build.roleId,
    slots: BUILD_SLOTS.map((s) => build.slots[s].templateId),
    spread: build.spread,
    sizeClass: build.sizeClass ?? 'medium',
    options: { duelsPerMember: options.duelsPerMember ?? null, seed: options.seed ?? null, candidateScale: options.candidateScale ?? null, field: options.field ? options.field.map((b) => gateKey(b)) : null },
    versions: [CATALOG_VERSION, CALIBRATION_VERSION, AI_CALIBRATION_VERSION],
  }
  return createHash('sha256').update(JSON.stringify(numbers)).digest('hex')
}

/** Rebuild the gate's outcome for this build from a cached result. */
function replay(input: Build, cached: Cached): GateOutcome {
  const slots = Object.fromEntries(BUILD_SLOTS.map((s) => [s, { ...input.slots[s], retuneSteps: cached.retuneSteps }])) as Build['slots']
  const stamp = { catalogVersion: CATALOG_VERSION, calibrationVersion: CALIBRATION_VERSION, aiCalibrationVersion: AI_CALIBRATION_VERSION, winRate: Math.round(cached.winRate * 1000) / 1000 }
  const gate = cached.state === 'ready' ? { state: 'ready' as const, ...stamp } : { state: 'blocked' as const, strongestSlot: cached.strongestSlot, ...stamp }
  const build = { ...input, slots, gate }
  return cached.state === 'ready'
    ? { state: 'ready', winRate: cached.winRate, build }
    : { state: 'blocked', winRate: cached.winRate, build, strongestSlot: cached.strongestSlot, alternatives: cached.strongestSlot ? swapAlternatives(input, cached.strongestSlot) : [] }
}

/** Run the gate, or reuse the result for the same numbers. */
export async function cachedGate(db: Db, build: Build, options: GateOptions = {}): Promise<GateOutcome> {
  const key = gateKey(build, options)
  const { rows } = await db.query<{ outcome: Cached }>('select outcome from gate_cache where key = $1', [key])
  if (rows.length) return replay(build, rows[0].outcome)
  const outcome = runGate(build, options)
  const cached: Cached = { state: outcome.state, winRate: outcome.winRate, retuneSteps: outcome.build.slots.basic.retuneSteps, ...(outcome.strongestSlot ? { strongestSlot: outcome.strongestSlot } : {}) }
  await db.query('insert into gate_cache (key, outcome) values ($1, $2) on conflict (key) do nothing', [key, JSON.stringify(cached)])
  return outcome
}
