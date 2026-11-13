import { AnimationClip, Quaternion, QuaternionKeyframeTrack, VectorKeyframeTrack, type KeyframeTrack } from 'three'

/**
 * Dynamic retargeting for varying proportions (GAME.md §9.6, playback). A clip is rotations: each bone's turn from the
 * source's rest. On a character those turns go onto the character's own rest (its own bone lengths, its posture), so
 * one clip plays on a Conan-sized body and a Broly-sized one alike. Only the hips (and Root) carry translation, and
 * that is scaled by the leg-length ratio, so feet neither float nor sink and a lunge covers ground in proportion: the
 * character's thigh and shin over the source's where both are known, else its standing hip height over the source's.
 * Hip height overshoots on a body whose hip joints sit high above its legs, which drops too far whenever its knees
 * bend (clip audit, 2026-11-05, fault 1: the caster went from 6 clips over 8 cm under the floor to 1 on leg length).
 */

export interface RetargetSource {
  /** The bones the clip keys, and each one's local rotation at the source's rest, in the same order. */
  bones: readonly string[]
  rest: readonly (readonly number[])[]
  /** The source's hips at rest (its standing hip height is [1]). */
  hips: readonly number[]
  /** The source's thigh and shin, hip joint to knee to ankle, in the hips' units. */
  legs?: number
}

export interface RetargetTarget {
  /** Each bone's local rotation at the character's rest, posture included. */
  rest: ReadonlyMap<string, Quaternion>
  /** The character's hips where they stand at rest, its legs' own length included. */
  hips: readonly number[]
  /** The character's thigh and shin, hip joint to knee to ankle, in the hips' units. */
  legs?: number
}

/** The leg-length ratio: how much longer the character's legs are than the source's, or failing that how much higher its hips stand. */
export const legRatio = (src: RetargetSource, tgt: RetargetTarget) => (src.legs && tgt.legs ? tgt.legs / src.legs : tgt.hips[1] / src.hips[1])

/** The clip on the character. Tracks for bones it doesn't know are kept as they are; the result's userData.legRatio says how it scaled. */
export function retargetClip(clip: AnimationClip, src: RetargetSource, tgt: RetargetTarget): AnimationClip {
  const scale = legRatio(src, tgt)
  const hipsBone = src.bones[0]
  const q = new Quaternion()
  const fix = new Quaternion()
  const tracks: KeyframeTrack[] = clip.tracks.map((track) => {
    const dot = track.name.lastIndexOf('.')
    const bone = track.name.slice(0, dot)
    const prop = track.name.slice(dot + 1)
    if (prop === 'quaternion') {
      const k = src.bones.indexOf(bone)
      const own = tgt.rest.get(bone)
      if (k < 0 || !own) return track
      // own rest · source rest⁻¹: the same turn from rest, on the character's own rest
      fix.copy(own).multiply(q.fromArray(src.rest[k] as number[]).invert())
      const values = Float32Array.from(track.values)
      for (let i = 0; i < values.length; i += 4) q.fromArray(values, i).premultiply(fix).normalize().toArray(values, i)
      return new QuaternionKeyframeTrack(track.name, Array.from(track.times), Array.from(values))
    }
    if (prop === 'position' && (bone === hipsBone || bone === 'Root')) {
      const values = Float32Array.from(track.values)
      const base = bone === 'Root' ? [0, 0, 0] : src.hips
      const to = bone === 'Root' ? [0, 0, 0] : tgt.hips
      for (let i = 0; i < values.length; i += 3) for (let c = 0; c < 3; c++) values[i + c] = to[c] + (values[i + c] - base[c]) * scale
      return new VectorKeyframeTrack(track.name, Array.from(track.times), Array.from(values))
    }
    return track
  })
  const out = new AnimationClip(clip.name, clip.duration, tracks)
  out.userData = { ...clip.userData, legRatio: scale }
  return out
}
