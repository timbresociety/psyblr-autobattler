import * as THREE from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { attribute, float, normalView, positionViewDirection, uniform } from 'three/tsl'
import { clone as cloneRig } from 'three/addons/utils/SkeletonUtils.js'
import { BUILD_SLOTS } from '../../../charter/build.js'
import { FAMILY_OF } from '../../../charter/skill-look.js'
import type { BuildSlot } from '../../../charter/types.js'
import { transformOf } from '../../../forge/form.js'
import type { HeroPackage } from '../../../forge/package.js'
import { ENGINE } from '../../engine/calibration.js'
import { capsule } from '../../engine/state.js'
import { atLeast } from '../quality.js'
import { chest } from '../../engine/deliveries.js'
import type { MatchEvent } from '../../engine/events.js'
import { composeRecipe } from '../../recipes/defaults.js'
import { formLookOf, skillLookOf } from '../../recipes/looks.js'
import type { EffectRecipe, RecipeLayer } from '../../recipes/schema.js'
import type { ArenaController } from '../match-view.js'
import { skyFlashOf } from '../map.js'
import { color, createDraw, fanShapes, hot, setOpacity, v3, vivid, type Kit, type MeshKind } from './draw.js'
import { createForms } from './forms.js'
import { baseSize, hitFeel, layerSize, type ImpactEvent } from './sizing.js'
import { cue, kitReady, playCast, playHit, type Cue, type Voice } from './sound.js'
import { createWorldFx } from './world-fx.js'
import { contactPoint, groundUnder } from './anchors.js'
import { createBlasts, elementOf, feelAt, nearness, tierOf, type Blow, type Feel, type Tier } from './blast.js'
import { DebrisPool } from './debris.js'
import { Decals } from './decals.js'
import { Props, fracture, houseProps, pieceColor } from './props.js'
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
export const BUDGET = { glow: 16_000, smoke: 3_000, motifs: 1_500, meshes: 96, trails: 48, ribbons: 64, tails: 36, ghosts: 8, tasks: 2_000 }

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
  /** Camera shake and kick offset to add this frame. */
  shake: () => THREE.Vector3
  /** The screen's share of the hit feel this frame (§6b): radial blur and speed lines toward a blast, the impact frame. */
  screen: () => ScreenFeel
  stats: () => { meshes: number; particles: number; debris: number; decals: number; props: number }
  /** For checking the look by hand (dev scripts): play a blast of a tier at a point. */
  blast: (tier: Tier, at: { x: number; y: number; z: number }, color?: THREE.Color) => void
  /** For checking the look by hand: hold the screen's hit feel at this until unpinned (a still of a two-frame flash). */
  pin: (screen?: ScreenFeel) => void
}

export interface ScreenFeel {
  /** Radial blur toward `centre`, 0-1. */
  blur: number
  /** Where the blast is on screen, 0-1 from the top left. */
  centre: [number, number]
  /** Speed lines streaming out of `centre`, 0-1. */
  lines: number
  /** The anime impact frame: 0 off, 1 ink, 2 ink inverted. */
  impact: number
  /** Changes every frame, so the lines flicker. */
  seed: number
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
/** The effect kinds drawn instanced (plain additive basic materials sharing their kind's texture). */
const BATCHED: ReadonlySet<MeshKind> = new Set(['shock', 'face', 'magic', 'crack', 'vortex', 'cone', 'band', 'core', 'disc', 'crescent', 'slash'])

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
  /** From the engine's start to the palm it is drawn leaving from, eased away over HAND_BLEND. */
  lead: THREE.Vector3
  born: number
}

/** Within this many metres of the camera a sound plays at full level; it halves at twice this. */
const NEAR = 14
/** Seconds a swing's whoosh peaks before its contact, so the hit doesn't swallow it. */
const SWING_LEAD = 0.05

/** Seconds a shot takes to ease from the palm onto the engine's line. */
const HAND_BLEND = 0.15
/** A swing's smear shows at this hand speed (metres a second, against the body) and is brightest at the second. */
const SMEAR_SPEED = [3, 9]
/** Most swings smearing at once; more swing unsmeared. */
const SMEARS = 12
/** Seconds of the fight between a smear's points, whatever the clock's speed. */
const SMEAR_STEP = 1 / 60
/** Frames at a match's start that every effect is drawn unseen, so its shaders compile in the countdown. */
const WARM_FRAMES = 4

interface Ghost {
  root: THREE.Object3D
  material: EnergyMaterial
  born: number
  life: number
  skeletons: THREE.Skeleton[]
}

/** Dust off the ground, air under a second jump, and each team's glow (phase 2). */
const DUST = new THREE.Color(0.78, 0.72, 0.62)
const AIR = new THREE.Color(0.9, 0.94, 1)
const TEAM_GLOW = [new THREE.Color(0.31, 0.64, 1), new THREE.Color(1, 0.42, 0.29)] as const

/** The most the camera shakes, metres from one side to the other: an ultimate next to it, never more. */
const SHAKE_MAX = 0.12

export function createEffects(ctrl: ArenaController, packages: (HeroPackage | undefined)[] = []): Effects {
  const { scene, arena } = ctrl
  const atlas = spriteAtlas()
  const glow = new SpritePool(BUDGET.glow, atlas, THREE.AdditiveBlending)
  const smoke = new SpritePool(BUDGET.smoke, atlas, THREE.NormalBlending)
  // coins, notes, leaves and code read as shapes, so they are drawn solid rather than as light
  const motifs = new SpritePool(BUDGET.motifs, motifAtlas(), THREE.NormalBlending, 4)
  const ribbons = new RibbonPool(BUDGET.ribbons)
  // a form's tails get a pool of their own, so a busy fight's ribbons never take one mid-form, and are drawn solid, so
  // an orange tail stays orange over a sunlit floor instead of washing out to white
  const tailRibbons = new RibbonPool(BUDGET.tails, 16, THREE.NormalBlending)
  scene.add(smoke.mesh, glow.mesh, motifs.mesh, ribbons.mesh, tailRibbons.mesh)
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
  const fans = fanShapes()
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
    cone: () => fans.cone(90),
    band: () => fans.band(90),
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
  // the plain additive kinds are drawn instanced, one draw per kind however many are out (GAME.md §10: a big fight had
  // 150 effect meshes on screen, a draw each). Their pooled meshes are only holders: an effect moves, scales, tints and
  // fades its holder as before, and each frame the holders taken out are copied into their kind's instanced mesh.
  // Beams, pillars and chains scroll their own textures, and the energy kinds and rocks have shaders of their own, so
  // those stay meshes in the scene.
  const out = new Map<MeshKind, Set<THREE.Mesh>>()
  const batches = new Map<MeshKind, { mesh: THREE.InstancedMesh; fade: THREE.InstancedBufferAttribute }>()
  const batchOf = (kind: MeshKind, like: THREE.MeshBasicMaterial, needed: number) => {
    let b = batches.get(kind)
    if (b && b.mesh.instanceMatrix.count >= needed) return b
    const capacity = Math.max(64, (b?.mesh.instanceMatrix.count ?? 0) * 2, needed)
    if (b) {
      b.mesh.removeFromParent()
      b.mesh.geometry.dispose()
      ;(b.mesh.material as THREE.Material).dispose()
    }
    const g = geometry[kind]()
    const fade = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1)
    g.setAttribute('fade', fade)
    const material = new MeshBasicNodeMaterial({ map: like.map, transparent: true, blending: like.blending, depthWrite: false, side: like.side })
    material.opacityNode = attribute('fade', 'float')
    const mesh = new THREE.InstancedMesh(g, material, capacity)
    mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(capacity * 3), 3)
    mesh.name = `fx:${kind}`
    mesh.renderOrder = 2
    mesh.frustumCulled = false
    scene.add(mesh)
    batches.set(kind, (b = { mesh, fade }))
    return b
  }
  const drawBatches = () => {
    for (const [kind, holders] of out) {
      let n = 0
      const first = holders.values().next().value
      const b = first ? batchOf(kind, first.material as THREE.MeshBasicMaterial, holders.size) : batches.get(kind)
      if (!b) continue
      for (const m of holders) {
        if (!m.visible) continue
        const mat = m.material as THREE.MeshBasicMaterial
        m.updateMatrix()
        b.mesh.setMatrixAt(n, m.matrix)
        b.mesh.setColorAt(n, mat.color)
        b.fade.setX(n, mat.opacity)
        n++
      }
      b.mesh.count = n
      b.mesh.visible = n > 0
      b.mesh.instanceMatrix.needsUpdate = true
      b.mesh.instanceColor!.needsUpdate = true
      b.fade.needsUpdate = true
    }
  }
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
    if (BATCHED.has(kind)) {
      let held = out.get(kind)
      if (!held) out.set(kind, (held = new Set()))
      held.add(m)
    } else if (!free) scene.add(m)
    return m
  }
  const park = (kind: MeshKind, m: THREE.Mesh) => {
    m.visible = false
    out.get(kind)?.delete(m)
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
  const background = (scene.background as THREE.Color).clone()
  let hitStop = 0
  let shake = 0
  // a shake from something at a place: less the further it is from the camera, like a blast's hit feel
  const shakeFrom = (amount: number, at: THREE.Vector3) => void (shake = Math.max(shake, amount * nearness(at.distanceTo(ctrl.camera.position))))
  let sky = 0
  let skyColor = new THREE.Color()

  // every skill's recipe, worked out once: its package's own, else one composed from its look
  const recipes = arena.setups.map((setup, hero) => {
    const out = {} as Record<BuildSlot, EffectRecipe>
    for (const slot of BUILD_SLOTS) out[slot] = packages[hero]?.slots[slot]?.effect?.recipe ?? composeRecipe(setup.kit[slot].delivery.kind, skillLookOf(setup.build, slot))
    return out
  })
  const recipe = (hero: number, slot: BuildSlot): EffectRecipe => recipes[hero][slot]
  // ground effects lie on the floor under them, which on the house is a slab 4.5 m up, a deck or a ramp
  const floorAt = (p: { x: number; y: number; z: number }) => groundUnder(arena.match, p)

  const kit: Kit = {
    camera: () => ctrl.camera,
    show,
    sparkle,
    puff,
    motif,
    ribbon: (path, c, width, life, options) => ribbons.spawn(path, c, width, life, clock, options),
    later,
    shake: (amount, at) => shakeFrom(amount, at),
    darken: (seconds, c) => {
      sky = Math.max(sky, seconds)
      skyColor = c
    },
    ghost,
    fans,
    floorAt,
  }
  const draw = createDraw(kit)
  const { flash, sparks } = draw

  // what big hits leave in the world (§6b): debris, marks on the floor, and the house's breakable props
  const debris = new DebrisPool(floorAt)
  const decals = new Decals(floorAt)
  const props = arena.match.map === 'house' ? new Props(houseProps(floorAt)) : undefined
  scene.add(debris.mesh, decals.group)
  if (props) scene.add(props.group)
  // the hit feel the screen shows: a kick along the blow, radial blur and speed lines toward it, the impact frame
  const kickAt = new THREE.Vector3()
  let kick = 0
  let blur = 0
  let lines = 0
  // the impact frame's frames still to show, one taken each time the screen is drawn: ink inverted, then ink
  let impactFrames: number[] = []
  const centre: [number, number] = [0.5, 0.5]
  const onScreen = new THREE.Vector3()
  const feel = (full: Feel, at: THREE.Vector3, dir?: THREE.Vector3) => {
    onScreen.copy(at).project(ctrl.camera)
    const f = feelAt(full, at.distanceTo(ctrl.camera.position), onScreen.z < 1 && Math.abs(onScreen.x) <= 1 && Math.abs(onScreen.y) <= 1)
    hitStop = Math.max(hitStop, f.stop)
    shake = Math.max(shake, f.shake)
    if (f.kick > kick) {
      kick = f.kick
      kickAt.copy(dir ?? at.clone().sub(ctrl.camera.position)).setY(0).normalize()
    }
    if (f.blur || f.lines || f.impactFrame) {
      centre[0] = THREE.MathUtils.clamp(0.5 + onScreen.x * 0.5, 0, 1)
      centre[1] = THREE.MathUtils.clamp(0.5 - onScreen.y * 0.5, 0, 1)
      blur = Math.max(blur, f.blur)
      if (f.lines) lines = 1
      if (f.impactFrame) impactFrames = [2, 1]
    }
  }
  const blast = createBlasts({ flash, sparkle, puff, show, later, floorAt, camera: () => ctrl.camera, debris, decals, clock: () => clock, feel })
  // how far each tier's blast reaches into the props round it
  const PROP_REACH: Record<Tier, number> = { light: 0.4, heavy: 1.2, finisher: 1.6, spell: 1.8, ultimate: 3.5 }
  const blastAt = (tier: Tier, at: THREE.Vector3, c: THREE.Color, options: Parameters<typeof blast>[3] = {}) => {
    blast(tier, at, c, options)
    props?.blast(at, Math.max(PROP_REACH[tier], options.radius ?? 0), debris, tier === 'ultimate' ? 2 : 1)
  }
  // the blow each hero's basic attack is: the cast says whether it is the chain's finisher or a held heavy
  const blows = new Map<number, Blow | undefined>()
  // one hit feel a tick from each source's skill: an area spell landing on five heroes shakes once
  let felt = new Set<string>()
  let feltTick = -1
  // where a knockback set off from, for the skid it leaves
  const slides = new Map<number, THREE.Vector3>()
  let pinned: ScreenFeel | undefined
  // transformations: how each arrives, what surrounds it, what it leaves behind and what it wears (forms.ts)
  const forms = createForms({
    ...kit,
    flash,
    sparks,
    tail: (path, c, width, life) => tailRibbons.spawn(path, c, width, life, clock, { taper: true, steady: true }),
    endTail: (ribbon) => tailRibbons.end(ribbon, clock),
  })
  // the skill that transforms a hero: a form event names no slot, and a kit holds one transformation at most
  const formOf = (hero: number) => {
    const skills = arena.setups[hero].kit
    const slot = BUILD_SLOTS.find((s) => transformOf(skills[s])) ?? 'ultimate'
    return { slot, duration: transformOf(skills[slot])?.duration ?? 8 }
  }

  // walls, turrets, fields, traps and stealth: what skills leave in the world
  const world = createWorldFx(ctrl, { sparkle, puff, flash, tint: (hero, slot = 'active1') => vivid(recipe(hero, slot), 0), floorAt })

  const aimOf = (hero: number) => {
    const h = arena.match.heroes[hero]
    return new THREE.Vector3(Math.sin(h.yaw) * Math.cos(h.pitch), Math.sin(h.pitch), Math.cos(h.yaw) * Math.cos(h.pitch))
  }

  // where a skill leaves the hero: its leading palm as last drawn, else its chest (a body without hands, or a view not
  // yet stood where the hero is)
  const handOf = (hero: number, dir: THREE.Vector3) => {
    const body = v3(chest(arena.match.heroes[hero]))
    const palm = ctrl.views[hero]?.hand?.(dir, new THREE.Vector3())
    return palm && palm.distanceToSquared(body) < 9 ? palm : body
  }
  // where a shot leaves (§6): the far end of what the hand holds (a gun's muzzle, a staff's head), else the palm
  const muzzleOf = (hero: number, dir: THREE.Vector3) => {
    const palm = handOf(hero, dir)
    const tip = ctrl.views[hero]?.tip?.(new THREE.Vector3())
    return tip && tip.distanceToSquared(palm) < 4 ? tip : palm
  }
  // a spell or an ultimate that lands somewhere (a shot, a zone, a leap, a nova) bursts there once; a beam, a cone or a
  // blow bursts on each body it reaches
  const landsAsBlast = (hero: number, slot: BuildSlot) =>
    (slot === 'active1' || slot === 'active2' || slot === 'ultimate') && ['projectile', 'zone', 'leap', 'aura'].includes(arena.setups[hero].kit[slot].delivery.kind)
  // where a blow or shot from `source` meets `target`'s body (§6): its weapon tip or muzzle, onto the victim's capsule
  const contactOf = (source: number, target: number) => {
    const h = arena.match.heroes[target]
    const cap = capsule(h)
    const drawnAt = ctrl.positions()[target] ?? h.position
    return contactPoint({ feet: drawnAt, radius: cap.radius, height: cap.height }, muzzleOf(source, aimOf(source)))
  }
  const newHalo = () => spareHalos.pop() ?? new THREE.Sprite(new THREE.SpriteMaterial({ map: haloMap, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }))

  // a charge held through a wind-up (Forge goal, phase 1): a hot core riding the leading palm, swelling until the shot
  // or beam leaves it, sputtering out if the wind-up is cut short
  const held = new Map<number, { release: number; halo: THREE.Sprite; size: number; born: number; prep: number }>()
  const drop = (hero: number, fizzle: boolean) => {
    const h = held.get(hero)
    if (!h) return
    if (fizzle) sparks(h.halo.position.clone(), h.halo.material.color.clone(), 6, 2)
    h.halo.removeFromParent()
    spareHalos.push(h.halo)
    held.delete(hero)
  }
  const hold = (hero: number, release: number, c: THREE.Color, size: number, prep: number) => {
    drop(hero, false)
    const halo = newHalo()
    halo.material.color.copy(c)
    halo.material.opacity = 0.9
    halo.scale.setScalar(0.01)
    halo.position.copy(handOf(hero, aimOf(hero)))
    scene.add(halo)
    held.set(hero, { release, halo, size, born: clock, prep: Math.max(0.05, prep) })
  }

  // a swing's smear: a ribbon off the weapon's tip, or off the leading hand, bright only while it moves fast against
  // the body, so the strike shows and the wind-up and the run don't
  const swings = new Map<number, { release: number; trail: Trail; rel?: THREE.Vector3; fade: number; since: number }>()
  const spareSmears: Trail[] = []
  const smear = (hero: number, release: number, c: THREE.Color) => {
    if (swings.size >= SMEARS || swings.has(hero)) return
    const armed = !!ctrl.views[hero]?.tip?.(new THREE.Vector3())
    const trail = spareSmears.pop() ?? new Trail(10, 0.2, c)
    trail.width = armed ? 0.32 : 0.2
    trail.recolor(c)
    trail.reset()
    ;(trail.mesh.material as THREE.MeshBasicMaterial).opacity = 0
    trail.mesh.visible = true
    if (!trail.mesh.parent) scene.add(trail.mesh)
    swings.set(hero, { release, trail, fade: 0, since: 0 })
  }
  const SMEAR_FADE = 0.15

  // sound for a listener at the camera: full level near it, quieter further off, panned to where it happens
  const right = new THREE.Vector3()
  const spot = (at: { x: number; y: number; z: number }) => {
    const cam = ctrl.camera
    const to = new THREE.Vector3(at.x, at.y, at.z).sub(cam.position)
    const d = to.length()
    right.setFromMatrixColumn(cam.matrixWorld, 0)
    return { gain: 1 / (1 + Math.max(0, d - NEAR) / NEAR), pan: d > 0.01 ? THREE.MathUtils.clamp(to.dot(right) / d, -1, 1) * 0.7 : 0 }
  }
  // a wind-up's sounds are booked when it starts, to land on its release; a wind-up cut short cuts them too
  const booked = new Map<number, Voice[]>()
  const unbook = (hero: number) => {
    for (const v of booked.get(hero) ?? []) v.stop()
    booked.delete(hero)
  }
  /** What a skill sounds like as it lets go: a swish for a swing, a zip for a shot, a thump for a beam or an ultimate. */
  const releaseCue = (kind: string, slot: BuildSlot): Cue | undefined => {
    if (slot === 'ultimate') return 'burst'
    if (kind === 'melee' || kind === 'cone' || kind === 'dash' || kind === 'grapple' || kind === 'leap') return 'swing'
    if (kind === 'projectile') return 'shot'
    if (kind === 'beam') return slot === 'basic' ? 'shot' : 'burst'
    return undefined
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
    const halo = newHalo()
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
    // drawn leaving the muzzle (or the palm), and eased onto the engine's line over its first moment
    const from = muzzleOf(e.hero, aimOf(e.hero))
    const lead = from.clone().sub(v3(e.from))
    body.position.copy(from)
    projectiles.set(e.id, { body, kind, shape, halo, trail, skin, recipe: r, size, wakes, last: from, lead, born: clock })
    // a muzzle flash where it leaves
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
    const ease = 1 - (clock - fx.born) / HAND_BLEND
    if (ease > 0) at.addScaledVector(fx.lead, ease * ease)
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

  // a shader compiles the first time something is drawn with it, so the first cast of each kind used to stall the fight
  // (the soak's worst frame, 517 ms; Forge goal, phase 0). Instead one of every effect mesh, sprite and charge halo is
  // drawn unseen in front of the camera for the first frames, in the countdown, and then goes back to its pool.
  const unseen = new THREE.Color(0, 0, 0)
  const warming = (Object.keys(geometry) as MeshKind[]).map((kind) => ({ kind, mesh: mesh(kind, unseen, 0) }))
  const warmHalo = newHalo()
  warmHalo.material.opacity = 0
  scene.add(warmHalo)
  for (const spawn of [sparkle, puff, motif]) spawn({ at: { x: 0, y: 0, z: 0 }, count: 1, kind: 'glow', life: 1, size: [0, 0], color: unseen, alpha: 0 })
  let warmFrames = WARM_FRAMES
  const ahead = new THREE.Vector3()
  const warmUp = () => {
    if (!warmFrames) return
    if (--warmFrames) {
      ctrl.camera.getWorldDirection(ahead).multiplyScalar(3).add(ctrl.camera.position)
      for (const w of warming) (w.mesh.position.copy(ahead), w.mesh.scale.setScalar(0.01))
      warmHalo.position.copy(ahead)
      return
    }
    for (const w of warming) park(w.kind, w.mesh)
    warmHalo.removeFromParent()
    spareHalos.push(warmHalo)
  }

  return {
    events: (events) => {
      world.events(events)
      for (const e of events) {
        if (e.type === 'cast') {
          if (e.slot === 'basic') blows.set(e.hero, e.melee)
          // the wind-up (phase 1): the charge gathers and the circle opens; what the skill does waits for its release
          const r = recipe(e.hero, e.slot)
          const hero = arena.match.heroes[e.hero]
          const at = v3(chest(hero))
          const dir = aimOf(e.hero)
          // the charge lasts exactly as long as the engine's wind-up
          const prep = Math.max(0, e.release - arena.match.tick) / ENGINE.tickHz
          const winding = () => {
            const a = arena.match.heroes[e.hero].action
            return a?.release === e.release && !a.released
          }
          for (const l of r.layers) {
            if (l.phase !== 'charge') continue
            // motes rush in to the hands halfway through, once they have come together; an aura or a glowing fingertip
            // is drawn on the body at once
            if (l.primitive === 'gather' && (l.style ?? 'gather') === 'gather') later(prep / 2, () => winding() && draw.layer(l, { ...r, charge: prep / 2 }, handOf(e.hero, aimOf(e.hero)), 1, { dir: aimOf(e.hero) }))
            else draw.layer(l, { ...r, charge: prep }, at, 1, { dir })
          }
          const delivery = arena.setups[e.hero].kit[e.slot].delivery
          // the sound beats: a riser that tops out on the release for a skill, and the release's own sound peaking on it
          unbook(e.hero)
          const where = spot(at)
          const voices = [e.slot !== 'basic' ? cue(e.slot === 'ultimate' ? 'charge-big' : 'charge', where, prep) : undefined]
          const out = releaseCue(delivery.kind, e.slot)
          if (out) voices.push(cue(out, where, out === 'swing' ? Math.max(0, prep - SWING_LEAD) : prep))
          booked.set(e.hero, voices.filter((v): v is Voice => !!v))
          if (delivery.kind === 'projectile' || delivery.kind === 'beam') {
            const core = r.layers.find((l) => l.damaging) ?? r.layers[0]
            hold(e.hero, e.release, vivid(r, core.color), layerSize(core, delivery.projectileRadius ?? 0.25) * (e.slot === 'ultimate' ? 4 : 2.5), prep)
          } else if (delivery.kind === 'melee' || delivery.kind === 'cone') smear(e.hero, e.release, hot(vivid(r, 0), 0.25))
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
        } else if (e.type === 'release') {
          drop(e.hero, false)
          booked.delete(e.hero)
          const r = recipe(e.hero, e.slot)
          const hero = arena.match.heroes[e.hero]
          const at = v3(chest(hero))
          const dir = aimOf(e.hero)
          const family = FAMILY_OF[r.delivery]
          // a self-cast has no area and sends no impact: its look plays on the caster as it lands (a transformation's
          // arrival is the form's own, from its event)
          if (family === 'self' && !transformOf(arena.setups[e.hero].kit[e.slot])) for (const l of r.layers) if (l.phase === 'impact' || l.phase === 'linger') draw.layer(l, r, at, capsule(hero).height / 2, { dir, caster: at })
          // a movement skill has just moved the hero; its way runs from where the hero was last drawn
          // the cast flash (§6): off the hand or weapon, on the release; a shot flashes at its muzzle as it leaves, and a
          // blow's light is its swing
          const kind = arena.setups[e.hero].kit[e.slot].delivery.kind
          if (family !== 'self' && family !== 'movement' && kind !== 'projectile' && kind !== 'melee') flash(handOf(e.hero, dir), vivid(r, 0), e.slot === 'ultimate' ? 1.4 : 0.8)
          if (family === 'movement') {
            const was = ctrl.positions()[e.hero]
            const from = was ? v3(was) : v3(hero.position)
            for (const l of r.layers) if (l.phase === 'travel') draw.path(l, r, e.hero, from, v3(hero.position), capsule(hero).height * ENGINE.chest)
          }
          if (!kitReady()) playCast(r.delivery)
        } else if (e.type === 'interrupt') {
          drop(e.hero, true)
          unbook(e.hero)
        } else if (e.type === 'projectile') {
          launch(e)
        } else if (e.type === 'impact') {
          const r = recipe(e.hero, e.slot)
          const end = v3(e.at)
          // a beam runs from the hands to where the engine stopped it, wall or full range
          const beam = r.delivery === 'beam'
          const from = handOf(e.hero, aimOf(e.hero))
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
          // a spell or an ultimate bursts where it lands (§6b); one that only reaches what it touches bursts on each hit
          if (landsAsBlast(e.hero, e.slot)) {
            const template = arena.setups[e.hero].kit[e.slot]
            blastAt(e.slot === 'ultimate' ? 'ultimate' : 'spell', end, vivid(r, 0), { radius: e.radius, mark: elementOf(template.tags), dir })
          }
        } else if (e.type === 'hit') {
          // an anime hit (§6, §6b): a blast at the point the blow or shot met the body, of the tier its cause sets (a
          // light hit, a heavy, the chain's finisher, a spell, an ultimate), and a little blood
          const at = contactOf(e.source, e.target)
          const r = recipe(e.source, e.slot)
          const c = vivid(r, 1)
          const tier = tierOf(e.slot, e.heavy, e.slot === 'basic' ? blows.get(e.source) : undefined)
          if (arena.match.tick !== feltTick) ((felt = new Set()), (feltTick = arena.match.tick))
          const key = `${e.source}:${e.slot}`
          const dir = at.clone().sub(muzzleOf(e.source, aimOf(e.source))).setY(0)
          if (dir.lengthSq() > 1e-6) dir.normalize()
          // a spell that burst where it landed already shook the screen; its victims only spark
          if (landsAsBlast(e.source, e.slot)) blastAt('light', at, c, { dir, quiet: true })
          else blastAt(tier, at, c, { dir, quiet: felt.has(key) })
          felt.add(key)
          const bleed = hitFeel(e).blood
          if (bleed) puff({ at, count: Math.ceil(bleed / 3), kind: 'glow', life: 0.5, size: [0.08, 0.03], color: new THREE.Color(0.6, 0.02, 0.02), speed: 3.5, gravity: 14, alpha: 0.9 })
          if (kitReady()) cue(e.heavy ? 'hit-heavy' : 'hit', spot(at))
          else playHit(e.heavy)
        } else if (e.type === 'form') {
          if (e.phase === 'end') forms.end(e.hero)
          else {
            const { slot, duration } = formOf(e.hero)
            const id = e.hero
            // read fresh each frame: the form hugs the capsule the engine gives it, so what's seen is what can be hit (R23)
            forms.start(id, formLookOf(skillLookOf(arena.setups[id].build, slot)), recipe(id, slot), duration, {
              feet: () => v3(ctrl.positions()[id] ?? arena.match.heroes[id].position),
              capsule: () => capsule(arena.match.heroes[id]),
              yaw: () => arena.match.heroes[id].yaw,
            })
          }
        } else if (e.type === 'melee') {
          // the canon's melee beats, loud enough to read from the broadcast camera: a launch bursts and kicks the camera,
          // a heavy blow's charge glows at the hands, a guard throws sparks
          const hero = arena.match.heroes[e.hero]
          const at = v3(chest(hero))
          const hands = handOf(e.hero, aimOf(e.hero))
          if (e.what === 'launch') {
            const c = new THREE.Color(1, 0.86, 0.5)
            sparkle({ at, count: 40, kind: 'glow', life: 0.6, size: [0.2, 0.04], color: c, speed: 9, gravity: 8 })
            show('shock', c, 0.45, (m) => m.position.set(hero.position.x, hero.position.y + 0.06, hero.position.z), (p, m) => (m.scale.setScalar(1 + 5 * p), setOpacity(m, 0.9 * (1 - p))))
            puff({ at: { x: hero.position.x, y: hero.position.y + 0.05, z: hero.position.z }, count: 10, kind: 'smoke', life: 0.9, size: [0.4, 1.4], color: DUST, speed: 3, spread: 0.4, drag: 3, up: 0.3, alpha: 0.35, spin: 0.6 })
            shakeFrom(0.35, at)
          } else if (e.what === 'charge') {
            const c = TEAM_GLOW[hero.team]
            sparkle({ at: hands, count: 18, kind: 'glow', life: 0.5, size: [0.16, 0.03], color: hot(c, 0.2), spread: 0.4, velocity: { x: 0, y: 1.5, z: 0 }, speed: 0.6 })
          } else if (e.what === 'blocked') sparkle({ at: e.by !== undefined ? contactOf(e.by, e.hero) : at, count: 16, kind: 'glow', life: 0.35, size: [0.1, 0.02], color: new THREE.Color(1, 0.95, 0.75), speed: 6, gravity: 10 })
        } else if (e.type === 'passive') {
          // F: switched on, a ring in the passive's colours rises up the body; switched off, it drains to the floor
          const hero = arena.match.heroes[e.hero]
          const c = vivid(recipe(e.hero, 'passive'), 0)
          const feet = { x: hero.position.x, y: hero.position.y + 0.05, z: hero.position.z }
          const tall = capsule(hero).height
          if (e.on) {
            show('shock', hot(c, 0.2), 0.45, (m) => m.position.set(feet.x, feet.y, feet.z), (p, m) => (m.position.y = feet.y + tall * p, m.scale.setScalar(0.8 + 0.6 * p), setOpacity(m, 0.9 * (1 - p))))
            sparkle({ at: { ...feet, y: feet.y + tall * 0.5 }, count: 24, kind: 'glow', life: 0.8, size: [0.14, 0.03], color: hot(c, 0.3), spread: 0.5, velocity: { x: 0, y: 2.5, z: 0 }, speed: 0.8 })
          } else show('shock', c.clone().multiplyScalar(0.5), 0.35, (m) => m.position.set(feet.x, feet.y + tall, feet.z), (p, m) => (m.position.y = feet.y + tall * (1 - p), m.scale.setScalar(1.2 - 0.6 * p), setOpacity(m, 0.6 * (1 - p))))
        } else if (e.type === 'cover-hit') {
          // stone chips and a puff of dust where a shot meets cover
          const at = v3(e.at)
          sparkle({ at, count: 8, kind: 'glow', life: 0.4, size: [0.08, 0.02], color: new THREE.Color(1, 0.85, 0.6), speed: 4, gravity: 10 })
          puff({ at, count: 3, kind: 'smoke', life: 0.9, size: [0.3, 1.0], color: new THREE.Color(0.85, 0.8, 0.7), speed: 0.8, drag: 2, alpha: 0.5, spin: 0.8 })
        } else if (e.type === 'cover-broken') {
          // a barricade, a glass partition or a card bridge bursting into its own pieces (pre-cut, §6b): a cloud of dust,
          // a shockwave and a thump in the camera
          const at = v3(e.at)
          const piece = arena.match.cover?.pieces[e.index]
          if (piece) debris.shatter(fracture(piece, e.index + 1), at, { speed: piece.look === 'glass' ? 6 : 4, up: 3, color: pieceColor(piece), life: piece.look === 'glass' ? 3 : 6 })
          if (piece?.look === 'glass') sparkle({ at: { x: at.x, y: (piece.base + piece.top) / 2, z: at.z }, count: 24, kind: 'star', life: 0.5, size: [0.18, 0.03], color: new THREE.Color(0.8, 0.95, 1), speed: 5, gravity: 9, spin: 8 })
          props?.blast(at, 2, debris)
          puff({ at, count: 28, kind: 'smoke', life: 1.8, size: [0.8, 2.6], color: new THREE.Color(0.78, 0.7, 0.58), speed: 4, spread: 1, drag: 1.8, up: 0.5, alpha: 0.6, spin: 0.5 })
          puff({ at, count: 30, kind: 'glow', life: 0.9, size: [0.12, 0.08], color: new THREE.Color(0.45, 0.3, 0.16), speed: 8, gravity: 12, alpha: 1 })
          show('shock', new THREE.Color(1, 0.9, 0.7), 0.5, (m) => m.position.set(at.x, floorAt(at) + 0.06, at.z), (p, m) => (m.scale.setScalar(1 + 4 * p), setOpacity(m, 0.8 * (1 - p))))
          shakeFrom(0.4, at)
        } else if (e.type === 'slam') {
          // a body knocked into a wall: a heavy blast against it, dust, chunks off the wall, a crater at its foot, and
          // whatever props it went through break
          const hero = arena.match.heroes[e.hero]
          const at = v3(e.at).setY(e.at.y + capsule(hero).height * 0.45)
          const back = slides.get(e.hero)
          const dir = back ? v3(e.at).sub(back).setY(0) : undefined
          if (dir && dir.lengthSq() > 1e-6) dir.normalize().negate()
          blastAt(e.speed > 20 ? 'finisher' : 'heavy', at, DUST, { dir })
        } else if (e.type === 'knockback') {
          // a slide along the floor leaves a skid from where the blow landed to where the body stopped
          const hero = arena.match.heroes[e.hero]
          if (e.phase === 'start') {
            if (!hero.airborne) slides.set(e.hero, v3(hero.position))
            else slides.delete(e.hero)
          } else {
            const from = slides.get(e.hero)
            slides.delete(e.hero)
            const to = v3(hero.position)
            const run = to.clone().sub(from ?? to).setY(0)
            if (from && !hero.airborne && Math.abs(to.y - from.y) < 0.3 && run.length() > 1) {
              decals.place('skid', from.clone().add(to).multiplyScalar(0.5), 0.9, clock, { yaw: Math.atan2(run.x, run.z), length: run.length() })
              puff({ at: { x: to.x, y: to.y + 0.1, z: to.z }, count: 5, kind: 'smoke', life: 0.8, size: [0.3, 1], color: DUST, speed: 1.5, drag: 3, up: 0.3, alpha: 0.3, spin: 0.5 })
            }
          }
        } else if (e.type === 'move') {
          // moving like Deadlock (phase 2): dust kicked up by a jump, a hard landing or a slide, a puff of air under a
          // second jump, and a dash leaves a faint copy of the hero where it set off
          const hero = arena.match.heroes[e.hero]
          const feet = { x: hero.position.x, y: hero.position.y + 0.05, z: hero.position.z }
          const fall = e.speed ?? 0
          if (e.move === 'jump') puff({ at: feet, count: 4, kind: 'smoke', life: 0.7, size: [0.25, 0.8], color: DUST, speed: 1.4, spread: 0.2, drag: 3, up: 0.2, alpha: 0.28, spin: 0.6 })
          else if (e.move === 'land' && fall > 5) puff({ at: feet, count: Math.min(14, 3 + Math.round(fall / 2)), kind: 'smoke', life: 0.9, size: [0.3, 1.1], color: DUST, speed: 1 + fall * 0.12, spread: 0.3, drag: 3, up: 0.12, alpha: 0.32, spin: 0.6 })
          else if (e.move === 'air-jump') puff({ at: feet, count: 6, kind: 'smoke', life: 0.45, size: [0.3, 1.0], color: AIR, speed: 2.4, spread: 0.2, drag: 4, alpha: 0.22, spin: 1 })
          else if (e.move === 'dash') {
            if (!hero.airborne) puff({ at: feet, count: 5, kind: 'smoke', life: 0.7, size: [0.3, 0.9], color: DUST, speed: 1.6, spread: 0.2, drag: 3, up: 0.25, alpha: 0.3, spin: 0.6 })
            const view = ctrl.views[e.hero]
            if (view) ghost(e.hero, view.root.position.clone(), hot(TEAM_GLOW[hero.team], 0.1), 0.22)
          } else if (e.move === 'slide') {
            for (let k = 0; k < 9; k++) {
              later(k * 0.09, () => {
                if (hero.slide) puff({ at: { x: hero.position.x, y: hero.position.y + 0.05, z: hero.position.z }, count: 2, kind: 'smoke', life: 0.6, size: [0.2, 0.75], color: DUST, speed: 0.7, drag: 3, up: 0.3, alpha: 0.24, spin: 0.5 })
              })
            }
          }
        } else if (e.type === 'death') {
          // the engine sends no form end for a hero that dies transformed; the death has its own flash
          forms.end(e.hero, true)
          unbook(e.hero)
          const hero = arena.match.heroes[e.hero]
          const at = v3(chest(hero))
          const team = hero.team === 0 ? new THREE.Color(0.31, 0.64, 1) : new THREE.Color(1, 0.42, 0.29)
          flash(at, team, 2)
          // spirit motes rising off the fallen, in their team's colour
          sparkle({ at, count: 50, kind: 'glow', life: 1.6, size: [0.22, 0.04], color: hot(team, 0.35), spread: 0.6, velocity: { x: 0, y: 2.8, z: 0 }, speed: 1 })
          puff({ at: { x: at.x, y: floorAt(at) + 0.3, z: at.z }, count: 8, kind: 'smoke', life: 1.4, size: [0.5, 1.5], color: new THREE.Color(0.7, 0.65, 0.58), speed: 2.5, drag: 2, up: 0.4, alpha: 0.35 })
        }
      }
    },
    frame: (dt) => {
      warmUp()
      clock += dt
      world.frame(dt)
      debris.step(dt)
      decals.step(clock)
      // bodies going through the props: a knocked-back one breaks what it meets, a walking one scatters loose things
      if (props) {
        const drawn = ctrl.positions()
        arena.match.heroes.forEach((h, i) => {
          if (!h.alive) return
          const cap = capsule(h)
          props.body(drawn[i] ?? h.position, cap.radius, cap.height, !!h.knockback, debris)
        })
      }
      kick = Math.max(0, kick - dt * 3)
      blur = Math.max(0, blur - dt * 2.5)
      lines = Math.max(0, lines - dt * 3)
      // tasks may book more tasks; those run from the next frame
      for (let i = tasks.length - 1; i >= 0; i--) {
        if (tasks[i].at > clock) continue
        const task = tasks[i]
        tasks[i] = tasks[tasks.length - 1]
        tasks.pop()
        task.fn()
      }
      // the forms step their tails before the ribbons are drawn down them
      forms.frame(dt)
      glow.update(clock)
      smoke.update(clock)
      motifs.update(clock)
      ribbons.update(clock, ctrl.camera)
      tailRibbons.update(clock, ctrl.camera)
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
      for (const [hero, h] of held) {
        const a = arena.match.heroes[hero].action
        // a death, or anything else that ends the wind-up without a word, puts it out
        if (a?.release !== h.release || a.released) {
          drop(hero, true)
          continue
        }
        const grown = Math.min(1, (clock - h.born) / h.prep)
        h.halo.position.copy(handOf(hero, aimOf(hero)))
        h.halo.scale.setScalar(h.size * (0.25 + 0.75 * grown) * (1 + 0.1 * Math.sin(clock * 45)))
      }
      for (const [hero, s] of swings) {
        const material = s.trail.mesh.material as THREE.MeshBasicMaterial
        const view = ctrl.views[hero]
        const drawn = ctrl.positions()[hero]
        if (!view || !drawn || arena.match.heroes[hero].action?.release !== s.release) s.fade += dt
        if (s.fade >= SMEAR_FADE || !view || !drawn) {
          s.trail.mesh.visible = false
          spareSmears.push(s.trail)
          swings.delete(hero)
          continue
        }
        const head = view.tip?.(new THREE.Vector3()) ?? handOf(hero, aimOf(hero))
        const rel = head.clone().sub(v3(drawn))
        const speed = s.rel && dt > 0 ? rel.distanceTo(s.rel) / dt : 0
        s.rel = rel
        s.since += dt
        const grow = s.since >= SMEAR_STEP
        if (grow) s.since = 0
        s.trail.push(head, ctrl.camera, grow)
        // only the strike smears: the back half of the wind-up and the front half of the recovery
        const a = arena.match.heroes[hero].action
        const t = arena.match.tick
        const striking = a && (a.released ? t < (a.release + a.ends) / 2 : t >= (a.started + a.release) / 2)
        const bright = striking ? THREE.MathUtils.smoothstep(speed, SMEAR_SPEED[0], SMEAR_SPEED[1]) : 0
        material.opacity = s.fade > 0 ? material.opacity * (1 - s.fade / SMEAR_FADE) : Math.max(bright, material.opacity * Math.exp(-13 * dt))
      }
      const flying = new Map(arena.match.projectiles.map((p) => [p.id, p]))
      for (const [id, fx] of projectiles) {
        const p = flying.get(id)
        if (p) fly(fx, v3(p.position), dt)
        else land(id, fx)
      }
      sky = Math.max(0, sky - dt)
      const flashSky = skyFlashOf(scene)
      if (flashSky) {
        flashSky.tint.copy(skyColor)
        flashSky.amount.value = Math.min(0.55, sky)
      } else (scene.background as THREE.Color).copy(background).lerp(skyColor, Math.min(0.55, sky))
      drawBatches()
    },
    timeScale: () => (hitStop > 0 ? 0.05 : 1),
    // a rumble of 3 to 5 sways a second, not new noise every frame: in a brawl something always shakes the camera, and
    // per-frame noise read as the view jittering
    shake: () => {
      const a = Math.min(SHAKE_MAX, shake) * 0.5
      return new THREE.Vector3(a * Math.sin(clock * 31 + 1.3), a * Math.sin(clock * 25 + 4.1), a * Math.sin(clock * 19 + 2.6)).addScaledVector(kickAt, kick * kick)
    },
    // two frames of ink, the first inverted, the way an anime impact frame cuts in
    screen: () => pinned ?? { blur, centre, lines, impact: impactFrames.shift() ?? 0, seed: clock },
    stats: () => ({ meshes: live.length + projectiles.size + forms.live() + ghosts.length, particles: BUDGET.glow + BUDGET.smoke + BUDGET.motifs, debris: debris.live(), decals: decals.live(), props: props?.standing() ?? 0 }),
    blast: (tier, at, c = new THREE.Color(1, 0.55, 0.2)) => blastAt(tier, v3(at), c, { mark: tier === 'spell' || tier === 'ultimate' ? 'scorch' : undefined, radius: tier === 'ultimate' ? 4 : tier === 'spell' ? 2.5 : 0 }),
    pin: (screen) => void (pinned = screen),
  }
}
