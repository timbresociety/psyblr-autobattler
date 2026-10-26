import { composeRecipe, defaultRecipe, passiveRecipe } from '../arena/recipes/defaults.js'
import type { EffectRecipe } from '../arena/recipes/schema.js'
import { validateRecipe } from '../arena/recipes/validate.js'
import { BUILD_SLOTS, type Build } from '../charter/build.js'
import type { SizeClass } from '../charter/sizes.js'
import { getTemplate } from '../charter/templates/catalog.js'
import type { BuildSlot, Delivery } from '../charter/types.js'
import { basicMotions, motionsFor, playable, type Motion } from './motion/library.js'
import { formSize } from './form.js'
import type { Forge, SpecSheet, StageId } from './types.js'

// the names the staged Forge stored its outputs under; packages it published still carry them
const ARENA_ARTIFACT = { focus: 'arena-focus', other: 'arena-other' } as const
const ARENA_RETARGET_PREFIX = 'arena-retarget'
const EFFECT_SLOT: Partial<Record<StageId, BuildSlot>> = { active1: 'active1', active2: 'active2', ultimate: 'ultimate' }

/**
 * The hero package (KTD9, KTD13): a versioned manifest any psyblr game can load (R21, R22, R36). The rigged and
 * retargeted models are GLB; the quad FBX is kept only as an archival source. Version 2 adds the arena-ready hero,
 * an effect recipe per skill and an optional transformation form; version 1 packages are upgraded when loaded.
 */
export const PACKAGE_VERSION = 2

export interface PackageAsset {
  url: string
  format: 'glb' | 'fbx' | 'png' | 'webp' | 'svg'
}

export interface SlotPackage {
  templateId: string
  motion: { id: string; label: string; play: ReturnType<typeof playable> }
  /** Effect sprites and recipe, shaped to the mechanic (R18, R33); basic, movement and passive slots carry none here. */
  effect?: { sprites: string[]; chosen: number; shape: EffectShape; recipe?: EffectRecipe }
}

type Motions = (PackageAsset & { presets: string[] })[]

/** Version 1, as stored before the arena: no arena hero, no recipes, no form. */
export interface HeroPackageV1 {
  packageVersion: 1
  forgeId: string
  heroName: string
  spec: SpecSheet
  build: Build
  skeleton: 'mixamo'
  assets: {
    sheet: string[]
    front: string
    quadMesh: PackageAsset
    rigged: PackageAsset
    motions: Motions
  }
  slots: Record<BuildSlot, SlotPackage>
  passive: { visual: 'aura' | 'body-element'; element?: string; sprites: string[] }
}

export interface HeroPackage extends Omit<HeroPackageV1, 'packageVersion' | 'assets' | 'passive'> {
  packageVersion: typeof PACKAGE_VERSION
  assets: HeroPackageV1['assets'] & {
    /** The arena-ready hero (R24, R35): 2K for heroes in focus, 1K for the rest, and its own motions. */
    arena: { focus: PackageAsset; other: PackageAsset; motions: Motions }
  }
  passive: HeroPackageV1['passive'] & { recipe: EffectRecipe }
  /** The transformation's form (R22, R34), shown at the size class its ultimate reaches (KTD14). */
  form?: { mesh: PackageAsset; sizeClass: SizeClass }
}

export type EffectShape = { delivery: string; range: number; radius?: number }

/** The shape an effect's art must match: the template's delivery, range and radius (R18). */
export function effectShape(templateId: string): EffectShape {
  const { kind, range, radius } = getTemplate(templateId).delivery
  return { delivery: kind, range, ...(radius !== undefined ? { radius } : {}) }
}

/** The option a player picked on a stage (`choice[key]`), 0 when unset or invalid. */
export const pick = (forge: Forge, stage: StageId, key: string): number => {
  const value = Number((forge.stages[stage].inputs.choice as Record<string, unknown> | undefined)?.[key] ?? 0)
  return Number.isInteger(value) && value >= 0 ? value : 0
}

/** Artifacts named `<prefix>-0`, `<prefix>-1`, … in index order. */
export const numbered = (artifacts: Record<string, string>, prefix: string) =>
  Object.keys(artifacts)
    .filter((k) => k.startsWith(`${prefix}-`) && /^\d+$/.test(k.slice(prefix.length + 1)))
    .sort((a, b) => Number(a.slice(prefix.length + 1)) - Number(b.slice(prefix.length + 1)))
    .map((k) => artifacts[k])

const format = (url: string, fallback: PackageAsset['format']): PackageAsset['format'] => {
  const m = /\.(glb|fbx|png|webp|svg)(?:[?#]|$)/i.exec(url)
  return m ? (m[1].toLowerCase() as PackageAsset['format']) : url.startsWith('data:image/svg') ? 'svg' : fallback
}

/** The stage that generates a slot's effect, if it has one. */
const effectStage = (slot: BuildSlot): StageId | undefined => (Object.keys(EFFECT_SLOT) as StageId[]).find((stage) => EFFECT_SLOT[stage] === slot)

/** The motion variants each slot offers at its confirm (R17). */
export function motionOptions(forge: Pick<Forge, 'build' | 'spec'>, slot: BuildSlot): Motion[] {
  if (slot === 'basic') return basicMotions(forge.spec!.basicStyle)
  return motionsFor(getTemplate(forge.build!.slots[slot].templateId))
}


/** A motion stage approved before the arena hero existed: it has only the archival rig and motions. */
export const isLegacyMotion = (forge: Forge) => !forge.stages.motion.artifacts[ARENA_ARTIFACT.focus]

/** Assemble the manifest from an approved forge. `presetBatches` are the retarget calls, in step order. */
export function buildPackage(forge: Forge, build: Build, presetBatches: string[][]): HeroPackage {
  const spec = forge.spec!
  const concept = forge.stages.concept.artifacts
  const sheet = numbered(concept, 'sheet')
  const motion = forge.stages.motion.artifacts
  const slots = {} as Record<BuildSlot, SlotPackage>
  for (const slot of BUILD_SLOTS) {
    const stage = effectStage(slot)
    const options = motionOptions(forge, slot)
    const chosen = options[stage ? pick(forge, stage, 'motion') : slot === 'basic' ? pick(forge, 'motion', 'basic') : 0] ?? options[0]
    const entry: SlotPackage = { templateId: build.slots[slot].templateId, motion: { id: chosen.id, label: chosen.label, play: playable(chosen) } }
    if (stage) {
      const record = forge.stages[stage].inputs.effect as { shape: EffectShape; recipe?: EffectRecipe } | undefined
      const shape = record?.shape ?? effectShape(build.slots[slot].templateId)
      entry.effect = { sprites: numbered(forge.stages[stage].artifacts, 'effect'), chosen: pick(forge, stage, 'effect'), shape, recipe: record?.recipe ?? composeRecipe(shape.delivery as Delivery['kind']) }
    }
    slots[slot] = entry
  }
  const passiveRecord = forge.stages.ultimate.inputs.passive as { recipe?: EffectRecipe } | undefined
  const form = forge.stages.form
  const formMesh = form && !form.inputs.skipped ? form.artifacts['form-mesh'] : undefined
  const size = formSize(build)
  const arenaMotions = numbered(motion, ARENA_RETARGET_PREFIX)
  const rigged = { url: motion.rig, format: format(motion.rig ?? '', 'glb') }
  const archival = presetBatches.map((presets, i) => ({ url: motion[`retarget-${i}`], format: format(motion[`retarget-${i}`] ?? '', 'glb'), presets }))
  return {
    packageVersion: PACKAGE_VERSION,
    forgeId: forge.id,
    heroName: spec.heroName,
    spec,
    build,
    skeleton: 'mixamo',
    assets: {
      sheet,
      front: sheet[pick(forge, 'concept', 'sheet')] ?? sheet[0],
      quadMesh: { url: forge.stages.mesh.artifacts.mesh, format: 'fbx' },
      rigged,
      motions: archival,
      // a legacy forge fights with its rigged model, as an upgraded version 1 package does
      arena: isLegacyMotion(forge)
        ? { focus: rigged, other: rigged, motions: archival }
        : {
            focus: { url: motion[ARENA_ARTIFACT.focus], format: 'glb' },
            other: { url: motion[ARENA_ARTIFACT.other], format: 'glb' },
            motions: presetBatches.map((presets, i) => ({ url: arenaMotions[i], format: 'glb' as const, presets })),
          },
    },
    slots,
    passive: {
      visual: spec.passiveVisual,
      ...(spec.passiveElement ? { element: spec.passiveElement } : {}),
      sprites: numbered(forge.stages.ultimate.artifacts, 'passive'),
      recipe: passiveRecord?.recipe ?? passiveRecipe(spec.passiveVisual),
    },
    ...(formMesh && size ? { form: { mesh: { url: formMesh, format: format(formMesh, 'glb') }, sizeClass: size } } : {}),
  }
}

/**
 * Any stored package as version 2 (KTD13, AE7). A version 1 hero fights with its rigged model as its arena hero,
 * the default recipe for each skill's delivery, and no form.
 */
export function upgradePackage(raw: HeroPackageV1 | HeroPackage): HeroPackage {
  if (raw.packageVersion === PACKAGE_VERSION) return raw as HeroPackage
  const v1 = raw as HeroPackageV1
  // a damaged stored package still loads; validatePackage reports what it lacks
  const slots = Object.fromEntries(
    BUILD_SLOTS.map((slot) => {
      const s = v1.slots?.[slot]
      return [slot, s?.effect ? { ...s, effect: { ...s.effect, recipe: s.effect.recipe ?? defaultRecipe(getTemplate(s.templateId).delivery.kind) } } : s]
    }),
  ) as HeroPackage['slots']
  const assets = v1.assets ?? ({} as HeroPackageV1['assets'])
  return {
    ...v1,
    packageVersion: PACKAGE_VERSION,
    assets: { ...assets, arena: { focus: assets.rigged, other: assets.rigged, motions: assets.motions ?? [] } },
    slots,
    passive: { ...v1.passive, recipe: passiveRecipe(v1.passive?.visual === 'body-element' ? 'body-element' : 'aura') },
  }
}

/** Everything a game needs, present and well-formed; returns the problems found (empty when valid). */
export function validatePackage(pkg: HeroPackage, isAllowedUrl: (url: string) => boolean = () => true): string[] {
  const problems: string[] = []
  const url = (label: string, value: string | undefined) => {
    if (!value) problems.push(`missing ${label}`)
    else if (!isAllowedUrl(value)) problems.push(`${label} is not a forge asset`)
  }
  if (pkg.packageVersion !== PACKAGE_VERSION) problems.push('wrong package version')
  const arena = pkg.assets.arena
  if (!arena) problems.push('missing arena hero')
  else {
    url('arena hero', arena.focus?.url)
    url('arena hero (1K)', arena.other?.url)
    if (arena.focus?.format !== 'glb' || arena.other?.format !== 'glb') problems.push('arena hero must be GLB')
    arena.motions.forEach((m, i) => url(`arena motion batch ${i}`, m.url))
  }
  if (pkg.passive.recipe && validateRecipe(pkg.passive.recipe).length) problems.push('passive recipe is invalid')
  if (pkg.form) {
    url('form mesh', pkg.form.mesh.url)
    if (pkg.form.sizeClass !== formSize(pkg.build)) problems.push("form size does not match the ultimate's transformation")
  }
  if (pkg.skeleton !== 'mixamo') problems.push('unknown skeleton')
  if (!pkg.assets.sheet.length) problems.push('missing sheet')
  pkg.assets.sheet.forEach((s, i) => url(`sheet ${i}`, s))
  url('front', pkg.assets.front)
  url('quad mesh', pkg.assets.quadMesh.url)
  url('rigged model', pkg.assets.rigged.url)
  if (pkg.assets.rigged.format !== 'glb') problems.push('rigged model must be GLB')
  if (!pkg.assets.motions.length) problems.push('missing motions')
  pkg.assets.motions.forEach((m, i) => url(`motion batch ${i}`, m.url))
  for (const slot of BUILD_SLOTS) {
    const s = pkg.slots[slot]
    if (!s?.motion) problems.push(`missing ${slot} motion`)
    if (effectStage(slot) && !s?.effect?.sprites.length) problems.push(`missing ${slot} effect`)
    s?.effect?.sprites.forEach((e, i) => url(`${slot} effect ${i}`, e))
    if (effectStage(slot) && (!s?.effect?.recipe || validateRecipe(s.effect.recipe).length)) problems.push(`${slot} recipe is missing or invalid`)
  }
  if (pkg.passive.visual !== 'aura' && pkg.passive.visual !== 'body-element') problems.push('passive visual must be an aura or a body element')
  if (!pkg.passive.sprites.length) problems.push('missing passive visual')
  pkg.passive.sprites.forEach((p, i) => url(`passive ${i}`, p))
  return problems
}
