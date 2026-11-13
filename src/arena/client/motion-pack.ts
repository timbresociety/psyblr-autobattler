import * as THREE from 'three'
import { derived } from './clip-source.js'

/**
 * The owner's own motion pack (2026-11-13): a folder of single-clip GLBs with an index, kept on this machine under
 * `.scratch/motion-pack` and read only by the dev server. It is never part of a build: `packIndex` answers nothing
 * outside development, and every hero then moves on the licensed library alone (anim-library.ts), as it does wherever
 * the pack has no clip for a move.
 *
 * A pack clip is keyed on the male medium body's rest (public/heroes/v2/m-medium.glb), bone for bone the library's
 * rig, with a `Root` above the hips that carries the clip's travel across the floor. Here it becomes a clip as the
 * library's are (each bone's `.quaternion`, and `Hips.position`), so it is fitted to any body the same way.
 *
 * **Who moves the body.** The engine does: where a hero stands, how far a dodge carries it and how high a jump rises
 * are the simulation's alone. So a pack clip's `Root` track, its authored travel, is dropped as it loads (what it was
 * is kept in `userData.travel`, to read, never to play), and what stays on the hips is the body's own motion about
 * the spot the engine holds: the dip of a landing, a stride's bob, a lean.
 */

/** Where the dev server serves the pack from; nothing is there in a build. */
export const PACK_URL = '/.scratch/motion-pack'

/** One clip of the pack's index (animation-index.json), as much of it as is read here. */
export interface PackEntry {
  id: string
  action: string
  category: string
  motionSet: string
  file: string
  durationSeconds: number
  /** Only a broad family is known (an emote, a numbered skill segment): look at it before giving it a job. */
  needsPurposeReview: boolean
}

export interface PackIndex {
  /** Each action's clips, by id, in the index's order: `actions['jump-start'][0]` is its first variant. */
  actions: Readonly<Record<string, readonly string[]>>
  clips: ReadonlyMap<string, PackEntry>
}

/** The travel a pack clip was made with, on the `Root` it loaded with: where it ends from where it starts, and its turn. */
export interface PackTravel {
  /** Metres: across (x), up (y) and ahead (z) by the clip's end. */
  end: [number, number, number]
  /** Radians round the vertical by the clip's end. */
  turn: number
  /**
   * The travel itself, key by key from where it starts (x, y, z a key), for the moves that follow it: a climb's body
   * goes up and over as the clip was made to, fitted to the real ledge (match-view.ts). Absent on a clip that stays put.
   */
  path?: { times: Float32Array; values: Float32Array }
}

/** One animation channel read from a GLB: a node's translation, rotation or scale over time. */
export interface GlbChannel {
  node: string
  path: 'translation' | 'rotation' | 'scale' | 'weights'
  times: Float32Array
  values: Float32Array
}

const SIZES: Readonly<Record<string, number>> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }
const JSON_CHUNK = 0x4e4f534a
const BIN_CHUNK = 0x004e4942
const FLOAT = 5126

/**
 * The first animation in a binary glTF, channel by channel: only what a clip needs, with no meshes built and nothing
 * drawn, so it loads without a renderer. Float accessors with linear keys, which is what the pack holds.
 */
export function glbChannels(buffer: ArrayBuffer): { name: string; channels: GlbChannel[] } {
  const view = new DataView(buffer)
  if (view.byteLength < 20 || view.getUint32(0, true) !== 0x46546c67) throw new Error('not a binary glTF')
  let json: { nodes: { name?: string }[]; accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }[]; bufferViews: { byteOffset?: number; byteStride?: number }[]; animations?: { name?: string; channels: { sampler: number; target: { node: number; path: GlbChannel['path'] } }[]; samplers: { input: number; output: number }[] }[] } | undefined
  let bin = 0
  for (let at = 12; at + 8 <= view.byteLength; ) {
    const length = view.getUint32(at, true)
    const type = view.getUint32(at + 4, true)
    if (type === JSON_CHUNK) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, at + 8, length)))
    else if (type === BIN_CHUNK) bin = at + 8
    at += 8 + length
  }
  const animation = json?.animations?.[0]
  if (!json || !animation || !bin) throw new Error('no animation in the file')
  const read = (index: number): Float32Array => {
    const a = json.accessors[index]
    const v = json.bufferViews[a.bufferView]
    const width = SIZES[a.type]
    if (a.componentType !== FLOAT || !width) throw new Error(`accessor ${index}: not floats`)
    const start = bin + (v.byteOffset ?? 0) + (a.byteOffset ?? 0)
    const stride = v.byteStride ?? width * 4
    const out = new Float32Array(a.count * width)
    for (let k = 0; k < a.count; k++) for (let c = 0; c < width; c++) out[k * width + c] = view.getFloat32(start + k * stride + c * 4, true)
    return out
  }
  const channels = animation.channels.map((ch): GlbChannel => {
    const sampler = animation.samplers[ch.sampler]
    return { node: json.nodes[ch.target.node].name ?? '', path: ch.target.path, times: read(sampler.input), values: read(sampler.output) }
  })
  return { name: animation.name ?? '', channels }
}

const yawOf = (v: Float32Array, i: number) => Math.atan2(2 * (v[i + 3] * v[i + 1] + v[i] * v[i + 2]), 1 - 2 * (v[i + 1] * v[i + 1] + v[i] * v[i]))

/**
 * A pack file's channels as a clip of the library's kind, under `id`: each of `bones`' turns, and the hips' position.
 * The `Root`'s travel and turn are left out and noted (`userData.travel`); bones the rig hasn't got (the jaw) and scale
 * are left out too. It says which body's rest it is keyed on (`userData.rest`), for fitClip.
 */
export function packClipFrom(id: string, channels: readonly GlbChannel[], bones: readonly string[]): THREE.AnimationClip {
  const known = new Set(bones)
  const hips = bones[0]
  const tracks: THREE.KeyframeTrack[] = []
  let duration = 0
  const travel: PackTravel = { end: [0, 0, 0], turn: 0 }
  for (const ch of channels) {
    duration = Math.max(duration, ch.times[ch.times.length - 1] ?? 0)
    if (ch.node === 'Root') {
      const n = ch.values.length
      if (ch.path === 'translation' && n >= 6) {
        travel.end = [ch.values[n - 3] - ch.values[0], ch.values[n - 2] - ch.values[1], ch.values[n - 1] - ch.values[2]]
        if (Math.hypot(...travel.end) > 0.05) travel.path = { times: ch.times, values: ch.values.map((v, i) => v - ch.values[i % 3]) }
      }
      if (ch.path === 'rotation' && n >= 8) travel.turn = yawOf(ch.values, n - 4) - yawOf(ch.values, 0)
      continue
    }
    if (!known.has(ch.node)) continue
    if (ch.path === 'rotation') tracks.push(new THREE.QuaternionKeyframeTrack(`${ch.node}.quaternion`, ch.times, ch.values))
    else if (ch.path === 'translation' && ch.node === hips) tracks.push(new THREE.VectorKeyframeTrack(`${hips}.position`, ch.times, ch.values))
  }
  const clip = new THREE.AnimationClip(id, duration, tracks)
  clip.userData = { rest: 'm', pack: true, travel, source: { clip: id, from: 0, rate: 1 } }
  return clip
}

/** Whether this page may use the pack: a development build, and not told `?motion=library`. */
export function packWanted(): boolean {
  if (!import.meta.env.DEV || typeof location === 'undefined') return false
  return new URLSearchParams(location.search).get('motion') !== 'library'
}

let index: Promise<PackIndex | undefined> | undefined

/** The pack's index, fetched once; undefined in a build, when the pack isn't on this machine, or when it's switched off. */
export function packIndex(): Promise<PackIndex | undefined> {
  // spelled out here, and in each function below that reaches for the pack, so a build drops them whole: none of the
  // pack's names or paths is in what ships
  if (!import.meta.env.DEV || !packWanted()) return Promise.resolve(undefined)
  index ??= fetch(`${PACK_URL}/animation-index.json`)
    .then((r) => (r.ok ? (r.json() as Promise<{ actions: Record<string, string[]>; clips: PackEntry[] }>) : undefined))
    .then((raw) => (raw?.actions && Array.isArray(raw.clips) ? { actions: raw.actions, clips: new Map(raw.clips.map((c) => [c.id, c])) } : undefined))
    .catch(() => undefined)
  return index
}

const clips = new Map<string, Promise<THREE.AnimationClip | undefined>>()

/**
 * One pack clip by the action it plays (`jump-start`: its first variant, or its `variant`-th) or by its own id, as a
 * library clip on `bones`; fetched once. With a motion `set`, that set's own clip for the action where it has one
 * (its first, in the index's order), and the plain variant where it hasn't: a set keeps its own stance, gait, jumps
 * and blows, and shares the rest. Resolved through the index's `actions` and the file it lists: no path is guessed.
 * Undefined when there is no pack or it has no such clip.
 */
export function packClip(action: string, bones: readonly string[], variant = 1, set?: string): Promise<THREE.AnimationClip | undefined> {
  if (!import.meta.env.DEV) return Promise.resolve(undefined)
  const key = `${action}#${variant}#${set ?? ''}`
  let clip = clips.get(key)
  if (!clip) {
    clip = packIndex().then(async (idx) => {
      const own = set ? idx?.actions[action]?.find((id) => idx.clips.get(id)?.motionSet === set) : undefined
      const id = own ?? (idx?.clips.has(action) ? action : idx?.actions[action]?.[variant - 1])
      const entry = id ? idx!.clips.get(id) : undefined
      if (!entry) return undefined
      const r = await fetch(`${PACK_URL}/${entry.file}`)
      if (!r.ok) return undefined
      const out = packClipFrom(entry.id, glbChannels(await r.arrayBuffer()).channels, bones)
      out.userData.set = entry.motionSet
      return out
    })
    clip.catch(() => clips.delete(key))
    clips.set(key, clip)
  }
  return clip.catch(() => undefined)
}

const at3 = new THREE.Vector3()
/**
 * Where a clip's own travel has the body when the source's second `seconds` plays: from where it ends up, so [0, 0, 0]
 * at its end. Undefined for a clip made without travel.
 */
export function travelFromEnd(clip: THREE.AnimationClip, seconds: number): [number, number, number] | undefined {
  const travel = clip.userData?.travel as PackTravel | undefined
  const path = travel?.path
  if (!travel || !path) return undefined
  const { times, values } = path
  let k = 0
  while (k < times.length - 2 && times[k + 1] < seconds) k++
  const u = Math.min(1, Math.max(0, (seconds - times[k]) / Math.max(1e-6, times[k + 1] - times[k])))
  at3.fromArray(values, k * 3).lerp(new THREE.Vector3().fromArray(values, (k + 1) * 3), u)
  return [at3.x - travel.end[0], at3.y - travel.end[1], at3.z - travel.end[2]]
}

/** `clip` looping: the same clip, told to loop, for the view (characters.ts) to play round. */
export function looping(clip: THREE.AnimationClip): THREE.AnimationClip {
  const out = derived(clip, new THREE.AnimationClip(clip.name, clip.duration, clip.tracks))
  out.userData.loop = true
  return out
}

/** One engine move's clip from the pack: which action, the part of it that plays, and what was checked on it. */
export interface PackMove {
  action: string
  variant?: number
  /** Seconds into the clip, from and to: the part that plays. The whole clip without it. */
  cut?: readonly [from: number, to: number]
  /** The same as shares of the clip's length (0 to 1), for a move whose clip is each motion set's own, of its own length. */
  part?: readonly [from: number, to: number]
  /** It plays round while its state lasts. */
  loop?: boolean
  /**
   * Seconds into the clip (as the pack has it) where its blow lands, read off the striking hand frame by frame and
   * checked on its contact sheet. The engine's release tick meets this frame (characters.ts releaseOf).
   */
  contact?: number
}

/**
 * The shared movement set: the pack's clip for each move the engine plays, by the name the view plays it under
 * (library-gait.ts LIBRARY_MOVES has the library's for the same names). Each was looked at on the medium body, frame
 * by frame, before it was given its move (.scratch/course/pack-sheets); a move not here plays the library's.
 *
 * - **Jumps.** A take-off is the push alone: the engine leaves the ground on the press, so the clip's squat before it
 *   (its first half, a third at a run) would play in the air. Standing it springs straight up; at a run it goes off one
 *   foot. The rise, the top and the fall are each their own clip, shown by how fast the body rises (animation.ts
 *   AirPhase). Every way a jump goes plays the same take-off, as the pack has no side or back one.
 * - **The ledge.** The pack clings to a wall rather than hanging from an edge: caught, held, shuffled along and vaulted
 *   over from a crouch on the wall, hands over the head.
 * - **Reactions.** A flinch, a daze, the flight back from a launch (its held part), the fall to the back, the get-up.
 */
export const PACK_MOVES: Readonly<Record<string, PackMove>> = {
  jump: { action: 'forward-jump-start', part: [0.35, 1] },
  jump_up: { action: 'jump-start', part: [0.5, 1] },
  jump_left: { action: 'jump-start', part: [0.5, 1] },
  jump_right: { action: 'jump-start', part: [0.5, 1] },
  jump_back: { action: 'jump-start', part: [0.5, 1] },
  air_jump: { action: 'jump-start', part: [0.5, 1] },
  air_jump_up: { action: 'jump-start', part: [0.5, 1] },
  air_jump_left: { action: 'jump-start', part: [0.5, 1] },
  air_jump_right: { action: 'jump-start', part: [0.5, 1] },
  air_jump_back: { action: 'jump-start', part: [0.5, 1] },
  air_rise: { action: 'jump-rise', loop: true },
  air_apex: { action: 'jump-apex' },
  air: { action: 'fall', loop: true },
  land: { action: 'land' },
  roll: { action: 'dodge-forward' },
  dash: { action: 'dash-start' },
  dash_air: { action: 'air-dash-start' },
  crouch: { action: 'crouch-idle', loop: true },
  crouch_move: { action: 'crouch-walk-forward', loop: true },
  catch: { action: 'wall-climb-air-entry' },
  hang: { action: 'wall-climb-idle', loop: true },
  hang_left: { action: 'wall-climb-left', loop: true },
  hang_right: { action: 'wall-climb-right', loop: true },
  climb: { action: 'wall-climb-crest' },
  mantle: { action: 'wall-climb-crest' },
  // the flinch itself: the clip goes on into a second and more of staggering, far too much for a light hit
  hurt: { action: 'light-hit-react-front', cut: [0, 0.35] },
  stunned: { action: 'stunned', loop: true },
  launched: { action: 'knockback-backward', cut: [0.3, 0.6], loop: true },
  down: { action: 'knockdown-face-up' },
  get_up: { action: 'get-up-face-up' },
  regain: { action: 'air-recovery' },
}

/**
 * The equipped kit's motions the pack has: its clip for a library clip a hero's kit plays, by the library's name. The
 * fists' chain is the pack's three-blow combo, each motion set's own, each blow's contact its own (PACK_STYLES).
 */
export const PACK_KIT: Readonly<Record<string, string>> = {
  lead_jab: 'melee-combo-1',
  cross_punch: 'melee-combo-2',
  hook_punch: 'melee-combo-3',
}

/**
 * The pack's clip for a skill, by what the skill is (recipes/motions.ts `skillKey`): `action` is the pack clip's own
 * id, `contact` the second its shot leaves or its gesture peaks. Each was read on its contact sheet before it was
 * given its skill (.scratch/motion-pack-audit/described). A hero with any weapons takes these as an unarmed one does:
 * a Q and an R are cast with the hands emptied, and a shot from the bare hands holds nothing.
 */
export const PACK_SKILLS: Readonly<Record<string, PackMove>> = {
  // a shot from the bare hands: the plain set's own, an arm held out at the target and kicked by each shot; both
  // palms pulsed for a burst; the arms swept out to a fan; a deep lunge held behind a beam; hands drawn in, then thrust
  'shot:emitter:single': { action: 'aim-shot-small--variant-001', contact: 0.1 },
  'shot:emitter:auto': { action: 'aim-shot-small--variant-001', contact: 0.1 },
  'shot:emitter:burst': { action: 'aim-shot-small--variant-004', contact: 0.55 },
  'shot:emitter:spread': { action: 'aim-shot-small--variant-021', contact: 0.24 },
  'shot:emitter:held': { action: 'aim-shot--variant-002', contact: 0.15, loop: true },
  'shot:emitter:charge': { action: 'aim-shot-small--variant-031', contact: 0.5 },
  // Q: fists to the floor for a stun, a hand pressed to it for a root; palms shoved out; an arm thrust up to lift;
  // a hand to the mouth to heal, crossed fists for a shield, a knee beside the fallen; arms flung up and open to call
  // minions; what is built is knelt to, stamped or planted; a hand held out at the one a trick takes
  'cast:stun': { action: 'finisher--variant-017', contact: 0.57 },
  'cast:root': { action: 'finisher--variant-001', contact: 0.54 },
  'cast:push': { action: 'skill-2-segment-00--variant-040', contact: 0.43 },
  'cast:lift': { action: 'finisher--variant-013', contact: 0.43 },
  'cast:heal': { action: 'use-item-start--variant-001', contact: 0.8 },
  'cast:shield': { action: 'special-action-segment-00--variant-006', contact: 1.0 },
  'cast:revive': { action: 'revive-teammate-start--variant-001', contact: 0.43 },
  'cast:minions': { action: 'use-revive-item-start--variant-001', contact: 0.95 },
  'cast:clone': { action: 'aim-shot-small--variant-009', contact: 0.57 },
  'cast:decoy': { action: 'aim-shot-small-alternate--variant-002', contact: 0.29 },
  'cast:wall': { action: 'finisher--variant-003', contact: 0.55 },
  'cast:terrain': { action: 'aim-shot-end--variant-012', contact: 1.0 },
  'cast:portal': { action: 'aim-shot-small--variant-015', contact: 0.29 },
  'cast:turret': { action: 'revive-teammate-start--variant-003', contact: 0.43 },
  'cast:trap': { action: 'finisher--variant-020', contact: 0.52 },
  'cast:totem': { action: 'finisher--variant-002', contact: 0.54 },
  'cast:possess': { action: 'aim-shot-small--variant-020', contact: 0.3 },
  'cast:copyKit': { action: 'aim-shot-start--variant-006', contact: 0.21 },
  'cast:curse': { action: 'aim-shot-small--variant-035', contact: 0.3 },
  'cast:zone': { action: 'aim-shot-small--variant-023', contact: 0.2 },
  'cast:vision': { action: 'aim-shot-small--variant-013', contact: 0.17 },
  'cast:charged': { action: 'skill-2-segment-00--variant-015', contact: 1.14 },
  'cast:bolt': { action: 'aim-shot-small--variant-005', contact: 0.21 },
  'cast:substitute': { action: 'skill-3-segment-01--variant-004', contact: 0.2 },
  'cast:absorb': { action: 'aim-shot-small--variant-003', contact: 0.2 },
  'cast:reflect': { action: 'aim-shot-start--variant-015', contact: 0.21 },
  // E: a low lunge off the mark, a flying kick that homes, a long leap to one knee, a dive out of sight, a curl to
  // nothing, the body laid along its flight
  'move:dash': { action: 'melee-step-in--variant-001', contact: 0.3 },
  'move:homing': { action: 'air-melee-combo-3--variant-005', contact: 0.47 },
  'move:leap': { action: 'skill-2-segment-07--variant-002', contact: 0.43 },
  'move:burrow': { action: 'skill-3-segment-00--variant-013', contact: 0.57 },
  'move:teleport': { action: 'skill-2-segment-00--variant-010', contact: 0.4 },
  'move:flight': { action: 'special-action-segment-01--variant-003', loop: true },
  // F: each aura comes on with a power-up of its own
  'aura:numbers': { action: 'power-up-start--variant-001', contact: 0.57 },
  'aura:guard': { action: 'aim-shot-small--variant-003', contact: 0.2 },
  'aura:stealth': { action: 'skill-2-segment-00--variant-010', contact: 0.4 },
  'aura:state': { action: 'power-up-start--variant-009', contact: 0.57 },
  'aura:allies': { action: 'power-up-start--variant-007', contact: 0.86 },
  'aura:element': { action: 'power-up-start--variant-018', contact: 0.86 },
  // R: both hands slammed down, arms opened to the sky over a domain, raised for a rally, a flex and a roar
  'ult:devastation': { action: 'finisher--variant-040', contact: 0.5 },
  'ult:domain': { action: 'aim-shot-end--variant-010', contact: 0.86 },
  'ult:rally': { action: 'power-up-start--variant-029', contact: 0.86 },
  'ult:rampage': { action: 'finisher-start--variant-038', contact: 1.79 },
  'ult:form': { action: 'special-action-segment-02--variant-013', contact: 0.6 },
  'ult:giant': { action: 'power-up-start--variant-026', contact: 0.86 },
  'ult:titan': { action: 'aim-shot-start--variant-007', contact: 0.66 },
}

/** A looping gait as it was measured: metres a second at 1x, strides in the loop, the second the left foot lands. */
interface PackStride {
  speed: number
  strides: number
  strike: number
}

/**
 * One motion set of the pack, given to an attitude (kit/anim/attitude.ts). The pack holds forty sets that each carry
 * themselves their own way: a stance, a walk, a run, a sprint, jumps, a landing and a three-blow chain of their own,
 * over the moves all of them share (the ledge, the crouch, the reactions). Every set's stance, walk and run were
 * measured on the medium body (kit/bench/pack-audit.ts: lean, knee bend, elbows out, stance width, sway, shoulder
 * turn, cadence), scored against what each attitude is in those terms, and the nearest looked at on contact sheets
 * before it was given the attitude (2026-11-13).
 *
 * What the measuring found, and each number below is for: a set's stance opens on the way into it and its sprint on
 * the lean into it, a third to a half of the clip, so each loops from where its cycle starts (`from`, seconds; played
 * round whole, the way in popped once a cycle). Each loop's gait is read off its planted feet. Each blow's contact is
 * where its striking hand is fastest: these blows snap from pose to pose, and the hand is at its reach a frame later.
 */
export interface PackStyle {
  set: string
  stance: { from: number }
  walk: PackStride
  jog: PackStride
  /** The sprint: the set's sprint loop from where its cycle starts, or another of its loops (`action`) where that reads better. */
  run: PackStride & { from: number; action?: string }
  /** Seconds into each blow of the chain (PACK_KIT, in its order) where it lands. */
  contacts: readonly [number, number, number]
  /** Seconds to leave off the head of each blow: a first pose that isn't the stance's, or a frame that flips a limb. */
  starts?: readonly [number, number, number]
  /**
   * Actions the set has a clip of its own for that does not suit the attitude, read on its contact sheet: the plain
   * set's plays instead (a fall with both arms held out ahead reads as holding handlebars; the tall set sprints bent
   * double with an arm folded over its back).
   */
  lacks?: readonly string[]
}

export const PACK_STYLES: Readonly<Record<string, PackStyle>> = {
  // the plain set: a boxer's stance, the squarest of them. Its walk is a guard's shuffle, side-on, the same foot
  // leading every step: the library's walk stays
  neutral: { set: 'motion-set-001', stance: { from: 0.367 }, walk: { speed: 1.27, strides: 1, strike: 0.267 }, jog: { speed: 7.81, strides: 1, strike: 0.171 }, run: { from: 0.333, speed: 10.9, strides: 1, strike: 0.133 }, contacts: [0.2, 0.17, 0.18], lacks: ['walk-forward'] },
  // hunched and wide, arms hung out from the body, the heaviest walk and the deepest landing of the forty; slow blows.
  // Its sprint loop is a string of upright leaps that reads slower than its run, so it sprints on its run: a charge,
  // leant right over, one arm punched ahead
  brute: { set: 'motion-set-028', stance: { from: 0.767 }, walk: { speed: 1.72, strides: 1, strike: 0.333 }, jog: { speed: 8.28, strides: 1, strike: 0.467 }, run: { action: 'run-forward', from: 0, speed: 8.28, strides: 1, strike: 0.467 }, contacts: [0.4, 0.333, 0.5] },
  // upright, a hand up by the chin, the chest turning over an easy walk
  swagger: { set: 'motion-set-036', stance: { from: 0.767 }, walk: { speed: 1.61, strides: 1, strike: 0.267 }, jog: { speed: 5.6, strides: 1, strike: 0.233 }, run: { from: 0.3, speed: 11.49, strides: 1, strike: 0.2 }, contacts: [0.467, 0.5, 0.133] },
  // a low, wide crouch behind a raised guard, the run leant over on quick steps (the lowest stance of all holds an arm
  // straight out ahead through its walk, which read as aiming)
  // (its first blow turns on the spot before it lunges: the arm is out at 0.95 s; the hand is fastest in the turn, at 0.5)
  low: { set: 'motion-set-009', stance: { from: 0.433 }, walk: { speed: 2.66, strides: 1, strike: 0.167 }, jog: { speed: 7.03, strides: 1, strike: 0.167 }, run: { from: 0.333, speed: 11.24, strides: 1, strike: 0.1 }, contacts: [0.95, 0.467, 0.233], lacks: ['fall', 'jump-apex'] },
  // tall and narrow, the widest swing of hips and arms in the walk. Its chain has two blows of its own, a lunge and a
  // high kick, and the plain set's third; the lunge opens mid-run with a forearm flipped for a frame, left off. Its
  // sprint loop runs bent double with an arm folded over the back, so it sprints on its run; its dash and its fall
  // (hung by both hands, to look at) are the plain set's
  strut: { set: 'motion-set-016', stance: { from: 0.533 }, walk: { speed: 1.63, strides: 1, strike: 0.433 }, jog: { speed: 6.35, strides: 1, strike: 0.2 }, run: { action: 'run-forward', from: 0, speed: 6.35, strides: 1, strike: 0.2 }, contacts: [0.42, 0.33, 0.18], starts: [0.2, 0, 0], lacks: ['dash-start', 'fall'] },
}

/** The pack's gait: the loops it has for the ways and paces the library names, each from the hero's motion set. */
const PACK_GAIT = { walk: 'walk-forward', jog: 'run-forward', run: 'dash-loop' } as const

const styleOf = (attitude: string | undefined) => PACK_STYLES[attitude ?? 'neutral'] ?? PACK_STYLES.neutral
/** The style whose clip plays an action for `style`: its own, or the plain one for an action its set lacks. */
const sourceOfAction = (style: PackStyle, action: string) => (style.lacks?.includes(action) ? PACK_STYLES.neutral : style)

async function prepared(name: string, move: PackMove, bones: readonly string[], tools: PackTools, style: PackStyle, plain: boolean): Promise<THREE.AnimationClip | undefined> {
  const raw = await packClip(move.action, bones, move.variant, sourceOfAction(style, move.action).set)
  if (!raw) return undefined
  const span = move.part ? ([move.part[0] * raw.duration, move.part[1] * raw.duration] as const) : move.cut ? ([move.cut[0], Math.min(move.cut[1], raw.duration)] as const) : undefined
  const part = span && span[1] > span[0] ? tools.cut(raw, span[0], span[1], span[1] - span[0]) : raw
  const out = tools.named(part, name)
  if (move.loop) out.userData.loop = true
  if (move.contact !== undefined) out.userData.contact = move.contact
  // a set's own clip already carries itself its own way: it plays on the body's plain rest, without the attitude's
  // lean and bend laid over it again (anim-library.ts fitClip); a clip every set shares takes the attitude's as the
  // library's clips do
  if (plain && raw.userData.set === style.set) out.userData.plain = true
  return out
}

/** The helpers that cut and name a clip, the library's own (library-gait.ts): passed in, so this module stands alone. */
export interface PackTools {
  named: (clip: THREE.AnimationClip, name: string) => THREE.AnimationClip
  cut: (clip: THREE.AnimationClip, from: number, to: number, seconds: number) => THREE.AnimationClip
}

/**
 * The pack's clips for a hero: the movement set under the engine's names, and the pack's own for those of `kit` (the
 * library clips its kit plays) it has, each from the hero's attitude's motion set where that set has its own. Only
 * these are fetched, never the pack. Empty without a pack.
 */
export async function packMoves(bones: readonly string[], kit: readonly string[], tools: PackTools, attitude?: string): Promise<Map<string, THREE.AnimationClip>> {
  const out = new Map<string, THREE.AnimationClip>()
  if (!import.meta.env.DEV || !(await packIndex())) return out
  const style = styleOf(attitude)
  const plain = style !== PACK_STYLES.neutral
  const blows = Object.entries(PACK_KIT).flatMap(([name, action], k): [string, PackMove][] => (kit.includes(name) ? [[name, { action, contact: style.contacts[k], ...(style.starts?.[k] ? { cut: [style.starts[k], Infinity] as const } : {}) }]] : []))
  const wanted = [...Object.entries(PACK_MOVES), ...blows]
  const clips = await Promise.all(wanted.map(([name, move]) => prepared(name, move, bones, tools, style, plain)))
  wanted.forEach(([name], k) => {
    const clip = clips[k]
    if (!clip) return
    // a blow the set has no clip of its own for is the plain set's, with the plain set's contact
    const blow = Object.keys(PACK_KIT).indexOf(name)
    if (blow >= 0 && clip.userData.set !== style.set) clip.userData.contact = PACK_STYLES.neutral.contacts[blow]
    out.set(name, clip)
  })
  return out
}

/**
 * The pack's clips for a hero's skills: `skills` are each slot's library clip with what the skill is (`skillKey`), and
 * the pack's clip for it comes back under the library clip's name, to play in its place. The first slot to name a
 * library clip keeps it, where two slots play the same one. Empty without a pack.
 */
export async function packSkills(bones: readonly string[], skills: readonly (readonly [clip: string, key: string])[], tools: PackTools): Promise<Map<string, THREE.AnimationClip>> {
  const out = new Map<string, THREE.AnimationClip>()
  if (!import.meta.env.DEV || !(await packIndex())) return out
  const wanted = skills.filter(([clip, key], k) => PACK_SKILLS[key] && skills.findIndex(([c]) => c === clip) === k)
  const clips = await Promise.all(wanted.map(([clip, key]) => prepared(clip, PACK_SKILLS[key], bones, tools, PACK_STYLES.neutral, false)))
  wanted.forEach(([clip], k) => clips[k] && out.set(clip, clips[k]!))
  return out
}

/** The pack's stance and gait loops for a hero's attitude (PACK_STYLES), each loop with its gait; undefined without a pack. */
export async function packGait(bones: readonly string[], tools: PackTools, attitude?: string): Promise<{ stance?: THREE.AnimationClip; clips: Map<string, THREE.AnimationClip>; gaits: Record<string, PackStride> } | undefined> {
  if (!import.meta.env.DEV || !(await packIndex())) return undefined
  const style = styleOf(attitude)
  const plain = style !== PACK_STYLES.neutral
  const names = Object.keys(PACK_GAIT) as (keyof typeof PACK_GAIT)[]
  const action = (name: keyof typeof PACK_GAIT) => (name === 'run' && style.run.action) || PACK_GAIT[name]
  const from = (name: keyof typeof PACK_GAIT) => sourceOfAction(style, action(name))
  const [idle, ...loops] = await Promise.all([packClip('idle', bones, 1, style.set), ...names.map((name) => packClip(action(name), bones, 1, from(name).set))])
  const own = (clip: THREE.AnimationClip, out: THREE.AnimationClip) => {
    if (plain && clip.userData.set === style.set) out.userData.plain = true
    return out
  }
  const clips = new Map<string, THREE.AnimationClip>()
  const gaits: Record<string, PackStride> = {}
  names.forEach((name, k) => {
    const clip = loops[k]
    // a set with no loop of its own for a pace keeps the library's, gait and all
    const source = from(name)
    // (and a loop the plain set itself is better without is nobody's: the library's stays)
    if (!clip || clip.userData.set !== source.set || (source === PACK_STYLES.neutral && source.lacks?.includes(action(name)))) return
    const start = name === 'run' ? Math.min(source.run.from, clip.duration - 0.1) : 0
    const loop = start > 0 ? tools.cut(clip, start, clip.duration, clip.duration - start) : clip
    clips.set(name, own(clip, derived(loop, new THREE.AnimationClip(name, loop.duration, loop.tracks))))
    const { speed, strides, strike } = source[name]
    gaits[name] = { speed, strides, strike }
  })
  const settled = idle && idle.userData.set === style.set ? Math.min(style.stance.from, idle.duration - 0.2) : 0
  const stance = idle ? own(idle, settled > 0 ? tools.cut(idle, settled, idle.duration, idle.duration - settled) : idle) : undefined
  return { ...(stance ? { stance } : {}), clips, gaits }
}
