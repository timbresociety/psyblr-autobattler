import * as THREE from 'three'
import type { FormAura, TransformationLook } from '../../../charter/skill-look.js'
import { createTails, placeTails, stepTails, tailPoint, type Tails } from '../../../kit/physics/tails.js'
import type { EffectRecipe } from '../../recipes/schema.js'
import { color, hot, setOpacity, type Kit } from './draw.js'
import { lightning, spiral, straight, type Ribbon, type RibbonPath } from './vfx.js'

/**
 * A transformation as the audience sees it (R23): how it arrives, what surrounds the hero while it lasts, what it
 * leaves as it moves, and anything it wears beyond its body. The engine owns the size: an aura hugs the hero's capsule
 * as it is now, and a spirit body fills it exactly, so what's drawn stays what can be hit. The body swap itself (a
 * titan's body, gold hair, a chakra cloak) is the hero view's (heroes.ts).
 */

const UP = new THREE.Vector3(0, 1, 0)

/** Where a transformed hero is, read fresh each frame. */
export interface FormBodyAt {
  /** Its feet, where it's drawn now. */
  feet: () => THREE.Vector3
  /** Its hit capsule now: what the form fills. */
  capsule: () => { radius: number; height: number }
  /** Its facing; 0 looks along +z. */
  yaw: () => number
}

/** What a form needs beyond the shared kit: a flash and sparks from the drawing, and steady ribbons for tails. */
export interface FormKit extends Kit {
  flash: (at: THREE.Vector3, c: THREE.Color, size: number) => void
  sparks: (at: THREE.Vector3, c: THREE.Color, count: number, speed: number) => void
  tail: (path: RibbonPath, c: THREE.Color, width: number, life: number) => Ribbon | undefined
  endTail: (ribbon: Ribbon) => void
}

interface Form {
  look: TransformationLook
  r: EffectRecipe
  body: FormBodyAt
  age: number
  /** Aura sprites owed to the rate, carried between frames. */
  debt: number
  /** Where the trail last left a mark, and when. */
  last?: THREE.Vector3
  lastAt: number
  tails?: { chains: Tails; ribbons: Ribbon[] }
}

/**
 * A form's colour: the richest in its palette. Palettes lead with a pale core, and a form drawn in it reads as white,
 * so the saturation is judged as the eye sees it (sRGB), where a pale cream is pale.
 */
const hsl = { h: 0, s: 0, l: 0 }
const chroma = (c: THREE.Color) => (c.getHSL(hsl, THREE.SRGBColorSpace), hsl.s * (1 - Math.abs(2 * hsl.l - 1)))
export const formColor = (r: EffectRecipe) => ([0, 1, 2] as const).map((k) => color(r, k)).reduce((a, b) => (chroma(b) > chroma(a) ? b : a))

/** Aura spawns a second, per style: flames lick constantly, steam rolls off slowly, a storm strikes now and then. */
const AURA_RATE: Record<FormAura, number> = { flame: 70, steam: 9, chakra: 36, storm: 8, sparks: 22 }
const TAILS = 9

export function createForms(kit: FormKit) {
  const forms = new Map<number, Form>()

  const parts = (b: FormBodyAt) => {
    const feet = b.feet()
    const cap = b.capsule()
    return { feet, cap, mid: feet.clone().addScaledVector(UP, cap.height * 0.55), top: feet.clone().addScaledVector(UP, cap.height) }
  }

  function arrive(look: TransformationLook, r: EffectRecipe, b: FormBodyAt) {
    const v = formColor(r)
    const { feet, cap, mid, top } = parts(b)
    const ring = (life: number, reach: number) =>
      kit.show('shock', v, life, (m) => (m.position.set(feet.x, feet.y + 0.06, feet.z), m.scale.setScalar(cap.radius)), (p, m) => (m.scale.setScalar(cap.radius * (1 + reach * p)), setOpacity(m, 0.9 * (1 - p))))
    switch (look.entry) {
      case 'strike': {
        // a bolt from the sky onto the hero, the sky darkening for it, and a shockwave out from its feet
        const sky = feet.clone().addScaledVector(UP, 16)
        for (let k = 0; k < 2; k++) kit.ribbon(lightning(sky, feet, 1.4, Math.random() * 100), hot(v, 0.5), 0.3, 0.45, { flicker: true })
        kit.darken(0.5, v)
        kit.flash(mid, v, cap.height * 1.2)
        ring(0.6, 6)
        kit.shake(0.45)
        break
      }
      case 'implode':
        // everything rushes in to the hero and collapses: motes falling inward and a shell shrinking onto it
        kit.sparkle({ at: mid, count: 60, kind: 'glow', life: 0.35, size: [0.16, 0.03], color: hot(v, 0.3), speed: -cap.height * 4, spread: cap.height * 1.4 })
        kit.show('shell', v, 0.3, (m) => (m.position.copy(mid), m.scale.setScalar(cap.height * 1.2)), (p, m) => (m.scale.setScalar(cap.height * 1.2 * (1 - p) + 0.05), setOpacity(m, 0.8 * (1 - p * 0.5))))
        kit.later(0.28, () => kit.flash(parts(b).mid, v, cap.height * 0.6))
        kit.shake(0.15)
        break
      case 'swirl': {
        // ribbons spiralling up round the hero, and motes lifting with them
        const radius = cap.radius * 1.8
        const crown = top.clone().addScaledVector(UP, cap.height * 0.3)
        for (let k = 0; k < 3; k++) kit.ribbon(spiral(feet, crown, radius, 2.5, 2, (k * Math.PI * 2) / 3), k ? v : hot(v, 0.4), cap.radius * 0.35, 0.7)
        kit.sparkle({ at: feet, count: 40, kind: 'glow', life: 0.8, size: [0.18, 0.03], color: hot(v, 0.3), spread: radius, velocity: { x: 0, y: cap.height * 2.5, z: 0 }, speed: 0.8 })
        kit.flash(mid, v, cap.height * 0.8)
        break
      }
      case 'smoke':
        // a puff of smoke, and the new body standing in it
        kit.puff({ at: mid, count: 18, kind: 'smoke', life: 1.2, size: [cap.height * 0.4, cap.height * 1.1], color: new THREE.Color(0.8, 0.78, 0.76), speed: 2.5, spread: cap.radius, drag: 2, alpha: 0.6, spin: 0.6, up: 0.4 })
        kit.flash(mid, v, cap.height * 0.5)
        break
      case 'flash':
        // a white-out, and a column of light where the hero stood
        kit.flash(mid, v, cap.height * 1.4)
        kit.show('core', hot(v, 0.6), 0.35, (m) => (m.position.copy(feet), m.lookAt(feet.clone().addScaledVector(UP, 1)), m.scale.set(cap.radius * 0.5, cap.radius * 0.5, cap.height * 3)), (p, m) => setOpacity(m, 0.9 * (1 - p)), 0.9)
        kit.sparkle({ at: mid, count: 24, kind: 'star', life: 0.5, size: [0.3, 0.05], color: hot(v, 0.5), speed: 3.5, spin: 2 })
        break
      default:
        // a burst of power: a flash, a shell blowing out past the body, sparks and a ring along the ground
        kit.flash(mid, v, cap.height * 1.1)
        kit.show('shell', v, 0.4, (m) => (m.position.copy(mid), m.scale.setScalar(cap.height * 0.4)), (p, m) => (m.scale.setScalar(cap.height * (0.4 + 0.9 * p)), setOpacity(m, 0.8 * (1 - p) ** 1.5)))
        kit.sparks(mid, v, 30, 7)
        ring(0.5, 4)
        kit.shake(0.3)
    }
  }

  function aura(f: Form, dt: number) {
    const style = f.look.aura
    if (!style) return
    f.debt += dt * AURA_RATE[style]
    const n = Math.min(8, Math.floor(f.debt))
    if (!n) return
    f.debt -= n
    const { feet, cap } = parts(f.body)
    const v = formColor(f.r)
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2
      const at = (reach: number) => new THREE.Vector3(feet.x + Math.cos(a) * cap.radius * reach, feet.y + cap.height * Math.random() * 0.95, feet.z + Math.sin(a) * cap.radius * reach)
      // light alone washes out over a sunlit floor, so flame and chakra lay a body of solid colour under their glow
      switch (style) {
        case 'flame': {
          // tongues of flame licking up round the body, hot at the core
          const p = at(1.05)
          const rise = { x: 0, y: 2 + cap.height, z: 0 }
          kit.puff({ at: p, count: 1, kind: 'glow', life: 0.45, size: [cap.radius * 1.3, 0.1], color: v, velocity: rise, speed: 0.3, alpha: 0.6 })
          kit.sparkle({ at: p, count: 1, kind: 'glow', life: 0.5, size: [cap.radius, 0.06], color: hot(v, 0.15 + 0.3 * Math.random()), velocity: rise, speed: 0.3 })
          break
        }
        case 'steam':
          kit.puff({ at: at(0.7), count: 1, kind: 'smoke', life: 1.5, size: [cap.radius * 0.9, cap.radius * 2.6], color: new THREE.Color(0.95, 0.95, 0.95), velocity: { x: 0, y: 1.2, z: 0 }, speed: 0.4, drag: 0.5, alpha: 0.5, spin: 0.4 })
          break
        case 'chakra': {
          // a cloak of energy bubbling off the body's surface
          const p = at(1)
          const drift = { x: Math.cos(a) * 0.6, y: 0.9, z: Math.sin(a) * 0.6 }
          kit.puff({ at: p, count: 1, kind: 'glow', life: 0.6, size: [cap.radius * 0.6, cap.radius], color: v, velocity: drift, alpha: 0.45 })
          kit.sparkle({ at: p, count: 1, kind: 'glow', life: 0.6, size: [cap.radius * 0.5, cap.radius * 0.9], color: hot(v, 0.2), velocity: drift })
          break
        }
        case 'storm': {
          const p = at(1)
          const q = p.clone().add(new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(cap.radius * 1.2))
          kit.ribbon(lightning(p, q, cap.radius * 0.25, Math.random() * 100), hot(v, 0.4), 0.05, 0.16, { flicker: true })
          break
        }
        case 'sparks':
          kit.sparkle({ at: at(0.9), count: 2, kind: 'glow', life: 0.4, size: [0.1, 0.02], color: hot(v, 0.4), speed: 2.2, gravity: 6, up: 0.6 })
      }
    }
  }

  function trail(hero: number, f: Form) {
    const style = f.look.trail
    if (!style) return
    const { feet, cap, mid } = parts(f.body)
    if (!f.last) {
      f.last = mid
      f.lastAt = f.age
      return
    }
    const moved = mid.distanceTo(f.last)
    if (style === 'streak') {
      // a streak from where it just was, bright at the hero and thinning behind it
      if (moved > 0.05) kit.ribbon(straight(mid.clone(), f.last.clone()), hot(formColor(f.r), 0.3), cap.radius * 1.2, 0.3, { taper: true })
      f.last = mid
    } else if (moved > cap.radius * 1.2 && f.age - f.lastAt > 0.08) {
      kit.ghost(hero, feet, hot(formColor(f.r), 0.2), 0.3)
      f.last = mid
      f.lastAt = f.age
    }
  }

  /** Tails' root: the small of the back, a little behind the body's middle. */
  const tailRoot = (b: FormBodyAt): [number, number, number] => {
    const { feet, cap } = parts(b)
    const yaw = b.yaw()
    return [feet.x - Math.sin(yaw) * cap.radius * 0.7, feet.y + cap.height * 0.48, feet.z - Math.cos(yaw) * cap.radius * 0.7]
  }

  function wearTails(f: Form, duration: number) {
    const { cap } = parts(f.body)
    const chains = createTails(TAILS, 6, cap.height * 0.85)
    placeTails(chains, tailRoot(f.body), f.body.yaw(), 1)
    const v = formColor(f.r)
    const ribbons: Ribbon[] = []
    for (let t = 0; t < TAILS; t++) {
      const path: RibbonPath = (i, n, _age, out) => void tailPoint(chains, t, i / (n - 1), out)
      path.points = 14
      const ribbon = kit.tail(path, t % 2 ? v : hot(v, 0.25), cap.radius * 0.7, duration + 1)
      if (ribbon) ribbons.push(ribbon)
    }
    f.tails = { chains, ribbons }
  }

  function wearSpirit(hero: number, f: Form, duration: number) {
    // a spirit body that fills the hitbox exactly and follows the hero, gone the moment the form ends
    const fill = (m: THREE.Mesh) => {
      const { feet, cap } = parts(f.body)
      m.position.set(feet.x, feet.y + cap.height / 2, feet.z)
      m.scale.set(cap.radius, cap.height / 2, cap.radius)
    }
    kit.show('form', formColor(f.r), duration, fill, (_p, m) => {
      if (forms.get(hero) !== f) return setOpacity(m, 0)
      fill(m)
      setOpacity(m, 0.5 + 0.12 * Math.sin(f.age * 5))
    }, 0.5)
  }

  /** The form is over (or the hero died in it): what it wore goes, with a breath of its colour unless `quiet`. */
  const end = (hero: number, quiet = false) => {
    const f = forms.get(hero)
    if (!f) return
    forms.delete(hero)
    for (const ribbon of f.tails?.ribbons ?? []) kit.endTail(ribbon)
    if (quiet) return
    const { mid, cap } = parts(f.body)
    const v = formColor(f.r)
    kit.flash(mid, v, cap.height * 0.5)
    kit.sparkle({ at: mid, count: 20, kind: 'glow', life: 0.6, size: [0.14, 0.03], color: hot(v, 0.3), spread: cap.radius, velocity: { x: 0, y: 1.5, z: 0 }, speed: 1 })
  }

  return {
    start(hero: number, look: TransformationLook, r: EffectRecipe, duration: number, body: FormBodyAt) {
      end(hero, true)
      const f: Form = { look, r, body, age: 0, debt: 0, lastAt: 0 }
      forms.set(hero, f)
      arrive(look, r, body)
      if (look.avatar === 'tails') wearTails(f, duration)
      else if (look.avatar === 'spirit') wearSpirit(hero, f, duration)
    },
    end,
    frame(dt: number) {
      for (const [hero, f] of forms) {
        f.age += dt
        aura(f, dt)
        trail(hero, f)
        if (f.tails) {
          const { cap } = parts(f.body)
          stepTails(f.tails.chains, tailRoot(f.body), f.body.yaw(), 1, dt, cap.radius * 0.9, cap.radius * 0.7)
        }
      }
    },
    live: () => forms.size,
    has: (hero: number) => forms.has(hero),
  }
}
