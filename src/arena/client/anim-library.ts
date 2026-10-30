import * as THREE from 'three'
import type { Gender } from '../../charter/look.js'
import { animIndex, animIndexNow, setOf, type AnimIndex } from './anim-index.js'

/**
 * Motion-captured clips from Ready Player Me's animation library, retargeted onto the heroes' rig by
 * scripts/rpm-anim.ts (public/anim): idles, walks, jogs and runs in four directions, crouches, jumps, dances, talking
 * and gestures, for each gender. A clip is fitted to its gender's medium body; `fitClip` gives a body of another size
 * each bone's change from rest instead, so that body's own rest (a big body's arms held wider) stays under the motion.
 */

export { ANIM_SETS, animIndex, setOf, type AnimIndex, type AnimSet } from './anim-index.js'

interface ClipFile {
  frames: number
  from: string
  rot: number[]
  pos: number[]
}

const clips = new Map<string, Promise<THREE.AnimationClip | undefined>>()

/** One clip, fitted to the gender's medium body, fetched once; undefined when the library hasn't got it. */
export function animClip(gender: Gender, name: string): Promise<THREE.AnimationClip | undefined> {
  const key = `${gender}/${name}`
  let clip = clips.get(key)
  if (!clip) {
    clip = animIndex().then(async (idx) => {
      if (!idx || !setOf(idx, gender, name)) return undefined
      const r = await fetch(`/anim/${key}.json`)
      if (!r.ok) throw new Error(`${key}: ${r.status}`)
      return toClip(name, (await r.json()) as ClipFile, idx)
    })
    clip.catch(() => clips.delete(key))
    clips.set(key, clip)
  }
  return clip
}

/** Track-major frame-to-frame changes back to frame-major values. */
function undelta(deltas: number[], frames: number, width: number, scale: number): Float32Array {
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

function toClip(name: string, file: ClipFile, idx: AnimIndex): THREE.AnimationClip {
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
  tracks.push(new THREE.VectorKeyframeTrack('hips.position', times, pos))
  return new THREE.AnimationClip(name, (frames - 1) / idx.fps, tracks)
}

/** A body's rest: each rig bone's local rotation, and the hips' position, read off a model before it is animated. */
export interface RestPose {
  rotations: Map<string, THREE.Quaternion>
  hips: THREE.Vector3
}

export function restPose(model: THREE.Object3D, bones: readonly string[]): RestPose | undefined {
  const rotations = new Map<string, THREE.Quaternion>()
  for (const name of bones) {
    const bone = model.getObjectByName(name)
    if (!bone) return undefined
    rotations.set(name, bone.quaternion.clone())
  }
  const hips = model.getObjectByName('hips')
  return hips ? { rotations, hips: hips.position.clone() } : undefined
}

const fitted = new WeakMap<THREE.AnimationClip, Map<string, THREE.AnimationClip>>()

/**
 * A clip for one body: each bone's change from the medium body's rest put on this body's rest, and the hips' travel
 * scaled to its height. Cached per clip and `body` (its file's name); the medium body takes the clip as it is.
 */
export function fitClip(clip: THREE.AnimationClip, gender: Gender, body: string, rest: RestPose): THREE.AnimationClip {
  const idx = animIndexNow()
  if (!idx || body === `${gender}-medium`) return clip
  let mine = fitted.get(clip)
  if (!mine) fitted.set(clip, (mine = new Map()))
  const done = mine.get(body)
  if (done) return done
  const ref = idx.genders[gender]
  const refHips = new THREE.Vector3().fromArray(ref.hips)
  const scale = rest.hips.y / refHips.y
  const q = new THREE.Quaternion()
  const tracks = clip.tracks.map((track) => {
    const [bone, prop] = track.name.split('.')
    const values = Float32Array.from(track.values)
    if (prop === 'quaternion') {
      const k = idx.bones.indexOf(bone)
      const own = rest.rotations.get(bone)
      if (k < 0 || !own) return track
      // this body's rest times the reference's inverse: the same change from rest, on this body's own rest
      const fix = own.clone().multiply(new THREE.Quaternion().fromArray(ref.rest[k]).invert())
      for (let i = 0; i < values.length; i += 4) q.fromArray(values, i).premultiply(fix).normalize().toArray(values, i)
      return new THREE.QuaternionKeyframeTrack(track.name, track.times, values)
    }
    if (track.name === 'hips.position') {
      for (let i = 0; i < values.length; i += 3) {
        values[i] = rest.hips.x + (values[i] - refHips.x) * scale
        values[i + 1] = rest.hips.y + (values[i + 1] - refHips.y) * scale
        values[i + 2] = rest.hips.z + (values[i + 2] - refHips.z) * scale
      }
      return new THREE.VectorKeyframeTrack(track.name, track.times, values)
    }
    return track
  })
  const out = new THREE.AnimationClip(clip.name, clip.duration, tracks)
  mine.set(body, out)
  return out
}
