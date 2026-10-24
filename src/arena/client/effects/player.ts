import * as THREE from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { float, normalView, positionViewDirection, uniform } from 'three/tsl'
import type { BuildSlot } from '../../../charter/types.js'
import type { HeroPackage } from '../../../forge/package.js'
import { capsule } from '../../engine/state.js'
import { atLeast } from '../quality.js'
import { chest } from '../../engine/deliveries.js'
import type { MatchEvent } from '../../engine/events.js'
import { defaultRecipe } from '../../recipes/defaults.js'
import type { EffectRecipe, RecipeLayer } from '../../recipes/schema.js'
import type { ArenaController } from '../match-view.js'
import { skyFlashOf } from '../map.js'
import { baseSize, coneYaw, hitFeel, layerSize, type ImpactEvent } from './sizing.js'
import { playCast, playHit } from './sound.js'
import { createWorldFx } from './world-fx.js'
import { SpritePool, Trail, arcGeometry, crackTexture, flowTexture, magicCircleTexture, shockTexture, slashTexture, spriteAtlas, type SpriteSpec } from './vfx.js'

/**
 * The effect kit at runtime (U14, R10, R11, R21): engine events become recipe layers drawn with real effects - glowing
 * sprites, smoke, star flashes, shockwaves, flowing beams, slash arcs, magic circles and ribbon trails - each sized
 * from the event's own hit geometry, so a damaging layer shows exactly the area that hurts. Heavy hits freeze the
 * picture for a beat and shake the camera; a transformation wraps the hero in its form at its hitbox. All cosmetic.
 */

/** Effect budgets (KTD11): additive and smoke sprites recycle oldest-first; pooled meshes give way oldest-first. */
export const BUDGET = { glow: 16_000, smoke: 3_000, meshes: 96, trails: 48 }

interface Live {
  mesh: THREE.Mesh
  start: number
  duration: number
  /** Called each frame with progress 0-1. */
  update: (p: number, mesh: THREE.Mesh) => void
  kind: string
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

// one fan per whole-degree arc, shared by every cone effect
const cones = new Map<number, THREE.CircleGeometry>()
function coneGeometry(degrees: number): THREE.CircleGeometry {
  const key = Math.round(degrees)
  let g = cones.get(key)
  if (!g) {
    const arc = (key * Math.PI) / 180
    cones.set(key, (g = new THREE.CircleGeometry(1, 32, Math.PI / 2 - arc / 2, arc)))
  }
  return g
}

type EnergyMaterial = MeshBasicNodeMaterial & { tint: { value: THREE.Color }; fade: { value: number } }

/**
 * An energy body, tinted per effect, additive. A core (a projectile) glows through its middle; a shell (a burst, an
 * aura, a transformed hero's hitbox) lights only its rim, so what sits inside it stays readable.
 */
function energyMaterial(color: THREE.Color, opacity: number, shell = false): EnergyMaterial {
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }) as EnergyMaterial
  const tint = uniform(color.clone())
  const fade = uniform(opacity)
  const facing = normalView.dot(positionViewDirection).abs()
  const rim = float(1).sub(facing).pow(1.6)
  m.colorNode = shell ? tint.mul(rim.pow(1.5).mul(2).add(0.03)) : tint.mul(rim.mul(1.8).add(facing.pow(4).mul(1.2)).add(0.25))
  m.opacityNode = fade
  m.tint = tint
  m.fade = fade
  return m
}

const flat = (map: THREE.Texture, color: THREE.Color, opacity: number) =>
  new THREE.MeshBasicMaterial({ map, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })

export function createEffects(ctrl: ArenaController, packages: (HeroPackage | undefined)[] = []): Effects {
  const { scene, arena } = ctrl
  const atlas = spriteAtlas()
  const glow = new SpritePool(BUDGET.glow, atlas, THREE.AdditiveBlending)
  const smoke = new SpritePool(BUDGET.smoke, atlas, THREE.NormalBlending)
  scene.add(smoke.mesh, glow.mesh)
  // the frame-rate guard's third step halves every spawn (U18, R26)
  const thin = (spec: SpriteSpec): SpriteSpec => (atLeast(ctrl.quality(), 'fewer-particles') ? { ...spec, count: Math.ceil(spec.count / 2) } : spec)
  let clock = 0
  const sparkle = (spec: SpriteSpec) => glow.spawn(thin(spec), clock)
  const puff = (spec: SpriteSpec) => smoke.spawn(thin(spec), clock)
  const tex = { shock: shockTexture(), magic: magicCircleTexture(), slash: slashTexture(), flow: flowTexture(), crack: crackTexture() }
  const geometry: Record<string, () => THREE.BufferGeometry> = {
    shock: () => new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
    face: () => new THREE.PlaneGeometry(2, 2),
    magic: () => new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
    crack: () => new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2),
    beam: () => new THREE.CylinderGeometry(1, 1, 1, 20, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5),
    core: () => new THREE.CylinderGeometry(1, 1, 1, 12, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5),
    cone: () => coneGeometry(90),
    orb: () => new THREE.IcosahedronGeometry(1, 3),
    shell: () => new THREE.IcosahedronGeometry(1, 3),
    form: () => new THREE.IcosahedronGeometry(1, 3),
    slash: () => arcGeometry(0.35, 1, -Math.PI * 0.42, Math.PI * 0.84),
  }
  const materialFor = (kind: string, c: THREE.Color, opacity: number): THREE.Material => {
    if (kind === 'orb') return energyMaterial(c, opacity)
    if (kind === 'shell' || kind === 'form') return energyMaterial(c, opacity, true)
    if (kind === 'beam') {
      // each beam scrolls its own copy of the flow texture
      const flow = tex.flow.clone()
      flow.needsUpdate = true
      flow.wrapS = flow.wrapT = THREE.RepeatWrapping
      flow.repeat.set(2, 3)
      return flat(flow, c, opacity)
    }
    if (kind === 'core') return new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false })
    if (kind === 'cone' || kind === 'face') return flat(tex.shock, c, opacity)
    return flat(tex[kind as keyof typeof tex], c, opacity)
  }
  const pool = new Map<string, THREE.Mesh[]>()
  const live: Live[] = []
  const tint = (m: THREE.Mesh, c: THREE.Color, opacity: number) => {
    const mat = m.material as THREE.MeshBasicMaterial & Partial<EnergyMaterial>
    if (mat.tint && mat.fade) {
      mat.tint.value.copy(c)
      mat.fade.value = opacity
    } else {
      mat.color.copy(c)
      mat.opacity = opacity
    }
  }
  const setOpacity = (m: THREE.Mesh, o: number) => {
    const mat = m.material as THREE.MeshBasicMaterial & Partial<EnergyMaterial>
    if (mat.fade) mat.fade.value = o
    else mat.opacity = o
  }
  const mesh = (kind: string, c: THREE.Color, opacity = 0.9): THREE.Mesh => {
    const free = pool.get(kind)?.pop()
    const m = free ?? new THREE.Mesh(geometry[kind](), materialFor(kind, c, opacity))
    tint(m, c, opacity)
    m.visible = true
    m.rotation.set(0, 0, 0)
    m.scale.setScalar(1)
    m.renderOrder = 2
    if (!free) scene.add(m)
    return m
  }
  const release = (l: Live) => {
    l.mesh.visible = false
    const list = pool.get(l.kind) ?? []
    list.push(l.mesh)
    pool.set(l.kind, list)
  }
  const show = (kind: string, c: THREE.Color, duration: number, place: (m: THREE.Mesh) => void, update: Live['update'], opacity = 0.9) => {
    // the mesh budget holds: when full, the oldest live effect gives way
    if (live.length >= BUDGET.meshes) release(live.shift()!)
    const m = mesh(kind, c, opacity)
    place(m)
    live.push({ mesh: m, start: clock, duration, update, kind })
  }
  const projectiles = new Map<number, { orb: THREE.Mesh; halo: THREE.Sprite; trail: Trail; recipe: EffectRecipe; size: number }>()
  const spareTrails: Trail[] = []
  const spareHalos: THREE.Sprite[] = []
  // the projectile halo uses the glow cell of the atlas (its top-left quarter)
  const haloMap = atlas.clone()
  haloMap.needsUpdate = true
  haloMap.repeat.set(0.5, 0.5)
  haloMap.offset.set(0, 0.5)
  const forms = new Map<number, THREE.Mesh>()
  const background = (scene.background as THREE.Color).clone()
  let hitStop = 0
  let shake = 0
  let sky = 0
  let skyColor = new THREE.Color()

  const recipe = (hero: number, slot: BuildSlot): EffectRecipe => {
    const own = packages[hero]?.slots[slot]?.effect?.recipe
    return own ?? defaultRecipe(arena.setups[hero].kit[slot].delivery.kind)
  }
  const color = (r: EffectRecipe, i: 0 | 1 | 2) => new THREE.Color(r.palette[i])
  const white = new THREE.Color(1, 1, 1)
  const hot = (c: THREE.Color, k = 0.55) => c.clone().lerp(white, k)
  const hsl = { h: 0, s: 0, l: 0 }
  const chroma = (c: THREE.Color) => (c.getHSL(hsl), hsl.s * (1 - Math.abs(2 * hsl.l - 1)))
  /**
   * The colour for anything that covers an area. Many palettes lead with white for a hot core, and white drawn
   * additively over a whole cone or sphere washes the picture out, so pale colours give way to the recipe's richest.
   */
  const vivid = (r: EffectRecipe, i: 0 | 1 | 2) => {
    const c = color(r, i)
    if (chroma(c) >= 0.3) return c
    return ([0, 1, 2] as const).map((k) => color(r, k)).reduce((a, b) => (chroma(b) > chroma(a) ? b : a))
  }

  /** A bright flash that pops and is gone: the punctuation on every impact. */
  const flash = (at: THREE.Vector3, c: THREE.Color, size: number) => {
    sparkle({ at, count: 1, kind: 'star', life: 0.14, size: [size * 1.6, size * 0.3], color: hot(c, 0.7), spin: 2 })
    sparkle({ at, count: 2, kind: 'glow', life: 0.22, size: [size * 1.2, size * 2.2], color: c, alpha: 0.9 })
  }
  /** Sparks that burst out and fall. */
  const sparks = (at: THREE.Vector3, c: THREE.Color, count: number, speed: number, size = 0.12) =>
    sparkle({ at, count, kind: 'glow', life: 0.5, size: [size, size * 0.2], color: hot(c, 0.3), speed, gravity: 9, drag: 1.5 })

  const layer = (l: RecipeLayer, r: EffectRecipe, at: THREE.Vector3, base: number, extra: Partial<{ dir: THREE.Vector3; range: number; arc: number; caster: THREE.Vector3 }> = {}) => {
    const size = layerSize(l, base)
    const c = color(r, l.color)
    const v = vivid(r, l.color)
    const dur = l.phase === 'linger' ? Math.max(0.4, r.linger) : 0.45
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
      case 'beam': {
        const dir = extra.dir ?? new THREE.Vector3(0, 0, 1)
        const len = extra.range ?? 10
        const end = at.clone().addScaledVector(dir, len)
        // a wide beam layer is the soft glow around a narrow one, so it is drawn faint; stacked additive layers burn white
        const strength = l.size > 1 ? 0.3 : 0.75
        show('beam', v, dur, (m) => (m.position.copy(at), m.lookAt(end), m.scale.set(size, size, len)), (p, m) => {
          setOpacity(m, strength * (1 - p))
          const map = (m.material as THREE.MeshBasicMaterial).map
          if (map) map.offset.y -= 0.08
          m.scale.x = m.scale.y = size * (1 + 0.15 * Math.sin(p * 40))
        })
        if (l.size <= 1) show('core', hot(v, 0.6), dur * 0.8, (m) => (m.position.copy(at), m.lookAt(end), m.scale.set(size * 0.3, size * 0.3, len)), (p, m) => setOpacity(m, 0.5 * (1 - p)))
        flash(at, v, size * 1.8)
        flash(end, v, size * 2.2)
        sparks(end, v, 16, 7)
        // motes streaming along the beam
        for (let k = 0; k < 5; k++) sparkle({ at: at.clone().addScaledVector(dir, (len * (k + 0.5)) / 5), count: 4, kind: 'glow', life: 0.35, size: [size * 0.7, 0.02], color: hot(c, 0.4), speed: 1.5, spread: size })
        break
      }
      case 'cone': {
        const dir = extra.dir ?? new THREE.Vector3(0, 0, 1)
        const range = extra.range ?? size
        show('cone', v, dur, (m) => {
          m.geometry = coneGeometry(extra.arc ?? 90)
          m.position.set(at.x, 0.08, at.z)
          m.rotation.set(-Math.PI / 2, 0, coneYaw(dir))
          m.scale.setScalar(range)
        }, (p, m) => setOpacity(m, 0.8 * (1 - p)))
        // a spray out along the cone
        sparkle({ at, count: 34, kind: 'glow', life: 0.45, size: [0.3, 0.06], color: hot(v, 0.3), velocity: { x: dir.x * range * 2, y: 0.5, z: dir.z * range * 2 }, speed: range * 0.6, drag: 1.5 })
        puff({ at, count: 6, kind: 'smoke', life: 0.8, size: [0.4, 1.2], color: v.clone().lerp(new THREE.Color(0.2, 0.2, 0.2), 0.5), velocity: { x: dir.x * range, y: 0.3, z: dir.z * range }, speed: 1, drag: 2, alpha: 0.3 })
        break
      }
      case 'gather':
        // motes rushing in to the caster's hands, and a hot core growing where they meet
        sparkle({ at, count: 70, kind: 'glow', life: Math.max(0.3, r.charge || 0.5), size: [0.18, 0.04], color: hot(c, 0.3), speed: -size * 3, spread: size * 2.2 })
        sparkle({ at, count: 1, kind: 'glow', life: Math.max(0.3, r.charge || 0.5), size: [size * 0.3, size * 1.6], color: c })
        break
      case 'trail':
        // a melee swing or a dash: an arc of light in front of the caster, sized to the reach
        if (extra.caster && extra.dir) {
          const yaw = Math.atan2(extra.dir.x, extra.dir.z)
          const reach = Math.max(1.4, extra.range ?? size)
          const tilt = (Math.random() - 0.5) * 0.9
          show('slash', hot(v, 0.2), 0.22, (m) => {
            m.position.set(extra.caster!.x, extra.caster!.y - 0.15, extra.caster!.z)
            m.rotation.set(0, 0, 0)
            // the arc's open side faces the swing direction; a little tilt makes it a diagonal cut
            m.rotateY(-yaw + Math.PI / 2)
            m.rotateX(tilt)
            m.scale.setScalar(reach)
          }, (p, m) => (setOpacity(m, 1.3 * (1 - p) ** 1.5), m.scale.setScalar(reach * (0.9 + 0.2 * p))))
        }
        sparks(at, c, 10, 5)
        break
      case 'sparks':
        sparks(at, c, 24, 6)
        sparkle({ at, count: 6, kind: 'star', life: 0.25, size: [0.5, 0.1], color: hot(c, 0.6), speed: 3, spin: 4 })
        break
      case 'sky':
        sky = Math.max(sky, r.charge + 0.6)
        skyColor = c
        break
      case 'aura':
        // a low dome of light over the aura's ground, and motes rising off it: a sphere this wide would swallow the fight
        show('shell', v, dur, (m) => (m.position.set(at.x, Math.max(0, at.y - 1.1), at.z), m.scale.set(size, size * 0.45, size)), (p, m) => setOpacity(m, 0.28 * (1 - p)), 0.28)
        sparkle({ at, count: 24, kind: 'glow', life: 0.9, size: [0.16, 0.04], color: hot(v, 0.3), spread: size, velocity: { x: 0, y: 2.5, z: 0 }, speed: 0.6 })
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

  const v3 = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.y, p.z)
  // walls, turrets, fields, traps and stealth: what skills leave in the world
  const world = createWorldFx(ctrl, { sparkle, puff, flash, tint: (hero, slot = 'active1') => vivid(recipe(hero, slot), 0) })

  const dropForm = (hero: number) => {
    const m = forms.get(hero)
    if (m) m.visible = false
    forms.delete(hero)
  }
  const aimOf = (hero: number) => {
    const h = arena.match.heroes[hero]
    return new THREE.Vector3(Math.sin(h.yaw) * Math.cos(h.pitch), Math.sin(h.pitch), Math.cos(h.yaw) * Math.cos(h.pitch))
  }

  return {
    events: (events) => {
      world.events(events)
      for (const e of events) {
        if (e.type === 'cast') {
          const r = recipe(e.hero, e.slot)
          const hero = arena.match.heroes[e.hero]
          const at = v3(chest(hero))
          for (const l of r.layers) if (l.phase === 'charge') layer(l, r, at, 1)
          // skills draw a magic circle under the caster; the ultimate's is big and slow
          if (e.slot !== 'basic' && e.slot !== 'passive') {
            const big = e.slot === 'ultimate'
            const c = vivid(r, 0)
            show('magic', c, big ? 1.4 : 0.7, (m) => (m.position.set(hero.position.x, hero.position.y + 0.05, hero.position.z), m.scale.setScalar(big ? 2.6 : 1.4)), (p, m) => {
              m.rotation.y += big ? 0.04 : 0.06
              setOpacity(m, (p < 0.15 ? p / 0.15 : 1 - (p - 0.15) / 0.85) * 1.2)
            })
            if (big) sparkle({ at: v3(hero.position), count: 60, kind: 'glow', life: 1.2, size: [0.25, 0.05], color: hot(c, 0.3), spread: 2.2, velocity: { x: 0, y: 3.5, z: 0 }, speed: 0.6 })
          }
          playCast(r.delivery)
        } else if (e.type === 'projectile') {
          const r = recipe(e.hero, e.slot)
          const core = r.layers.find((l) => l.damaging) ?? r.layers[0]
          const c = color(r, core.color)
          const v = vivid(r, core.color)
          const size = layerSize(core, e.radius) * (core.intensity ?? 1)
          const orb = mesh('orb', c, 1)
          orb.scale.setScalar(size)
          const halo = spareHalos.pop() ?? new THREE.Sprite(new THREE.SpriteMaterial({ map: haloMap, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
          halo.material.color.copy(v)
          halo.scale.setScalar(size * 4.5)
          scene.add(halo)
          const trail = spareTrails.pop() ?? new Trail(18, size * 2.2, v)
          trail.recolor(hot(v, 0.15))
          trail.reset()
          trail.mesh.visible = true
          if (!trail.mesh.parent) scene.add(trail.mesh)
          projectiles.set(e.id, { orb, halo, trail, recipe: r, size })
          // a muzzle flash where it leaves the hand
          flash(v3(e.from), v, Math.max(0.4, size * 2.2))
        } else if (e.type === 'impact') {
          const r = recipe(e.hero, e.slot)
          const caster = arena.match.heroes[e.hero]
          const from = v3(chest(caster))
          const dir = aimOf(e.hero)
          const base = baseSize(e as ImpactEvent, arena.setups[e.hero].kit[e.slot].delivery.projectileRadius)
          for (const l of r.layers) {
            if (l.phase !== 'impact' && l.phase !== 'linger') continue
            const place = l.primitive === 'beam' || l.primitive === 'cone' ? from : v3(e.at)
            layer(l, r, place, base, { dir, range: e.range, arc: e.arcDegrees, caster: from })
          }
        } else if (e.type === 'hit') {
          const feel = hitFeel(e)
          const target = arena.match.heroes[e.target]
          const at = v3(chest(target))
          const r = recipe(e.source, e.slot)
          const c = vivid(r, 1)
          // an anime hit: a star flash, sparks thrown off the body, a shock ring on heavy blows, a little blood
          flash(at, c, e.heavy ? 1.2 : 0.7)
          sparks(at, c, e.heavy ? 18 : 8, e.heavy ? 6 : 4, 0.1)
          if (e.heavy) {
            show('face', hot(c), 0.3, (m) => (m.position.copy(at), m.lookAt(ctrl.camera.position)), (p, m) => (m.scale.setScalar(0.5 + 1.6 * p), setOpacity(m, 1 - p)))
          }
          if (feel.blood) puff({ at, count: Math.ceil(feel.blood / 3), kind: 'glow', life: 0.5, size: [0.08, 0.03], color: new THREE.Color(0.6, 0.02, 0.02), speed: 3.5, gravity: 14, alpha: 0.9 })
          hitStop = Math.max(hitStop, feel.hitStop)
          shake = Math.max(shake, feel.shake)
          playHit(e.heavy)
        } else if (e.type === 'resize') {
          const hero = arena.match.heroes[e.hero]
          if (e.phase === 'start') {
            const r = recipe(e.hero, 'ultimate')
            const m = forms.get(e.hero) ?? mesh('form', vivid(r, 0), 0.6)
            // the form fills the hero's new capsule exactly: what the audience sees is what can be hit (R23, AE6)
            const c = capsule(hero)
            m.scale.set(c.radius, c.height / 2, c.radius)
            forms.set(e.hero, m)
            flash(v3(chest(hero)), vivid(r, 0), 2.5)
          } else dropForm(e.hero)
        } else if (e.type === 'cover-hit') {
          // stone chips and a puff of dust where a shot meets cover
          const at = v3(e.at)
          sparkle({ at, count: 8, kind: 'glow', life: 0.4, size: [0.08, 0.02], color: new THREE.Color(1, 0.85, 0.6), speed: 4, gravity: 10 })
          puff({ at, count: 3, kind: 'smoke', life: 0.9, size: [0.3, 1.0], color: new THREE.Color(0.85, 0.8, 0.7), speed: 0.8, drag: 2, alpha: 0.5, spin: 0.8 })
        } else if (e.type === 'cover-broken') {
          // a barricade bursting: a cloud of dust, splinters flying, a shockwave and a thump in the camera
          const at = v3(e.at)
          puff({ at, count: 28, kind: 'smoke', life: 1.8, size: [0.8, 2.6], color: new THREE.Color(0.78, 0.7, 0.58), speed: 4, spread: 1, drag: 1.8, up: 0.5, alpha: 0.6, spin: 0.5 })
          puff({ at, count: 30, kind: 'glow', life: 0.9, size: [0.12, 0.08], color: new THREE.Color(0.45, 0.3, 0.16), speed: 8, gravity: 12, alpha: 1 })
          show('shock', new THREE.Color(1, 0.9, 0.7), 0.5, (m) => m.position.set(at.x, 0.06, at.z), (p, m) => (m.scale.setScalar(1 + 4 * p), setOpacity(m, 0.8 * (1 - p))))
          shake = Math.max(shake, 0.4)
        } else if (e.type === 'death') {
          // the engine sends no resize end for a hero that dies transformed
          dropForm(e.hero)
          const hero = arena.match.heroes[e.hero]
          const at = v3(chest(hero))
          const team = hero.team === 0 ? new THREE.Color(0.31, 0.64, 1) : new THREE.Color(1, 0.42, 0.29)
          flash(at, team, 2)
          // spirit motes rising off the fallen, in their team's colour
          sparkle({ at, count: 50, kind: 'glow', life: 1.6, size: [0.22, 0.04], color: hot(team, 0.35), spread: 0.6, velocity: { x: 0, y: 2.8, z: 0 }, speed: 1 })
          puff({ at: { x: at.x, y: 0.3, z: at.z }, count: 8, kind: 'smoke', life: 1.4, size: [0.5, 1.5], color: new THREE.Color(0.7, 0.65, 0.58), speed: 2.5, drag: 2, up: 0.4, alpha: 0.35 })
        }
      }
    },
    frame: (dt) => {
      clock += dt
      world.frame(dt)
      glow.update(clock)
      smoke.update(clock)
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
      const flying = new Map(arena.match.projectiles.map((p) => [p.id, p]))
      for (const [id, fx] of projectiles) {
        const p = flying.get(id)
        if (!p) {
          fx.orb.visible = false
          const list = pool.get('orb') ?? []
          list.push(fx.orb)
          pool.set('orb', list)
          fx.halo.removeFromParent()
          spareHalos.push(fx.halo)
          fx.trail.mesh.visible = false
          if (spareTrails.length < BUDGET.trails) spareTrails.push(fx.trail)
          else fx.trail.dispose()
          projectiles.delete(id)
          continue
        }
        const at = v3(p.position)
        fx.orb.position.copy(at)
        fx.orb.rotation.y += dt * 6
        fx.halo.position.copy(at)
        fx.trail.push(at, ctrl.camera)
        sparkle({ at, count: 2, kind: 'glow', life: 0.35, size: [fx.size * 1.4, 0.02], color: hot(color(fx.recipe, 1), 0.3), speed: 0.5, spread: fx.size })
      }
      for (const [id, m] of forms) {
        const at = positions[id]
        m.position.set(at.x, at.y + capsule(arena.match.heroes[id]).height * 0.55, at.z)
      }
      sky = Math.max(0, sky - dt)
      const flashSky = skyFlashOf(scene)
      if (flashSky) {
        flashSky.tint.copy(skyColor)
        flashSky.amount.value = Math.min(0.55, sky)
      } else (scene.background as THREE.Color).copy(background).lerp(skyColor, Math.min(0.55, sky))
    },
    timeScale: () => (hitStop > 0 ? 0.05 : 1),
    shake: () => new THREE.Vector3((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake),
    stats: () => ({ meshes: live.length + projectiles.size + forms.size, particles: BUDGET.glow + BUDGET.smoke }),
  }
}
