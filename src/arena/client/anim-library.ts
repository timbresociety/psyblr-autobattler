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
  /** An attitude's bent legs (metarig/attitude.ts), which every clip fitted to this rest is grounded for. */
  ground?: Ground
  /**
   * The rest without the attitude's turns, for the moves down at the floor (a clip's `userData.plain`): a lean or a
   * hunch on a landing's crouch, a roll or a slide puts the hands and head through the floor.
   */
  plain?: RestPose
}

/** The chain from the hips down each leg to the toes' tip, in order. */
const LEG_CHAIN = ['UpLeg', 'Leg', 'Foot', 'ToeBase', 'Toe_End']

export interface Ground {
  /** The hips' bone, and each leg bone's local offset and scale (the chain, both sides). */
  hips: string
  bones: Map<string, { position: THREE.Vector3; scale: THREE.Vector3 }>
  /** Each bone's turn the attitude put in front of its rest rotation (the legs' are the ones that count here). */
  turns: Map<string, THREE.Quaternion>
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
  const rest: RestPose = { rotations, hips: hips.position.clone().add(new THREE.Vector3(0, drop, 0)) }
  const given = model.userData.attitudeTurns as Record<string, number[]> | undefined
  if (given) {
    const bones = new Map<string, { position: THREE.Vector3; scale: THREE.Vector3 }>()
    bones.set(hips.name, { position: new THREE.Vector3(), scale: hips.scale.clone() })
    for (const side of ['Left', 'Right']) {
      for (const part of LEG_CHAIN) {
        const bone = model.getObjectByName(side + part)
        if (bone) bones.set(bone.name, { position: bone.position.clone(), scale: bone.scale.clone() })
      }
    }
    const turns = new Map(Object.entries(given).map(([name, q]) => [name, new THREE.Quaternion().fromArray(q)]))
    rest.ground = { hips: hips.name, bones, turns }
    const plain = new Map([...rotations].map(([name, q]) => [name, turns.has(name) ? q.clone().premultiply(turns.get(name)!.clone().invert()) : q]))
    rest.plain = { rotations: plain, hips: rest.hips }
  }
  mine.set(key, rest)
  return rest
}

/**
 * A clip kept on the floor under an attitude's bent legs: at each of the hips' keys, how much higher the lowest point
 * of the feet sits under the hips with the attitude's leg turns than without them, taken off the hips. A bent knee
 * lifts the foot more the more the clip already bends it, so this is per frame, not one drop at rest; the clip's own
 * contact with the floor (and its hips' travel, scaled by the straight legs) is what it had.
 */
export function groundClip(clip: THREE.AnimationClip, ground: Ground): THREE.AnimationClip {
  const position = clip.tracks.find((t) => t.name === `${ground.hips}.position`)
  if (!position) return clip
  const sampled = new Map<string, THREE.Interpolant>()
  for (const t of clip.tracks) {
    const name = t.name.slice(0, t.name.lastIndexOf('.'))
    if (t.name.endsWith('.quaternion') && ground.bones.has(name)) sampled.set(name, new THREE.QuaternionLinearInterpolant(t.times, t.values, 4, new Float32Array(4)))
  }
  const m = new THREE.Matrix4()
  const local = new THREE.Matrix4()
  const q = new THREE.Quaternion()
  const at = new THREE.Vector3()
  const lowest = (time: number, bent: boolean) => {
    let low = Infinity
    for (const side of ['Left', 'Right']) {
      m.identity()
      for (const name of [ground.hips, ...LEG_CHAIN.map((p) => side + p)]) {
        const bone = ground.bones.get(name)
        if (!bone) break
        const keyed = sampled.get(name)
        if (keyed) q.fromArray(keyed.evaluate(time) as Float32Array)
        else q.identity()
        const turn = ground.turns.get(name)
        // the clip's keys carry the turn (own rest first); without it is the turn taken back off the front
        if (turn && !bent) q.premultiply(turn.clone().invert())
        m.multiply(local.compose(bone.position, q, bone.scale))
        if (name !== ground.hips) low = Math.min(low, at.setFromMatrixPosition(m).y)
      }
    }
    return low
  }
  const values = Float32Array.from(position.values)
  for (let i = 0; i < position.times.length; i++) {
    const time = position.times[i]
    values[i * 3 + 1] -= lowest(time, true) - lowest(time, false)
  }
  const tracks = clip.tracks.map((t) => (t === position ? new THREE.VectorKeyframeTrack(t.name, Array.from(t.times), Array.from(values)) : t))
  const out = new THREE.AnimationClip(clip.name, clip.duration, tracks)
  out.userData = { ...clip.userData }
  return out
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
  if (clip.userData.plain && rest.plain) rest = rest.plain
  let mine = fitted.get(clip)
  if (!mine) fitted.set(clip, (mine = new WeakMap()))
  const done = mine.get(rest)
  if (done) return done
  const ref = idx.genders[gender]
  if (!ref) throw new Error(`${body}: no ${gender} clips`)
  const fit = retargetClip(clip, { bones: idx.bones, rest: ref.rest, hips: ref.hips }, { rest: rest.rotations, hips: rest.hips.toArray() })
  const out = rest.ground ? groundClip(fit, rest.ground) : fit
  mine.set(rest, out)
  return out
}
