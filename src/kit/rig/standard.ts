import standard from './standard.json' with { type: 'json' }

/**
 * The Psyblr Human rig: the one skeleton every body, clip, garment and piece targets (docs/plans/2026-10-31-canon-
 * psyblr-human.md, phase 0). Bones carry Mixamo's names, so Ready Player Me, Mixamo and Tripo's auto-rig retarget
 * by name, with twist bones on each limb segment, full fingers, a jaw and two eyes on top. The face animates by the
 * 52 ARKit blendshapes. `standard.json` is the source of truth; the Blender pipeline reads the same file.
 *
 * Kinds: `core` is the hips, spine, neck and head; `arm` and `leg` the limb segments clips key; `finger` the three
 * keyed joints of each digit; `twist` a helper that clips never key, since the runtime turns it part way between its
 * parent and the bone it follows; `face` the jaw and eyes; `end` a tip with no weights, kept so lengths are known.
 */

export type BoneKind = 'core' | 'arm' | 'leg' | 'finger' | 'twist' | 'face' | 'end'

export interface StandardBone {
  name: string
  parent: string | null
  kind: BoneKind
  /** The name the 20-bone rig and today's clips use for this bone (public/anim/index.json). */
  legacy?: string
  /** For a twist bone: the child segment whose roll it shares. */
  follows?: string
}

export const STANDARD_BONES: readonly StandardBone[] = standard.bones as StandardBone[]
export const BONE_NAMES: readonly string[] = STANDARD_BONES.map((b) => b.name)
export const BLENDSHAPES: readonly string[] = standard.blendshapes

const byName = new Map(STANDARD_BONES.map((b) => [b.name, b]))

export function bone(name: string): StandardBone | undefined {
  return byName.get(name)
}

export function parentOf(name: string): string | null {
  return byName.get(name)?.parent ?? null
}

/** The bones clips key: everything but twists and ends. */
export const KEYED_BONES: readonly string[] = STANDARD_BONES.filter((b) => b.kind !== 'twist' && b.kind !== 'end').map((b) => b.name)

/** The 20-bone rig's name for a standard bone, and back. */
export const LEGACY_TO_STANDARD: Readonly<Record<string, string>> = Object.fromEntries(STANDARD_BONES.filter((b) => b.legacy).map((b) => [b.legacy as string, b.name]))
export const STANDARD_TO_LEGACY: Readonly<Record<string, string>> = Object.fromEntries(STANDARD_BONES.filter((b) => b.legacy).map((b) => [b.name, b.legacy as string]))

/** The same bone on the other side, or the bone itself down the middle. */
export function mirrored(name: string): string {
  if (name.startsWith('Left')) return 'Right' + name.slice(4)
  if (name.startsWith('Right')) return 'Left' + name.slice(5)
  return name
}

/** The chain from the hips down to a bone, hips first. */
export function chainTo(name: string): string[] {
  const out: string[] = []
  for (let b: string | null = name; b; b = parentOf(b)) out.unshift(b)
  return out
}
