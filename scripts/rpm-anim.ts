/**
 * Ready Player Me's animation library (github.com/readyplayerme/animation-library, used under the owner's agreement with
 * Ready Player Me) retargeted onto the heroes' 20-bone rig. Each clip's motion moves over bone by bone in world space:
 * the RPM skeleton's T-pose is first turned bone by bone onto our bodies' A-pose, so a frame's change from that pose
 * is the change our bone makes from its own rest, and every bone points where the performer's did, but the clavicles,
 * which turn as far as the performer's shoulders turned from relaxed (relaxedShoulders). The hips' travel is
 * scaled to our hips' height, and walking forward becomes walking in place (the engine moves the hero).
 *
 *   npx tsx scripts/rpm-anim.ts [library]      (default .scratch/rpm/src: its masculine/ and feminine/ folders)
 *
 * Writes public/anim/ for src/arena/client/anim-library.ts: index.json (the clips of each gender by set, and the medium
 * body each gender's clips were fitted to, at rest, for the other sizes) and <m|f>/<clip>.json, 24 frames a second:
 * each bone's local rotation and the hips' position.
 */
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'
import { Quaternion, Vector3 } from 'three'

const LIBRARY = process.argv[2] ?? '.scratch/rpm/src'
const OUT = 'public/anim'
const FPS = 24

/** Our rig, parents first, and the RPM bone each takes its motion from. */
const RIG: [string, string][] = [
  ['hips', 'Hips'],
  ['spine', 'Spine'],
  ['chest', 'Spine1'],
  ['upper_chest', 'Spine2'],
  ['neck', 'Neck'],
  ['head', 'Head'],
  ['clavicle_L', 'LeftShoulder'],
  ['upper_arm_L', 'LeftArm'],
  ['forearm_L', 'LeftForeArm'],
  ['hand_L', 'LeftHand'],
  ['clavicle_R', 'RightShoulder'],
  ['upper_arm_R', 'RightArm'],
  ['forearm_R', 'RightForeArm'],
  ['hand_R', 'RightHand'],
  ['thigh_L', 'LeftUpLeg'],
  ['shin_L', 'LeftLeg'],
  ['foot_L', 'LeftFoot'],
  ['thigh_R', 'RightUpLeg'],
  ['shin_R', 'RightLeg'],
  ['foot_R', 'RightFoot'],
]

type Gender = 'm' | 'f'
/** A set of clips: our name for each and its file in the library (under <masculine|feminine>/glb/), per gender. */
type Pick = Record<string, string>
const SETS: Record<string, Record<Gender, Pick>> = {
  idle: {
    m: {
      idle: 'idle/M_Standing_Idle_001',
      idle_2: 'idle/M_Standing_Idle_002',
      ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => [`idle_v${i}`, `idle/M_Standing_Idle_Variations_${String(i).padStart(3, '0')}`])),
    },
    f: {
      idle: 'idle/F_Standing_Idle_001',
      ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((i) => [`idle_v${i}`, `idle/F_Standing_Idle_Variations_${String(i).padStart(3, '0')}`])),
    },
  },
  move: {
    m: {
      walk: 'locomotion/M_Walk_001',
      walk_back: 'locomotion/M_Walk_Backwards_001',
      walk_left: 'locomotion/M_Walk_Strafe_Left_002',
      walk_right: 'locomotion/M_Walk_Strafe_Right_002',
      jog: 'locomotion/M_Jog_001',
      jog_back: 'locomotion/M_Jog_Backwards_001',
      jog_left: 'locomotion/M_Jog_Strafe_Left_001',
      jog_right: 'locomotion/M_Jog_Strafe_Right_001',
      run: 'locomotion/M_Run_001',
      run_back: 'locomotion/M_Run_Backwards_002',
      run_left: 'locomotion/M_Run_Strafe_Left_002',
      run_right: 'locomotion/M_Run_Strafe_Right_002',
      crouch: 'locomotion/M_Crouch_Walk_003',
      crouch_back: 'locomotion/M_CrouchedWalk_Backwards_002',
      crouch_left: 'locomotion/M_Crouch_Strafe_Left_002',
      crouch_right: 'locomotion/M_Crouch_Strafe_Right_002',
      walk_jump: 'locomotion/M_Walk_Jump_001',
      jog_jump: 'locomotion/M_Jog_Jump_001',
      run_jump: 'locomotion/M_Run_Jump_001',
      falling: 'locomotion/M_Falling_Idle_002',
    },
    f: {
      walk: 'locomotion/F_Walk_002',
      walk_back: 'locomotion/F_Walk_Backwards_001',
      walk_left: 'locomotion/F_Walk_Strafe_Left_001',
      walk_right: 'locomotion/F_Walk_Strafe_Right_001',
      jog: 'locomotion/F_Jog_001',
      jog_back: 'locomotion/F_Jog_Backwards_001',
      jog_left: 'locomotion/F_Jog_Strafe_Left_002',
      jog_right: 'locomotion/F_Jog_Strafe_Right_002',
      run: 'locomotion/F_Run_001',
      run_back: 'locomotion/F_Run_Backwards_001',
      run_left: 'locomotion/F_Run_Strafe_Left_001',
      run_right: 'locomotion/F_Run_Strafe_Right_001',
      crouch: 'locomotion/F_Crouch_Walk_001',
      crouch_back: 'locomotion/F_CrouchedWalk_Backwards_001',
      crouch_left: 'locomotion/F_Crouch_Strafe_Left',
      crouch_right: 'locomotion/F_Crouch_Strafe_Right',
      walk_jump: 'locomotion/F_Walk_Jump_001',
      jog_jump: 'locomotion/F_Jog_Jump_Small_001',
      run_jump: 'locomotion/F_Run_Jump_001',
      falling: 'locomotion/F_Falling_Idle_000',
    },
  },
  dance: {
    m: Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9, 11].map((i, k) => [`dance_${k + 1}`, `dance/M_Dances_${String(i).padStart(3, '0')}`])),
    f: Object.fromEntries([1, 4, 5, 6, 7].map((i, k) => [`dance_${k + 1}`, `dance/F_Dances_${String(i).padStart(3, '0')}`])),
  },
  talk: {
    m: {
      ...Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) => [`talk_${i}`, `expression/M_Talking_Variations_${String(i).padStart(3, '0')}`])),
      ...Object.fromEntries([1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18].map((i, k) => [`gesture_${k + 1}`, `expression/M_Standing_Expressions_${String(i).padStart(3, '0')}`])),
    },
    f: Object.fromEntries([1, 2, 3, 4, 5, 6].map((i) => [`talk_${i}`, `expression/F_Talking_Variations_${String(i).padStart(3, '0')}`])),
  },
}

// ------------------------------------------------------------------------------------------------ glTF

interface Glb {
  json: {
    nodes: { name?: string; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[]
    accessors: { bufferView: number; byteOffset?: number; componentType: number; normalized?: boolean; count: number; type: string }[]
    bufferViews: { byteOffset?: number; byteStride?: number }[]
    animations?: { name?: string; channels: { sampler: number; target: { node: number; path: string } }[]; samplers: { input: number; output: number; interpolation?: string }[] }[]
  }
  bin: Buffer
}

function readGlb(path: string): Glb {
  const b = readFileSync(path)
  if (b.toString('latin1', 0, 4) !== 'glTF') throw new Error(`${path}: not a GLB`)
  const jsonLength = b.readUInt32LE(12)
  const json = JSON.parse(b.toString('utf8', 20, 20 + jsonLength))
  const at = 20 + jsonLength
  const bin = at + 8 <= b.length ? b.subarray(at + 8, at + 8 + b.readUInt32LE(at)) : Buffer.alloc(0)
  return { json, bin }
}

const WIDTH: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }

function readAccessor(glb: Glb, index: number): Float32Array {
  const acc = glb.json.accessors[index]
  const view = glb.json.bufferViews[acc.bufferView]
  const n = WIDTH[acc.type]
  const size = acc.componentType === 5126 ? 4 : acc.componentType === 5122 || acc.componentType === 5123 ? 2 : 1
  const stride = view.byteStride || size * n
  const base = (view.byteOffset ?? 0) + (acc.byteOffset ?? 0)
  const out = new Float32Array(acc.count * n)
  for (let i = 0; i < acc.count; i++)
    for (let k = 0; k < n; k++) {
      const p = base + i * stride + k * size
      const b = glb.bin
      let v: number
      if (acc.componentType === 5126) v = b.readFloatLE(p)
      else if (acc.componentType === 5122) v = acc.normalized ? Math.max(b.readInt16LE(p) / 32767, -1) : b.readInt16LE(p)
      else if (acc.componentType === 5123) v = acc.normalized ? b.readUInt16LE(p) / 65535 : b.readUInt16LE(p)
      else if (acc.componentType === 5120) v = acc.normalized ? Math.max(b.readInt8(p) / 127, -1) : b.readInt8(p)
      else v = acc.normalized ? b.readUInt8(p) / 255 : b.readUInt8(p)
      out[i * n + k] = v
    }
  return out
}

interface Bone {
  name: string
  parent: number
  t: Vector3
  r: Quaternion
}

function bonesOf(glb: Glb): Bone[] {
  const nodes = glb.json.nodes
  const parent = new Array<number>(nodes.length).fill(-1)
  nodes.forEach((n, i) => (n.children ?? []).forEach((c) => (parent[c] = i)))
  return nodes.map((n, i) => {
    const s = n.scale ?? [1, 1, 1]
    if (s.some((v) => Math.abs(v - 1) > 1e-3)) throw new Error(`${n.name}: scaled nodes aren't handled`)
    return { name: n.name ?? `node${i}`, parent: parent[i], t: new Vector3(...((n.translation ?? [0, 0, 0]) as [number, number, number])), r: new Quaternion(...((n.rotation ?? [0, 0, 0, 1]) as [number, number, number, number])) }
  })
}

/** Each node's rotation in the scene, from its local rotation (`local`, the rest pose's by default). */
function worldRotations(bones: Bone[], local: (b: Bone, i: number) => Quaternion = (b) => b.r): Quaternion[] {
  const out: Quaternion[] = []
  const at = (i: number): Quaternion => (out[i] ??= bones[i].parent < 0 ? local(bones[i], i).clone() : at(bones[i].parent).clone().multiply(local(bones[i], i)))
  bones.forEach((_, i) => at(i))
  return out
}

/** Each node's position in the scene at rest. */
function worldPositions(bones: Bone[]): Vector3[] {
  const rot = worldRotations(bones)
  const out: Vector3[] = []
  const at = (i: number): Vector3 => (out[i] ??= bones[i].parent < 0 ? bones[i].t.clone() : bones[i].t.clone().applyQuaternion(rot[bones[i].parent]).add(at(bones[i].parent)))
  bones.forEach((_, i) => at(i))
  return out
}

/** Each node's place in the scene at one frame: `rot` its rotations in the scene, the hips at their animated `hips`. */
function positionsAt(bones: Bone[], rot: Quaternion[], hipsIndex: number, hips: Vector3): Vector3[] {
  const out: Vector3[] = []
  const at = (i: number): Vector3 => {
    if (out[i]) return out[i]
    const t = i === hipsIndex ? hips : bones[i].t
    return (out[i] = bones[i].parent < 0 ? t.clone() : t.clone().applyQuaternion(rot[bones[i].parent]).add(at(bones[i].parent)))
  }
  bones.forEach((_, i) => at(i))
  return out
}

const indexOf = (bones: Bone[], name: string) => {
  const i = bones.findIndex((b) => b.name === name)
  if (i < 0) throw new Error(`no bone ${name}`)
  return i
}

// ------------------------------------------------------------------------------------------------ retargeting

const UP = new Vector3(0, 1, 0)
/** The library's shoulder bones: our clavicles take their turn from relaxed, not where they point (relaxedShoulders). */
const SHOULDERS = ['LeftShoulder', 'RightShoulder']

/** A body to retarget onto: its rest rotations in the scene, and its hips' rest position. */
interface Target {
  bones: Bone[]
  world: Quaternion[]
  index: number[]
  parentOf: number[]
  hips: Vector3
}

function target(path: string): Target {
  const bones = bonesOf(readGlb(path))
  const index = RIG.map(([ours]) => indexOf(bones, ours))
  return { bones, world: worldRotations(bones), index, parentOf: index.map((i) => bones[i].parent), hips: worldPositions(bones)[index[0]] }
}

/**
 * The RPM T-pose turned onto ours: walking down the skeleton, each mapped bone is swung (no twist) so it points along
 * our bone at rest, carrying its children with it. Returns each RPM bone's rotation in that pose, by name.
 */
function alignedPose(source: Bone[], ours: Target): Map<string, Quaternion> {
  const ourBone = new Map(RIG.map(([o, s], k) => [s, ours.index[k]]))
  const out: Quaternion[] = []
  const at = (i: number): Quaternion => {
    if (out[i]) return out[i]
    const b = source[i]
    const q = (b.parent < 0 ? new Quaternion() : at(b.parent).clone()).multiply(b.r)
    const mine = ourBone.get(b.name)
    if (mine !== undefined) {
      const from = UP.clone().applyQuaternion(q)
      const to = UP.clone().applyQuaternion(ours.world[mine])
      q.premultiply(new Quaternion().setFromUnitVectors(from, to))
    }
    return (out[i] = q)
  }
  source.forEach((_, i) => at(i))
  return new Map(source.map((b, i) => [b.name, out[i]]))
}

interface Track {
  times: Float32Array
  values: Float32Array
  width: number
}

/**
 * The library's shoulders as it stands: each shoulder bone's mean turn in its chest over the stance idle (`idle`). Its
 * shoulder bone starts nearer the neck than our clavicle, so a relaxed shoulder points 2° above its chest's level in its
 * rig and 10° below in ours, and copying where it points stood every hero with its shoulders shrugged 12°. Our
 * clavicles take the performer's turn from these instead (retarget): a relaxed shoulder is our rest clavicle, and a
 * clip lifts ours as far as the performer lifted theirs.
 */
function relaxedShoulders(idle: string): Map<string, Quaternion> {
  const glb = readGlb(idle)
  const bones = bonesOf(glb)
  const anim = glb.json.animations?.[0]
  if (!anim) throw new Error(`${idle}: no animation`)
  const out = new Map<string, Quaternion>()
  for (const name of SHOULDERS) {
    const node = indexOf(bones, name)
    const ch = anim.channels.find((c) => c.target.node === node && c.target.path === 'rotation')
    if (!ch) {
      out.set(name, bones[node].r.clone())
      continue
    }
    const s = anim.samplers[ch.sampler]
    const track = { times: readAccessor(glb, s.input), values: readAccessor(glb, s.output), width: 4 }
    const duration = track.times[track.times.length - 1]
    const sum = new Quaternion(0, 0, 0, 0)
    const q = new Quaternion()
    const tmp: number[] = []
    for (let f = 0; f <= Math.round(duration * FPS); f++) {
      q.fromArray(sample(track, Math.min(duration, f / FPS), tmp))
      // each frame on the first's side of the sphere, so they average the short way
      const sign = f && q.dot(sum) < 0 ? -1 : 1
      sum.set(sum.x + q.x * sign, sum.y + q.y * sign, sum.z + q.z * sign, sum.w + q.w * sign)
    }
    out.set(name, sum.normalize())
  }
  return out
}

function sample(track: Track, t: number, out: number[]): number[] {
  const { times, values, width } = track
  let i = 0
  while (i < times.length - 2 && times[i + 1] <= t) i++
  const span = times[i + 1] - times[i]
  const f = times.length < 2 || span <= 0 ? 0 : Math.min(1, Math.max(0, (t - times[i]) / span))
  const j = times.length < 2 ? 0 : i + 1
  if (width === 4) {
    const a = new Quaternion().fromArray(values, i * 4)
    const b = new Quaternion().fromArray(values, j * 4)
    a.slerp(b, f).toArray(out)
  } else for (let k = 0; k < width; k++) out[k] = values[i * width + k] * (1 - f) + values[j * width + k] * f
  return out
}

interface Retargeted {
  frames: number
  /** Per frame, per rig bone, x y z w. */
  rot: Float32Array
  /** Per frame, the hips' x y z in metres. */
  pos: Float32Array
  /**
   * How far the clip was turned to face ahead, in degrees: by its chest's mean facing, or a looping move by where it
   * goes. Then where its chest faces on average once turned, and how far it swings about that.
   */
  yaw: number
  chest: number
  spread: number
  /** A looping move's seam (seamOf): at OPEN_SEAM or more, it ended a frame short and was given its first frame again. */
  seam: number
  /**
   * Where the head looks over the clip, in degrees from level ahead: its highest and lowest, and its furthest aside;
   * and the furthest it leans from upright, any way (a nod or a tilt to a shoulder).
   */
  look: { up: number; down: number; aside: number; lean: number }
  gait: Gait
}

/**
 * How a looping move covers the ground, for blending moves in step (the arena's locomotion): metres a second at 1x on
 * our medium body, how many strides (left foot to left foot) the clip holds, and the second the left foot first
 * reaches furthest the way the clip goes, which is where it lands.
 */
interface Gait {
  speed: number
  strides: number
  strike: number
}

function retarget(path: string, aligned: Map<string, Quaternion>, relaxed: Map<string, Quaternion>, sourceHipsY: number, ours: Target, way?: number): Retargeted {
  const glb = readGlb(path)
  const bones = bonesOf(glb)
  const anim = glb.json.animations?.[0]
  if (!anim) throw new Error(`${path}: no animation`)
  const rotations = new Map<number, Track>()
  let hipsTrack: Track | undefined
  const hips = indexOf(bones, 'Hips')
  const chest = indexOf(bones, 'Spine2')
  let duration = 0
  for (const ch of anim.channels) {
    const s = anim.samplers[ch.sampler]
    const track = { times: readAccessor(glb, s.input), values: readAccessor(glb, s.output), width: ch.target.path === 'rotation' ? 4 : 3 }
    duration = Math.max(duration, track.times[track.times.length - 1])
    if (ch.target.path === 'rotation') rotations.set(ch.target.node, track)
    else if (ch.target.path === 'translation' && ch.target.node === hips) hipsTrack = track
  }
  let frames = Math.max(2, Math.round(duration * FPS) + 1)
  const sourceIndex = RIG.map(([, s]) => indexOf(bones, s))
  const alignedInverse = RIG.map(([, s]) => aligned.get(s)!.clone().invert())
  // each clavicle: the performer's shoulder in its chest, its relaxed turn there taken away, and from the library's chest
  // into ours (its chest as aligned onto ours), with our clavicle's rest in its parent to put the turn on
  const shoulders = new Map(
    RIG.flatMap(([o, src], k) => {
      if (!SHOULDERS.includes(src)) return []
      const node = sourceIndex[k]
      const parent = bones[node].parent
      const intoOurs = ours.world[ours.parentOf[k]].clone().invert().multiply(aligned.get(bones[parent].name)!)
      const rest = ours.world[ours.parentOf[k]].clone().invert().multiply(ours.world[ours.index[k]])
      return [[k, { node, parent, relaxedInverse: relaxed.get(src)!.clone().invert(), intoOurs, outOfOurs: intoOurs.clone().invert(), rest }] as const]
    }),
  )
  const raw: Vector3[] = []
  const facing: number[] = []
  const tmp: number[] = []
  const worlds: Quaternion[][] = []
  const leftFoot = indexOf(bones, 'LeftFoot')
  const feet: Vector3[] = []
  const hipsAt: Vector3[] = []
  for (let f = 0; f < frames; f++) {
    const t = Math.min(duration, f / FPS)
    const local = (b: Bone, i: number) => {
      const track = rotations.get(i)
      return track ? new Quaternion().fromArray(sample(track, t, tmp)) : b.r
    }
    const world = worldRotations(bones, local)
    worlds.push(world)
    raw.push(hipsTrack ? new Vector3().fromArray(sample(hipsTrack, t, tmp)) : bones[hips].t.clone())
    const placed = positionsAt(bones, world, hips, raw[f])
    feet.push(placed[leftFoot])
    hipsAt.push(placed[hips])
    // the chest's facing (where the hero looks and aims, even while the hips turn into a strafe): its forward on the ground
    const fwd = new Vector3(0, 0, 1).applyQuaternion(world[chest].clone().multiply(aligned.get('Spine2')!.clone().invert()))
    facing.push(Math.atan2(fwd.x, fwd.z))
  }
  // a looping move's last frame has to lead straight back into its first. The library cuts its loops two ways: some
  // end a frame short of where they began, which played as a jump each time round (the feet skipped about 20 cm a
  // stride on the strafes), and some end on their first frame again, near enough. The first kind gets its first frame
  // again, carried on by the hips' drift; the other has what is left of its seam spread over the loop, further down
  const seam = way === undefined ? 0 : seamOf(worlds, sourceIndex)
  if (seam >= OPEN_SEAM) {
    const n = frames
    const on = (p: Vector3[]) => new Vector3(p[0].x + ((p[n - 1].x - p[0].x) * n) / (n - 1), p[0].y, p[0].z + ((p[n - 1].z - p[0].z) * n) / (n - 1))
    const hipsThen = on(hipsAt)
    feet.push(feet[0].clone().add(hipsThen.clone().sub(hipsAt[0])))
    hipsAt.push(hipsThen)
    raw.push(on(raw))
    worlds.push(worlds[0])
    facing.push(facing[0])
    frames = n + 1
  }
  const rot = new Float32Array(frames * RIG.length * 4)
  // the mean facing, unwrapped
  let sum = 0
  for (let f = 0; f < frames; f++) sum += facing[0] + Math.atan2(Math.sin(facing[f] - facing[0]), Math.cos(facing[f] - facing[0]))
  const chestYaw = sum / frames
  const around = facing.map((f) => Math.atan2(Math.sin(f - chestYaw), Math.cos(f - chestYaw)))
  const spread = ((Math.max(...around) - Math.min(...around)) * 180) / Math.PI
  // every clip faces the way its performer faced on average: the library recorded some (crouches, idles) turned aside.
  // A looping move goes `way` instead (0 ahead, a quarter turn to the performer's left): the hero's hips face its aim
  // while it moves, and the library's strafes run with the body turned most of the way toward where they go, the head
  // looking back, so facing their chests ahead would turn a strafe into a run straight ahead
  const travel = new Vector3(hipsAt[frames - 1].x - hipsAt[0].x, 0, hipsAt[frames - 1].z - hipsAt[0].z)
  const off = Math.atan2(travel.x, travel.z) - (way ?? 0)
  const yaw = way !== undefined && travel.length() > 0.05 ? Math.atan2(Math.sin(off), Math.cos(off)) : chestYaw
  const turn = new Quaternion().setFromAxisAngle(UP, -yaw)

  const ourWorld: Quaternion[] = RIG.map(() => new Quaternion())
  const prev = RIG.map(() => new Quaternion())
  const head = RIG.findIndex(([o]) => o === 'head')
  const look = { up: -90, down: 90, aside: 0, lean: 0 }
  const upright = new Vector3(0, 1, 0).applyQuaternion(ours.world[ours.index[head]])
  for (let f = 0; f < frames; f++) {
    const world = worlds[f]
    RIG.forEach((_, k) => {
      // the change from the aligned pose, in the scene, put on our bone's rest
      const change = turn.clone().multiply(world[sourceIndex[k]]).multiply(alignedInverse[k])
      ourWorld[k] = change.multiply(ours.world[ours.index[k]])
      const parentWorld = k === 0 ? ours.world[ours.parentOf[0]] ?? new Quaternion() : ourWorld[RIG.findIndex(([o]) => ours.bones[ours.parentOf[k]].name === o)]
      const shoulder = shoulders.get(k)
      if (shoulder) {
        // a clavicle turns in our chest as the performer's shoulder turned from relaxed in theirs (relaxedShoulders)
        const turned = world[shoulder.parent].clone().invert().multiply(world[shoulder.node]).multiply(shoulder.relaxedInverse)
        ourWorld[k] = parentWorld.clone().multiply(shoulder.intoOurs).multiply(turned).multiply(shoulder.outOfOurs).multiply(shoulder.rest)
      }
      const q = parentWorld.clone().invert().multiply(ourWorld[k]).normalize()
      // keep each track on one side of the sphere so it blends the short way
      if (f && q.dot(prev[k]) < 0) q.set(-q.x, -q.y, -q.z, -q.w)
      prev[k].copy(q)
      q.toArray(rot, (f * RIG.length + k) * 4)
    })
    // where the head looks: its forward at rest, turned as the clip turns it
    const ahead = new Vector3(0, 0, 1).applyQuaternion(ourWorld[head].clone().multiply(ours.world[ours.index[head]].clone().invert()))
    const pitch = (Math.asin(Math.min(1, Math.max(-1, ahead.y))) * 180) / Math.PI
    look.up = Math.max(look.up, pitch)
    look.down = Math.min(look.down, pitch)
    look.aside = Math.max(look.aside, (Math.abs(Math.atan2(ahead.x, ahead.z)) * 180) / Math.PI)
    look.lean = Math.max(look.lean, (new Vector3(0, 1, 0).applyQuaternion(ourWorld[head]).angleTo(upright) * 180) / Math.PI)
  }
  // a loop that ends on its first frame again: each bone takes on what is left of the seam a little more each frame,
  // so the last frame is the first exactly
  const closing = way !== undefined && seam < OPEN_SEAM
  if (closing) {
    const q = new Quaternion()
    const error = new Quaternion()
    const part = new Quaternion()
    RIG.forEach((_, k) => {
      error.fromArray(rot, ((frames - 1) * RIG.length + k) * 4).invert().multiply(q.fromArray(rot, k * 4))
      if (error.w < 0) error.set(-error.x, -error.y, -error.z, -error.w)
      for (let f = 1; f < frames; f++) {
        const at = (f * RIG.length + k) * 4
        q.fromArray(rot, at).multiply(part.identity().slerp(error, f / (frames - 1))).normalize().toArray(rot, at)
      }
    })
  }

  // the hips: the drift over the clip taken out (in place), centred, turned with the clip, and scaled to our height
  const scale = ours.hips.y / sourceHipsY
  const first = raw[0]
  const last = raw[frames - 1]
  const flat = raw.map((p, f) => {
    const k = f / (frames - 1)
    return new Vector3(p.x - first.x - (last.x - first.x) * k, p.y, p.z - first.z - (last.z - first.z) * k)
  })
  const mean = flat.reduce((m, p) => m.add(new Vector3(p.x, 0, p.z)), new Vector3()).multiplyScalar(1 / frames)
  const pos = new Float32Array(frames * 3)
  // the drift takes the seam out across the ground; a closing loop's height is evened out the same way
  const rise = closing ? last.y - first.y : 0
  flat.forEach((p, f) => {
    const off = new Vector3(p.x - mean.x, 0, p.z - mean.z).applyQuaternion(turn)
    pos[f * 3] = ours.hips.x + off.x * scale
    pos[f * 3 + 1] = ours.hips.y + (p.y - sourceHipsY - (rise * f) / (frames - 1)) * scale
    pos[f * 3 + 2] = ours.hips.z + off.z * scale
  })
  return { frames, rot, pos, seam, yaw: (yaw * 180) / Math.PI, chest: (Math.atan2(Math.sin(chestYaw - yaw), Math.cos(chestYaw - yaw)) * 180) / Math.PI, spread, look, gait: gaitOf(feet, hipsAt, scale) }
}

/** Past this (seamOf), a loop ends a frame short of where it began; below it, on its first frame again. */
const OPEN_SEAM = 0.5

/**
 * How a loop's last frame leads back into its first, against how its frames lead on from each other either side of
 * the seam, the median over the bones that move: about 1 when it ends a frame short of where it began, about 0 when
 * it ends on its first frame again.
 */
function seamOf(worlds: Quaternion[][], bones: number[]): number {
  const n = worlds.length
  const ratios: number[] = []
  for (const b of bones) {
    const near = (worlds[0][b].angleTo(worlds[1][b]) + worlds[n - 2][b].angleTo(worlds[n - 1][b])) / 2
    if (near > (2 * Math.PI) / 180) ratios.push(worlds[n - 1][b].angleTo(worlds[0][b]) / near)
  }
  ratios.sort((a, b) => a - b)
  return ratios.length ? ratios[ratios.length >> 1] : 0
}

/** A move's gait (see Gait) from its left foot and hips in the scene, frame by frame; `scale` is ours over the source. */
function gaitOf(feet: Vector3[], hips: Vector3[], scale: number): Gait {
  const frames = feet.length
  const travel = new Vector3(hips[frames - 1].x - hips[0].x, 0, hips[frames - 1].z - hips[0].z)
  const seconds = (frames - 1) / FPS
  const along = travel.length() > 0.05 ? travel.clone().normalize() : new Vector3(0, 0, 1)
  // how far ahead of the hips the left foot reaches, the way the clip goes; it lands at each peak
  const reach = feet.map((p, f) => (p.x - hips[f].x) * along.x + (p.z - hips[f].z) * along.z)
  const low = Math.min(...reach)
  const high = Math.max(...reach)
  const peaks: number[] = []
  // the clip loops, so its last frame is its first again: look for peaks on frames 0..frames-2, around the loop
  const n = frames - 1
  for (let f = 0; f < n; f++) {
    let peak = reach[f] > low + 0.6 * (high - low)
    for (let k = 1; peak && k <= 3; k++) peak = reach[f] >= reach[(f + k) % n] && reach[f] > reach[(f - k + n) % n]
    if (peak) peaks.push(f)
  }
  return { speed: Math.round(((travel.length() * scale) / seconds) * 100) / 100, strides: Math.max(1, peaks.length), strike: Math.round(((peaks[0] ?? 0) / FPS) * 1000) / 1000 }
}

/**
 * A stance holds its ground and looks ahead (the chest within 10° of its facing, the head within 20° of level and of
 * upright, and 55° of ahead), so the hero can stand in it in the creator's studio and the Loadout. An idle that turns
 * away, looks up, down or around, or stretches its neck, is an idle moment to play once in a while instead.
 */
const isStance = (r: Retargeted) => r.spread / 2 <= 10 && r.look.up <= 20 && r.look.down >= -20 && r.look.aside <= 55 && r.look.lean <= 20
const OUT_SETS = ['idle', 'fidget', 'move', 'dance', 'talk']
/** The looping moves, which the arena blends in step: walking, jogging, running and crouching, every way. */
const LOOPS = /^(?:walk|jog|run|crouch)(?:_back|_left|_right)?$/
/** Which way each looping move goes from the hips, the way yaw turns: a quarter turn is the performer's left. */
const WAYS: Record<string, number> = { '': 0, _left: Math.PI / 2, _back: Math.PI, _right: -Math.PI / 2 }

// ------------------------------------------------------------------------------------------------ writing

/**
 * Values as whole numbers (times `scale`), track by track: each component's frames in a row as changes from the frame
 * before, which are small and repeat, so the served file compresses several times over.
 */
function deltas(values: Float32Array, frames: number, width: number, scale: number): number[] {
  const tracks = values.length / (frames * width)
  const out: number[] = []
  for (let k = 0; k < tracks; k++)
    for (let c = 0; c < width; c++) {
      let prev = 0
      for (let f = 0; f < frames; f++) {
        const v = Math.round(values[(f * tracks + k) * width + c] * scale)
        out.push(v - prev)
        prev = v
      }
    }
  return out
}

/** Quaternion components in ten-thousandths (under a hundredth of a degree), the hips in millimetres. */
const ROT_SCALE = 10000
const POS_SCALE = 1000

rmSync(OUT, { recursive: true, force: true })
const report: string[] = []
const index: Record<string, unknown> = { version: 1, fps: FPS, bones: RIG.map(([o]) => o), rot: ROT_SCALE, pos: POS_SCALE, genders: {} }
let bytes = 0
for (const gender of ['m', 'f'] as Gender[]) {
  const folder = join(LIBRARY, gender === 'm' ? 'masculine' : 'feminine', 'glb')
  const tpose = bonesOf(readGlb(join(folder, gender === 'm' ? 'Masculine_TPose.glb' : 'Feminine_TPose.glb')))
  const relaxed = relaxedShoulders(join(folder, `${SETS.idle[gender].idle}.glb`))
  const ours = target(`public/heroes/${gender}-medium.glb`)
  const aligned = alignedPose(tpose, ours)
  const sourceHipsY = worldPositions(tpose)[indexOf(tpose, 'Hips')].y
  mkdirSync(join(OUT, gender), { recursive: true })
  const sets: Record<string, Record<string, number>> = Object.fromEntries(OUT_SETS.map((s) => [s, {}]))
  const gait: Record<string, Gait> = {}
  for (const [set, picks] of Object.entries(SETS)) {
    for (const [name, file] of Object.entries(picks[gender])) {
      const r = retarget(join(folder, `${file}.glb`), aligned, relaxed, sourceHipsY, ours, LOOPS.test(name) ? WAYS[name.match(/_(?:back|left|right)$/)?.[0] ?? ''] : undefined)
      const out = join(OUT, gender, `${name}.json`)
      writeFileSync(out, JSON.stringify({ frames: r.frames, from: file.split('/').pop(), rot: deltas(r.rot, r.frames, 4, ROT_SCALE), pos: deltas(r.pos, r.frames, 3, POS_SCALE) }))
      const size = gzipSync(readFileSync(out)).length
      bytes += size
      const into = set === 'idle' && !isStance(r) ? 'fidget' : set
      if (LOOPS.test(name)) gait[name] = r.gait
      sets[into][name] = Math.round(((r.frames - 1) / FPS) * 100) / 100
      const looks = `head ${r.look.down.toFixed(0)}..${r.look.up.toFixed(0)}° ±${r.look.aside.toFixed(0)}° lean ${r.look.lean.toFixed(0)}°`
      const strides = LOOPS.test(name) ? `  ${r.gait.speed} m/s, ${r.gait.strides} stride${r.gait.strides > 1 ? 's' : ''}, lands ${r.gait.strike}s, seam ${r.seam.toFixed(2)}${r.seam >= OPEN_SEAM ? ' (+1 frame)' : ''}` : ''
      report.push(`${gender} ${into.padEnd(6)} ${name.padEnd(12)} ${String(r.frames).padStart(4)} frames  ${(size / 1024).toFixed(1).padStart(5)} KB gzipped  turned ${r.yaw.toFixed(1).padStart(6)}°, chest ${r.chest.toFixed(0).padStart(4)}° ±${(r.spread / 2).toFixed(0)}°  ${looks}${strides}`)
    }
  }
  // the body it was fitted to at rest, so a body of another size can take each bone's change from rest (anim-library.ts)
  const rest = ours.index.map((i) => ours.bones[i].r.toArray().map((v) => Math.round(v * 1e6) / 1e6))
  ;(index.genders as Record<string, unknown>)[gender] = { rest, hips: ours.hips.toArray().map((v) => Math.round(v * 1e5) / 1e5), sets, gait }
}
writeFileSync(join(OUT, 'index.json'), JSON.stringify(index))
console.log(`${report.join('\n')}\n${(bytes / 1024).toFixed(0)} KB gzipped in all`)
