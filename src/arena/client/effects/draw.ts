import * as THREE from 'three'
import { MOTIFS, type Motif } from '../../../charter/skill-look.js'
import type { EffectRecipe, RecipeLayer } from '../../recipes/schema.js'
import { coneYaw, layerSize } from './sizing.js'
import { lightning, spiral, straight, type RibbonPath, type SpriteSpec } from './vfx.js'

/**
 * How each recipe primitive is drawn (R10, R11, R21): its shape, its motion and its colours. Sizes come from the
 * engine event that carried the hit, so the hit layer is exactly as big as what can hit (sizing.ts); every other
 * layer is decoration around it. Purely cosmetic: the engine never reads any of it.
 */

export type MeshKind =
  | 'shock'
  | 'face'
  | 'magic'
  | 'crack'
  | 'beam'
  | 'core'
  | 'cone'
  | 'band'
  | 'orb'
  | 'shell'
  | 'form'
  | 'slash'
  | 'pillar'
  | 'dome'
  | 'shard'
  | 'rock'
  | 'disc'
  | 'crescent'
  | 'vortex'
  | 'chain'

export interface Kit {
  camera: () => THREE.Camera
  /** A pooled mesh, placed once and then updated with its progress 0-1 until `duration` is up. */
  show: (kind: MeshKind, c: THREE.Color, duration: number, place: (m: THREE.Mesh) => void, update: (p: number, m: THREE.Mesh) => void, opacity?: number) => void
  sparkle: (spec: SpriteSpec) => void
  puff: (spec: SpriteSpec) => void
  motif: (spec: SpriteSpec) => void
  ribbon: (path: RibbonPath, c: THREE.Color, width: number, life: number, options?: { taper?: boolean; flicker?: boolean }) => void
  /** Run `fn` this many seconds from now (effect time, so a hit-stop holds it too). */
  later: (seconds: number, fn: () => void) => void
  shake: (amount: number) => void
  /** Tint the sky toward a colour for a while: a charge that darkens the heavens. */
  darken: (seconds: number, c: THREE.Color) => void
  /** A frozen, glowing copy of a hero, standing where it was: an afterimage. */
  ghost: (hero: number, at: THREE.Vector3, c: THREE.Color, life: number) => void
}

/** What the impact event knows beyond where it landed. */
export interface Extra {
  dir?: THREE.Vector3
  range?: number
  arc?: number
  caster?: THREE.Vector3
}

const white = new THREE.Color(1, 1, 1)
export const hot = (c: THREE.Color, k = 0.55) => c.clone().lerp(white, k)
const hsl = { h: 0, s: 0, l: 0 }
const chroma = (c: THREE.Color) => (c.getHSL(hsl), hsl.s * (1 - Math.abs(2 * hsl.l - 1)))
export const color = (r: EffectRecipe, i: 0 | 1 | 2) => new THREE.Color(r.palette[i])
/**
 * The colour for anything that covers an area. Many palettes lead with white for a hot core, and white drawn
 * additively over a whole cone or sphere washes the picture out, so pale colours give way to the recipe's richest.
 */
export function vivid(r: EffectRecipe, i: 0 | 1 | 2): THREE.Color {
  const c = color(r, i)
  if (chroma(c) >= 0.3) return c
  return ([0, 1, 2] as const).map((k) => color(r, k)).reduce((a, b) => (chroma(b) > chroma(a) ? b : a))
}

type Energy = THREE.MeshBasicMaterial & { fade?: { value: number } }
export function setOpacity(m: THREE.Mesh, o: number) {
  const mat = m.material as Energy
  if (mat.fade) mat.fade.value = o
  else mat.opacity = o
}
/** Scroll a flowing texture along its length. */
const scroll = (m: THREE.Mesh, by: number) => {
  const map = (m.material as THREE.MeshBasicMaterial).map
  if (map) map.offset.y -= by
}

const v3 = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.y, p.z)
const UP = new THREE.Vector3(0, 1, 0)
/** The aim turned by `yaw` radians about the vertical, flattened: a direction inside a fan. */
const turned = (dir: THREE.Vector3, yaw: number) => {
  const a = Math.atan2(dir.x, dir.z) + yaw
  return new THREE.Vector3(Math.sin(a), 0, Math.cos(a))
}
const randomIn = (radius: number) => {
  const a = Math.random() * Math.PI * 2
  const d = Math.sqrt(Math.random()) * radius
  return new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d)
}
const motifCell = (style?: string) => Math.max(0, MOTIFS.indexOf(style as Motif))

export function createDraw(kit: Kit) {
  const { show, sparkle, puff, later, ribbon } = kit

  /** A bright flash that pops and is gone: the punctuation on every impact. */
  const flash = (at: THREE.Vector3, c: THREE.Color, size: number) => {
    sparkle({ at, count: 1, kind: 'star', life: 0.14, size: [size * 1.6, size * 0.3], color: hot(c, 0.7), spin: 2 })
    sparkle({ at, count: 2, kind: 'glow', life: 0.22, size: [size * 1.2, size * 2.2], color: c, alpha: 0.9 })
  }
  /** Sparks that burst out and fall. */
  const sparks = (at: THREE.Vector3, c: THREE.Color, count: number, speed: number, size = 0.12) =>
    sparkle({ at, count, kind: 'glow', life: 0.5, size: [size, size * 0.2], color: hot(c, 0.3), speed, gravity: 9, drag: 1.5 })
  const smokePop = (at: THREE.Vector3, c: THREE.Color, size: number) => {
    puff({ at, count: Math.round(10 + size * 4), kind: 'smoke', life: 1, size: [size * 0.5, size * 1.5], color: c.clone().lerp(new THREE.Color(0.85, 0.85, 0.88), 0.7), speed: 2 + size, spread: size * 0.3, drag: 2.5, alpha: 0.55, spin: 0.8 })
    sparkle({ at, count: 2, kind: 'star', life: 0.18, size: [size * 1.2, size * 0.2], color: hot(c, 0.6), spin: 3 })
  }
  /** A slash of light from the caster along the aim, with a tilt that makes it a diagonal cut. */
  const slash = (caster: THREE.Vector3, dir: THREE.Vector3, reach: number, c: THREE.Color, tilt: number, yaw = 0, life = 0.22, lift = 0) => {
    const aim = Math.atan2(dir.x, dir.z) + yaw
    show('slash', c, life, (m) => {
      m.position.set(caster.x, caster.y - 0.15 + lift, caster.z)
      m.rotation.set(0, 0, 0)
      // the arc's open side faces the swing direction
      m.rotateY(-aim + Math.PI / 2)
      m.rotateX(tilt)
      m.scale.setScalar(reach)
    }, (p, m) => (setOpacity(m, 1.3 * (1 - p) ** 1.5), m.scale.setScalar(reach * (0.9 + 0.2 * p))))
  }
  /** A straight streak of light from a to b: a thrust, a laser's core, a grapple's line. */
  const streak = (kind: MeshKind, a: THREE.Vector3, b: THREE.Vector3, width: number, c: THREE.Color, life: number, opacity = 0.9) => {
    const len = a.distanceTo(b)
    show(kind, c, life, (m) => (m.position.copy(a), m.lookAt(b), m.scale.set(width, width, len)), (p, m) => setOpacity(m, opacity * (1 - p)), opacity)
  }
  /** The low dome over an aura's ground at exactly its radius, so the area reads whatever it's made of. */
  const auraDome = (at: THREE.Vector3, v: THREE.Color, size: number, dur: number, strength: number) =>
    show('shell', v, dur, (m) => (m.position.set(at.x, Math.max(0, at.y - 1.1), at.z), m.scale.set(size, size * 0.45, size)), (p, m) => setOpacity(m, strength * (1 - p)), strength)

  function beam(style: string, r: EffectRecipe, at: THREE.Vector3, dir: THREE.Vector3, len: number, size: number, dur: number) {
    const c = color(r, 0)
    const v = vivid(r, 0)
    const accent = vivid(r, 2)
    const end = at.clone().addScaledVector(dir, len)
    const flow = (radius: number, strength: number, kind: MeshKind = 'beam') =>
      show(kind, v, dur, (m) => (m.position.copy(at), m.lookAt(end), m.scale.set(radius, radius, len)), (p, m) => {
        setOpacity(m, strength * (1 - p))
        scroll(m, 0.08)
        m.scale.x = m.scale.y = radius * (1 + 0.15 * Math.sin(p * 40))
      }, strength)
    const core = (radius: number, k = 0.6, strength = 0.5) => streak('core', at, end, radius, hot(v, k), dur * 0.8, strength)
    flash(at, v, size * 1.8)
    flash(end, v, size * 2.2)
    sparks(end, v, 16, 7)
    switch (style) {
      case 'crackle':
        // a narrower stream wrapped in lightning that strikes again and again along its length
        flow(size * 0.85, 0.5)
        core(size * 0.35)
        for (let k = 0; k < 4; k++) ribbon(lightning(at, end, size * 1.3, Math.random() * 100), hot(c, 0.35), 0.05 + size * 0.07, dur, { flicker: true })
        for (let k = 0; k < 4; k++) ribbon(lightning(end, end.clone().add(randomIn(size * 3).setY((Math.random() - 0.3) * size * 2)), size * 0.6, Math.random() * 100), hot(accent, 0.3), 0.05, dur * 0.7, { flicker: true })
        break
      case 'drill':
        // a hard thin core with a spiral turning fast around it
        core(size * 0.35, 0.7, 0.9)
        flow(size * 0.5, 0.35)
        ribbon(spiral(at, end, size * 0.95, Math.min(6, len * 0.5), 3), accent, size * 0.32, dur)
        ribbon(spiral(at, end, size * 0.95, Math.min(6, len * 0.5), 3, Math.PI), hot(accent, 0.3), size * 0.14, dur)
        break
      case 'laser': {
        // a thin, intense line that flickers, and embers kicked up along the ground under it
        show('core', hot(v, 0.7), dur, (m) => (m.position.copy(at), m.lookAt(end), m.scale.set(size * 0.3, size * 0.3, len)), (p, m) => setOpacity(m, (1 - p) * (0.8 + 0.2 * Math.sin(p * 80))), 1)
        core(size * 0.65, 0.2, 0.45)
        for (let k = 0; k < 8; k++) {
          const p = at.clone().addScaledVector(dir, (len * (k + 0.5)) / 8)
          sparkle({ at: { x: p.x, y: 0.15, z: p.z }, count: 3, kind: 'glow', life: 0.6, size: [0.14, 0.03], color: hot(accent, 0.3), speed: 0.8, velocity: { x: 0, y: 1.6, z: 0 } })
        }
        break
      }
      case 'helix':
        // two strands twisting round each other over a faint core
        core(size * 0.25, 0.5, 0.4)
        ribbon(spiral(at, end, size * 0.9, Math.min(6, len * 0.4), 2.5), v, size * 0.32, dur)
        ribbon(spiral(at, end, size * 0.9, Math.min(6, len * 0.4), 2.5, Math.PI), accent, size * 0.32, dur)
        break
      case 'pillar': {
        // pillars of light erupting one after another along the line, each as wide as the beam
        const step = Math.max(1.5, size * 2)
        const height = Math.max(2.5, size * 4)
        for (let d = 0; d <= len; d += step) {
          const p = at.clone().addScaledVector(dir, d)
          later((d / len) * 0.25, () => pillar(new THREE.Vector3(p.x, 0, p.z), v, size, height, 0.55))
        }
        break
      }
      case 'stream':
        // a flowing body, and a stream of light rushing down it
        flow(size, 0.45)
        for (let t = 0; t < 0.4; t += 1 / 30)
          later(t, () => sparkle({ at, count: 6, kind: 'glow', life: 0.3, size: [size * 0.9, size * 0.5], color: hot(v, 0.2), velocity: { x: (dir.x * len) / 0.3, y: (dir.y * len) / 0.3, z: (dir.z * len) / 0.3 }, spread: size * 0.4 }))
        break
      default: {
        // a wave: the flowing beam with a white-hot core and a swelling head where it hits
        flow(size, 0.85)
        core(size * 0.45, 0.75, 0.95)
        show('orb', hot(v, 0.3), dur, (m) => (m.position.copy(end), m.scale.setScalar(size * 1.6)), (p, m) => (m.scale.setScalar(size * (1.5 + 0.3 * Math.sin(p * 30))), setOpacity(m, 0.9 * (1 - p))))
        for (let k = 0; k < 5; k++) sparkle({ at: at.clone().addScaledVector(dir, (len * (k + 0.5)) / 5), count: 4, kind: 'glow', life: 0.35, size: [size * 0.7, 0.02], color: hot(c, 0.4), speed: 1.5, spread: size })
      }
    }
  }

  function pillar(at: THREE.Vector3, v: THREE.Color, radius: number, height: number, life: number) {
    show('pillar', v, life, (m) => (m.position.copy(at), m.scale.set(radius, 0.01, radius)), (p, m) => {
      m.scale.y = height * Math.min(1, p * 5)
      setOpacity(m, 0.9 * (1 - p) ** 1.2)
      scroll(m, -0.05)
    })
    flash(new THREE.Vector3(at.x, 0.3, at.z), v, radius * 1.4)
    sparkle({ at: { x: at.x, y: 0.4, z: at.z }, count: 16, kind: 'glow', life: 0.7, size: [0.2, 0.04], color: hot(v, 0.3), spread: radius, velocity: { x: 0, y: height * 1.4, z: 0 }, speed: 0.6 })
  }

  function cone(style: string, r: EffectRecipe, at: THREE.Vector3, dir: THREE.Vector3, range: number, arc: number) {
    const v = vivid(r, 0)
    const half = ((arc * Math.PI) / 180) * 0.45
    const within = () => turned(dir, (Math.random() * 2 - 1) * half)
    switch (style) {
      case 'breath':
        // a long rolling breath of it, not one puff
        for (let t = 0; t < 0.4; t += 1 / 30)
          later(t, () => {
            for (let k = 0; k < 3; k++) {
              const d = within()
              sparkle({ at, count: 3, kind: 'glow', life: 0.45, size: [0.25, range * 0.25], color: hot(v, 0.2), velocity: { x: d.x * range * 2.2, y: 0.3, z: d.z * range * 2.2 }, spread: 0.2, drag: 0.8 })
            }
            if (Math.random() < 0.3) puff({ at, count: 1, kind: 'smoke', life: 0.9, size: [0.4, 1.4], color: v.clone().lerp(new THREE.Color(0.25, 0.22, 0.2), 0.6), velocity: { x: dir.x * range * 1.4, y: 0.4, z: dir.z * range * 1.4 }, drag: 1.5, alpha: 0.3 })
          })
        break
      case 'shards':
        // splinters fanning out to the cone's edge
        for (let k = 0; k < 10; k++) {
          const d = within()
          const tip = at.clone().addScaledVector(d, range)
          show('shard', hot(v, 0.3), 0.3, (m) => (m.position.copy(at), m.lookAt(tip), m.scale.set(0.06, 0.06, 0.28)), (p, m) => (m.position.lerpVectors(at, tip, p), setOpacity(m, 1 - p * p)), 1)
        }
        sparkle({ at, count: 12, kind: 'star', life: 0.3, size: [0.3, 0.05], color: hot(v, 0.5), velocity: { x: dir.x * range * 2.5, y: 0, z: dir.z * range * 2.5 }, speed: range, spin: 6 })
        break
      case 'gust':
        // curved streaks of air racing out and dust kicked off the ground
        for (let k = 0; k < 3; k++) later(k * 0.06, () => slash(at, dir, range * (0.5 + 0.25 * k), hot(v, 0.5), (Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * half, 0.3, -0.6))
        puff({ at: { x: at.x, y: 0.3, z: at.z }, count: 8, kind: 'smoke', life: 0.8, size: [0.4, 1.4], color: new THREE.Color(0.8, 0.78, 0.74), velocity: { x: dir.x * range * 1.6, y: 0.3, z: dir.z * range * 1.6 }, speed: 1, drag: 2, alpha: 0.3 })
        break
      case 'sonic':
        // rings of sound spreading out across the fan, one after another
        for (let k = 0; k < 3; k++)
          later(k * 0.08, () =>
            show('band', hot(v, 0.2), 0.4, (m) => {
              m.geometry = bandGeometry(arc)
              m.position.set(at.x, 0.4 + at.y * 0.5, at.z)
              m.rotation.set(-Math.PI / 2, 0, coneYaw(dir))
              m.scale.setScalar(range * 0.15)
            }, (p, m) => (m.scale.setScalar(range * (0.15 + 0.85 * p)), setOpacity(m, 0.9 * (1 - p)))),
          )
        break
      default:
        // a spray out along the cone
        sparkle({ at, count: 34, kind: 'glow', life: 0.45, size: [0.3, 0.06], color: hot(v, 0.3), velocity: { x: dir.x * range * 2, y: 0.5, z: dir.z * range * 2 }, speed: range * 0.6, drag: 1.5 })
        puff({ at, count: 6, kind: 'smoke', life: 0.8, size: [0.4, 1.2], color: v.clone().lerp(new THREE.Color(0.2, 0.2, 0.2), 0.5), velocity: { x: dir.x * range, y: 0.3, z: dir.z * range }, speed: 1, drag: 2, alpha: 0.3 })
    }
  }

  function swing(style: string, r: EffectRecipe, caster: THREE.Vector3, dir: THREE.Vector3, reach: number, at: THREE.Vector3) {
    const v = vivid(r, 1)
    const tip = caster.clone().addScaledVector(dir, reach * 0.8)
    switch (style) {
      case 'punch':
        // a fist's shock ring popping where it lands
        streak('core', caster, tip, 0.1, hot(v, 0.5), 0.12)
        show('face', hot(v), 0.25, (m) => (m.position.copy(tip), m.lookAt(caster)), (p, m) => (m.scale.setScalar(0.3 + reach * 0.6 * p), setOpacity(m, 1 - p)))
        sparks(tip, v, 12, 5)
        break
      case 'claw':
        for (const [tilt, lift] of [
          [-0.35, 0.15],
          [0, 0],
          [0.35, -0.15],
        ])
          slash(caster, dir, reach, hot(v, 0.3), tilt, 0, 0.18, lift)
        break
      case 'thrust':
        streak('core', caster, caster.clone().addScaledVector(dir, reach), 0.08, hot(v, 0.5), 0.16, 1)
        flash(caster.clone().addScaledVector(dir, reach), v, 0.6)
        break
      case 'smash': {
        const ground = new THREE.Vector3(tip.x, 0.06, tip.z)
        show('shock', v, 0.4, (m) => m.position.copy(ground), (p, m) => (m.scale.setScalar(reach * (0.2 + 0.5 * p)), setOpacity(m, 0.9 * (1 - p))))
        show('crack', v, 1, (m) => (m.position.set(ground.x, 0.05, ground.z), m.scale.setScalar(reach * 0.45), (m.rotation.y = Math.random() * Math.PI * 2)), (p, m) => setOpacity(m, 1.2 * (1 - p)))
        puff({ at: { x: ground.x, y: 0.3, z: ground.z }, count: 8, kind: 'smoke', life: 1, size: [0.4, 1.3], color: new THREE.Color(0.7, 0.64, 0.56), speed: 3, drag: 2, up: 0.7, alpha: 0.35 })
        kit.shake(0.18)
        break
      }
      case 'flurry':
        for (let k = 0; k < 5; k++) later(k * 0.055, () => slash(caster, dir, reach, hot(v, 0.25), (Math.random() - 0.5) * 1.6, (Math.random() - 0.5) * 0.7, 0.16))
        break
      default:
        slash(caster, dir, Math.max(1.4, reach), hot(v, 0.2), (Math.random() - 0.5) * 0.9)
    }
    sparks(at, v, 10, 5)
  }

  function aura(style: string, r: EffectRecipe, at: THREE.Vector3, size: number, dur: number) {
    const v = vivid(r, 0)
    switch (style) {
      case 'flame':
        auraDome(at, v, size, dur, 0.18)
        for (const t of [0, 0.22])
          later(t, () => sparkle({ at: { x: at.x, y: 0.3, z: at.z }, count: 40, kind: 'glow', life: 0.7, size: [0.5, 0.05], color: hot(v, 0.2), spread: size * 0.9, velocity: { x: 0, y: 3.2, z: 0 }, speed: 0.5 }))
        puff({ at: { x: at.x, y: 1.2, z: at.z }, count: 6, kind: 'smoke', life: 1, size: [0.4, 1.4], color: new THREE.Color(0.25, 0.2, 0.18), spread: size * 0.6, velocity: { x: 0, y: 1.6, z: 0 }, alpha: 0.25 })
        break
      case 'storm':
        auraDome(at, v, size, dur, 0.18)
        for (let k = 0; k < 6; k++)
          later(k * 0.07, () => {
            const end = at.clone().add(randomIn(size)).setY(0.05)
            ribbon(lightning(at, end, 0.5, Math.random() * 100), hot(v, 0.4), 0.07, 0.2, { flicker: true })
            sparks(end, v, 6, 3)
          })
        break
      case 'mist':
        auraDome(at, v, size, dur, 0.16)
        puff({ at: { x: at.x, y: 0.5, z: at.z }, count: 18, kind: 'smoke', life: 1.4, size: [0.8, 2], color: v.clone().lerp(new THREE.Color(0.75, 0.78, 0.8), 0.5), spread: size * 0.9, speed: 0.6, drag: 1, alpha: 0.35, spin: 0.3 })
        break
      default:
        // a low dome of light over the aura's ground, and motes rising off it: a sphere this wide would swallow the fight
        auraDome(at, v, size, dur, 0.28)
        sparkle({ at, count: 24, kind: 'glow', life: 0.9, size: [0.16, 0.04], color: hot(v, 0.3), spread: size, velocity: { x: 0, y: 2.5, z: 0 }, speed: 0.6 })
    }
  }

  /** A trail-type layer shed at one point: sparks, smoke or a burst of its motif where the skill lands. */
  function shed(l: RecipeLayer, r: EffectRecipe, at: THREE.Vector3, size: number, many = true) {
    const c = color(r, l.color)
    if (l.primitive === 'motif') kit.motif({ at, count: many ? 14 : 4, kind: 'glow', cell: motifCell(l.style), life: 1.1, size: [Math.max(0.3, size * 0.5), 0.25], color: hot(c, 0.15), speed: many ? 3.5 : 1.5, gravity: 3, spin: 3, up: 0.6 })
    else if (l.primitive === 'smoke') puff({ at, count: many ? 8 : 2, kind: 'smoke', life: 1.1, size: [0.4, 1.4], color: c.clone().lerp(new THREE.Color(0.3, 0.28, 0.28), 0.6), speed: 1, drag: 1.5, alpha: 0.35, spin: 0.5, velocity: { x: 0, y: 0.6, z: 0 } })
    else sparks(at, c, many ? 20 : 6, 5)
  }

  /** A beam's trail, shed all along its length from where it leaves the hands. */
  function along(l: RecipeLayer, r: EffectRecipe, from: THREE.Vector3, dir: THREE.Vector3, len: number, base: number) {
    const size = layerSize(l, base)
    for (let k = 0; k < 6; k++) shed(l, r, from.clone().addScaledVector(dir, (len * (k + 0.5)) / 6), size, false)
  }

  /**
   * One layer where a skill fires or lands. `base` is the size the event's geometry gives (sizing.ts): a hit layer
   * is drawn at exactly that size.
   */
  function layer(l: RecipeLayer, r: EffectRecipe, at: THREE.Vector3, base: number, extra: Extra = {}) {
    const size = layerSize(l, base)
    const c = color(r, l.color)
    const v = vivid(r, l.color)
    const dur = l.phase === 'linger' ? Math.max(0.4, r.linger) : 0.45
    const dir = extra.dir ?? new THREE.Vector3(0, 0, 1)
    switch (l.primitive) {
      case 'ring':
        // a shockwave along the ground at exactly the hit radius, a second wave racing out, and dust kicked up
        show('shock', v, dur, (m) => (m.position.set(at.x, 0.06, at.z), m.scale.setScalar(size)), (p, m) => setOpacity(m, 0.9 * (1 - p) ** 1.5))
        show('shock', hot(v, 0.4), dur * 0.7, (m) => m.position.set(at.x, 0.07, at.z), (p, m) => (m.scale.setScalar(size * (0.3 + 0.9 * p)), setOpacity(m, 0.6 * (1 - p))))
        puff({ at: { x: at.x, y: 0.3, z: at.z }, count: Math.round(6 + size * 2), kind: 'smoke', life: 1.1, size: [0.5, 1.5], color: new THREE.Color(0.7, 0.64, 0.56), speed: 3 + size, spread: size * 0.8, drag: 2, up: 0.6, alpha: 0.35, spin: 0.6 })
        break
      case 'crack':
        // molten fissures that linger where the blow landed
        show('crack', v, Math.max(1.2, dur), (m) => (m.position.set(at.x, 0.05, at.z), m.scale.setScalar(size), (m.rotation.y = Math.random() * Math.PI * 2)), (p, m) => setOpacity(m, 1.2 * (1 - p)))
        sparkle({ at: { x: at.x, y: 0.2, z: at.z }, count: 18, kind: 'glow', life: 0.9, size: [0.15, 0.05], color: hot(c, 0.4), speed: 1.5, spread: size * 0.6, velocity: { x: 0, y: 2.2, z: 0 }, drag: 0.6 })
        break
      case 'beam':
        // the soft glow round a beam is drawn faint, in the beam's own profile; the beam itself draws the rest
        if (l.size > 1) {
          if (l.style !== 'pillar' && l.style !== 'laser' && l.style !== 'drill')
            show('beam', v, dur, (m) => (m.position.copy(at), m.lookAt(at.clone().addScaledVector(dir, extra.range ?? 10)), m.scale.set(size, size, extra.range ?? 10)), (p, m) => {
              setOpacity(m, 0.3 * (1 - p))
              scroll(m, 0.08)
              m.scale.x = m.scale.y = size * (1 + 0.15 * Math.sin(p * 40))
            }, 0.3)
        } else beam(l.style ?? 'wave', r, at, dir, extra.range ?? 10, size, dur)
        break
      case 'cone':
        // the fan on the ground is the hit area at its true size, whatever the cone is made of
        show('cone', v, dur, (m) => {
          m.geometry = coneGeometry(extra.arc ?? 90)
          m.position.set(at.x, 0.08, at.z)
          m.rotation.set(-Math.PI / 2, 0, coneYaw(dir))
          m.scale.setScalar(extra.range ?? size)
        }, (p, m) => setOpacity(m, (l.style && l.style !== 'spray' ? 0.5 : 0.8) * (1 - p)))
        if (r.delivery === 'cone') cone(l.style ?? 'spray', r, at, dir, extra.range ?? size, extra.arc ?? 90)
        break
      case 'gather':
        if (l.style === 'crackle') {
          // a crackling aura: lightning snapping off the caster while it charges
          for (let k = 0; k < 6; k++)
            later((k * Math.max(0.3, r.charge)) / 6, () => {
              const tip = at.clone().add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(0.6 + Math.random() * 0.7))
              ribbon(lightning(at, tip, 0.25, Math.random() * 100), hot(c, 0.4), 0.05, 0.18, { flicker: true })
            })
          sparkle({ at, count: 20, kind: 'glow', life: Math.max(0.3, r.charge), size: [0.12, 0.03], color: hot(c, 0.3), spread: 0.9, speed: 0.8 })
        } else if (l.style === 'point') {
          // a glowing fingertip at the brow
          const tip = at.clone().addScaledVector(dir, 0.35).addScaledVector(UP, 0.32)
          sparkle({ at: tip, count: 1, kind: 'glow', life: Math.max(0.3, r.charge), size: [0.12, 0.7], color: hot(c, 0.5) })
          sparkle({ at: tip, count: 1, kind: 'star', life: Math.max(0.3, r.charge), size: [0.3, 0.9], color: hot(c, 0.7), spin: 2 })
          sparkle({ at: tip, count: 16, kind: 'glow', life: Math.max(0.3, r.charge) * 0.8, size: [0.08, 0.02], color: hot(c, 0.3), speed: -1.4, spread: 0.6 })
        } else {
          // motes rushing in to the caster's hands, and a hot core growing where they meet
          sparkle({ at, count: 70, kind: 'glow', life: Math.max(0.3, r.charge || 0.5), size: [0.18, 0.04], color: hot(c, 0.3), speed: -size * 3, spread: size * 2.2 })
          sparkle({ at, count: 1, kind: 'glow', life: Math.max(0.3, r.charge || 0.5), size: [size * 0.3, size * 1.6], color: c })
        }
        break
      case 'trail':
        // a melee swing or a dash: an arc of light in front of the caster, sized to the reach
        if (extra.caster && extra.dir) slash(extra.caster, extra.dir, Math.max(1.4, extra.range ?? size), hot(v, 0.2), (Math.random() - 0.5) * 0.9)
        sparks(at, c, 10, 5)
        break
      case 'swing':
        if (extra.caster && extra.dir) swing(l.style ?? 'slash', r, extra.caster, extra.dir, Math.max(1, extra.range ?? size), at)
        break
      case 'sparks':
        sparks(at, c, 24, 6)
        sparkle({ at, count: 6, kind: 'star', life: 0.25, size: [0.5, 0.1], color: hot(c, 0.6), speed: 3, spin: 4 })
        break
      case 'motif':
      case 'smoke':
        if (l.primitive === 'smoke' && l.style === 'pop') smokePop(at, v, Math.max(0.8, size))
        else shed(l, r, at, size)
        break
      case 'sky':
        kit.darken(r.charge + 0.6, c)
        break
      case 'aura':
        aura(l.style ?? 'ring', r, at, size, dur)
        break
      case 'arc':
        // a pierce: lightning bursting straight through and out the far side
        for (let k = 0; k < 4; k++) {
          const d = dir.clone().add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.8)).normalize()
          ribbon(lightning(at, at.clone().addScaledVector(d, size), size * 0.2, Math.random() * 100), hot(c, 0.4), 0.06, 0.22, { flicker: true })
        }
        break
      case 'helix': {
        // two strands spiralling up round the caster
        const radius = Math.max(0.6, size)
        const feet = at.clone().addScaledVector(UP, -1.1)
        const top = at.clone().addScaledVector(UP, 1.4)
        ribbon(spiral(feet, top, radius, 2.5, 1.5), v, 0.12, 0.9)
        ribbon(spiral(feet, top, radius, 2.5, 1.5, Math.PI), vivid(r, 2), 0.12, 0.9)
        break
      }
      case 'pillar':
        pillar(new THREE.Vector3(at.x, 0, at.z), v, size, Math.max(3, size * 3.5), 0.7)
        break
      case 'dome':
        if (l.style === 'shield') {
          // a bubble round the caster that holds a moment and fades
          const radius = Math.max(1, size * 2)
          show('form', v, 1, (m) => (m.position.copy(at), m.scale.setScalar(radius * 0.8)), (p, m) => (m.scale.setScalar(radius * (0.8 + 0.2 * Math.min(1, p * 5))), setOpacity(m, 0.7 * (1 - p))), 0.7)
        } else {
          // a hemisphere of light swelling out to its size, then fading
          show('dome', v, 0.6, (m) => (m.position.set(at.x, Math.max(0, at.y - 1.1), at.z), m.scale.setScalar(size * 0.3)), (p, m) => (m.scale.setScalar(size * (0.3 + 0.7 * Math.min(1, p * 3.3))), setOpacity(m, 0.55 * (1 - p))), 0.55)
          flash(at, v, Math.max(0.6, size * 0.5))
        }
        break
      case 'shard':
        // a shatter: shards bursting off the point and falling
        for (let k = 0; k < 8; k++) {
          const d = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).normalize()
          const from = at.clone()
          show('shard', hot(v, 0.2), 0.45, (m) => (m.position.copy(from), m.lookAt(from.clone().add(d)), m.scale.set(0.08, 0.08, 0.22)), (p, m) => {
            m.position.copy(from).addScaledVector(d, size * 1.2 * p).addScaledVector(UP, -3 * p * p)
            m.rotation.x += 0.3
            setOpacity(m, 1 - p)
          }, 1)
        }
        sparkle({ at, count: 10, kind: 'star', life: 0.3, size: [0.35, 0.05], color: hot(v, 0.6), speed: 4, spin: 6 })
        break
      case 'rain': {
        // light falling all over the area for as long as it lingers, each drop bursting where it lands
        const fall = 0.32
        const height = 9
        for (let t = 0; t < r.linger; t += 0.07)
          later(t, () => {
            const p = at.clone().add(randomIn(size))
            for (let k = 0; k < 3; k++) sparkle({ at: { x: p.x, y: height + k * 0.45, z: p.z }, count: 1, kind: 'glow', life: fall, size: [0.45, 0.3], color: hot(v, 0.3), velocity: { x: 0, y: -height / fall, z: 0 } })
            later(fall, () => (flash(new THREE.Vector3(p.x, 0.25, p.z), v, 0.6), sparks(new THREE.Vector3(p.x, 0.2, p.z), v, 5, 3, 0.08)))
          })
        break
      }
      case 'vortex':
        // a whirlpool turning on the ground, drawing motes into its eye
        show('vortex', v, r.linger, (m) => (m.position.set(at.x, 0.07, at.z), m.scale.setScalar(size)), (p, m) => ((m.rotation.y = -p * 7), setOpacity(m, 0.9 * Math.min(1, p * 6) * (1 - p) ** 0.7)))
        for (let t = 0; t < r.linger; t += 0.12) later(t, () => sparkle({ at: { x: at.x, y: 0.4, z: at.z }, count: 10, kind: 'glow', life: 0.6, size: [0.18, 0.04], color: hot(v, 0.3), speed: -size * 1.6, spread: size }))
        break
      case 'field':
        // a glyph on the ground the size of the area, turning slowly while it lasts
        show('magic', v, r.linger, (m) => (m.position.set(at.x, 0.06, at.z), m.scale.setScalar(size)), (p, m) => ((m.rotation.y = p * 1.4), setOpacity(m, 1.1 * Math.min(1, p * 6) * (1 - p) ** 0.6)))
        for (let t = 0; t < r.linger; t += 0.25) later(t, () => sparkle({ at: { x: at.x, y: 0.2, z: at.z }, count: 8, kind: 'glow', life: 0.8, size: [0.14, 0.03], color: hot(v, 0.3), spread: size, velocity: { x: 0, y: 1.8, z: 0 } }))
        break
      case 'afterimage':
      case 'chain':
        break
      default:
        // orb and burst: a flash, an energy sphere swelling to the hit size, sparks and a smoke cloud left behind
        // the shell snaps out to the hit size and is gone in a third of a second; sparks and smoke carry the after-image
        flash(at, c, Math.max(0.6, size * 0.7))
        show('shell', v, Math.min(dur, 0.35), (m) => (m.position.copy(at), m.scale.setScalar(size * 0.6)), (p, m) => {
          m.scale.setScalar(size * (l.damaging ? 0.75 + 0.25 * p : 0.4 + 0.5 * p))
          setOpacity(m, 0.8 * (1 - p) ** 1.5)
        })
        sparks(at, v, Math.round(12 + size * 5), 4 + size * 2)
        puff({ at, count: Math.round(4 + size * 2), kind: 'smoke', life: 1.2, size: [size * 0.4, size * 1.2], color: v.clone().lerp(new THREE.Color(0.22, 0.2, 0.22), 0.65), speed: 1.5 + size * 0.5, spread: size * 0.4, drag: 1.5, alpha: 0.32, spin: 0.5, velocity: { x: 0, y: 0.6, z: 0 } })
    }
  }

  /**
   * A movement skill's way from where the hero stood to where it lands (`from` and `to` at the feet): a streak, a line
   * of afterimages, smoke where it vanished, a flash at each end, rocket exhaust or a chain.
   */
  function path(l: RecipeLayer, r: EffectRecipe, hero: number, from: THREE.Vector3, to: THREE.Vector3, chestHeight: number) {
    const c = color(r, l.color)
    const v = vivid(r, l.color)
    const a = from.clone().addScaledVector(UP, chestHeight)
    const b = to.clone().addScaledVector(UP, chestHeight)
    const far = a.distanceTo(b)
    switch (l.primitive) {
      case 'afterimage':
        for (let k = 0; k < 4; k++) kit.ghost(hero, from.clone().lerp(to, k / 4), hot(v, 0.2), 0.32 + k * 0.05)
        break
      case 'smoke':
        if (l.style === 'rocket') {
          // exhaust laid along the way, and fire where it lit
          for (let d = 0; d <= far; d += 0.5) puff({ at: a.clone().lerp(b, far ? d / far : 0).addScaledVector(UP, -0.5), count: 2, kind: 'smoke', life: 1, size: [0.3, 1.2], color: new THREE.Color(0.55, 0.52, 0.5), speed: 0.6, drag: 1.5, alpha: 0.35, spin: 0.5 })
          sparkle({ at: from.clone().addScaledVector(UP, 0.4), count: 20, kind: 'glow', life: 0.5, size: [0.3, 0.05], color: hot(v, 0.2), speed: 3, gravity: 4, up: 0.2 })
        } else {
          smokePop(a, v, 1.2)
          later(0.05, () => smokePop(b, v, 1))
        }
        break
      case 'burst':
        // gone in a flash and back in another, with a thin column of light where it left
        flash(a, v, 1.2)
        flash(b, v, 1.2)
        streak('core', from, from.clone().addScaledVector(UP, chestHeight * 2.2), 0.08, hot(v, 0.6), 0.25)
        sparkle({ at: b, count: 16, kind: 'glow', life: 0.4, size: [0.14, 0.03], color: hot(v, 0.4), speed: 2.5 })
        break
      case 'chain':
        // links paid out from where it stood to where it caught, tiled to the length so they never stretch
        show('chain', c, 0.4, (m) => {
          m.position.copy(a)
          m.lookAt(b)
          m.scale.set(0.06, 0.06, Math.max(0.01, far))
          ;(m.material as THREE.MeshBasicMaterial).map?.repeat.set(1, Math.max(1, far / 0.45))
        }, (p, m) => setOpacity(m, 1 - p * p), 1)
        sparks(b, v, 8, 3, 0.08)
        break
      default:
        // a streak of light along the way, bright where it arrives and thinning back to where it left
        if (far > 0.2) ribbon(straight(b, a), hot(v, 0.2), 0.55, 0.35, { taper: true })
        for (let k = 0; k < 5; k++) sparkle({ at: a.clone().lerp(b, (k + 0.5) / 5), count: 3, kind: 'glow', life: 0.35, size: [0.2, 0.03], color: hot(c, 0.3), speed: 1, spread: 0.3 })
    }
  }

  /** What a shot sheds each frame as it flies: sparks, smoke or its motif. */
  function wake(l: RecipeLayer, r: EffectRecipe, at: THREE.Vector3, size: number) {
    const c = color(r, l.color)
    if (l.primitive === 'sparks') sparkle({ at, count: 2, kind: 'glow', life: 0.4, size: [size * 0.6, 0.02], color: hot(c, 0.3), speed: 2, gravity: 6 })
    else if (l.primitive === 'smoke') puff({ at, count: 1, kind: 'smoke', life: 0.9, size: [size * 1.2, size * 3], color: c.clone().lerp(new THREE.Color(0.3, 0.28, 0.28), 0.6), speed: 0.4, drag: 1.5, alpha: 0.4, spin: 0.6 })
    else if (l.primitive === 'motif' && Math.random() < 0.4) kit.motif({ at, count: 1, kind: 'glow', cell: motifCell(l.style), life: 0.9, size: [Math.max(0.3, size * 1.4), 0.2], color: hot(c, 0.15), speed: 1, gravity: 1.5, spin: 3 })
  }

  return { layer, along, path, wake, flash, sparks }
}

// one fan per whole-degree arc, shared by every cone effect
const cones = new Map<number, THREE.CircleGeometry>()
export function coneGeometry(degrees: number): THREE.CircleGeometry {
  const key = Math.round(degrees)
  let g = cones.get(key)
  if (!g) {
    const arc = (key * Math.PI) / 180
    cones.set(key, (g = new THREE.CircleGeometry(1, 32, Math.PI / 2 - arc / 2, arc)))
  }
  return g
}

// a band at the fan's edge, laid out like the fan, for sound waves spreading across it
const bands = new Map<number, THREE.RingGeometry>()
export function bandGeometry(degrees: number): THREE.RingGeometry {
  const key = Math.round(degrees)
  let g = bands.get(key)
  if (!g) {
    const arc = (key * Math.PI) / 180
    bands.set(key, (g = new THREE.RingGeometry(0.86, 1, 32, 1, Math.PI / 2 - arc / 2, arc)))
  }
  return g
}

export { v3 }
