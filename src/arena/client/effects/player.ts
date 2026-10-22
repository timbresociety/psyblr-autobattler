import * as THREE from 'three'
import type { BuildSlot } from '../../../charter/types'
import type { HeroPackage } from '../../../forge/package'
import { capsule } from '../../engine/state'
import { atLeast } from '../quality'
import { chest } from '../../engine/deliveries'
import type { MatchEvent } from '../../engine/events'
import { defaultRecipe } from '../../recipes/defaults'
import type { EffectRecipe, RecipeLayer } from '../../recipes/schema'
import type { ArenaController } from '../match-view'
import { Particles } from './particles'
import { baseSize, hitFeel, layerSize, type ImpactEvent } from './sizing'
import { playCast, playHit } from './sound'

/**
 * The effect kit at runtime (U14, R10, R11, R21): engine events become recipe layers, sized from the event's own hit
 * geometry; hits throw blood and aura sparks, heavy ones freeze the picture for a beat and shake the camera; a
 * transformation wraps the hero in its form at the size of its hitbox. All cosmetic: nothing here touches the engine.
 */

/** Effect budgets (KTD11): cosmetic particles recycle oldest-first; impact particles have their own pool. */
export const BUDGET = { cosmetic: 30_000, impact: 8_000, meshes: 80 }

interface Live {
  mesh: THREE.Mesh
  start: number
  duration: number
  /** Called each frame with progress 0-1. */
  update: (p: number, mesh: THREE.Mesh) => void
  primitive: string
}

const additive = (color: THREE.Color, opacity = 0.85) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })

const GEOMETRY: Record<string, () => THREE.BufferGeometry> = {
  orb: () => new THREE.IcosahedronGeometry(1, 2),
  burst: () => new THREE.IcosahedronGeometry(1, 1),
  aura: () => new THREE.IcosahedronGeometry(1, 2),
  form: () => new THREE.IcosahedronGeometry(1, 1),
  ring: () => new THREE.RingGeometry(0.92, 1, 48),
  crack: () => new THREE.RingGeometry(0.2, 1, 24, 1),
  beam: () => new THREE.CylinderGeometry(1, 1, 1, 12, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5),
  cone: () => new THREE.CircleGeometry(1, 24, -Math.PI / 4, Math.PI / 2),
}

export interface Effects {
  events: (events: MatchEvent[]) => void
  frame: (dt: number) => void
  /** Animation time scale: near zero during a hit-stop (render only; the engine keeps ticking). */
  timeScale: () => number
  /** Camera shake offset to add this frame. */
  shake: () => THREE.Vector3
  stats: () => { meshes: number; particles: number }
}

export function createEffects(ctrl: ArenaController, packages: (HeroPackage | undefined)[] = []): Effects {
  const { scene, arena } = ctrl
  const cosmetic = new Particles(BUDGET.cosmetic)
  const impacts = new Particles(BUDGET.impact)
  // the frame-rate guard's third step halves every spawn (U18, R26)
  for (const pool of [cosmetic, impacts]) {
    const spawn = pool.spawn.bind(pool)
    pool.spawn = (spec, now) => spawn(atLeast(ctrl.quality(), 'fewer-particles') ? { ...spec, count: Math.ceil(spec.count / 2) } : spec, now)
  }
  scene.add(cosmetic.mesh, impacts.mesh)
  const pool = new Map<string, THREE.Mesh[]>()
  const live: Live[] = []
  const projectiles = new Map<number, { mesh: THREE.Mesh; recipe: EffectRecipe }>()
  const forms = new Map<number, THREE.Mesh>()
  const background = (scene.background as THREE.Color).clone()
  let clock = 0
  let hitStop = 0
  let shake = 0
  let sky = 0
  let skyColor = new THREE.Color()

  const recipe = (hero: number, slot: BuildSlot): EffectRecipe => {
    const own = packages[hero]?.slots[slot]?.effect?.recipe
    return own ?? defaultRecipe(arena.setups[hero].kit[slot].delivery.kind)
  }
  const color = (r: EffectRecipe, i: 0 | 1 | 2) => new THREE.Color(r.palette[i])

  const mesh = (primitive: string, c: THREE.Color, opacity = 0.85): THREE.Mesh => {
    const free = pool.get(primitive)?.pop()
    const m = free ?? new THREE.Mesh(GEOMETRY[primitive](), additive(c, opacity))
    ;(m.material as THREE.MeshBasicMaterial).color.copy(c)
    ;(m.material as THREE.MeshBasicMaterial).opacity = opacity
    m.visible = true
    m.rotation.set(0, 0, 0)
    m.scale.setScalar(1)
    if (!free) scene.add(m)
    return m
  }
  const release = (l: Live) => {
    l.mesh.visible = false
    const list = pool.get(l.primitive) ?? []
    list.push(l.mesh)
    pool.set(l.primitive, list)
  }
  const show = (primitive: string, c: THREE.Color, duration: number, place: (m: THREE.Mesh) => void, update: Live['update']) => {
    // the mesh budget holds: when full, the oldest live effect gives way
    if (live.length >= BUDGET.meshes) release(live.shift()!)
    const m = mesh(primitive, c)
    place(m)
    live.push({ mesh: m, start: clock, duration, update, primitive })
  }

  const layer = (l: RecipeLayer, r: EffectRecipe, at: THREE.Vector3, base: number, extra: Partial<{ dir: THREE.Vector3; range: number; arc: number }> = {}) => {
    const size = layerSize(l, base)
    const c = color(r, l.color)
    const dur = l.phase === 'linger' ? Math.max(0.3, r.linger) : 0.35
    switch (l.primitive) {
      case 'ring':
      case 'crack':
        show(l.primitive, c, dur, (m) => (m.position.set(at.x, 0.05, at.z), (m.rotation.x = -Math.PI / 2)), (p, m) => {
          m.scale.setScalar(size * (l.damaging ? 1 : 0.6 + 0.4 * p))
          ;(m.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - p)
        })
        break
      case 'beam': {
        const dir = extra.dir ?? new THREE.Vector3(0, 0, 1)
        show('beam', c, dur, (m) => {
          m.position.copy(at)
          m.lookAt(at.clone().add(dir))
          m.scale.set(size, size, extra.range ?? 10)
        }, (p, m) => ((m.material as THREE.MeshBasicMaterial).opacity = 0.9 * (1 - p)))
        break
      }
      case 'cone': {
        const dir = extra.dir ?? new THREE.Vector3(0, 0, 1)
        const arc = ((extra.arc ?? 90) * Math.PI) / 180
        show('cone', c, dur, (m) => {
          m.geometry.dispose()
          m.geometry = new THREE.CircleGeometry(1, 24, Math.PI / 2 - arc / 2, arc)
          m.position.set(at.x, 0.06, at.z)
          m.rotation.set(-Math.PI / 2, 0, Math.atan2(dir.x, dir.z))
          m.scale.setScalar(extra.range ?? size)
        }, (p, m) => ((m.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - p)))
        break
      }
      case 'gather':
        cosmetic.spawn({ count: 60, at: { x: at.x, y: at.y, z: at.z }, speed: -size * 3, spread: size * 2, life: r.charge || 0.5, size: 0.08, color: c }, clock)
        break
      case 'sparks':
      case 'trail':
        cosmetic.spawn({ count: 24, at: { x: at.x, y: at.y, z: at.z }, speed: 6, spread: size * 0.5, life: 0.5, size: 0.07, color: c, gravity: 9 }, clock)
        break
      case 'sky':
        sky = Math.max(sky, r.charge + 0.6)
        skyColor = c
        break
      default:
        // orb, burst and aura: a sphere that swells and fades
        show(l.primitive === 'aura' ? 'aura' : 'burst', c, dur, (m) => m.position.copy(at), (p, m) => {
          m.scale.setScalar(size * (l.damaging ? 1 : 0.5 + 0.5 * p))
          ;(m.material as THREE.MeshBasicMaterial).opacity = (l.primitive === 'aura' ? 0.35 : 0.8) * (1 - p)
        })
    }
  }

  const v3 = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.y, p.z)

  return {
    events: (events) => {
      for (const e of events) {
        if (e.type === 'cast') {
          const r = recipe(e.hero, e.slot)
          const at = v3(chest(arena.match.heroes[e.hero]))
          for (const l of r.layers) if (l.phase === 'charge') layer(l, r, at, 1)
          playCast(r.delivery)
        } else if (e.type === 'projectile') {
          const r = recipe(e.hero, e.slot)
          const core = r.layers.find((l) => l.damaging) ?? r.layers[0]
          const m = mesh('orb', color(r, core.color))
          m.scale.setScalar(layerSize(core, e.radius) * (core.intensity ?? 1))
          projectiles.set(e.id, { mesh: m, recipe: r })
        } else if (e.type === 'impact') {
          const r = recipe(e.hero, e.slot)
          const caster = arena.match.heroes[e.hero]
          const from = v3(chest(caster))
          const dir = new THREE.Vector3(Math.sin(caster.yaw) * Math.cos(caster.pitch), Math.sin(caster.pitch), Math.cos(caster.yaw) * Math.cos(caster.pitch))
          const base = baseSize(e as ImpactEvent, arena.setups[e.hero].kit[e.slot].delivery.projectileRadius)
          for (const l of r.layers) {
            if (l.phase !== 'impact' && l.phase !== 'linger') continue
            const place = l.primitive === 'beam' || l.primitive === 'cone' ? from : v3(e.at)
            layer(l, r, place, base, { dir, range: e.range, arc: e.arcDegrees })
          }
        } else if (e.type === 'hit') {
          const feel = hitFeel(e)
          const target = arena.match.heroes[e.target]
          const at = chest(target)
          impacts.spawn({ count: feel.blood, at, speed: 4, spread: 0.2, life: 0.6, size: 0.06, color: new THREE.Color(0.75, 0.04, 0.04), gravity: 14, lift: 1.5 }, clock)
          const r = recipe(e.source, e.slot)
          impacts.spawn({ count: 8, at, speed: 3, spread: 0.1, life: 0.25, size: 0.1, color: color(r, 1) }, clock)
          hitStop = Math.max(hitStop, feel.hitStop)
          shake = Math.max(shake, feel.shake)
          playHit(e.heavy)
        } else if (e.type === 'resize') {
          const hero = arena.match.heroes[e.hero]
          if (e.phase === 'start') {
            const r = recipe(e.hero, 'ultimate')
            const m = forms.get(e.hero) ?? mesh('form', color(r, 0), 0.28)
            // the form fills the hero's new capsule exactly: what the audience sees is what can be hit (R23, AE6)
            const c = capsule(hero)
            m.scale.set(c.radius, c.height / 2, c.radius)
            forms.set(e.hero, m)
          } else {
            const m = forms.get(e.hero)
            if (m) m.visible = false
            forms.delete(e.hero)
          }
        } else if (e.type === 'death') {
          const at = chest(arena.match.heroes[e.hero])
          impacts.spawn({ count: 40, at, speed: 5, spread: 0.3, life: 0.9, size: 0.08, color: new THREE.Color(1, 0.85, 0.6), gravity: 6 }, clock)
        }
      }
    },
    frame: (dt) => {
      clock += dt
      cosmetic.update(clock)
      impacts.update(clock)
      hitStop = Math.max(0, hitStop - dt)
      shake = Math.max(0, shake - dt * 1.6)
      for (let i = live.length - 1; i >= 0; i--) {
        const l = live[i]
        const p = (clock - l.start) / l.duration
        if (p >= 1) {
          release(l)
          live.splice(i, 1)
        } else l.update(p, l.mesh)
      }
      const positions = ctrl.positions()
      for (const [id, { mesh: m, recipe: r }] of projectiles) {
        const p = arena.match.projectiles.find((x) => x.id === id)
        if (!p) {
          m.visible = false
          const list = pool.get('orb') ?? []
          list.push(m)
          pool.set('orb', list)
          projectiles.delete(id)
          continue
        }
        m.position.set(p.position.x, p.position.y, p.position.z)
        if (Math.random() < 0.5) cosmetic.spawn({ count: 2, at: p.position, speed: 0.4, spread: 0.05, life: 0.3, size: 0.05, color: color(r, 1) }, clock)
      }
      for (const [id, m] of forms) {
        const at = positions[id]
        m.position.set(at.x, at.y + capsule(arena.match.heroes[id]).height * 0.55, at.z)
      }
      sky = Math.max(0, sky - dt)
      ;(scene.background as THREE.Color).copy(background).lerp(skyColor, Math.min(0.55, sky))
    },
    timeScale: () => (hitStop > 0 ? 0.05 : 1),
    shake: () => new THREE.Vector3((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake),
    stats: () => ({ meshes: live.length + projectiles.size + forms.size, particles: BUDGET.cosmetic + BUDGET.impact }),
  }
}
