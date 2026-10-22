import type { Forge, StageId, StageState, Transition } from './types'

/** The forge's stages in order; each is confirmed before the next starts (R11). */
export const STAGE_ORDER: readonly StageId[] = ['spec', 'concept', 'mesh', 'motion', 'active1', 'active2', 'ultimate', 'stats']

/** Which stages spend credits, and how many retries each allows after its first generation (R4). */
export const STAGE_TABLE: Record<StageId, { paid: boolean; retryCap: number }> = {
  spec: { paid: false, retryCap: 99 },
  concept: { paid: true, retryCap: 3 },
  mesh: { paid: true, retryCap: 3 },
  motion: { paid: true, retryCap: 3 },
  active1: { paid: true, retryCap: 3 },
  active2: { paid: true, retryCap: 3 },
  ultimate: { paid: true, retryCap: 3 },
  stats: { paid: false, retryCap: 99 },
}

function emptyStage(id: StageId): StageState {
  return { id, status: 'draft', retriesUsed: 0, generations: 0, attempt: 0, inputs: {}, steps: [], artifacts: {} }
}

export function createForge(id: string, accountId: string, prompt = '', referenceUrls: string[] = []): Forge {
  const stages = Object.fromEntries(STAGE_ORDER.map((s) => [s, emptyStage(s)])) as Forge['stages']
  return { id, accountId, version: 0, current: 'spec', prompt, referenceUrls, stages, chat: [] }
}

const reject = (reason: Extract<Transition, { ok: false }>['reason']): Transition => ({ ok: false, reason })

function update(forge: Forge, stage: StageId, patch: Partial<StageState>, extra: Partial<Forge> = {}): Transition {
  return { ok: true, forge: { ...forge, ...extra, version: forge.version + 1, stages: { ...forge.stages, [stage]: { ...forge.stages[stage], ...patch } } } }
}

/** Checks shared by every action on a stage: it must be the current stage and not yet approved. */
function guard(forge: Forge, stage: StageId): Transition | undefined {
  if (forge.stages[stage].status === 'approved') return reject('frozen')
  if (forge.current !== stage) return reject('out-of-order')
  return undefined
}

/** Start the first generation of a draft (or edited) stage. */
export function begin(forge: Forge, stage: StageId): Transition {
  const blocked = guard(forge, stage)
  if (blocked) return blocked
  const s = forge.stages[stage]
  if (s.status !== 'draft' && s.status !== 'failed') return reject('bad-status')
  // regenerating after an edit is a retry too, so editing cannot bypass the cap
  const spends = s.generations > 0
  if (spends && s.retriesUsed >= STAGE_TABLE[stage].retryCap) return reject('retry-cap')
  return update(forge, stage, { status: 'generating', attempt: s.attempt + 1, retriesUsed: s.retriesUsed + (spends ? 1 : 0), steps: [], failure: undefined })
}

export function succeed(forge: Forge, stage: StageId, artifacts: Record<string, string>, servedBy: string[] = []): Transition {
  const blocked = guard(forge, stage)
  if (blocked) return blocked
  if (forge.stages[stage].status !== 'generating') return reject('bad-status')
  return update(forge, stage, { status: 'ready', artifacts, servedBy, generations: forge.stages[stage].generations + 1 })
}

/** Every provider declined or failed: the stage costs nothing and can be tried again (F3). */
export function fail(forge: Forge, stage: StageId, reason: string): Transition {
  const blocked = guard(forge, stage)
  if (blocked) return blocked
  if (forge.stages[stage].status !== 'generating') return reject('bad-status')
  return update(forge, stage, { status: 'failed', failure: reason })
}

/** Generate again. A failed stage retries for free; a ready stage spends one of its capped retries (R4, R12). */
export function retry(forge: Forge, stage: StageId): Transition {
  const blocked = guard(forge, stage)
  if (blocked) return blocked
  const s = forge.stages[stage]
  if (s.status === 'failed') return update(forge, stage, { status: 'generating', attempt: s.attempt + 1, steps: [], failure: undefined })
  if (s.status !== 'ready') return reject('bad-status')
  if (s.retriesUsed >= STAGE_TABLE[stage].retryCap) return reject('retry-cap')
  return update(forge, stage, { status: 'generating', attempt: s.attempt + 1, retriesUsed: s.retriesUsed + 1, steps: [] })
}

/** Change a stage's inputs; it goes back to draft and keeps its retry count. */
export function editInputs(forge: Forge, stage: StageId, inputs: Record<string, unknown>): Transition {
  const blocked = guard(forge, stage)
  if (blocked) return blocked
  const s = forge.stages[stage]
  if (s.status === 'generating') return reject('bad-status')
  return update(forge, stage, { status: 'draft', inputs: { ...s.inputs, ...inputs } })
}

/** Approve a ready stage and open the next one; approving stats publishes the forge. */
export function confirm(forge: Forge, stage: StageId): Transition {
  const blocked = guard(forge, stage)
  if (blocked) return blocked
  if (forge.stages[stage].status !== 'ready') return reject('bad-status')
  const next = STAGE_ORDER[STAGE_ORDER.indexOf(stage) + 1] ?? 'published'
  return update(forge, stage, { status: 'approved' }, { current: next })
}
