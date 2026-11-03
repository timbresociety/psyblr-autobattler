import type RAPIER from '@dimforge/rapier3d-compat'
import type { CoverPiece } from '../engine/cover.js'
import type { MatchEvent } from '../engine/events.js'
import type { Vec3 } from '../engine/maths.js'
import type { MatchState } from '../engine/state.js'

/**
 * Cosmetic physics (U15, KTD12): Rapier makes hits look physical and never decides anything. A launched hero tumbles
 * while the engine still owns where it is, then blends back upright; a fallen hero drops and settles on the floor it
 * fell on (the map's own pieces are its colliders, so a body on the house's raised floor lies on it). The engine never
 * reads any of this, so a match plays out the same with physics on or off. Debris is the effects' own pool
 * (effects/debris.ts), budgeted apart from these bodies.
 */

export const PHYSICS = {
  /** Most bodies awake at once: tumbling or fallen heroes. */
  maxBodies: 48,
  /** Seconds a hero takes to stand back up after a knockback. */
  blendBack: 0.2,
}

type Quat = { x: number; y: number; z: number; w: number }

// Rapier's WASM loads once per page; a second init on a rematch corrupted its memory
let rapier: Promise<typeof RAPIER> | undefined
const loadRapier = () =>
  (rapier ??= import('@dimforge/rapier3d-compat').then(async (m) => {
    await m.default.init()
    return m.default
  }).catch((e: unknown) => {
    rapier = undefined
    throw e
  }))
const UPRIGHT: Quat = { x: 0, y: 0, z: 0, w: 1 }

function slerpToUpright(q: Quat, t: number): Quat {
  // normalized lerp toward identity is enough for a fraction of a second of blending
  const k = 1 - t
  const r = { x: q.x * k, y: q.y * k, z: q.z * k, w: q.w * k + (q.w >= 0 ? t : -t) }
  const len = Math.sqrt(r.x * r.x + r.y * r.y + r.z * r.z + r.w * r.w) || 1
  return { x: r.x / len, y: r.y / len, z: r.z / len, w: r.w / len }
}

interface Tumble {
  body: RAPIER.RigidBody
  /** Seconds left blending back upright once the knockback ends; undefined while still flying. */
  blend?: number
  from?: Quat
}

export class CosmeticPhysics {
  private readonly tumbling = new Map<number, Tumble>()
  private readonly fallen = new Map<number, RAPIER.RigidBody>()
  /** The collider of each breakable map piece, removed when the engine breaks it. */
  private readonly pieces = new Map<number, RAPIER.Collider>()
  /** Set when Rapier fails; physics then stays off, because it is cosmetic and must never stop a match (KTD12). */
  broken = false

  private constructor(
    private readonly R: typeof RAPIER,
    private readonly world: RAPIER.World,
    map: readonly CoverPiece[],
  ) {
    const ground = world.createRigidBody(R.RigidBodyDesc.fixed())
    world.createCollider(R.ColliderDesc.cuboid(60, 0.1, 60).setTranslation(0, -0.1, 0), ground)
    map.forEach((piece, index) => {
      const c = world.createCollider(collider(R, piece), ground)
      if (piece.health !== undefined) this.pieces.set(index, c)
    })
  }

  /** A world for a match on `map` (its cover pieces); an open floor without one. */
  static async create(map: readonly CoverPiece[] = []): Promise<CosmeticPhysics> {
    const R = await loadRapier()
    return new CosmeticPhysics(R, new R.World({ x: 0, y: -18, z: 0 }), map)
  }

  /** The engine broke map piece `index`: bodies fall through where it stood. */
  breakPiece(index: number) {
    const c = this.pieces.get(index)
    if (!c || this.broken) return
    this.pieces.delete(index)
    try {
      this.world.removeCollider(c, true)
    } catch {
      this.broken = true
    }
  }

  /** Free the world's WASM memory when the match ends; the instance is inert afterwards. */
  dispose() {
    if (this.broken) return
    this.broken = true
    this.tumbling.clear()
    this.fallen.clear()
    this.pieces.clear()
    this.world.free()
  }

  /** Bodies awake right now; the cap keeps this under `PHYSICS.maxBodies`. */
  activeBodies(): number {
    let n = 0
    this.world.forEachRigidBody((b) => void (b.isDynamic() && !b.isSleeping() && n++))
    return n
  }

  private budget(): boolean {
    return this.tumbling.size + this.fallen.size < PHYSICS.maxBodies
  }

  private body(at: Vec3, velocity: Vec3, spin: number, half: Vec3) {
    const R = this.R
    const b = this.world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(at.x, at.y, at.z).setLinvel(velocity.x, velocity.y, velocity.z).setAngvel({ x: spin, y: spin * 0.3, z: -spin * 0.6 }).setCanSleep(true))
    this.world.createCollider(R.ColliderDesc.cuboid(half.x, half.y, half.z).setRestitution(0.2).setFriction(0.9), b)
    return b
  }

  /** React to this tick's engine events. */
  events(events: readonly MatchEvent[], match: MatchState) {
    if (this.broken) return
    try {
      this.react(events, match)
    } catch {
      this.broken = true
    }
  }

  private react(events: readonly MatchEvent[], match: MatchState) {
    for (const e of events) {
      const hero = 'hero' in e ? match.heroes[e.hero] : undefined
      if (e.type === 'knockback' && hero) {
        if (e.phase === 'start' && hero.knockback && this.budget()) {
          const step = hero.knockback.step
          const old = this.tumbling.get(e.hero)
          if (old) this.world.removeRigidBody(old.body)
          this.tumbling.set(e.hero, { body: this.body(hero.position, { x: step.x * 60, y: step.y * 60, z: step.z * 60 }, 9, { x: 0.3, y: 0.9, z: 0.3 }) })
        } else if (e.phase === 'end') {
          const t = this.tumbling.get(e.hero)
          if (t) {
            t.from = t.body.rotation()
            t.blend = PHYSICS.blendBack
          }
        }
      } else if (e.type === 'death' && hero) {
        const t = this.tumbling.get(e.hero)
        if (t) this.world.removeRigidBody(t.body)
        this.tumbling.delete(e.hero)
        if (this.budget()) this.fallen.set(e.hero, this.body({ x: hero.position.x, y: hero.position.y + 0.9, z: hero.position.z }, { x: 0, y: 1, z: 0 }, 3, { x: 0.3, y: 0.9, z: 0.3 }))
      } else if (e.type === 'cover-broken') this.breakPiece(e.index)
    }
  }

  step(dt: number) {
    // a zero or negative step (first frame, a hit-stop) is skipped: Rapier cannot step by nothing
    if (this.broken || !(dt > 1e-4)) return
    try {
      this.world.timestep = Math.min(dt, 1 / 30)
      this.world.step()
    } catch {
      this.broken = true
      return
    }
    for (const [id, t] of this.tumbling) {
      if (t.blend === undefined) continue
      t.blend -= dt
      if (t.blend <= 0) {
        this.world.removeRigidBody(t.body)
        this.tumbling.delete(id)
      }
    }
  }

  /** The tumble to draw a hero with, if any. Its position stays the engine's (KTD12). */
  rotation(hero: number): Quat | undefined {
    if (this.broken) return undefined
    const t = this.tumbling.get(hero)
    if (!t) return undefined
    if (t.blend === undefined) return t.body.rotation()
    return slerpToUpright(t.from ?? UPRIGHT, 1 - Math.max(0, t.blend) / PHYSICS.blendBack)
  }

  /** Where a fallen hero's body lies, and how. */
  fallenPose(hero: number): { position: Vec3; rotation: Quat; sleeping: boolean } | undefined {
    if (this.broken) return undefined
    const b = this.fallen.get(hero)
    if (!b) return undefined
    const p = b.translation()
    return { position: { x: p.x, y: p.y - 0.9, z: p.z }, rotation: b.rotation(), sleeping: b.isSleeping() }
  }

}

/** A fixed collider for a map piece: a box, a column, or a ramp's sloped deck. */
function collider(R: typeof RAPIER, piece: CoverPiece): RAPIER.ColliderDesc {
  const s = piece.shape
  const mid = (piece.base + piece.top) / 2
  const half = Math.max(0.01, (piece.top - piece.base) / 2)
  if (s.kind === 'column') return R.ColliderDesc.cylinder(half, s.r).setTranslation(s.x, mid, s.z)
  if (!piece.slope) return R.ColliderDesc.cuboid(s.hx, half, s.hz).setTranslation(s.x, mid, s.z)
  // a ramp: a deck 0.3 m thick lying on its slope, from its low end up to its top
  const { rise, low } = piece.slope
  const along = rise[0] === 'x' ? s.hx : s.hz
  const climb = piece.top - low
  const angle = Math.atan2(climb, 2 * along) * (rise.endsWith('+') ? 1 : -1)
  const length = Math.sqrt(4 * along * along + climb * climb) / 2
  const thick = 0.15
  const y = (low + piece.top) / 2 - thick
  // tilt about the axis across the slope: z for a ramp rising along x, x for one along z
  const q = rise[0] === 'x' ? { x: 0, y: 0, z: Math.sin(angle / 2), w: Math.cos(angle / 2) } : { x: -Math.sin(angle / 2), y: 0, z: 0, w: Math.cos(angle / 2) }
  const desc = rise[0] === 'x' ? R.ColliderDesc.cuboid(length, thick, s.hz) : R.ColliderDesc.cuboid(s.hx, thick, length)
  return desc.setTranslation(s.x, y, s.z).setRotation(q)
}
