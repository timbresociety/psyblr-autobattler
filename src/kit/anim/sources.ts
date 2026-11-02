import SOURCES_JSON from './sources.json' with { type: 'json' }

/**
 * The motion sources' bone-name maps onto Mixamo's names (GAME.md §12), shared with tools/blender/mixamo.py through
 * sources.json: the converter renames a source's bones by its map, and the baker then reads every source as it reads
 * Mixamo. Each source records which licence its clips carry (scripts/rpm-anim.ts LICENCES).
 */
export interface SourceMap {
  format: 'fbx' | 'glb' | 'bvh'
  licence: string
  /**
   * A noisy source (CMU's conversions): a clip past a joint limit by more than `gate` degrees is left out of the
   * library, and its clips don't set the limits (scripts/joint-ranges.ts). Every clip is clamped to them in the bake.
   */
  gate?: number
  /** `lacks`: core bones the source's rig doesn't have (the CMU Poser rig's middle spine and toes), left at rest. */
  variants: { when?: string; lacks?: string[]; map: Record<string, string> }[]
}

export const SOURCES = SOURCES_JSON.sources as unknown as Record<string, SourceMap>

/** The bones every clip must drive for the baker to place a body: the trunk, the head, the arms and the legs. */
export const CORE_BONES = [
  'Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head',
  ...['Left', 'Right'].flatMap((s) => [`${s}Shoulder`, `${s}Arm`, `${s}ForeArm`, `${s}Hand`, `${s}UpLeg`, `${s}Leg`, `${s}Foot`, `${s}ToeBase`]),
]

/** The map for a file with these bones: its source's first variant whose `when` bone it has (an empty map keeps names). */
export function mapFor(source: string, bones: readonly string[]): Record<string, string> | undefined {
  const s = SOURCES[source]
  if (!s) return undefined
  return s.variants.find((v) => !v.when || bones.includes(v.when))?.map
}
