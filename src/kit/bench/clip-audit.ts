import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { legLength, REFERENCE_LEGS, toClip, type ClipFile } from '../../arena/client/anim-library.js'
import type { AnimIndex } from '../../arena/client/anim-index.js'
import { applyPosture } from '../../arena/client/metarig/posture.js'
import { meshRest } from '../../arena/client/metarig/upgrade.js'
import { proportion } from '../../arena/client/proportions.js'
import type { Archetype } from '../body/physique.js'
import { bodyBase, shapeBody } from '../body/shape.js'
import type { ClipTags } from '../anim/bake.js'
import { retargetClip } from '../rig/retarget.js'
import { benchModel } from './model.js'

/**
 * The clip audit's numbers (docs/plans/2026-11-05-session-1-handoff.md, step 3): one clip on one body, read frame by
 * frame off its keys, the way a player would catch it. The physique bench (physique-bench.ts) scores joint limits and
 * skin through itself; this scores what it leaves out:
 *
 * - hips: how far they leave the hero's capsule and come back. Clips play in place, so anything left is the body
 *   wandering off the spot the engine has it on, and `sway` is the sideways swing the owner saw as a C in the old dash;
 * - travel: the line the clip was captured moving along, its baked-out root and what is left in the hips;
 * - facing: where the chest points, start to end and at the blow, against the aim (ahead, +z);
 * - strike: the limb that lands the blow, and which way from the chest it goes;
 * - feet: slide while planted, and how far the soles go under the floor or float over it;
 * - pops: a bone's single-frame jump over its neighbours' speed, which reads as a glitch and not a fast move;
 * - seam: for a loop, how far its last frame is from its first;
 * - lead and tail: the dead time before it starts moving and after it stops.
 */

const ANIM = 'public/anim/standard'
const DEG = 180 / Math.PI

/** The bones a viewer sees move: fingers and eyes are left out of pops and seams, and their worst is kept apart. */
const fine = (bone: string) => /Hand(Thumb|Index|Middle|Ring|Pinky)|Eye/.test(bone)
/** Ankles and toes snap at every heel strike across the library, 20 to 40 degrees a frame: kept apart, or they'd hide a real pop. */
const ankle = (bone: string) => /Foot|ToeBase/.test(bone)
/** A sole counts as down within this of its rest height, and as swinging from this speed over the ground (metres, m/s). */
const PLANT_HEIGHT = 0.04
const SWINGING = 1

export interface AuditBody {
  label: string
  gender: Archetype['gender']
  model: THREE.Group
  /** Each keyed bone's rest and the hips' stand, for retargeting. */
  rotations: Map<string, THREE.Quaternion>
  hips: THREE.Vector3
  soles: { Left: [number, number]; Right: [number, number] }
  /** Top of the head at rest, metres, in the body file's units. */
  height: number
}

export function readIndex(): AnimIndex {
  return JSON.parse(readFileSync(`${ANIM}/index.json`, 'utf8')) as AnimIndex
}

/** A body built the way the physique bench builds one: the game's proportions and posture over the file. */
export async function auditBody(label: string, spec: Pick<Archetype, 'gender' | 'body' | 'dials'>, idx: AnimIndex): Promise<AuditBody> {
  const g = spec.gender
  const { model, mesh, file, morphNames } = await benchModel(`public/heroes/v2/${g}-${spec.body}.glb`)
  const dials = { ...spec.dials }
  const shaped = shapeBody(bodyBase(file), morphNames, dials, undefined, { skeleton: { bones: file.bones, rest: file.rest }, gender: g })
  proportion(mesh, shaped, dials)
  applyPosture(model, dials)
  model.updateMatrixWorld(true)
  meshRest(mesh)
  const rotations = new Map(idx.bones.map((b) => [b, model.getObjectByName(b)!.quaternion.clone()]))
  const hips = model.getObjectByName('Hips')!.position.clone().add(new THREE.Vector3(0, (mesh.userData.legDrop as number | undefined) ?? 0, 0))
  const head = model.getObjectByName('Head')!.getWorldPosition(new THREE.Vector3())
  return { label, gender: g, model, rotations, hips, soles: { Left: [file.rest.LeftFoot[1], file.rest.LeftToeBase[1]], Right: [file.rest.RightFoot[1], file.rest.RightToeBase[1]] }, height: head.y }
}

/** A library clip as the file holds it, on the gender's medium body. */
export const fileClip = (name: string, gender: string, idx: AnimIndex) => toClip(name, JSON.parse(readFileSync(`${ANIM}/${gender}/${name}.json`, 'utf8')) as ClipFile, idx)

/** `clip` (on the gender's medium body) fitted to `body`, the way fitClip does in the game. */
export function onBody(clip: THREE.AnimationClip, body: AuditBody, idx: AnimIndex): THREE.AnimationClip {
  const ref = idx.genders[body.gender]!
  const legs = legLength(body.model, body.model.getObjectByName('Hips')!)
  return retargetClip(clip, { bones: idx.bones, rest: ref.rest, hips: ref.hips, legs: REFERENCE_LEGS.standard![body.gender] }, { rest: body.rotations, hips: body.hips.toArray(), legs })
}

export interface Kinematics {
  frames: number
  seconds: number
  /** Metres the hips end from where they began, and the most they stray at any frame. */
  hipsEnd: number
  hipsMost: number
  /** The sideways swing about the line from the first frame to the last (or about the spot, if it ends where it began). */
  sway: number
  rise: { low: number; high: number }
  /** Metres and the heading (degrees, 0 ahead, plus to the hero's left) the clip travelled, its baked-out root with what is left in the hips. */
  travel: { metres: number; heading: number }
  /** Metres a second and the heading the planted feet slide back along: the true line of a looping gait. */
  treadmill: { speed: number; heading: number }
  /** Degrees off the aim, plus to the left. */
  facing: { start: number; end: number; most: number; atBlow?: number }
  /** Lowest the hips' up points: below 0.5 the body has gone past flat. */
  tumble: number
  strike?: { limb: string; heading: number; ahead: number; height: number }
  feet: { slide: number; slideWorst: number; sink: number; float: number; plantedShare: number }
  pops: { degrees: number; bone: string; at: number; fine: number; ankle: number; hipsCm: number }
  speed: { degrees: number; bone: string }
  seam: { degrees: number; bone: string; hipsCm: number; mean: number }
  lead: number
  tail: number
  /** The hands' distance apart: their mean and spread over the clip, metres. */
  hands: { mean: number; spread: number }
  /** Mean degrees off the first frame of `stance`, at the clip's first and last frames: what its fades have to cover. */
  fromStance: { start: number; end: number }
}

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[xs.length >> 1] : 0)
const r = (x: number, n = 3) => +x.toFixed(n)

/** Every key of `clip` set on the model in turn; `each` reads the pose. Keys, not the mixer: a mixer wraps a clip's last frame to its first. */
function frames(clip: THREE.AnimationClip, model: THREE.Group, each: (f: number, time: number) => void) {
  const tracks = clip.tracks.map((t) => {
    const dot = t.name.lastIndexOf('.')
    const bone = model.getObjectByName(t.name.slice(0, dot))
    return { t, bone, prop: t.name.slice(dot + 1) }
  })
  const n = clip.tracks[0].times.length
  for (let f = 0; f < n; f++) {
    for (const { t, bone, prop } of tracks) {
      if (!bone) continue
      if (prop === 'quaternion') bone.quaternion.fromArray(t.values, f * 4)
      else if (prop === 'position') bone.position.fromArray(t.values, f * 3)
    }
    model.updateMatrixWorld(true)
    each(f, clip.tracks[0].times[f])
  }
}

const v0 = new THREE.Vector3()
const v1 = new THREE.Vector3()

export function kinematics(clip: THREE.AnimationClip, body: AuditBody, idx: AnimIndex, tags: ClipTags | undefined, stance?: THREE.AnimationClip): Kinematics {
  const { model, soles } = body
  const find = (n: string) => model.getObjectByName(n)!
  const at = (n: string) => find(n).getWorldPosition(new THREE.Vector3())
  const bones = idx.bones
  const hipsPath: THREE.Vector3[] = []
  const yaws: (number | undefined)[] = []
  let tumble = 1
  const quats: THREE.Quaternion[][] = []
  const feet: Record<'Left' | 'Right', { at: THREE.Vector3; low: number }[]> = { Left: [], Right: [] }
  const ends: Record<string, THREE.Vector3[]> = { LeftHand: [], RightHand: [], LeftFoot: [], RightFoot: [] }
  const chest: THREE.Vector3[] = []
  const handGap: number[] = []
  const times: number[] = []
  frames(clip, model, (_, time) => {
    times.push(time)
    const hips = at('Hips')
    hipsPath.push(hips)
    quats.push(bones.map((b) => find(b).quaternion.clone()))
    const low = at('Spine')
    const high = at('Spine2')
    const up = v0.subVectors(high, low).normalize()
    tumble = Math.min(tumble, up.y)
    const side = v1.subVectors(at('LeftArm'), at('RightArm')).normalize()
    const front = new THREE.Vector3().crossVectors(side, up)
    yaws.push(up.y > 0.5 ? Math.atan2(front.x, front.z) : undefined)
    for (const s of ['Left', 'Right'] as const) {
      const foot = at(`${s}Foot`)
      const toe = at(`${s}ToeBase`)
      feet[s].push({ at: toe.clone().setY(0), low: Math.min(foot.y - soles[s][0], toe.y - soles[s][1]) })
    }
    for (const n of Object.keys(ends)) ends[n].push(at(n))
    chest.push(high.clone())
    handGap.push(ends.LeftHand[ends.LeftHand.length - 1].distanceTo(ends.RightHand[ends.RightHand.length - 1]))
  })
  const n = times.length
  const dt = n > 1 ? times[1] - times[0] : 1 / idx.fps

  // the hips against where they start
  const first = hipsPath[0]
  const lastAt = hipsPath[n - 1]
  const flat = (a: THREE.Vector3) => new THREE.Vector2(a.x - first.x, a.z - first.z)
  const net = flat(lastAt)
  const line = net.length() > 0.15 ? net.clone().normalize() : new THREE.Vector2(0, 1)
  let hipsMost = 0
  let sway = 0
  for (const p of hipsPath) {
    const d = flat(p)
    hipsMost = Math.max(hipsMost, d.length())
    sway = Math.max(sway, Math.abs(d.x * line.y - d.y * line.x))
  }
  const ys = hipsPath.map((p) => p.y)

  const root = tags?.root ?? { x: 0, z: 0, rise: 0 }
  const tx = root.x + net.x
  const tz = root.z + net.y

  // facing, read only while the body is upright enough for one to mean anything
  const known = yaws.filter((y): y is number => y !== undefined)
  const y0 = known[0] ?? 0
  const yEnd = known[known.length - 1] ?? 0
  const most = known.reduce((m, y) => (Math.abs(wrap(y)) > Math.abs(m) ? wrap(y) : m), 0)

  // the blow: the fastest end against the hips at the tagged contact
  let strike: Kinematics['strike']
  let blowYaw: number | undefined
  if (tags) {
    const seconds = Math.max(times[n - 1], 1e-6)
    const f = Math.min(n - 1, Math.round(((tags.contact / Math.max(seconds, tags.contact)) * seconds) / dt))
    blowYaw = yaws[f]
    let best = ''
    let fastest = -1
    const from = Math.max(0, f - 1)
    for (const [name, path] of Object.entries(ends)) {
      const speed = path[f].clone().sub(hipsPath[f]).distanceTo(path[from].clone().sub(hipsPath[from]))
      if (speed > fastest) (fastest = speed), (best = name)
    }
    const end = ends[best][f]
    const d = end.clone().sub(chest[f])
    strike = { limb: best, heading: r(Math.atan2(d.x, d.z) * DEG, 0), ahead: r(end.z - hipsPath[f].z, 2), height: r(end.y, 2) }
  }

  // planted feet: a sole near the floor and not swinging, its speed over the ground with the baked-out travel added back
  const slides: number[] = []
  let planted = 0
  const fps = 1 / dt
  const legs = (clip.userData.legRatio as number | undefined) ?? 1
  const clipSeconds = Math.max(times[n - 1], 1e-6)
  const drifting = new THREE.Vector3((root.x * legs) / clipSeconds, 0, (root.z * legs) / clipSeconds)
  for (const s of ['Left', 'Right'] as const)
    for (let f = 1; f < n; f++) {
      if (feet[s][f].low > PLANT_HEIGHT || feet[s][f - 1].low > PLANT_HEIGHT) continue
      const speed = feet[s][f].at.clone().sub(feet[s][f - 1].at).multiplyScalar(fps).add(drifting).length()
      if (speed > SWINGING) continue
      planted++
      slides.push(speed * 100)
    }
  // the line the feet say it travels: played in place, a planted foot slides back along it. Independent of the root tag
  const under: THREE.Vector3[] = []
  for (const s of ['Left', 'Right'] as const)
    for (let f = 1; f < n; f++) if (feet[s][f].low < PLANT_HEIGHT && feet[s][f - 1].low < PLANT_HEIGHT) under.push(feet[s][f].at.clone().sub(feet[s][f - 1].at).multiplyScalar(-fps))
  const belt = new THREE.Vector3(median(under.map((x) => x.x)), 0, median(under.map((x) => x.z)))
  const lowest = feet.Left.map((l, f) => Math.min(l.low, feet.Right[f].low))

  // pops: a bone's turn this frame over the turns round it; one bad frame stands out, a fast move doesn't
  const scale = dt * idx.fps
  const turn = (k: number, f: number) => 2 * Math.acos(Math.min(1, Math.abs(quats[f][k].dot(quats[f + 1][k])))) * DEG / scale
  let pop = { degrees: 0, bone: '', at: 0, fine: 0, ankle: 0, hipsCm: 0 }
  let speed = { degrees: 0, bone: '' }
  let energy = new Array<number>(Math.max(0, n - 1)).fill(0)
  bones.forEach((bone, k) => {
    const ws = Array.from({ length: n - 1 }, (_, f) => turn(k, f))
    ws.forEach((w, f) => {
      const round = ws.slice(Math.max(0, f - 3), f).concat(ws.slice(f + 1, f + 4))
      const over = round.length ? w - Math.max(median(round), 0) : 0
      if (fine(bone)) pop.fine = Math.max(pop.fine, over)
      else if (ankle(bone)) pop.ankle = Math.max(pop.ankle, over)
      else {
        energy[f] += w
        if (over > pop.degrees) pop = { ...pop, degrees: over, bone, at: times[f] }
        if (w > speed.degrees) speed = { degrees: w, bone }
      }
    })
  })
  const steps = hipsPath.slice(1).map((p, f) => p.distanceTo(hipsPath[f]) / scale)
  steps.forEach((w, f) => {
    const round = steps.slice(Math.max(0, f - 3), f).concat(steps.slice(f + 1, f + 4))
    if (round.length) pop.hipsCm = Math.max(pop.hipsCm, (w - median(round)) * 100)
  })

  // the seam: the last frame against the first
  let seam = { degrees: 0, bone: '', hipsCm: first.distanceTo(lastAt) * 100, mean: 0 }
  let shown = 0
  bones.forEach((bone, k) => {
    if (fine(bone)) return
    const d = 2 * Math.acos(Math.min(1, Math.abs(quats[0][k].dot(quats[n - 1][k])))) * DEG
    seam.mean += d
    shown++
    if (d > seam.degrees) seam = { ...seam, degrees: d, bone }
  })
  seam.mean /= shown || 1

  // lead and tail: the stretch before and after it moves at a fifth of its peak
  const peak = Math.max(...energy, 1e-6)
  const moving = energy.map((e) => e > peak * 0.2)
  const firstMove = moving.indexOf(true)
  const lastMove = moving.lastIndexOf(true)

  // what the fades cover: the first and last frames against the stance
  const fromStance = { start: 0, end: 0 }
  if (stance) {
    const held: THREE.Quaternion[] = []
    frames(stance, model, (f) => f === 0 && held.push(...bones.map((b) => find(b).quaternion.clone())))
    let a = 0
    let b = 0
    let c = 0
    bones.forEach((bone, k) => {
      if (fine(bone)) return
      a += 2 * Math.acos(Math.min(1, Math.abs(held[k].dot(quats[0][k])))) * DEG
      b += 2 * Math.acos(Math.min(1, Math.abs(held[k].dot(quats[n - 1][k])))) * DEG
      c++
    })
    fromStance.start = r(a / c, 1)
    fromStance.end = r(b / c, 1)
  }

  const handMean = handGap.reduce((a, b) => a + b, 0) / n
  return {
    frames: n,
    seconds: r(times[n - 1], 2),
    hipsEnd: r(net.length()),
    hipsMost: r(hipsMost),
    sway: r(sway),
    rise: { low: r(Math.min(...ys) - body.hips.y), high: r(Math.max(...ys) - body.hips.y) },
    travel: { metres: r(Math.hypot(tx, tz), 2), heading: r(Math.atan2(tx, tz) * DEG, 0) },
    treadmill: { speed: r(belt.length(), 2), heading: r(Math.atan2(belt.x, belt.z) * DEG, 0) },
    facing: { start: r(wrap(y0) * DEG, 0), end: r(wrap(yEnd) * DEG, 0), most: r(most * DEG, 0), ...(blowYaw !== undefined ? { atBlow: r(wrap(blowYaw) * DEG, 0) } : {}) },
    tumble: r(tumble, 2),
    ...(strike ? { strike } : {}),
    feet: { slide: r(slides.length ? slides.reduce((a, b) => a + b, 0) / slides.length : 0, 1), slideWorst: r(Math.max(0, ...slides), 1), sink: r(Math.min(...lowest) * 100, 1), float: r(median(lowest) * 100, 1), plantedShare: r(planted / (2 * Math.max(1, n - 1)), 2) },
    pops: { degrees: r(pop.degrees, 1), bone: pop.bone, at: r(pop.at, 2), fine: r(pop.fine, 1), ankle: r(pop.ankle, 1), hipsCm: r(pop.hipsCm, 1) },
    speed: { degrees: r(speed.degrees, 1), bone: speed.bone },
    seam: { degrees: r(seam.degrees, 1), bone: seam.bone, hipsCm: r(seam.hipsCm, 1), mean: r(seam.mean, 1) },
    lead: r(firstMove < 0 ? 0 : times[firstMove], 2),
    tail: r(lastMove < 0 ? 0 : times[n - 1] - times[lastMove + 1], 2),
    hands: { mean: r(handMean, 2), spread: r(Math.max(...handGap) - Math.min(...handGap), 2) },
    fromStance,
  }
}
