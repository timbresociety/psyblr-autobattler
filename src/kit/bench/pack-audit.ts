import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import type { AnimIndex } from '../../arena/client/anim-index.js'
import { glbChannels, packClipFrom, type GlbChannel, type PackEntry, type PackTravel } from '../../arena/client/motion-pack.js'
import { onBody, type AuditBody } from './clip-audit.js'

/**
 * The owner's motion pack read clip by clip in Node (2026-11-13): every file opened, put on the male medium body the
 * way the game fits it, and played through at 30 frames a second with nothing drawn. Each clip gets the numbers a
 * player would catch it by (does it move, does it pop, where the feet and hips go, which limb strikes and when), and
 * each motion set gets the numbers of how it carries itself (its idle, walk, run and sprint), which is what an attitude
 * is matched to. The pack and everything written from it stay on this machine (`.scratch`); nothing here is in a build.
 */

export const PACK_DIR = '.scratch/motion-pack'

export interface PackFile {
  actions: Record<string, string[]>
  clips: (PackEntry & { frames: number; fps: number; tags?: string[]; starter?: boolean })[]
}

export const readPack = (): PackFile => JSON.parse(readFileSync(`${PACK_DIR}/animation-index.json`, 'utf8')) as PackFile

/** The bones a viewer sees move, in the order their numbers are kept. */
const MAJOR = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', 'LeftArm', 'LeftForeArm', 'LeftHand', 'RightArm', 'RightForeArm', 'RightHand', 'LeftUpLeg', 'LeftLeg', 'LeftFoot', 'LeftToeBase', 'RightUpLeg', 'RightLeg', 'RightFoot', 'RightToeBase'] as const
type Major = (typeof MAJOR)[number]
const LIMBS = { 'left hand': 'LeftHand', 'right hand': 'RightHand', 'left foot': 'LeftFoot', 'right foot': 'RightFoot' } as const
const HZ = 30
const DEG = 180 / Math.PI
const r = (x: number, n = 3) => (Number.isFinite(x) ? +x.toFixed(n) : x)

export interface PackNumbers {
  id: string
  action: string
  category: string
  set: string
  /** Seconds as read from the file, and what its index says. */
  seconds: number
  listed: number
  /** What is wrong with the file itself, in words; empty when nothing is. */
  faults: string[]
  /** Channels on bones the rig hasn't got (left out), and rig bones the clip never keys (they hold their rest). */
  extra: number
  unkeyed: number
  /** The most any major bone turns from the clip's first frame, degrees: under 3 it is a held pose. */
  moved: number
  /** Mean turning speed of the major bones, degrees a second. */
  energy: number
  /** The biggest single-frame turn over its neighbours': a snap from one held pose to the next, as this pack is keyed. */
  pop: { degrees: number; bone: string; at: number }
  /** The biggest turn that is there for one frame and gone the next (out and back): a glitch, not a fast move. */
  spike: { degrees: number; bone: string; at: number }
  /** First frame against last: mean degrees over the major bones, and the hips' gap in centimetres. */
  seam: { degrees: number; hipsCm: number }
  /** The travel the clip was made with (dropped when it plays; the engine moves the body). */
  travel: { end: [number, number, number]; turn: number }
  /** The hips about the spot: lowest and highest against standing (metres), the furthest they stray across the floor. */
  hips: { low: number; high: number; stray: number }
  /** The soles: deepest under the floor (metres), and the share of the clip with both feet off it. */
  feet: { sink: number; aloft: number }
  /** How the body is carried, averaged over the clip. */
  carry: Carriage
  /** The limb that reaches furthest toward the front, how far past the hips and how high from them, when; and the fastest. */
  strike: { limb: string; ahead: number; height: number; at: number; fastest: string; fastestAt: number; speed: number }
  /** Where the chest points at the start and the end, degrees off straight ahead (plus to its left). */
  facing: { start: number; end: number }
  /**
   * When the body comes back nearest its first frame, past the clip's first fifth, and how near (mean degrees over
   * the major bones): a loop keyed with a tail after its cycle closes there, not at its end.
   */
  back: { at: number; degrees: number }
  /**
   * Where a loop starts: the earliest frame, in the clip's first four fifths, that its last frame comes back to (within
   * 4 degrees, mean, and 4 cm at the hips). Some of the pack's loops open on the way in (a stance taken, a sprint
   * leant into) before the cycle; played round whole, the way in pops once a cycle. Absent when the last frame matches
   * nothing before it: not a loop as keyed.
   */
  loopFrom?: number
  /** A looping gait's stride, read off the planted feet; absent when no foot plants and swings. */
  gait?: { speed: number; strides: number; strike: number; quartiles?: number[] }
  /** The same read on the loop alone (from `loopFrom` on), when the clip opens on a way in. */
  loopGait?: { seconds: number; speed: number; strides: number; strike: number; quartiles?: number[] }
}

export interface Carriage {
  /** The back's lean from upright, degrees forward; the head's against the back. */
  lean: number
  head: number
  /** The knees' bend, degrees (0 a straight leg), and the hips' height against standing. */
  knees: number
  height: number
  /** The elbows out from the chest's middle and the hands up from the hips, metres. */
  elbows: number
  hands: number
  /** The feet apart across the body, metres. */
  stance: number
  /** Over the clip: the hips' swing side to side and up and down (metres), the shoulders' turn against the hips (degrees). */
  sway: number
  bounce: number
  twist: number
}

interface Sample {
  t: number
  at: Record<Major, THREE.Vector3>
  q: Record<Major, THREE.Quaternion>
}

export interface PackBench {
  body: AuditBody
  idx: AnimIndex
  mixer: THREE.AnimationMixer
  bones: Record<Major, THREE.Object3D>
  rest: Map<THREE.Object3D, { p: THREE.Vector3; q: THREE.Quaternion }>
  stand: Record<Major, THREE.Vector3>
}

export function packBench(body: AuditBody, idx: AnimIndex): PackBench {
  const bones = Object.fromEntries(MAJOR.map((name) => [name, body.model.getObjectByName(name)!])) as Record<Major, THREE.Object3D>
  const rest = new Map<THREE.Object3D, { p: THREE.Vector3; q: THREE.Quaternion }>()
  body.model.traverse((o) => rest.set(o, { p: o.position.clone(), q: o.quaternion.clone() }))
  body.model.updateMatrixWorld(true)
  const stand = Object.fromEntries(MAJOR.map((name) => [name, bones[name].getWorldPosition(new THREE.Vector3())])) as Record<Major, THREE.Vector3>
  return { body, idx, mixer: new THREE.AnimationMixer(body.model), bones, rest, stand }
}

/** What is wrong with a file's channels before anything is played. */
function faultsOf(channels: readonly GlbChannel[], known: ReadonlySet<string>) {
  const faults: string[] = []
  let extra = 0
  const keyed = new Set<string>()
  for (const ch of channels) {
    if (ch.node !== 'Root' && !known.has(ch.node)) extra++
    else if (ch.path === 'rotation') keyed.add(ch.node)
    if (!ch.times.length) faults.push(`${ch.node}.${ch.path}: no keys`)
    for (let i = 1; i < ch.times.length; i++)
      if (!(ch.times[i] > ch.times[i - 1])) {
        faults.push(`${ch.node}.${ch.path}: keys out of order`)
        break
      }
    for (let i = 0; i < ch.values.length; i++)
      if (!Number.isFinite(ch.values[i])) {
        faults.push(`${ch.node}.${ch.path}: a value that is not a number`)
        break
      }
    if (ch.path === 'rotation')
      for (let i = 0; i + 3 < ch.values.length; i += 4) {
        const n = Math.hypot(ch.values[i], ch.values[i + 1], ch.values[i + 2], ch.values[i + 3])
        if (Math.abs(n - 1) > 0.02) {
          faults.push(`${ch.node}: a turn that is not a unit quaternion (${n.toFixed(2)})`)
          break
        }
      }
  }
  return { faults: [...new Set(faults)], extra, unkeyed: [...known].filter((b) => !keyed.has(b)).length }
}

const yaw = (a: THREE.Vector3, b: THREE.Vector3) => Math.atan2(-(b.z - a.z), b.x - a.x)
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a))
const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : 0)
const range = (xs: number[]) => (xs.length ? Math.max(...xs) - Math.min(...xs) : 0)

/** A clip played through on the bench body, 30 samples a second from its first key to its last. */
function samples(bench: PackBench, clip: THREE.AnimationClip): Sample[] {
  const { body, mixer, bones, rest } = bench
  for (const [o, at] of rest) {
    o.position.copy(at.p)
    o.quaternion.copy(at.q)
  }
  const action = mixer.clipAction(clip)
  action.play()
  const n = Math.max(2, Math.round(clip.duration * HZ) + 1)
  const out: Sample[] = []
  for (let k = 0; k < n; k++) {
    const t = Math.min(Math.max(0, clip.duration - 1e-4), (clip.duration * k) / (n - 1))
    mixer.setTime(t)
    body.model.updateMatrixWorld(true)
    out.push({
      t,
      at: Object.fromEntries(MAJOR.map((name) => [name, bones[name].getWorldPosition(new THREE.Vector3())])) as Sample['at'],
      q: Object.fromEntries(MAJOR.map((name) => [name, bones[name].quaternion.clone()])) as Sample['q'],
    })
  }
  action.stop()
  mixer.uncacheAction(clip)
  mixer.uncacheClip(clip)
  return out
}

function carriage(bench: PackBench, all: readonly Sample[]): Carriage {
  const { stand } = bench
  const knee = (s: Sample, side: 'Left' | 'Right') => {
    const up = s.at[`${side}UpLeg`]
    const mid = s.at[`${side}Leg`]
    const foot = s.at[`${side}Foot`]
    return 180 - mid.clone().sub(up).angleTo(foot.clone().sub(mid).negate()) * DEG
  }
  const lean = (s: Sample) => Math.atan2(s.at.Neck.z - s.at.Hips.z, s.at.Neck.y - s.at.Hips.y) * DEG
  const twist = (s: Sample) => wrap(yaw(s.at.LeftArm, s.at.RightArm) - yaw(s.at.LeftUpLeg, s.at.RightUpLeg)) * DEG
  return {
    lean: r(mean(all.map(lean)), 1),
    head: r(mean(all.map((s) => Math.atan2(s.at.Head.z - s.at.Neck.z, s.at.Head.y - s.at.Neck.y) * DEG - lean(s))), 1),
    knees: r(mean(all.map((s) => (knee(s, 'Left') + knee(s, 'Right')) / 2)), 1),
    height: r(mean(all.map((s) => s.at.Hips.y)) / stand.Hips.y),
    elbows: r(mean(all.map((s) => (Math.abs(s.at.LeftForeArm.x - s.at.Spine2.x) + Math.abs(s.at.RightForeArm.x - s.at.Spine2.x)) / 2))),
    hands: r(mean(all.map((s) => (s.at.LeftHand.y + s.at.RightHand.y) / 2 - s.at.Hips.y))),
    stance: r(mean(all.map((s) => Math.abs(s.at.LeftFoot.x - s.at.RightFoot.x)))),
    sway: r(range(all.map((s) => s.at.Hips.x))),
    bounce: r(range(all.map((s) => s.at.Hips.y))),
    twist: r(range(all.map(twist)), 1),
  }
}

/** A looping gait off its planted feet: metres a second the floor passes under them, strides in the clip, the left foot's landing. */
function gaitOf(bench: PackBench, all: readonly Sample[], seconds: number): PackNumbers['gait'] {
  // a foot is down within 6 cm of the lowest it gets (a sprint runs on its toes, the ankle never at its standing
  // height), as long as that lowest is near the floor at all
  const lowest = { Left: Math.min(...all.map((s) => s.at.LeftFoot.y)), Right: Math.min(...all.map((s) => s.at.RightFoot.y)) }
  if (Math.max(lowest.Left, lowest.Right) > bench.stand.LeftFoot.y + 0.25) return undefined
  const planted = (s: Sample, side: 'Left' | 'Right') => s.at[`${side}Foot`].y < lowest[side] + 0.06
  const speeds: number[] = []
  let lands = 0
  let strike = -1
  for (let k = 1; k < all.length; k++) {
    for (const side of ['Left', 'Right'] as const) {
      if (!planted(all[k], side) || !planted(all[k - 1], side) || !(all[k].t > all[k - 1].t)) continue
      // a planted foot goes back under the hips as fast as the body goes forward
      const back = -((all[k].at[`${side}Foot`].z - all[k].at.Hips.z) - (all[k - 1].at[`${side}Foot`].z - all[k - 1].at.Hips.z)) / (all[k].t - all[k - 1].t)
      if (back > 0.3) speeds.push(back)
    }
    if (planted(all[k], 'Left') && !planted(all[k - 1], 'Left')) {
      lands++
      if (strike < 0) strike = all[k].t
    }
  }
  if (speeds.length < 2 && !lands) return undefined
  const sorted = [...speeds].sort((a, b) => a - b)
  // (a sprint keyed at 30 frames a second can have a foot down for one frame: then the landing is known, the speed not)
  const q = (share: number) => (sorted.length < 2 ? 0 : r(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * share))], 2))
  // a clip that starts with the left foot down has that landing at its seam
  const starts = planted(all[0], 'Left') && !planted(all[all.length - 2], 'Left')
  // the foot rolls on at the heel and off at the toe, slower than the floor passes: the floor's own speed is the top
  // of what a planted ankle does, not its middle
  return { speed: q(0.75), strides: Math.max(1, lands + (starts ? 1 : 0)), strike: r(starts ? 0 : Math.max(0, strike - (all[0]?.t ?? 0))) % seconds, quartiles: [q(0.25), q(0.5), q(0.75), q(0.9)] }
}

/** One clip of the pack, read from its file and measured on the bench body. */
export function measure(bench: PackBench, entry: PackFile['clips'][number]): PackNumbers {
  const { idx, stand } = bench
  const buffer = readFileSync(`${PACK_DIR}/${entry.file}`)
  const { channels } = glbChannels(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer)
  const { faults, extra, unkeyed } = faultsOf(channels, new Set(idx.bones))
  const raw = packClipFrom(entry.id, channels, idx.bones)
  const travel = raw.userData.travel as PackTravel
  if (!raw.tracks.length) faults.push('no track for any bone of the rig')
  if (Math.abs(raw.duration - entry.durationSeconds) > 0.05) faults.push(`lasts ${raw.duration.toFixed(2)} s, listed as ${entry.durationSeconds.toFixed(2)}`)
  const all = raw.tracks.length ? samples(bench, onBody(raw, bench.body, idx)) : []
  const none: PackNumbers = {
    id: entry.id, action: entry.action, category: entry.category, set: entry.motionSet, seconds: r(raw.duration), listed: entry.durationSeconds, faults, extra, unkeyed,
    moved: 0, energy: 0, pop: { degrees: 0, bone: '', at: 0 }, spike: { degrees: 0, bone: '', at: 0 }, seam: { degrees: 0, hipsCm: 0 }, travel: { end: travel.end.map((v) => r(v)) as [number, number, number], turn: r(travel.turn * DEG, 1) },
    hips: { low: 0, high: 0, stray: 0 }, feet: { sink: 0, aloft: 0 }, carry: { lean: 0, head: 0, knees: 0, height: 1, elbows: 0, hands: 0, stance: 0, sway: 0, bounce: 0, twist: 0 },
    strike: { limb: '', ahead: 0, height: 0, at: 0, fastest: '', fastestAt: 0, speed: 0 }, facing: { start: 0, end: 0 }, back: { at: 0, degrees: 0 },
  }
  if (all.length < 2) return none
  const first = all[0]
  const last = all[all.length - 1]
  // how far each bone turns: from the first frame, and frame to frame
  let moved = 0
  const steps: { degrees: number; bone: string; at: number }[][] = []
  let turned = 0
  for (let k = 1; k < all.length; k++) {
    const row = MAJOR.map((bone) => ({ degrees: all[k].q[bone].angleTo(all[k - 1].q[bone]) * DEG, bone, at: all[k].t }))
    steps.push(row)
    for (const bone of MAJOR) moved = Math.max(moved, all[k].q[bone].angleTo(first.q[bone]) * DEG)
    turned += mean(row.map((s) => s.degrees))
  }
  // a pop: one frame's turn well over both its neighbours' (ankles and toes snap at every heel strike, and are left out)
  let pop = { degrees: 0, bone: '', at: 0 }
  for (let k = 1; k + 1 < steps.length; k++)
    steps[k].forEach((s, b) => {
      if (/Foot|ToeBase/.test(s.bone)) return
      const around = Math.max(steps[k - 1][b].degrees, steps[k + 1][b].degrees)
      if (s.degrees > 30 && s.degrees > around * 3 && s.degrees - around > pop.degrees) pop = { degrees: r(s.degrees - around, 1), bone: s.bone, at: r(s.at) }
    })
  // a spike: a bone far from where it was a frame ago, and back there a frame later
  let spike = { degrees: 0, bone: '', at: 0 }
  for (let k = 1; k + 1 < all.length; k++)
    for (const bone of MAJOR) {
      if (/Foot|ToeBase/.test(bone)) continue
      const out = all[k].q[bone].angleTo(all[k - 1].q[bone]) * DEG
      const across = all[k + 1].q[bone].angleTo(all[k - 1].q[bone]) * DEG
      if (out > 35 && across < out * 0.35 && out - across > spike.degrees) spike = { degrees: r(out - across, 1), bone, at: r(all[k].t) }
    }
  const soles = (s: Sample) => Math.min(s.at.LeftFoot.y - stand.LeftFoot.y, s.at.LeftToeBase.y - stand.LeftToeBase.y, s.at.RightFoot.y - stand.RightFoot.y, s.at.RightToeBase.y - stand.RightToeBase.y)
  // the limb that goes furthest toward the front, past where it is carried through the rest of the clip
  const limbs = Object.entries(LIMBS).map(([limb, bone]) => {
    const ahead = all.map((s) => s.at[bone].z - s.at.Hips.z)
    const sorted = [...ahead].sort((a, b) => a - b)
    const k = ahead.indexOf(Math.max(...ahead))
    // (a one-frame clip has no time in it: nothing moves)
    const speed = all.map((s, i) => (i && s.t > all[i - 1].t ? s.at[bone].distanceTo(all[i - 1].at[bone]) / (s.t - all[i - 1].t) : 0))
    const f = speed.indexOf(Math.max(...speed))
    return { limb, reach: ahead[k] - sorted[sorted.length >> 1], ahead: ahead[k], height: all[k].at[bone].y - all[k].at.Hips.y, at: all[k].t, speed: speed[f], fastestAt: all[f].t }
  })
  const striking = limbs.reduce((a, b) => (b.reach > a.reach ? b : a))
  const fastest = limbs.reduce((a, b) => (b.speed > a.speed ? b : a))
  let back = { at: last.t, degrees: Infinity }
  for (const s of all) {
    if (s.t < last.t * 0.2) continue
    const off = mean(MAJOR.map((bone) => first.q[bone].angleTo(s.q[bone]) * DEG))
    if (off < back.degrees) back = { at: r(s.t), degrees: r(off, 1) }
  }
  let loopFrom: number | undefined
  for (let k = 0; k < all.length * 0.8 - 1 && loopFrom === undefined; k++)
    if (mean(MAJOR.map((bone) => all[k].q[bone].angleTo(last.q[bone]) * DEG)) < 4 && all[k].at.Hips.distanceTo(last.at.Hips) < 0.04) loopFrom = r(all[k].t)
  const chest = (s: Sample) => r(wrap(yaw(s.at.LeftArm, s.at.RightArm) - Math.PI) * DEG, 1)
  return {
    ...none,
    moved: r(moved, 1),
    energy: r(turned / (last.t - first.t || 1), 1),
    pop,
    spike,
    seam: { degrees: r(mean(MAJOR.map((bone) => first.q[bone].angleTo(last.q[bone]) * DEG)), 1), hipsCm: r(first.at.Hips.distanceTo(last.at.Hips) * 100, 1) },
    hips: { low: r(Math.min(...all.map((s) => s.at.Hips.y)) - stand.Hips.y), high: r(Math.max(...all.map((s) => s.at.Hips.y)) - stand.Hips.y), stray: r(Math.max(...all.map((s) => Math.hypot(s.at.Hips.x - first.at.Hips.x, s.at.Hips.z - first.at.Hips.z)))) },
    feet: { sink: r(Math.min(0, ...all.map(soles))), aloft: r(all.filter((s) => soles(s) > 0.12).length / all.length, 2) },
    carry: carriage(bench, all),
    strike: { limb: striking.limb, ahead: r(striking.ahead), height: r(striking.height), at: r(striking.at), fastest: fastest.limb, fastestAt: r(fastest.fastestAt), speed: r(fastest.speed, 1) },
    facing: { start: chest(first), end: chest(last) },
    back,
    ...(loopFrom !== undefined && moved >= 3 ? { loopFrom } : {}),
    gait: gaitOf(bench, all, raw.duration),
    ...(loopFrom ? (() => {
      const part = all.filter((s) => s.t >= loopFrom! - 1e-6)
      const g = gaitOf(bench, part, last.t - loopFrom!)
      return g ? { loopGait: { seconds: r(last.t - loopFrom!), ...g } } : {}
    })() : {}),
  }
}

/** What to say of a clip from its numbers: what a player would catch, worst first; empty when nothing would be caught. */
export function verdict(n: PackNumbers): string[] {
  const out = [...n.faults]
  if (n.moved < 3) out.push('a held pose')
  if (n.spike.degrees > 35) out.push(`a one-frame spike of ${n.spike.degrees} degrees at ${n.spike.at} s (${n.spike.bone})`)
  if (n.feet.sink < -0.12 && n.hips.low > -0.45) out.push(`feet ${Math.round(-n.feet.sink * 100)} cm under the floor`)
  if (n.unkeyed > 20) out.push(`${n.unkeyed} bones never keyed`)
  return out
}
