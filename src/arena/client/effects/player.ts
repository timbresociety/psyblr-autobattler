import * as THREE from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { float, normalView, positionViewDirection, uniform } from 'three/tsl'
import { clone as cloneRig } from 'three/addons/utils/SkeletonUtils.js'
import { BUILD_SLOTS } from '../../../charter/build.js'
import { FAMILY_OF } from '../../../charter/skill-look.js'
import type { BuildSlot } from '../../../charter/types.js'
import type { HeroPackage } from '../../../forge/package.js'
import { ENGINE } from '../../engine/calibration.js'
import { capsule } from '../../engine/state.js'
import { atLeast } from '../quality.js'
import { chest } from '../../engine/deliveries.js'
import type { MatchEvent } from '../../engine/events.js'
import { composeRecipe } from '../../recipes/defaults.js'
import { skillLookOf } from '../../recipes/looks.js'
import type { EffectRecipe, RecipeLayer } from '../../recipes/schema.js'
import type { ArenaController } from '../match-view.js'
import { skyFlashOf } from '../map.js'
import { bandGeometry, color, coneGeometry, createDraw, hot, setOpacity, v3, vivid, type MeshKind } from './draw.js'
import { baseSize, hitFeel, layerSize, type ImpactEvent } from './sizing.js'
import { playCast, playHit } from './sound.js'
import { createWorldFx } from './world-fx.js'
import {
  RibbonPool,
  SpritePool,
  Trail,
  arcGeometry,
  chainTexture,
  crackTexture,
  crescentGeometry,
  crescentTexture,
  discTexture,
  flowTexture,
  magicCircleTexture,
  motifAtlas,
  rockGeometry,
  shockTexture,
  slashTexture,
  spriteAtlas,
  vortexTexture,
  type SpriteSpec,
} from './vfx.js'

/**
 * The effect kit at runtime (U14, R10, R11, R21): engine events become recipe layers drawn with real effects - glowing
 * sprites, smoke, star flashes, shockwaves, flowing beams, lightning, spirals, slash arcs, magic circles and ribbon
 * trails - each sized from the event's own hit geometry, so a damaging layer shows exactly the area that hurts. A
 * skill's look (src/charter/skill-look.ts) picks the form, charge, landing and trail; draw.ts draws each one. Heavy hits
 * freeze the picture for a beat and shake the camera; a transformation wraps the hero in its form at its hitbox.
 * All cosmetic.
 */

/** Effect budgets (KTD11): sprites, ribbons and pooled meshes recycle oldest-first, and nothing grows past these. */
export const BUDGET = { glow: 16_000, smoke: 3_000, motifs: 1_500, meshes: 96, trails: 48, ribbons: 64, ghosts: 8, tasks: 2_000 }

interface Live {
  mesh: THREE.Mesh
  start: number
  duration: number
  /** Called each frame with progress 0-1. */
  update: (p: number, mesh: THREE.Mesh) => void
  kind: MeshKind
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
const plain = (color: THREE.Color, opacity: number, side: THREE.Side = THREE.FrontSide) =>
  new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side })
/** Each mesh scrolls or tiles its own copy of a texture. */
const own = (t: THREE.Texture, u: number, v: number) => {
  const c = t.clone()
  c.needsUpdate = true
  c.wrapS = c.wrapT = THREE.RepeatWrapping
  c.repeat.set(u, v)
  return c
}
// a tube of length 1 along +z from the origin, so `lookAt` and a z scale lay it from one point to another
const tube = (segments: number) => new THREE.CylinderGeometry(1, 1, 1, segments, 1, true).rotateX(Math.PI / 2).translate(0, 0, 0.5)
const ground = () => new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2)

/** What a shot flies as: the hit layer's primitive and style pick the body, and the body fits inside the hit sphere. */
type ShotBody = 'orb' | 'bolt' | 'crystal' | 'arrow' | 'disc' | 'crescent' | 'meteor'
function shotBody(core: RecipeLayer): ShotBody {
  if (core.primitive === 'shard') return core.style === 'arrow' ? 'arrow' : core.style === 'crystal' ? 'crystal' : 'bolt'
  if (core.primitive === 'disc' || core.primitive === 'crescent' || core.primitive === 'meteor') return core.primitive
  return 'orb'
}
const BODY_MESH: Record<ShotBody, MeshKind> = { orb: 'orb', bolt: 'shard', crystal: 'shard', arrow: 'shard', disc: 'disc', crescent: 'crescent', meteor: 'rock' }
/** The trail behind each body, as a share of the shot's radius. */
const TRAIL_WIDTH: Record<ShotBody, number> = { orb: 2.2, bolt: 1.2, crystal: 1.4, arrow: 0.5, disc: 0.8, crescent: 1.6, meteor: 2.4 }

interface Shot {
  body: THREE.Mesh
  kind: MeshKind
  shape: ShotBody
  halo: THREE.Sprite
  trail: Trail
  /** A meteor's burning skin. */
  skin?: THREE.Mesh
  recipe: EffectRecipe
  size: number
  /** What it sheds each frame on the way: sparks, smoke or its motif. */
  wakes: RecipeLayer[]
  last: THREE.Vector3
}

interface Ghost {
  root: THREE.Object3D
  material: EnergyMaterial
  born: number
  life: number
  skeletons: THREE.Skeleton[]
}

export function createEffects(ctrl: ArenaController, packages: (HeroPackage | undefined)[] = []): Effects {
  const { scene, arena } = ctrl
  const atlas = spriteAtlas()
  const glow = new SpritePool(BUDGET.glow, atlas, THREE.AdditiveBlending)
  const smoke = new SpritePool(BUDGET.smoke, atlas, THREE.NormalBlending)
  // coins, notes, leaves and code read as shapes, so they are drawn solid rather than as light
  const motifs = new SpritePool(BUDGET.motifs, motifAtlas(), THREE.NormalBlending, 4)
  const ribbons = new RibbonPool(BUDGET.ribbons)
  scene.add(smoke.mesh, glow.mesh, motifs.mesh, ribbons.mesh)
  // the frame-rate guard's third step halves every spawn (U18, R26)
  const thin = (spec: SpriteSpec): SpriteSpec => (atLeast(ctrl.quality(), 'fewer-particles') ? { ...spec, count: Math.ceil(spec.count / 2) } : spec)
  let clock = 0
  const sparkle = (spec: SpriteSpec) => glow.spawn(thin(spec), clock)
  const puff = (spec: SpriteSpec) => smoke.spawn(thin(spec), clock)
  const motif = (spec: SpriteSpec) => motifs.spawn(thin(spec), clock)
  const tex = {
    shock: shockTexture(),
    magic: magicCircleTexture(),
    slash: slashTexture(),
    flow: flowTexture(),
    crack: crackTexture(),
    chain: chainTexture(),
    vortex: vortexTexture(),
    disc: discTexture(),
    crescent: crescentTexture(),
  }
  const geometry: Record<MeshKind, () => THREE.BufferGeometry> = {
    shock: ground,
    face: () => new THREE.PlaneGeometry(2, 2),
    magic: ground,
    crack: ground,
    vortex: ground,
    beam: () => tube(20),
    core: () => tube(12),
    chain: () => tube(8),
    pillar: () => new THREE.CylinderGeometry(1, 1, 1, 24, 1, true).translate(0, 0.5, 0),
    cone: () => coneGeometry(90),
    band: () => bandGeometry(90),
    orb: () => new THREE.IcosahedronGeometry(1, 3),
    shell: () => new THREE.IcosahedronGeometry(1, 3),
    form: () => new THREE.IcosahedronGeometry(1, 3),
    dome: () => new THREE.SphereGeometry(1, 28, 10, 0, Math.PI * 2, 0, Math.PI / 2),
    // a diamond with its tips at z = ±1: scaled (w, w, half-length) it lies along its flight
    shard: () => new THREE.OctahedronGeometry(1, 0),
    rock: rockGeometry,
    disc: () => new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2),
    crescent: () => crescentGeometry(),
    slash: () => arcGeometry(0.35, 1, -Math.PI * 0.42, Math.PI * 0.84),
  }
  const materialFor = (kind: MeshKind, c: THREE.Color, opacity: number): THREE.Material => {
    switch (kind) {
      case 'orb':
      case 'shard':
        return energyMaterial(c, opacity)
      case 'shell':
      case 'form':
      case 'dome':
        return energyMaterial(c, opacity, true)
      case 'rock':
        // a meteor is stone, lit by the arena, glowing from inside
        return new THREE.MeshStandardMaterial({ color: 0x2b2421, emissive: c, emissiveIntensity: 0.7, roughness: 0.95, flatShading: true, transparent: true, opacity })
      case 'beam':
        return flat(own(tex.flow, 2, 3), c, opacity)
      case 'pillar':
        return flat(own(tex.flow, 3, 1), c, opacity)
      case 'chain':
        return flat(own(tex.chain, 1, 1), c, opacity)
      case 'core':
        return plain(c, opacity)
      case 'band':
        return plain(c, opacity, THREE.DoubleSide)
      case 'cone':
      case 'face':
        return flat(tex.shock, c, opacity)
      default:
        return flat(tex[kind], c, opacity)
    }
  }
  const pool = new Map<MeshKind, THREE.Mesh[]>()
  const live: Live[] = []
  const tint = (m: THREE.Mesh, c: THREE.Color, opacity: number) => {
    const mat = m.material as THREE.MeshBasicMaterial & Partial<EnergyMaterial>
    if (mat.tint && mat.fade) {
      mat.tint.value.copy(c)
      mat.fade.value = opacity
    } else if (mat instanceof THREE.MeshStandardMaterial) {
      mat.emissive.copy(c)
      mat.opacity = opacity
    } else {
      mat.color.copy(c)
      mat.opacity = opacity
    }
  }
  const mesh = (kind: MeshKind, c: THREE.Color, opacity = 0.9): THREE.Mesh => {
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
  const park = (kind: MeshKind, m: THREE.Mesh) => {
    m.visible = false
    const list = pool.get(kind) ?? []
    list.push(m)
    pool.set(kind, list)
  }
  const release = (l: Live) => park(l.kind, l.mesh)
  const show = (kind: MeshKind, c: THREE.Color, duration: number, place: (m: THREE.Mesh) => void, update: Live['update'], opacity = 0.9) => {
    // the mesh budget holds: when full, the oldest live effect gives way
    if (live.length >= BUDGET.meshes) release(live.shift()!)
    const m = mesh(kind, c, opacity)
    place(m)
    live.push({ mesh: m, start: clock, duration, update, kind })
  }

  // effects that play out over time: a stream of breath, rain falling, pillars erupting one after another
  const tasks: { at: number; fn: () => void }[] = []
  const later = (seconds: number, fn: () => void) => {
    if (seconds <= 0) fn()
    else if (tasks.length < BUDGET.tasks) tasks.push({ at: clock + seconds, fn })
  }

  // afterimages: frozen copies of a hero, glowing, left where it passed
  const ghosts: Ghost[] = []
  const spareGhostMaterials: EnergyMaterial[] = []
  const endGhost = (g: Ghost) => {
    g.root.removeFromParent()
    for (const s of g.skeletons) s.dispose()
    spareGhostMaterials.push(g.material)
  }
  const ghost = (hero: number, at: THREE.Vector3, c: THREE.Color, life: number) => {
    const view = ctrl.views[hero]
    if (!view) return
    if (ghosts.length >= BUDGET.ghosts) endGhost(ghosts.shift()!)
    const material = spareGhostMaterials.pop() ?? energyMaterial(c, 0.7, true)
    material.tint.value.copy(c)
    material.fade.value = 0.7
    // the copy shares the hero's geometry; only its bones are new, posed as the hero stands now
    const root = cloneRig(view.root)
    const skeletons: THREE.Skeleton[] = []
    root.traverse((o) => {
      const m = o as THREE.SkinnedMesh
      if (m.isMesh) {
        m.material = material
        m.castShadow = false
        if (m.isSkinnedMesh) skeletons.push(m.skeleton)
      } else if ((o as THREE.Sprite).isSprite || (o as THREE.Points).isPoints || (o as THREE.Line).isLine) o.visible = false
    })
    root.position.set(at.x, at.y, at.z)
    scene.add(root)
    ghosts.push({ root, material, born: clock, life, skeletons })
  }

  const projectiles = new Map<number, Shot>()
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

  // every skill's recipe, worked out once: its package's own, else one composed from its look
  const recipes = arena.setups.map((setup, hero) => {
    const out = {} as Record<BuildSlot, EffectRecipe>
    for (const slot of BUILD_SLOTS) out[slot] = packages[hero]?.slots[slot]?.effect?.recipe ?? composeRecipe(setup.kit[slot].delivery.kind, skillLookOf(setup.build, slot))
    return out
  })
  const recipe = (hero: number, slot: BuildSlot): EffectRecipe => recipes[hero][slot]

  const draw = createDraw({
    camera: () => ctrl.camera,
    show,
    sparkle,
    puff,
    motif,
    ribbon: (path, c, width, life, options) => ribbons.spawn(path, c, width, life, clock, options),
    later,
    shake: (amount) => (shake = Math.max(shake, amount)),
    darken: (seconds, c) => {
      sky = Math.max(sky, seconds)
      skyColor = c
    },
    ghost,
  })
  const { flash, sparks } = draw

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

  const launch = (e: Extract<MatchEvent, { type: 'projectile' }>) => {
    const r = recipe(e.hero, e.slot)
    const core = r.layers.find((l) => l.damaging) ?? r.layers[0]
    const shape = shotBody(core)
    const kind = BODY_MESH[shape]
    const c = color(r, core.color)
    const v = vivid(r, core.color)
    // the body is the hit sphere's size and never more; the look's intensity brightens the halo instead
    const size = layerSize(core, e.radius)
    const bright = Math.min(2, Math.max(0.5, r.intensity ?? 1))
    const body = mesh(kind, shape === 'meteor' ? v : c, 1)
    if (shape === 'bolt') body.scale.set(size * 0.3, size * 0.3, size)
    else if (shape === 'crystal') body.scale.set(size * 0.45, size * 0.45, size)
    else if (shape === 'arrow') body.scale.set(size * 0.12, size * 0.12, size)
    else body.scale.setScalar(shape === 'crescent' ? size * 0.95 : size)
    const skin = shape === 'meteor' ? mesh('shell', hot(v, 0.2), 0.9) : undefined
    skin?.scale.setScalar(size * 1.15)
    const halo = spareHalos.pop() ?? new THREE.Sprite(new THREE.SpriteMaterial({ map: haloMap, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))
    halo.material.color.copy(v)
    halo.material.opacity = Math.min(1, 0.6 * bright)
    halo.scale.setScalar(size * (shape === 'orb' ? 4.5 : 3) * bright)
    scene.add(halo)
    const width = size * TRAIL_WIDTH[shape]
    const trail = spareTrails.pop() ?? new Trail(18, width, v)
    trail.width = width
    trail.recolor(hot(v, 0.15))
    trail.reset()
    trail.mesh.visible = true
    if (!trail.mesh.parent) scene.add(trail.mesh)
    const wakes = r.layers.filter((l) => l.phase === 'travel' && (l.primitive === 'sparks' || l.primitive === 'smoke' || l.primitive === 'motif'))
    const from = v3(e.from)
    body.position.copy(from)
    projectiles.set(e.id, { body, kind, shape, halo, trail, skin, recipe: r, size, wakes, last: from })
    // a muzzle flash where it leaves the hand
    flash(from, v, Math.max(0.4, size * 2.2))
  }

  const land = (id: number, fx: Shot) => {
    park(fx.kind, fx.body)
    if (fx.skin) park('shell', fx.skin)
    fx.halo.removeFromParent()
    spareHalos.push(fx.halo)
    fx.trail.mesh.visible = false
    if (spareTrails.length < BUDGET.trails) spareTrails.push(fx.trail)
    else fx.trail.dispose()
    projectiles.delete(id)
  }

  const fly = (fx: Shot, at: THREE.Vector3, dt: number) => {
    const heading = at.clone().sub(fx.last)
    const moving = heading.lengthSq() > 1e-6
    const b = fx.body
    b.position.copy(at)
    switch (fx.shape) {
      case 'orb':
        b.rotation.y += dt * 6
        break
      case 'disc':
        // a saw spinning flat as it flies
        b.rotation.y += dt * 30
        break
      case 'meteor':
        b.rotation.x += dt * 4
        b.rotation.z += dt * 2.5
        fx.skin?.position.copy(at)
        break
      default:
        // bolts, crystals, arrows and crescents point where they fly
        if (moving) b.lookAt(at.clone().add(heading))
        if (fx.shape === 'crystal') b.rotateZ(clock * 9)
    }
    fx.halo.position.copy(at)
    fx.trail.push(at, ctrl.camera)
    sparkle({ at, count: 2, kind: 'glow', life: 0.35, size: [fx.size * 1.4, 0.02], color: hot(color(fx.recipe, 1), 0.3), speed: 0.5, spread: fx.size })
    for (const l of fx.wakes) draw.wake(l, fx.recipe, at, fx.size)
    fx.last = at
  }

  return {
    events: (events) => {
      world.events(events)
      for (const e of events) {
        if (e.type === 'cast') {
          const r = recipe(e.hero, e.slot)
          const hero = arena.match.heroes[e.hero]
          const at = v3(chest(hero))
          const dir = aimOf(e.hero)
          const family = FAMILY_OF[r.delivery]
          for (const l of r.layers) if (l.phase === 'charge') draw.layer(l, r, at, 1, { dir })
          // a self-cast has no area and sends no impact: its look plays on the caster as it casts
          if (family === 'self') for (const l of r.layers) if (l.phase === 'impact' || l.phase === 'linger') draw.layer(l, r, at, capsule(hero).height / 2, { dir, caster: at })
          // a movement skill has already moved the hero; its way runs from where the hero was last drawn
          if (family === 'movement') {
            const was = ctrl.positions()[e.hero]
            const from = was ? v3(was) : v3(hero.position)
            for (const l of r.layers) if (l.phase === 'travel') draw.path(l, r, e.hero, from, v3(hero.position), capsule(hero).height * ENGINE.chest)
          }
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
          launch(e)
        } else if (e.type === 'impact') {
          const r = recipe(e.hero, e.slot)
          const caster = arena.match.heroes[e.hero]
          const from = v3(chest(caster))
          const end = v3(e.at)
          // a beam runs from the hands to where the engine stopped it, wall or full range
          const beam = r.delivery === 'beam'
          const length = beam ? from.distanceTo(end) : e.range
          const dir = beam && length > 0.01 ? end.clone().sub(from).normalize() : aimOf(e.hero)
          const base = baseSize(e as ImpactEvent, arena.setups[e.hero].kit[e.slot].delivery.projectileRadius)
          for (const l of r.layers) {
            if (l.phase === 'travel') {
              if (beam) draw.along(l, r, from, dir, length, base)
              continue
            }
            if (l.phase !== 'impact' && l.phase !== 'linger') continue
            const place = l.primitive === 'beam' || l.primitive === 'cone' ? from : end
            draw.layer(l, r, place, base, { dir, range: length, arc: e.arcDegrees, caster: from })
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
      // tasks may book more tasks; those run from the next frame
      for (let i = tasks.length - 1; i >= 0; i--) {
        if (tasks[i].at > clock) continue
        const task = tasks[i]
        tasks[i] = tasks[tasks.length - 1]
        tasks.pop()
        task.fn()
      }
      glow.update(clock)
      smoke.update(clock)
      motifs.update(clock)
      ribbons.update(clock, ctrl.camera)
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
      for (let i = ghosts.length - 1; i >= 0; i--) {
        const g = ghosts[i]
        const p = (clock - g.born) / g.life
        if (p >= 1) {
          endGhost(g)
          ghosts.splice(i, 1)
        } else g.material.fade.value = 0.7 * (1 - p) ** 1.3
      }
      const positions = ctrl.positions()
      const flying = new Map(arena.match.projectiles.map((p) => [p.id, p]))
      for (const [id, fx] of projectiles) {
        const p = flying.get(id)
        if (p) fly(fx, v3(p.position), dt)
        else land(id, fx)
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
    stats: () => ({ meshes: live.length + projectiles.size + forms.size + ghosts.length, particles: BUDGET.glow + BUDGET.smoke + BUDGET.motifs }),
  }
}
