import { composeRecipe, passiveRecipe } from '../arena/recipes/defaults'
import { lookFor } from '../arena/recipes/looks'
import type { Delivery } from '../charter/types'
import { randomUUID } from 'node:crypto'
import { BUILD_SLOTS, allocate, hydrateBuild, setStatTarget, swapTemplate, type Build } from '../charter/build'
import { isSizeClass } from '../charter/sizes'
import { getTemplate } from '../charter/templates/catalog'
import type { BuildSlot, SecondaryStat } from '../charter/types'
import { buildSpec, runDirector } from '../forge/director/director'
import { applyFloor, imageBreach } from '../forge/director/floor'
import { MOVEMENT_SET, basicMotions, motionsFor, presetsNeeded } from '../forge/motion/library'
import { effectShape, numbered, pick } from '../forge/package'
import { stagePrice } from '../forge/pricing'
import { pollTask, route, type Registry, type Routed } from '../forge/providers/router'
import type { Asset, ImageProvider, ImageRequest, MeshProvider, RetargetProvider, RigProvider, TaskProvider } from '../forge/providers/types'
import { EFFECT_SLOT, STAGE_TABLE, begin, choose, confirm, createForge, editInputs, fail, retry, succeed } from '../forge/stages'
import type { Forge, SpecSheet, StageId, StageState, StepState, Transition } from '../forge/types'
import { placeHold, settleHold } from './credits'
import type { Db } from './db'
import { insertForge, loadForge, saveForge } from './forge-store'
import { isOwnPhotoUrl } from './photo-url'
import { NotFoundError } from './store'
import type { GateOptions } from '../sim/gate'

/**
 * Drives a forge through its stages (KTD1). Requests are short: an action changes state and starts at most one
 * provider step; GET polls advance running steps. Every write is conditional on the version read, so only the
 * request that wins a step's claim calls the provider, and a resume or a second tab never doubles a paid task.
 */

export class ForgeError extends Error {
  constructor(message: string, readonly status: number) {
    super(message)
  }
}

/** Copy a provider output into our own store and return our URL (provider URLs expire). */
export type CopyFn = (pathname: string, sourceUrl: string) => Promise<string>

export interface RunnerDeps {
  db: Db
  registry: Registry
  copy: CopyFn
  /** Publishes the forged hero at the stats confirm (U10). */
  publish?: (deps: RunnerDeps, forge: Forge) => Promise<Forge>
  /** Balance gate options for publishing; tests use fewer duels. */
  gateOptions?: GateOptions
  now?: () => number
}

/** A claimed step whose request died is taken over after this long. */
export const STEP_TIMEOUT_MS = 120_000

/** A provider task still unfinished after this long fails the stage and releases its hold. */
export const TASK_TIMEOUT_MS = 20 * 60_000

/** The house art style every visual is generated in (R19). */
export const HOUSE_STYLE = 'Hyper-realistic cinematic 3D game character, physically based materials, dramatic studio lighting, full body in a neutral A-pose on a plain background.'

const REASONS: Record<Extract<Transition, { ok: false }>['reason'], string> = {
  'retry-cap': 'no retries left for this stage',
  'out-of-order': 'that stage is not open yet',
  frozen: 'that stage is already approved',
  'bad-status': 'that stage cannot do this right now',
}

function must(t: Transition): Forge {
  if (!t.ok) throw new ForgeError(REASONS[t.reason], 409)
  return t.forge
}

const holdRef = (forge: Forge, stage: StageId) => `${forge.id}:${stage}:${forge.stages[stage].attempt}`

function patchStage(forge: Forge, stage: StageId, patch: Partial<StageState>): Forge {
  return { ...forge, stages: { ...forge.stages, [stage]: { ...forge.stages[stage], ...patch } } }
}

function patchStep(forge: Forge, stage: StageId, name: string, patch: Partial<StepState>): Forge {
  return patchStage(forge, stage, { steps: forge.stages[stage].steps.map((s) => (s.name === name ? { ...s, ...patch } : s)) })
}

/** Save `next` over `before`, or tell the player another tab got there first. */
export async function commit(db: Db, before: Forge, next: Forge): Promise<Forge> {
  const saved = await saveForge(db, before.version, next)
  if (!saved) throw new ForgeError('the forge changed in another tab; reload it', 409)
  return saved
}

// ---------------------------------------------------------------------------------------------------------
// Creating a forge

export interface StartInput {
  prompt?: string
  referenceUrls?: string[]
  referenceHeroId?: string
}

/** A spec drafted from an existing Charter build, for "start from this hero" (R2, AE7). */
export function specFromBuild(build: Build, description: string): SpecSheet {
  const basic = getTemplate(build.slots.basic.templateId)
  return {
    heroName: build.heroName,
    description,
    tone: 'mixed',
    sizeClass: build.sizeClass ?? 'medium',
    silhouette: '',
    signatureElements: [],
    basicStyle: basic.delivery.kind === 'melee' ? 'melee' : 'ranged',
    skills: BUILD_SLOTS.map((slot) => ({ slot, name: build.slots[slot].name || slot, theme: build.slots[slot].flavour, templateId: build.slots[slot].templateId })),
    passiveVisual: 'aura',
    flags: { realPerson: false, sexual: false, minors: false, endorsement: false },
    removed: [],
  }
}

export async function startForge(deps: RunnerDeps, accountId: string, deviceId: string | undefined, input: StartInput): Promise<Forge> {
  const prompt = String(input.prompt ?? '').slice(0, 2_000)
  const references = (input.referenceUrls ?? []).slice(0, 3)
  if (references.some((url) => !isOwnPhotoUrl(url, deps.registry.env))) throw new ForgeError('reference images must be uploaded through the photo endpoint', 400)
  let forge = createForge(randomUUID(), accountId, prompt, references)
  if (deviceId) forge.deviceId = deviceId
  if (input.referenceHeroId) {
    const { rows } = await deps.db.query<{ name: string; photos: string[]; original_build: Build; spec: SpecSheet | null }>('select name, photos, original_build, spec from heroes where id = $1 and not hidden', [input.referenceHeroId])
    if (!rows.length) throw new NotFoundError('hero not found')
    const hero = rows[0]
    const { heroId: _drop, ...build } = hero.original_build
    const spec = hero.spec ?? specFromBuild(build as Build, prompt || hero.name)
    const floor = await applyFloor(spec, deps.registry)
    forge = { ...forge, prompt: prompt || hero.name, referenceUrls: references.length ? references : hero.photos.slice(0, 3), referenceHeroId: input.referenceHeroId, build: build as Build }
    if (!floor.blocked) {
      forge.spec = floor.spec
      forge = must(succeed(must(begin(forge, 'spec')), 'spec', {}, ['reference-hero']))
    }
    forge.chat = [{ from: 'director', text: `Starting from ${hero.name}. Change anything below, then confirm the spec.` }]
  }
  forge = { ...forge, version: 0 }
  await insertForge(deps.db, forge)
  return forge
}

// ---------------------------------------------------------------------------------------------------------
// Actions

export type ForgeAction =
  | { type: 'chat'; text: string; answers?: Record<string, string> }
  | { type: 'edit'; stage: StageId; inputs: Record<string, unknown> }
  | { type: 'choose'; stage: StageId; choice: Record<string, unknown> }
  | { type: 'start'; stage: StageId }
  | { type: 'retry'; stage: StageId }
  | { type: 'confirm'; stage: StageId }

export async function act(deps: RunnerDeps, forge: Forge, action: ForgeAction): Promise<Forge> {
  switch (action.type) {
    case 'chat':
      return chat(deps, forge, action.text, action.answers)
    case 'edit':
      return edit(deps, forge, action.stage, action.inputs)
    case 'choose':
      return commit(deps.db, forge, must(choose(forge, action.stage, action.choice)))
    case 'start':
    case 'retry':
      return generate(deps, forge, action.stage, action.type)
    case 'confirm': {
      const next = must(confirm(forge, action.stage))
      if (action.stage === 'stats') {
        if (!deps.publish) throw new ForgeError('publishing is not available', 503)
        return deps.publish(deps, forge)
      }
      return commit(deps.db, forge, next)
    }
  }
}

/** Talk to the cultural director until the spec is drafted (R7-R10). The spec stage is free. */
async function chat(deps: RunnerDeps, forge: Forge, rawText: string, answers?: Record<string, string>): Promise<Forge> {
  if (forge.current !== 'spec') throw new ForgeError('the spec is already confirmed', 409)
  const text = rawText.trim().slice(0, 2_000)
  if (!text && !answers) throw new ForgeError('say something first', 400)
  const history = [...forge.chat, ...(text ? [{ from: 'player' as const, text }] : [])].slice(-40)
  const prompt = forge.prompt || text
  const { output, provider } = await runDirector({ prompt, referenceCaptions: [], chat: history, answers }, deps.registry)
  let next: Forge = must(editInputs({ ...forge, prompt, chat: history }, 'spec', { director: output, answers: answers ?? {} }))
  let reply = output.questions.length ? output.questions.map((q) => `${q.text} (${q.options.join(' / ')})`).join('\n') : ''
  if (output.spec) {
    const built = buildSpec(output.spec)
    const floor = await applyFloor({ ...built.spec, tone: output.tone }, deps.registry, forge.referenceUrls)
    if (floor.blocked) {
      reply = 'I can’t build part of that: it crosses the content floor. Try describing it another way.'
    } else {
      next = must(succeed(must(begin({ ...next, spec: floor.spec, build: { ...built.build, heroName: floor.spec.heroName } }, 'spec')), 'spec', {}, [provider]))
      const removed = floor.spec.removed.map((r) => `${r.element} (${r.reason})`).join('; ')
      reply = [reply, `Here’s the spec for ${floor.spec.heroName}. Swap or drop anything, then confirm.`, removed && `Removed: ${removed}.`].filter(Boolean).join('\n')
    }
  }
  next = { ...next, chat: [...next.chat, { from: 'director' as const, text: reply || 'Tell me more about the hero.' }].slice(-40) }
  return commit(deps.db, forge, next)
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : undefined)

/** Edit a stage's inputs. Spec and stats edits apply at once (both are free); paid stages go back to draft. */
async function edit(deps: RunnerDeps, forge: Forge, stage: StageId, inputs: Record<string, unknown>): Promise<Forge> {
  if (stage === 'spec') return editSpec(deps, forge, inputs)
  if (stage === 'stats') return editStats(deps, forge, inputs)
  const clean = { prompt: str(inputs.prompt, 500) }
  return commit(deps.db, forge, must(editInputs(forge, stage, clean)))
}

async function editSpec(deps: RunnerDeps, forge: Forge, inputs: Record<string, unknown>): Promise<Forge> {
  if (!forge.spec || !forge.build) throw new ForgeError('chat with the director first', 409)
  let spec: SpecSheet = { ...forge.spec }
  let build: Build = forge.build
  const name = str(inputs.heroName, 60)
  if (name) {
    spec.heroName = name
    build = { ...build, heroName: name }
  }
  const silhouette = str(inputs.silhouette, 280)
  if (silhouette !== undefined) spec.silhouette = silhouette
  if (Array.isArray(inputs.signatureElements)) spec.signatureElements = inputs.signatureElements.map((e) => str(e, 120)).filter((e): e is string => !!e).slice(0, 12)
  if (inputs.passiveVisual === 'aura' || inputs.passiveVisual === 'body-element') spec.passiveVisual = inputs.passiveVisual
  const element = str(inputs.passiveElement, 120)
  if (element !== undefined) spec.passiveElement = element || undefined
  if (inputs.basicStyle === 'melee' || inputs.basicStyle === 'ranged') spec.basicStyle = inputs.basicStyle
  if (inputs.sizeClass !== undefined) {
    if (!isSizeClass(inputs.sizeClass)) throw new ForgeError('unknown size class', 400)
    spec.sizeClass = inputs.sizeClass
    const { sizeClass: _old, ...rest } = build
    build = inputs.sizeClass === 'medium' ? rest : { ...rest, sizeClass: inputs.sizeClass }
  }
  const swap = inputs.swap as { slot?: unknown; templateId?: unknown } | undefined
  if (swap) {
    const slot = BUILD_SLOTS.find((s) => s === swap.slot)
    if (!slot || typeof swap.templateId !== 'string') throw new ForgeError('bad swap', 400)
    const swapped = swapTemplate(build, slot, swap.templateId)
    if (!swapped.ok) throw new ForgeError('that skill cannot go in this slot', 400)
    build = swapped.build
    spec = { ...spec, skills: spec.skills.map((s) => (s.slot === slot ? { ...s, templateId: swap.templateId as string } : s)) }
  }
  const floor = await applyFloor(spec, deps.registry, forge.referenceUrls)
  if (floor.blocked) throw new ForgeError('that change crosses the content floor', 422)
  let next = must(editInputs(forge, 'spec', {}))
  next = must(succeed(must(begin({ ...next, spec: floor.spec, build }, 'spec')), 'spec', {}, ['edit']))
  return commit(deps.db, forge, next)
}

/** The stat split stays editable with the Charter's own operations (R20). */
async function editStats(deps: RunnerDeps, forge: Forge, inputs: Record<string, unknown>): Promise<Forge> {
  if (!forge.build) throw new ForgeError('no build yet', 409)
  let result = hydrateBuild(forge.build)
  if (result.ok && inputs.spread) result = allocate(result.build, inputs.spread as Build['spread'])
  const target = inputs.statTarget as { stat?: unknown; value?: unknown } | undefined
  if (result.ok && target && typeof target.stat === 'string' && typeof target.value === 'number') result = setStatTarget(result.build, target.stat as SecondaryStat, target.value)
  if (!result.ok) throw new ForgeError(result.errors.map((e) => `${e.field}: ${e.reason}`).join('; ') || 'invalid stat split', 400)
  const next = must(editInputs({ ...forge, build: result.build }, 'stats', {}))
  return generate(deps, await commit(deps.db, forge, next), 'stats', 'start')
}

/** Start or retry a stage: hold its price, plan its steps, save, then run the first step (R4, KTD6). */
async function generate(deps: RunnerDeps, forge: Forge, stage: StageId, kind: 'start' | 'retry'): Promise<Forge> {
  if (!forge.spec || !forge.build) throw new ForgeError('confirm the spec first', 409)
  let next = must(kind === 'start' ? begin(forge, stage) : retry(forge, stage))
  next = patchStage(next, stage, { steps: planSteps(next, stage), inputs: { ...next.stages[stage].inputs, ...stageRecord(next, stage) } })
  const ref = holdRef(next, stage)
  const price = stagePrice(stage)
  if (price) await placeHold(deps.db, forge.accountId, price, ref)
  const saved = await saveForge(deps.db, forge.version, next)
  if (!saved) {
    // another request moved the forge first; release our hold unless it started this same attempt
    const now = await loadForge(deps.db, forge.id, forge.accountId)
    if (price && !(now.stages[stage].attempt === next.stages[stage].attempt && now.stages[stage].status === 'generating')) await settleHold(deps.db, ref, false)
    throw new ForgeError('the forge changed in another tab; reload it', 409)
  }
  return advance(deps, saved)
}

// ---------------------------------------------------------------------------------------------------------
// Steps

/** Retarget batches: every preset the hero's motions need, at most 5 per call (KTD1, KTD7). */
export function presetBatches(forge: Forge): string[][] {
  const build = forge.build!
  const motions = [
    ...MOVEMENT_SET,
    ...basicMotions(forge.spec!.basicStyle),
    ...(['active1', 'active2', 'ultimate', 'movement'] as const).flatMap((slot) => motionsFor(getTemplate(build.slots[slot].templateId))),
  ]
  const presets = presetsNeeded(motions)
  const batches: string[][] = []
  for (let i = 0; i < presets.length; i += 5) batches.push(presets.slice(i, i + 5))
  return batches
}

export function planSteps(forge: Forge, stage: StageId): StepState[] {
  const step = (name: string): StepState => ({ name, status: 'pending' })
  switch (stage) {
    case 'concept':
      return [step('sheet')]
    case 'mesh':
      return [step('mesh')]
    case 'motion':
      return [step('rig'), ...presetBatches(forge).map((_, i) => step(`retarget-${i}`))]
    case 'active1':
    case 'active2':
      return [step('effect')]
    case 'ultimate':
      return [step('effect'), step('passive')]
    default:
      return []
  }
}

/** What a generation was asked for, stored on the stage so the package can record it (R18). */
function stageRecord(forge: Forge, stage: StageId): Record<string, unknown> {
  const slot = EFFECT_SLOT[stage]
  if (!slot) return {}
  const shape = effectShape(forge.build!.slots[slot].templateId)
  const skill = forge.spec!.skills.find((s) => s.slot === slot)
  // the look comes from the director, or from the skill's own words; the recipe's hit layer is sized to the real area (R11)
  const recipe = composeRecipe(shape.delivery as Delivery['kind'], skill?.look ?? lookFor(`${skill?.theme ?? ''} ${forge.build!.slots[slot].name}`))
  const record: Record<string, unknown> = { effect: { slot, shape, recipe } }
  if (stage === 'ultimate') {
    const s = forge.spec!
    record.passive = { visual: s.passiveVisual, element: s.passiveElement ?? null, shape: effectShape(forge.build!.slots.passive.templateId), recipe: passiveRecipe(s.passiveVisual, lookFor(s.passiveElement ?? s.description)) }
  }
  return record
}

const extra = (forge: Forge, stage: StageId) => str(forge.stages[stage].inputs.prompt, 500) ?? ''

function conceptPrompt(forge: Forge): string {
  const s = forge.spec!
  return [HOUSE_STYLE, `Character sheet (front, side, back) of ${s.heroName}: ${s.description}`, s.silhouette && `Silhouette: ${s.silhouette}.`, s.signatureElements.length ? `Signature elements: ${s.signatureElements.join(', ')}.` : '', `Size: ${s.sizeClass}.`, extra(forge, 'concept')].filter(Boolean).join(' ')
}

function effectRequest(forge: Forge, stage: StageId, slot: BuildSlot): ImageRequest {
  const skill = forge.spec!.skills.find((s) => s.slot === slot)
  const name = forge.build!.slots[slot].name || skill?.name || slot
  return { kind: 'effect', prompt: `Hyper-realistic VFX sprite sheet for "${name}" by ${forge.spec!.heroName}: ${skill?.theme ?? ''}. ${extra(forge, stage)}`.trim(), shape: effectShape(forge.build!.slots[slot].templateId) }
}

function passiveRequest(forge: Forge): ImageRequest {
  const s = forge.spec!
  const what = s.passiveVisual === 'aura' ? `a glowing aura around ${s.heroName}` : `a body element on ${s.heroName}: ${s.passiveElement ?? 'a glowing mark'}`
  return { kind: 'effect', prompt: `Hyper-realistic VFX for a passive ability, shown as ${what}. ${extra(forge, 'ultimate')}`.trim(), shape: effectShape(forge.build!.slots.passive.templateId) }
}

/** The sheet the player picked becomes the mesh input. */
function chosenSheet(forge: Forge): string {
  const sheets = numbered(forge.stages.concept.artifacts, 'sheet')
  return sheets[pick(forge, 'concept', 'sheet')] ?? sheets[0]
}

type StepValue = { urls: string[] } | Asset

async function startStep(deps: RunnerDeps, forge: Forge, stage: StageId, name: string): Promise<Routed<StepValue>> {
  const r = deps.registry
  const image = (req: ImageRequest) => route<ImageProvider, StepValue>(r, 'image', (p) => p.generate(req))
  if (name === 'sheet') return image({ kind: 'sheet', prompt: conceptPrompt(forge), references: forge.referenceUrls })
  if (name === 'effect') return image(effectRequest(forge, stage, EFFECT_SLOT[stage]!))
  if (name === 'passive') return image(passiveRequest(forge))
  if (name === 'mesh') return route<MeshProvider, StepValue>(r, 'mesh', (p) => p.start({ imageUrl: chosenSheet(forge), quad: true, faceLimit: 20_000 }))
  if (name === 'rig') return route<RigProvider, StepValue>(r, 'rig', (p) => p.start({ modelUrl: forge.stages.mesh.artifacts.mesh, skeleton: 'mixamo' }))
  const batch = /^retarget-(\d+)$/.exec(name)
  if (batch) {
    const rigged = forge.stages.motion.steps.find((s) => s.name === 'rig')?.outputs?.rig
    return route<RetargetProvider, StepValue>(r, 'retarget', (p) => p.start({ riggedUrl: rigged!, presets: presetBatches(forge)[Number(batch[1])] }))
  }
  return { ok: false, kind: 'failed', reasons: [{ provider: '-', kind: 'failed', reason: `unknown step ${name}` }] }
}

function extension(url: string, fallback: string): string {
  if (url.startsWith('data:image/svg')) return 'svg'
  const m = /\.(png|webp|jpe?g|svg|glb|fbx)(?:[?#]|$)/i.exec(url)
  return m ? m[1].toLowerCase() : fallback
}

/** Copy every output into Blob under forge/<id>/<stage>/<attempt>/ and screen images (KTD1, KTD10). */
async function collect(deps: RunnerDeps, forge: Forge, stage: StageId, name: string, value: StepValue): Promise<{ outputs: Record<string, string> } | { breach: string }> {
  const base = `forge/${forge.id}/${stage}/${forge.stages[stage].attempt}`
  const entries: [string, string, string][] = 'urls' in value ? value.urls.map((u, i) => [`${name}-${i}`, u, extension(u, 'png')]) : [[name, value.url, value.format]]
  if ('urls' in value) {
    const breaches = await Promise.all(entries.map(([, url]) => imageBreach(deps.registry, url, forge.spec!.flags.realPerson)))
    const breach = breaches.find(Boolean)
    if (breach) return { breach }
  }
  const copied = await Promise.all(entries.map(([key, url, ext]) => deps.copy(`${base}/${key}.${ext}`, url)))
  return { outputs: Object.fromEntries(entries.map(([key], i) => [key, copied[i]])) }
}

type StepResult = Forge | 'wait'

async function settleStep(deps: RunnerDeps, forge: Forge, stage: StageId, step: StepState, outcome: Routed<StepValue>): Promise<StepResult> {
  if (outcome.ok === 'pending') {
    if (step.taskId === outcome.taskId) return 'wait'
    await saveForge(deps.db, forge.version, patchStep(forge, stage, step.name, { taskId: outcome.taskId, provider: outcome.provider }))
    return 'wait'
  }
  if (outcome.ok === true) {
    const got = await collect(deps, forge, stage, step.name, outcome.value)
    if ('outputs' in got) return (await saveForge(deps.db, forge.version, patchStep(forge, stage, step.name, { status: 'done', provider: outcome.provider, outputs: got.outputs }))) ?? 'wait'
    return failStage(deps, forge, stage, step, got.breach)
  }
  return failStage(deps, forge, stage, step, outcome.reasons.map((r) => `${r.provider}: ${r.reason}`).join('; '))
}

/** Every provider declined or failed: the stage fails, its hold is released, and the player pays nothing (F3). */
async function failStage(deps: RunnerDeps, forge: Forge, stage: StageId, step: StepState, reason: string): Promise<StepResult> {
  const failed = must(fail(patchStep(forge, stage, step.name, { status: 'failed' }), stage, reason))
  const saved = await saveForge(deps.db, forge.version, failed)
  if (saved) await settleHold(deps.db, holdRef(saved, stage), false)
  return 'wait'
}

async function runStep(deps: RunnerDeps, forge: Forge, stage: StageId, step: StepState): Promise<StepResult> {
  const now = (deps.now ?? Date.now)()
  const stale = step.status === 'running' && !step.taskId && now - (step.claimedAt ?? 0) > STEP_TIMEOUT_MS
  if (step.status === 'pending' || stale) {
    const claimed = await saveForge(deps.db, forge.version, patchStep(forge, stage, step.name, { status: 'running', claimedAt: now, taskId: undefined }))
    if (!claimed) return 'wait'
    return settleStep(deps, claimed, stage, { ...step, status: 'running', taskId: undefined }, await startStep(deps, claimed, stage, step.name))
  }
  if (step.status === 'running' && step.taskId && step.provider) {
    if (now - (step.claimedAt ?? now) > TASK_TIMEOUT_MS) return failStage(deps, forge, stage, step, `${step.provider}: the task did not finish in time`)
    const outcome = await pollTask<StepValue>(deps.registry, step.provider, (p) => (p as TaskProvider<unknown>).poll(step.taskId!))
    return settleStep(deps, forge, stage, step, outcome)
  }
  return 'wait'
}

/** Close any hold the stage left open: ready means charge it, failed means release it. Both are idempotent. */
async function reconcile(deps: RunnerDeps, forge: Forge): Promise<void> {
  if (forge.current === 'published') return
  const s = forge.stages[forge.current]
  if (!STAGE_TABLE[forge.current].paid || s.attempt === 0) return
  if (s.status === 'ready') await settleHold(deps.db, holdRef(forge, forge.current), true)
  if (s.status === 'failed') await settleHold(deps.db, holdRef(forge, forge.current), false)
}

/** Move the current stage forward as far as it can go right now. Safe to call from any number of polls. */
export async function advance(deps: RunnerDeps, forge: Forge): Promise<Forge> {
  if (forge.current === 'published' || forge.stages[forge.current].status !== 'generating') {
    // nothing to run: only close a hold a crashed request may have left open
    await reconcile(deps, forge)
    return forge
  }
  let current = forge
  for (let i = 0; i < 32; i++) {
    const stage = current.current
    if (stage === 'published' || current.stages[stage].status !== 'generating') break
    const step = current.stages[stage].steps.find((s) => s.status !== 'done')
    if (!step) {
      const steps = current.stages[stage].steps
      const artifacts = Object.assign({}, ...steps.map((s) => s.outputs ?? {})) as Record<string, string>
      const ready = await saveForge(deps.db, current.version, must(succeed(current, stage, artifacts, steps.map((s) => s.provider ?? '-'))))
      if (ready && stagePrice(stage)) await settleHold(deps.db, holdRef(ready, stage), true)
      break
    }
    const result = await runStep(deps, current, stage, step)
    if (result === 'wait') break
    current = result
  }
  const latest = await loadForge(deps.db, forge.id, forge.accountId)
  await reconcile(deps, latest)
  return latest
}
