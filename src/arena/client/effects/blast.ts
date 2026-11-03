import * as THREE from 'three'
import type { BuildSlot } from '../../../charter/types.js'
import type { MeshKind } from './draw.js'
import { hot, setOpacity } from './draw.js'
import type { DebrisPool } from './debris.js'
import type { Decals, Mark } from './decals.js'
import type { SpriteSpec } from './vfx.js'

/**
 * Blasts (GAME.md §6b, "big hits must visibly change the world"): every blast is layered (an anticipation flash, a
 * shock ring, a smoke and dust plume, debris chunks, sparks, a lingering haze) at one of five tiers set by what caused
 * it: a light hit, a heavy, a combo finisher, a spell, an ultimate. Each tier also sets the hit feel (hit-stop, camera
 * shake and kick, radial blur and speed lines on heavies and ultimates, an anime impact frame on ultimates) and what it
 * leaves on the ground (a crater and rubble where heavies, slams and ultimates land; the element's mark for a spell).
 */
export type Tier = 'light' | 'heavy' | 'finisher' | 'spell' | 'ultimate'
export type Layer = 'anticipation' | 'ring' | 'plume' | 'debris' | 'sparks' | 'haze'
export const LAYERS: readonly Layer[] = ['anticipation', 'ring', 'plume', 'debris', 'sparks', 'haze']

export interface Feel {
  /** Seconds the picture freezes. */
  stop: number
  /** Camera shake, metres. */
  shake: number
  /** The camera knocked back along the blow, metres. */
  kick: number
  /** Radial blur toward the blast, 0-1. */
  blur: number
  /** Speed lines streaming out of the blast. */
  lines: boolean
  /** The anime impact frame: two frames of ink. */
  impactFrame: boolean
}

export interface TierSpec extends Feel {
  /** Size of every layer against a light hit's. */
  scale: number
  layers: readonly Layer[]
  /** Chunks thrown, before distance thins them. */
  debris: number
  /** A crater and rubble where it lands on the floor. */
  crater: boolean
}

export const TIERS: Record<Tier, TierSpec> = {
  light: { scale: 0.55, layers: ['anticipation', 'ring', 'sparks'], debris: 0, crater: false, stop: 0, shake: 0.04, kick: 0, blur: 0, lines: false, impactFrame: false },
  heavy: { scale: 1, layers: ['anticipation', 'ring', 'plume', 'debris', 'sparks'], debris: 8, crater: true, stop: 0.065, shake: 0.3, kick: 0.18, blur: 0.35, lines: true, impactFrame: false },
  finisher: { scale: 1.3, layers: LAYERS, debris: 12, crater: true, stop: 0.09, shake: 0.42, kick: 0.26, blur: 0.4, lines: true, impactFrame: false },
  spell: { scale: 1.5, layers: LAYERS, debris: 14, crater: false, stop: 0.035, shake: 0.28, kick: 0.1, blur: 0, lines: false, impactFrame: false },
  ultimate: { scale: 2.4, layers: LAYERS, debris: 36, crater: true, stop: 0.12, shake: 0.8, kick: 0.45, blur: 0.6, lines: true, impactFrame: true },
}

/** What a basic blow was: the third in its chain (the finisher), or a held heavy. From the cast event. */
export interface Blow {
  step?: number
  heavy?: number
}

/**
 * The tier of a hit: an ultimate's or a spell's by its slot; a basic blow by what it was (a combo finisher, a held
 * heavy, or one that took a big bite of health), else light. A movement skill or a passive proc hits as a heavy when
 * it bites hard, else light.
 */
export function tierOf(slot: BuildSlot, heavy: boolean, blow?: Blow): Tier {
  if (slot === 'ultimate') return 'ultimate'
  if (slot === 'active1' || slot === 'active2') return 'spell'
  if (slot === 'basic' && blow?.step === 2) return 'finisher'
  if (heavy || (slot === 'basic' && blow?.heavy !== undefined)) return 'heavy'
  return 'light'
}

const ELEMENTS: [Mark, readonly string[]][] = [
  ['frost', ['ice', 'frost', 'cold', 'freeze', 'snow', 'chill']],
  ['acid', ['poison', 'acid', 'toxic', 'venom', 'plague']],
  ['char', ['lightning', 'shock', 'thunder', 'storm', 'electric', 'spark']],
  ['void', ['shadow', 'void', 'dark', 'abyss', 'curse', 'blood']],
  ['holy', ['holy', 'light', 'radiant', 'divine', 'sacred']],
  ['scorch', ['fire', 'flame', 'burn', 'heat', 'magma', 'lava', 'meteor', 'explosion', 'blast', 'bomb']],
  ['crater', ['earth', 'stone', 'rock', 'quake', 'slam', 'ground', 'impact']],
]

/** The mark a spell leaves on the floor, from its tags; scorch when nothing names an element. */
export function elementOf(tags: readonly string[]): Mark {
  for (const [mark, words] of ELEMENTS) if (tags.some((t) => words.includes(t))) return mark
  return 'scorch'
}

export interface BlastKit {
  flash: (at: THREE.Vector3, c: THREE.Color, size: number) => void
  sparkle: (spec: SpriteSpec) => void
  puff: (spec: SpriteSpec) => void
  show: (kind: MeshKind, c: THREE.Color, duration: number, place: (m: THREE.Mesh) => void, update: (p: number, m: THREE.Mesh) => void, opacity?: number) => void
  later: (seconds: number, fn: () => void) => void
  floorAt: (p: { x: number; y: number; z: number }) => number
  camera: () => THREE.Camera
  debris: DebrisPool
  decals: Decals
  clock: () => number
  /** Hand the hit feel to the screen: freeze, shake, kick, blur, lines, impact frame. */
  feel: (f: Feel, at: THREE.Vector3, dir?: THREE.Vector3) => void
}

export interface BlastOptions {
  /** Which way the blow was going: the debris follows it, the camera is kicked along it. */
  dir?: THREE.Vector3
  /** The area it covers, metres (a spell's radius); a blast is never smaller than its tier's. */
  radius?: number
  /** The spell's mark on the floor. */
  mark?: Mark
  /** No hit feel (another blast this tick already gave it). */
  quiet?: boolean
}

const DUST = new THREE.Color(0.74, 0.7, 0.64)
const STONE = new THREE.Color(0.55, 0.53, 0.5)

/** How much of a shake or a hit feel `distance` metres from the camera reaches it: all within 15 m, none past 50. */
export const nearness = (distance: number) => Math.min(1, Math.max(0, 1 - (distance - 15) / 35))

/**
 * The share of a blast's hit feel that reaches the screen: all of it within 15 m of the camera, none past 50 m, so a
 * brawl across the map does not shake or blur the view of this one. The blur, the speed lines and the impact frame
 * also need the blast on screen.
 */
export function feelAt(f: Feel, distance: number, seen: boolean): Feel {
  const w = nearness(distance)
  const v = seen ? w : 0
  return { stop: w > 0.4 ? f.stop : 0, shake: f.shake * w, kick: f.kick * w, blur: f.blur * v, lines: f.lines && v > 0.5, impactFrame: f.impactFrame && v > 0.4 }
}

/** Effects thin with distance (§6b): full detail within 25 m of the camera, down to a third at 75 m and beyond. */
export function detailAt(distance: number): number {
  return Math.min(1, Math.max(0.33, 1 - (distance - 25) / 75))
}

export function createBlasts(kit: BlastKit) {
  return (tier: Tier, where: THREE.Vector3, color: THREE.Color, options: BlastOptions = {}) => {
    const spec = TIERS[tier]
    const at = where.clone()
    const floor = kit.floorAt(at)
    // within reach of the floor, a blast's ring and its scars lie on it; higher up, they face the camera
    const grounded = at.y - floor < 2
    const detail = detailAt(kit.camera().position.distanceTo(at))
    const size = Math.max(spec.scale, (options.radius ?? 0) * 0.9)
    const c = color.clone()
    const has = (l: Layer) => spec.layers.includes(l) && (detail > 0.5 || (l !== 'haze' && l !== 'plume'))
    // a spell or an ultimate draws in on itself for a beat before it bursts
    const windup = tier === 'spell' || tier === 'ultimate' ? 0.07 : 0
    if (has('anticipation')) {
      if (windup) {
        kit.show('face', hot(c, 0.6), windup, (m) => (m.position.copy(at), m.lookAt(kit.camera().position)), (p, m) => (m.scale.setScalar(size * (1.6 - 1.3 * p)), setOpacity(m, 0.4 + 0.6 * p)))
        kit.flash(at, hot(c, 0.8), size * 0.5)
      } else kit.flash(at, hot(c, 0.75), size * 0.7)
    }
    if (!options.quiet && spec.stop + spec.shake + spec.kick + spec.blur > 0) kit.later(windup, () => kit.feel(spec, at, options.dir))
    kit.later(windup, () => {
      kit.flash(at, c, size * 1.1)
      if (has('ring')) {
        if (grounded) {
          const y = floor + 0.06
          kit.show('shock', hot(c, 0.3), 0.45 + 0.1 * spec.scale, (m) => (m.position.set(at.x, y, at.z), m.scale.setScalar(size * 0.4)), (p, m) => (m.scale.setScalar(size * (0.4 + 2.2 * p)), setOpacity(m, 0.95 * (1 - p))))
        } else kit.show('face', hot(c, 0.4), 0.3, (m) => (m.position.copy(at), m.lookAt(kit.camera().position)), (p, m) => (m.scale.setScalar(size * (0.4 + 1.8 * p)), setOpacity(m, 1 - p)))
      }
      if (has('sparks')) {
        const n = Math.ceil((8 + 14 * spec.scale) * detail)
        kit.sparkle({ at, count: n, kind: 'glow', life: 0.35 + 0.1 * spec.scale, size: [0.1 * spec.scale, 0.02], color: hot(c, 0.45), speed: 4 + 3 * spec.scale, gravity: 12, ...(options.dir ? { velocity: { x: options.dir.x * 3, y: 1, z: options.dir.z * 3 } } : {}) })
        kit.sparkle({ at, count: Math.ceil(6 * spec.scale * detail), kind: 'star', life: 0.22, size: [0.35 * spec.scale, 0.05], color: hot(c, 0.7), speed: 2, spin: 6 })
      }
      if (has('plume')) {
        const base = { x: at.x, y: grounded ? floor + 0.2 : at.y, z: at.z }
        kit.puff({ at: base, count: Math.ceil((6 + 8 * spec.scale) * detail), kind: 'smoke', life: 0.9 + 0.3 * spec.scale, size: [0.5 * spec.scale, 1.8 * spec.scale], color: DUST.clone().lerp(c, 0.25), speed: 2 + 1.5 * spec.scale, spread: size * 0.4, drag: 2, up: 0.6, alpha: 0.42, spin: 0.5 })
      }
      if (has('debris') && spec.debris) {
        const count = Math.round(spec.debris * detail)
        if (count) kit.debris.throw({ at: grounded ? { x: at.x, y: floor, z: at.z } : at, count, speed: 2.5 + 1.5 * spec.scale, up: 3 + 2 * spec.scale, size: [0.08, 0.12 + 0.08 * spec.scale], color: STONE, life: 4 + 2 * spec.scale, dir: options.dir, spread: size * 0.3 })
      }
      if (has('haze')) kit.later(0.15, () => kit.puff({ at: { x: at.x, y: (grounded ? floor : at.y) + 0.6, z: at.z }, count: Math.ceil(4 * spec.scale * detail), kind: 'smoke', life: 2.6 + spec.scale, size: [1.4 * spec.scale, 3 * spec.scale], color: DUST.clone().lerp(c, 0.15), speed: 0.4, spread: size * 0.6, drag: 1, up: 0.15, alpha: 0.16, spin: 0.2 }))
      // what it leaves: a crater and rubble where a heavy blow or an ultimate meets the floor, the element's mark under a
      // spell
      if (grounded) {
        if (spec.crater) {
          kit.decals.place('crater', { x: at.x, y: floor, z: at.z }, size * 1.3, kit.clock())
          if (detail > 0.5) kit.debris.throw({ at: { x: at.x, y: floor, z: at.z }, count: Math.ceil(spec.debris / 3), speed: 1.2, up: 1.5, size: [0.1, 0.2], color: STONE, life: 9, spread: size * 0.45 })
        }
        if (options.mark && (tier === 'spell' || tier === 'ultimate')) kit.decals.place(options.mark, { x: at.x, y: floor, z: at.z }, size * 1.6, kit.clock())
      }
    })
  }
}
