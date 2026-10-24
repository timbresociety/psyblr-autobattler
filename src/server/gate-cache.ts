import { createHash } from 'node:crypto'
import { BUILD_SLOTS, swapAlternatives, type Build } from '../charter/build.js'
import { CATALOG_VERSION } from '../charter/templates/catalog.js'
import type { BuildSlot } from '../charter/types.js'
import { AI_CALIBRATION_VERSION, CALIBRATION_VERSION } from '../sim/calibration.js'
import { MAX_RETUNE_STEPS } from '../charter/budget.js'
import { GATE_CEILING, GATE_MARGIN, gateStamp, runGate, verifyGate, type GateOptions, type GateOutcome } from '../sim/gate.js'
import type { Db } from './db.js'

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
    // the gate's own thresholds decide ready or blocked too, so changing them must miss the cache
    gate: [GATE_CEILING, GATE_MARGIN, MAX_RETUNE_STEPS],
  }
  return createHash('sha256').update(JSON.stringify(numbers)).digest('hex')
}

/** Rebuild the gate's outcome for this build from a cached result. */
function replay(input: Build, cached: Cached): GateOutcome {
  const slots = Object.fromEntries(BUILD_SLOTS.map((s) => [s, { ...input.slots[s], retuneSteps: cached.retuneSteps }])) as Build['slots']
  const stamp = gateStamp(cached.winRate)
  const gate = cached.state === 'ready' ? { state: 'ready' as const, ...stamp } : { state: 'blocked' as const, strongestSlot: cached.strongestSlot, ...stamp }
  const build = { ...input, slots, gate }
  return cached.state === 'ready'
    ? { state: 'ready', winRate: cached.winRate, build }
    : { state: 'blocked', winRate: cached.winRate, build, strongestSlot: cached.strongestSlot, alternatives: cached.strongestSlot ? swapAlternatives(input, cached.strongestSlot) : [] }
}

/**
 * Run the gate, or reuse the result for the same numbers. `claimedSteps` are the steps a browser's own gate found: one
 * measurement confirms them, and only a claim that fails falls back to the whole search.
 */
export async function cachedGate(db: Db, build: Build, options: GateOptions = {}, claimedSteps?: number): Promise<GateOutcome> {
  const key = gateKey(build, options)
  // the cache only saves time: if it cannot be read or written, the gate still runs and the save still succeeds
  const hit = await db.query<{ outcome: Cached }>('select outcome from gate_cache where key = $1', [key]).then(
    (r) => r.rows[0]?.outcome,
    () => undefined,
  )
  if (hit) return replay(build, hit)
  const outcome = (claimedSteps !== undefined ? verifyGate(build, claimedSteps, options) : undefined) ?? runGate(build, options)
  const cached: Cached = { state: outcome.state, winRate: outcome.winRate, retuneSteps: outcome.build.slots.basic.retuneSteps, ...(outcome.strongestSlot ? { strongestSlot: outcome.strongestSlot } : {}) }
  await db.query('insert into gate_cache (key, outcome) values ($1, $2) on conflict (key) do nothing', [key, JSON.stringify(cached)]).catch(() => undefined)
  return outcome
}
