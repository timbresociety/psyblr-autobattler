import { BUILD_SLOTS, type Build } from '../charter/build'
import { getTemplate } from '../charter/templates/catalog'
import type { BuildSlot } from '../charter/types'
import { basicMotions, motionsFor, playable, type Motion } from './motion/library'
import { EFFECT_SLOT } from './stages'
import type { Forge, SpecSheet, StageId } from './types'

/**
 * The hero package (KTD9): a versioned manifest any psyblr game can load (R21, R22). The rigged and retargeted
 * models are GLB; the quad FBX is kept only as an archival source.
 */
export const PACKAGE_VERSION = 1

export interface PackageAsset {
  url: string
  format: 'glb' | 'fbx' | 'png' | 'webp' | 'svg'
}

export interface SlotPackage {
  templateId: string
  motion: { id: string; label: string; play: ReturnType<typeof playable> }
  /** Effect sprites, shaped to the mechanic (R18); basic, movement and passive slots carry none here. */
  effect?: { sprites: string[]; chosen: number; shape: EffectShape }
}

export interface HeroPackage {
  packageVersion: typeof PACKAGE_VERSION
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
    motions: (PackageAsset & { presets: string[] })[]
  }
  slots: Record<BuildSlot, SlotPackage>
  passive: { visual: 'aura' | 'body-element'; element?: string; sprites: string[] }
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
      const record = forge.stages[stage].inputs.effect as { shape: EffectShape } | undefined
      entry.effect = { sprites: numbered(forge.stages[stage].artifacts, 'effect'), chosen: pick(forge, stage, 'effect'), shape: record?.shape ?? effectShape(build.slots[slot].templateId) }
    }
    slots[slot] = entry
  }
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
      rigged: { url: motion.rig, format: format(motion.rig ?? '', 'glb') },
      motions: presetBatches.map((presets, i) => ({ url: motion[`retarget-${i}`], format: format(motion[`retarget-${i}`] ?? '', 'glb'), presets })),
    },
    slots,
    passive: { visual: spec.passiveVisual, ...(spec.passiveElement ? { element: spec.passiveElement } : {}), sprites: numbered(forge.stages.ultimate.artifacts, 'passive') },
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
  }
  if (pkg.passive.visual !== 'aura' && pkg.passive.visual !== 'body-element') problems.push('passive visual must be an aura or a body element')
  if (!pkg.passive.sprites.length) problems.push('missing passive visual')
  pkg.passive.sprites.forEach((p, i) => url(`passive ${i}`, p))
  return problems
}
