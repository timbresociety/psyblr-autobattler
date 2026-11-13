import * as THREE from 'three'
import type { Gender } from '../../charter/look.js'
import { animFolder, animIndex, animIndexNow, setOf, type AnimIndex } from './anim-index.js'
import type { HeadReach } from './feet.js'
import type { RigKind } from './rig.js'
import { retargetClip } from '../../kit/rig/retarget.js'
import { CLIP_LEGS, CLIP_TRIMS, CLIP_TURNS } from '../../kit/anim/trims.js'
import { RIGS } from './rig.js'
import { derived } from './clip-source.js'

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
      const own = turnedBack(trimmed(toClip(name, (await r.json()) as ClipFile, idx)))
      const under = CLIP_LEGS[name]
      const legs = under ? await animClip(gender, under, rig) : undefined
      return legs ? onLegs(own, legs, RIGS[rig].legBones) : own
    })
    clip.catch(() => clips.delete(key))
    clips.set(key, clip)
  }
  return clip
}

/** `clip` cut to the part of it that plays (kit/anim/trims.ts), at its own pace; the whole clip when it has no trim. */
export function trimmed(clip: THREE.AnimationClip): THREE.AnimationClip {
  const trim = CLIP_TRIMS[clip.name]
  if (!trim) return clip
  const from = trim[0]
  const to = Math.min(trim[1] ?? clip.duration, clip.duration)
  const tracks = clip.tracks.map((track) => {
    const width = track.getValueSize()
    // the keys inside the window, with the window's own ends sampled so the cut starts and ends exactly there
    const inside = Array.from(track.times).filter((t) => t > from + 1e-4 && t < to - 1e-4)
    const times = [from, ...inside, to]
    // a quaternion track samples by slerp, as the mixer does
    const sample = (track as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant()
    const values = new Float32Array(times.length * width)
    times.forEach((t, n) => values.set(sample.evaluate(t), n * width))
    const Track = track.constructor as new (name: string, times: Float32Array, values: Float32Array) => THREE.KeyframeTrack
    return new Track(track.name, Float32Array.from(times, (t) => t - from), values)
  })
  return derived(clip, new THREE.AnimationClip(clip.name, to - from, tracks), from)
}

/**
 * `clip` standing on another clip's legs (kit/anim/trims.ts CLIP_LEGS): the hips and legs (`legBones`) from `legs`,
 * played at their own pace and looped, at `clip`'s keys; the rest of the body from `clip`.
 */
export function onLegs(clip: THREE.AnimationClip, legs: THREE.AnimationClip, legBones: ReadonlySet<string>): THREE.AnimationClip {
  const isLeg = (track: THREE.KeyframeTrack) => legBones.has(THREE.PropertyBinding.parseTrackName(track.name).nodeName)
  const times = clip.tracks.find((t) => t.name.endsWith('.quaternion'))?.times ?? Float32Array.from([0, clip.duration])
  const under = legs.tracks.filter(isLeg).map((track) => {
    const width = track.getValueSize()
    const sample = (track as unknown as { createInterpolant(): THREE.Interpolant }).createInterpolant()
    const values = new Float32Array(times.length * width)
    times.forEach((t, n) => values.set(sample.evaluate(t % legs.duration), n * width))
    const Track = track.constructor as new (name: string, times: Float32Array, values: Float32Array) => THREE.KeyframeTrack
    return new Track(track.name, Float32Array.from(times), values)
  })
  return derived(clip, new THREE.AnimationClip(clip.name, clip.duration, [...clip.tracks.filter((t) => !isLeg(t)), ...under]))
}

/** `clip` turned back to the way it's named (kit/anim/trims.ts CLIP_TURNS): its hips' facing and path both. */
export function turnedBack(clip: THREE.AnimationClip): THREE.AnimationClip {
  const degrees = CLIP_TURNS[clip.name]
  if (!degrees) return clip
  const r = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (degrees * Math.PI) / 180)
  const q = new THREE.Quaternion()
  const v = new THREE.Vector3()
  const tracks = clip.tracks.map((track) => {
    if (track.name !== 'Hips.quaternion' && track.name !== 'Hips.position') return track
    const values = new Float32Array(track.values)
    const width = track.getValueSize()
    for (let i = 0; i < values.length; i += width)
      if (width === 4) q.fromArray(values, i).premultiply(r).toArray(values, i)
      else v.fromArray(values, i).applyQuaternion(r).toArray(values, i)
    const Track = track.constructor as new (name: string, times: Float32Array, values: Float32Array) => THREE.KeyframeTrack
    return new Track(track.name, Float32Array.from(track.times), values)
  })
  return derived(clip, new THREE.AnimationClip(clip.name, clip.duration, tracks))
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
  /** Its thigh and shin, hip joint to knee to ankle, in the hips' units: how far its hips move (retarget.ts legRatio). */
  legs?: number
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

/**
 * The thigh and shin of the body each gender's clips are read off (public/heroes/v2/<gender>-medium.glb, whose rest is
 * the index's), hip joint to knee to ankle in metres. The legacy rig's bodies scale by standing height, as before.
 */
export const REFERENCE_LEGS: Readonly<Partial<Record<RigKind, Readonly<Record<Gender, number>>>>> = { standard: { m: 0.883, f: 0.8444 } }

/** The same bodies' torsos (feet.ts torsoDepth), metres in front of the hips and behind them, and their heads' reach: what the clips lie on. */
export const REFERENCE_DEPTH: Readonly<Partial<Record<RigKind, Readonly<Record<Gender, { front: number; back: number; head: HeadReach }>>>>> = {
  standard: {
    m: { front: 0.138, back: 0.1, head: { front: 0.172, back: 0.075, top: 0.227 } },
    f: { front: 0.153, back: 0.107, head: { front: 0.16, back: 0.08, top: 0.229 } },
  },
}

/** A model's thigh and shin, both legs' mean, in the units of its hips' parent (the hips track's); undefined without legs. */
export function legLength(model: THREE.Object3D, hips: THREE.Object3D): number | undefined {
  const parent = hips.parent
  if (!parent) return undefined
  model.updateMatrixWorld(true)
  const lengths: number[] = []
  for (const side of ['Left', 'Right']) {
    const joints = ['UpLeg', 'Leg', 'Foot'].map((part) => model.getObjectByName(side + part))
    if (joints.some((j) => !j)) continue
    const [hip, knee, ankle] = joints.map((j) => parent.worldToLocal(j!.getWorldPosition(new THREE.Vector3())))
    lengths.push(hip.distanceTo(knee) + knee.distanceTo(ankle))
  }
  return lengths.length ? lengths.reduce((a, b) => a + b) / lengths.length : undefined
}

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
  const legs = legLength(model, hips)
  const rest: RestPose = { rotations, hips: hips.position.clone().add(new THREE.Vector3(0, drop, 0)), ...(legs ? { legs } : {}) }
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
    rest.plain = { rotations: plain, hips: rest.hips, ...(legs ? { legs } : {}) }
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
 * Whether a clip goes down to the floor from standing: its hips drop below 65% of where it starts, as a slam, a grab
 * thrown down or a blast struck into the ground does (0.40 to 0.63) and no blow on its feet does (0.72 and up). Such a
 * clip plays on the rest without the attitude, as the moves the engine lays down do (library-gait.ts PLAIN): a hunch
 * and bent knees put its hands 10 to 40 cm through the floor (all-moves check, 2026-11-13).
 */
function downAtFloor(clip: THREE.AnimationClip): boolean {
  const hips = clip.tracks.find((t) => t.name.endsWith('.position'))?.values
  if (!hips || hips.length < 3 || hips[1] <= 0) return false
  let low = Infinity
  for (let i = 1; i < hips.length; i += 3) low = Math.min(low, hips[i])
  return low < hips[1] * 0.65
}

/**
 * A clip on one body (src/kit/rig/retarget.ts): each bone's turn from the gender's reference rest put on this body's
 * own rest, and the hips' travel scaled by its legs against the reference body's. Cached per clip and rest pose. `body` names the body
 * for messages only.
 */
export function fitClip(clip: THREE.AnimationClip, gender: Gender, body: string, rest: RestPose, rig: RigKind = 'legacy'): THREE.AnimationClip {
  const idx = animIndexNow(rig)
  if (!idx) return clip
  if ((clip.userData.plain || downAtFloor(clip)) && rest.plain) rest = rest.plain
  let mine = fitted.get(clip)
  if (!mine) fitted.set(clip, (mine = new WeakMap()))
  const done = mine.get(rest)
  if (done) return done
  // a clip keyed on one gender's medium body whoever plays it (the motion pack's, motion-pack.ts) is read off that body
  const keyed = (clip.userData.rest as Gender | undefined) ?? gender
  const ref = idx.genders[keyed]
  if (!ref) throw new Error(`${body}: no ${keyed} clips`)
  const fit = retargetClip(clip, { bones: idx.bones, rest: ref.rest, hips: ref.hips, legs: REFERENCE_LEGS[rig]?.[keyed] }, { rest: rest.rotations, hips: rest.hips.toArray(), legs: rest.legs })
  const out = rest.ground ? groundClip(fit, rest.ground) : fit
  mine.set(rest, out)
  return out
}
