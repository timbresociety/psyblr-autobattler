import * as THREE from 'three'
import type { Gender } from '../../charter/look.js'
import { animFolder, animIndex, animIndexNow, setOf, type AnimIndex } from './anim-index.js'
import type { RigKind } from './rig.js'
import { retargetClip } from '../../kit/rig/retarget.js'

/**
 * Motion-captured clips from Ready Player Me's animation library, retargeted onto the heroes' rig by
 * scripts/rpm-anim.ts (public/anim): idles, walks, jogs and runs in four directions, crouches, jumps, dances, talking
 * and gestures, for each gender. A clip is fitted to its gender's medium body; `fitClip` gives a body of another size
 * each bone's change from rest instead, so that body's own rest (a big body's arms held wider) stays under the motion.
 */

export { ANIM_SETS, animFolder, animIndex, setOf, type AnimIndex, type AnimSet } from './anim-index.js'

export interface ClipFile {
  frames: number
  from: string
  rot: number[]
  pos: number[]
}

const clips = new Map<string, Promise<THREE.AnimationClip | undefined>>()

/** One clip, fitted to the gender's medium body on `rig`, fetched once; undefined when the library hasn't got it. */
export function animClip(gender: Gender, name: string, rig: RigKind = 'legacy'): Promise<THREE.AnimationClip | undefined> {
  const key = `${rig}/${gender}/${name}`
  let clip = clips.get(key)
  if (!clip) {
    clip = animIndex(rig).then(async (idx) => {
      if (!idx || !setOf(idx, gender, name)) return undefined
      const r = await fetch(`${animFolder(rig)}/${gender}/${name}.json`)
      if (!r.ok) throw new Error(`${key}: ${r.status}`)
      return toClip(name, (await r.json()) as ClipFile, idx)
    })
    clip.catch(() => clips.delete(key))
    clips.set(key, clip)
  }
  return clip
}

/** Track-major frame-to-frame changes back to frame-major values. */
export function undelta(deltas: number[], frames: number, width: number, scale: number): Float32Array {
  const tracks = deltas.length / (frames * width)
  const out = new Float32Array(deltas.length)
  let at = 0
  for (let k = 0; k < tracks; k++)
    for (let c = 0; c < width; c++) {
      let v = 0
      for (let f = 0; f < frames; f++) {
        v += deltas[at++]
        out[(f * tracks + k) * width + c] = v / scale
      }
    }
  return out
}

/** A clip file as a three.js clip on the gender's medium body (the library's own decoding, for tools and the bench too). */
export function toClip(name: string, file: ClipFile, idx: AnimIndex): THREE.AnimationClip {
  const { frames } = file
  const bones = idx.bones
  const rot = undelta(file.rot, frames, 4, idx.rot)
  const pos = undelta(file.pos, frames, 3, idx.pos)
  const times = Float32Array.from({ length: frames }, (_, f) => f / idx.fps)
  const q = new THREE.Quaternion()
  const tracks: THREE.KeyframeTrack[] = bones.map((bone, k) => {
    const values = new Float32Array(frames * 4)
    for (let f = 0; f < frames; f++) q.fromArray(rot, (f * bones.length + k) * 4).normalize().toArray(values, f * 4)
    return new THREE.QuaternionKeyframeTrack(`${bone}.quaternion`, times, values)
  })
  tracks.push(new THREE.VectorKeyframeTrack(`${bones[0]}.position`, times, pos))
  return new THREE.AnimationClip(name, (frames - 1) / idx.fps, tracks)
}

/** A body's rest: each rig bone's local rotation, and the hips' position, read off a model before it is animated. */
export interface RestPose {
  rotations: Map<string, THREE.Quaternion>
  /** Where the hips stand at rest: the file's, raised by however much longer its proportions made the legs. */
  hips: THREE.Vector3
}

const rests = new WeakMap<THREE.Object3D, Map<string, RestPose>>()

/**
 * A model's rest, read once per model: pass a hero's own dressed clone, so its proportions and posture (put on its
 * rest pose at dressing) are what its clips play over (GAME.md §9.6).
 */
export function restPose(model: THREE.Object3D, bones: readonly string[]): RestPose | undefined {
  const key = bones.join()
  let mine = rests.get(model)
  if (!mine) rests.set(model, (mine = new Map()))
  const known = mine.get(key)
  if (known) return known
  const rotations = new Map<string, THREE.Quaternion>()
  for (const name of bones) {
    const bone = model.getObjectByName(name)
    if (!bone) return undefined
    rotations.set(name, bone.quaternion.clone())
  }
  // the index lists the hips first
  const hips = model.getObjectByName(bones[0])
  if (!hips) return undefined
  let drop = 0
  model.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh && typeof o.userData.legDrop === 'number') drop = Math.max(drop, o.userData.legDrop)
  })
  const rest = { rotations, hips: hips.position.clone().add(new THREE.Vector3(0, drop, 0)) }
  mine.set(key, rest)
  return rest
}

const fitted = new WeakMap<THREE.AnimationClip, WeakMap<RestPose, THREE.AnimationClip>>()

/**
 * A clip on one body (src/kit/rig/retarget.ts): each bone's turn from the gender's reference rest put on this body's
 * own rest, and the hips' travel scaled by its leg-length ratio. Cached per clip and rest pose. `body` names the body
 * for messages only.
 */
export function fitClip(clip: THREE.AnimationClip, gender: Gender, body: string, rest: RestPose, rig: RigKind = 'legacy'): THREE.AnimationClip {
  const idx = animIndexNow(rig)
  if (!idx) return clip
  let mine = fitted.get(clip)
  if (!mine) fitted.set(clip, (mine = new WeakMap()))
  const done = mine.get(rest)
  if (done) return done
  const ref = idx.genders[gender]
  if (!ref) throw new Error(`${body}: no ${gender} clips`)
  const out = retargetClip(clip, { bones: idx.bones, rest: ref.rest, hips: ref.hips }, { rest: rest.rotations, hips: rest.hips.toArray() })
  mine.set(rest, out)
  return out
}
