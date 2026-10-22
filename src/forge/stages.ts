import type { Build } from '../charter/build'
import { getTemplate } from '../charter/templates/catalog'
import type { BuildSlot } from '../charter/types'
import type { Forge, StageId, StageState, Transition } from './types'

/** The forge's stages in order; each is confirmed before the next starts (R11). */
export const STAGE_ORDER: readonly StageId[] = ['spec', 'concept', 'mesh', 'motion', 'active1', 'active2', 'ultimate', 'form', 'stats']

/** The stages that generate a skill's effect, and the slot each one dresses (R18). */
export const EFFECT_SLOT: Partial<Record<StageId, BuildSlot>> = { active1: 'active1', active2: 'active2', ultimate: 'ultimate' }

/** Which stages spend credits, and how many retries each allows after its first generation (R4). */
export const STAGE_TABLE: Record<StageId, { paid: boolean; retryCap: number }> = {
  spec: { paid: false, retryCap: 99 },
  concept: { paid: true, retryCap: 3 },
  mesh: { paid: true, retryCap: 3 },
  motion: { paid: true, retryCap: 3 },
  active1: { paid: true, retryCap: 3 },
  active2: { paid: true, retryCap: 3 },
  ultimate: { paid: true, retryCap: 3 },
  form: { paid: true, retryCap: 3 },
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

/** A stage's state; forges saved before a stage existed (the form stage) read it as a fresh draft. */
export const stageOf = (forge: Forge, stage: StageId): StageState => forge.stages[stage] ?? emptyStage(stage)

function update(forge: Forge, stage: StageId, patch: Partial<StageState>, extra: Partial<Forge> = {}): Transition {
  return { ok: true, forge: { ...forge, ...extra, version: forge.version + 1, stages: { ...forge.stages, [stage]: { ...stageOf(forge, stage), ...patch } } } }
}

/** The optional form stage is offered only to a hero whose ultimate transforms it (R34, KTD14). */
export function formAvailable(build: Build | undefined): boolean {
  return !!build && getTemplate(build.slots.ultimate.templateId).effects.some((e) => e.kind === 'resize')
}

/** The size class the hero's transformation reaches, which the form mesh is scaled to. */
export function formSize(build: Build | undefined) {
  const resize = build && getTemplate(build.slots.ultimate.templateId).effects.find((e) => e.kind === 'resize')
  return resize && resize.kind === 'resize' ? resize.sizeClass : undefined
}

/** Checks shared by every action on a stage: it must be the current stage and not yet approved. */
function guard(forge: Forge, stage: StageId): Transition | undefined {
  if (stageOf(forge, stage).status === 'approved') return reject('frozen')
  if (forge.current !== stage) return reject('out-of-order')
  return undefined
}

/** Start the first generation of a draft (or edited) stage. */
export function begin(forge: Forge, stage: StageId): Transition {
  const blocked = guard(forge, stage)
  if (blocked) return blocked
  const s = stageOf(forge, stage)
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
  if (stageOf(forge, stage).status !== 'ready') return reject('bad-status')
  const next = STAGE_ORDER[STAGE_ORDER.indexOf(stage) + 1] ?? 'published'
  const approved = update(forge, stage, { status: 'approved' }, { current: next })
  // a hero with no transformation has no form to make, so the form stage passes by at no charge
  if (approved.ok && next === 'form' && !formAvailable(forge.build)) return skip(approved.forge, 'form')
  return approved
}

/** Skip an optional stage at no charge (R34). Only the form stage is optional. */
export function skip(forge: Forge, stage: StageId): Transition {
  if (stage !== 'form') return reject('bad-status')
  const blocked = guard(forge, stage)
  if (blocked) return blocked
  if (stageOf(forge, stage).status === 'generating') return reject('bad-status')
  return update(forge, stage, { status: 'approved', artifacts: {}, inputs: { ...stageOf(forge, stage).inputs, skipped: true } }, { current: 'stats' })
}

/** Record a pick among a ready stage's options (which sheet, which motion variant); no regeneration. */
export function choose(forge: Forge, stage: StageId, choice: Record<string, unknown>): Transition {
  const blocked = guard(forge, stage)
  if (blocked) return blocked
  const s = forge.stages[stage]
  if (s.status !== 'ready') return reject('bad-status')
  return update(forge, stage, { inputs: { ...s.inputs, choice: { ...(s.inputs.choice as object | undefined), ...choice } } })
}
