import * as THREE from 'three'
import type { BuildSlot } from '../../../charter/types'
import { ENGINE } from '../../engine/calibration'
import type { MatchEvent } from '../../engine/events'
import type { ArenaController } from '../match-view'
import type { SpriteSpec } from './vfx'

/**
 * What skills leave in the world, drawn (the skill library's zones and constructs): walls that rise out of the floor
 * and crumble, turrets that turn and fire tracers, fields that glow on the ground and pulse on their beat, traps that
 * only the owner's side can see, and heroes in stealth as a faint shimmer. All cosmetic: the engine already decided.
 */

/** What the effect player lends this module: its particle pools, its flash, and each hero's skill colour. */
export interface FxKit {
  sparkle: (spec: SpriteSpec) => void
  puff: (spec: SpriteSpec) => void
  flash: (at: THREE.Vector3, color: THREE.Color, size: number) => void
  /** A hero's colour for a skill: the slot's recipe colour, or its main skill's. */
  tint: (hero: number, slot?: BuildSlot) => THREE.Color
}

const TEAM = [new THREE.Color(0.31, 0.64, 1), new THREE.Color(1, 0.42, 0.29)]
const RISE = 0.3
const FADE = 0.45

interface Wall {
  root: THREE.Group
  slab: THREE.Mesh
  born: number
  dying?: number
}
interface Turret {
  root: THREE.Group
  head: THREE.Object3D
  core: THREE.Mesh
  born: number
  dying?: number
  recoil: number
}
interface Field {
  disc: THREE.Mesh
  ring: THREE.Mesh
  owner: number
  trap: boolean
  born: number
  pulse: number
  dying?: number
}

/** A soft ring on the floor: clear in the middle, bright at the rim, the shape every field and trap is drawn with. */
function ringTexture(): THREE.Texture {
  const size = 128
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')
  if (g) {
    const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
    grad.addColorStop(0, 'rgba(255,255,255,0.10)')
    grad.addColorStop(0.72, 'rgba(255,255,255,0.22)')
    grad.addColorStop(0.93, 'rgba(255,255,255,0.95)')
    grad.addColorStop(1, 'rgba(255,255,255,0)')
    g.fillStyle = grad
    g.fillRect(0, 0, size, size)
  }
  const t = new THREE.CanvasTexture(c)
  t.colorSpace = THREE.SRGBColorSpace
  return t
}

export function createWorldFx(ctrl: ArenaController, kit: FxKit) {
  const { scene, arena } = ctrl
  const group = new THREE.Group()
  group.name = 'world-fx'
  scene.add(group)
  const walls = new Map<number, Wall>()
  const turrets = new Map<number, Turret>()
  const fields = new Map<number, Field>()
  const tracers: { line: THREE.Line; t: number }[] = []
  const shimmer = new Map<number, THREE.Mesh>()
  const floorRing = ringTexture()
  const discGeo = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2)
  const ringGeo = new THREE.RingGeometry(0.94, 1, 64).rotateX(-Math.PI / 2)
  const shellGeo = new THREE.IcosahedronGeometry(1, 2)
  let clock = 0

  const v3 = (p: { x: number; y: number; z: number }) => new THREE.Vector3(p.x, p.y, p.z)
  const teamOf = (hero: number) => (hero >= 0 ? arena.match.heroes[hero].team : 0)
  /** The player's own side, or undefined while watching: traps and stealth are hidden from the player's enemies only. */
  const viewer = () => (arena.match.human !== undefined ? arena.match.heroes[arena.match.human].team : undefined)

  function raiseWall(e: Extract<MatchEvent, { type: 'wall' }>) {
    const color = e.owner >= 0 ? TEAM[teamOf(e.owner)] : new THREE.Color(0.8, 0.8, 0.8)
    const root = new THREE.Group()
    // a slab of hard light over a stone foot: solid enough to read as cover, tinted so you know whose it is
    const slab = new THREE.Mesh(
      new THREE.BoxGeometry(e.hx * 2, e.top, e.hz * 2).translate(0, e.top / 2, 0),
      new THREE.MeshStandardMaterial({ color: color.clone().lerp(new THREE.Color(0.55, 0.55, 0.6), 0.6), emissive: color, emissiveIntensity: 0.35, roughness: 0.35, metalness: 0.1, transparent: true, opacity: 0.88 }),
    )
    const edges = new THREE.LineSegments(new THREE.EdgesGeometry(slab.geometry), new THREE.LineBasicMaterial({ color: color.clone().multiplyScalar(1.6), transparent: true, opacity: 0.9 }))
    slab.add(edges)
    slab.castShadow = true
    root.add(slab)
    root.position.set(e.at.x, 0, e.at.z)
    root.scale.y = 0.02
    group.add(root)
    walls.set(e.index, { root, slab, born: clock })
    const at = v3(e.at)
    kit.puff({ at, count: 16, kind: 'smoke', life: 1.2, size: [0.6, 1.8], color: new THREE.Color(0.75, 0.7, 0.62), speed: 2.4, spread: Math.max(e.hx, e.hz), drag: 1.6, up: 0.6, alpha: 0.45, spin: 0.4 })
    kit.sparkle({ at: { x: at.x, y: 0.3, z: at.z }, count: 24, kind: 'glow', life: 0.6, size: [0.14, 0.03], color: color.clone().lerp(new THREE.Color(1, 1, 1), 0.4), speed: 4, spread: Math.max(e.hx, e.hz), velocity: { x: 0, y: 3, z: 0 } })
  }

  function dropWall(index: number) {
    const w = walls.get(index)
    if (!w || w.dying !== undefined) return
    w.dying = clock
    const at = w.root.position
    kit.puff({ at: { x: at.x, y: 1, z: at.z }, count: 22, kind: 'smoke', life: 1.5, size: [0.7, 2.2], color: new THREE.Color(0.72, 0.68, 0.62), speed: 3, spread: 1.5, drag: 1.8, up: 0.4, alpha: 0.5 })
  }

  function placeTurret(e: Extract<MatchEvent, { type: 'turret' }>) {
    const color = TEAM[teamOf(e.owner)]
    const metal = new THREE.MeshStandardMaterial({ color: 0x3a3f4a, roughness: 0.45, metalness: 0.7 })
    const root = new THREE.Group()
    const base = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.6, 0.5, 10).translate(0, 0.25, 0), metal)
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, 0.7, 8).translate(0, 0.85, 0), metal)
    const head = new THREE.Group()
    head.position.y = 1.35
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.38, 0.7), metal)
    const barrel = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.07, 0.6, 8).rotateX(Math.PI / 2).translate(0, 0, 0.6), metal)
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 8), new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(2), toneMapped: false }))
    core.position.set(0, 0.06, 0.36)
    head.add(body, barrel, core)
    root.add(base, post, head)
    for (const m of [base, post, body, barrel]) m.castShadow = true
    root.position.set(e.at.x, 0, e.at.z)
    root.scale.setScalar(0.02)
    group.add(root)
    turrets.set(e.id, { root, head, core, born: clock, recoil: 0 })
    kit.flash(v3({ x: e.at.x, y: 0.6, z: e.at.z }), color, 1.2)
    kit.puff({ at: { x: e.at.x, y: 0.2, z: e.at.z }, count: 10, kind: 'smoke', life: 0.9, size: [0.4, 1.2], color: new THREE.Color(0.7, 0.68, 0.64), speed: 2, drag: 2, up: 0.5, alpha: 0.4 })
  }

  function turretShot(e: Extract<MatchEvent, { type: 'turret' }>) {
    const t = turrets.get(e.id)
    if (!t || !e.to) return
    const color = kit.tint(e.owner)
    const from = v3(e.at)
    const to = v3(e.to)
    t.head.lookAt(to.x, t.root.position.y + t.head.position.y, to.z)
    t.recoil = 1
    const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([from, to]), new THREE.LineBasicMaterial({ color: color.clone().multiplyScalar(2.2), transparent: true, opacity: 1, toneMapped: false }))
    group.add(line)
    tracers.push({ line, t: 0 })
    kit.flash(from, color, 0.45)
    kit.sparkle({ at: to, count: 6, kind: 'glow', life: 0.3, size: [0.1, 0.02], color, speed: 3.5 })
  }

  function openField(e: Extract<MatchEvent, { type: 'field' }>) {
    const color = e.trap ? TEAM[teamOf(e.owner)].clone() : kit.tint(e.owner, e.slot)
    const mat = (opacity: number) => new THREE.MeshBasicMaterial({ map: floorRing, color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })
    const disc = new THREE.Mesh(discGeo, mat(e.trap ? 0.35 : 0.7))
    const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color: color.clone().multiplyScalar(1.5), transparent: true, opacity: e.trap ? 0.5 : 0.85, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }))
    for (const m of [disc, ring]) {
      m.position.set(e.at.x, 0.04, e.at.z)
      m.scale.setScalar(e.radius)
      m.renderOrder = 2
      group.add(m)
    }
    fields.set(e.id, { disc, ring, owner: e.owner, trap: e.trap, born: clock, pulse: 0 })
  }

  function closeField(e: Extract<MatchEvent, { type: 'field' }>) {
    const f = fields.get(e.id)
    if (!f) return
    f.dying = clock
    if (e.trap && e.sprung) {
      // a trap snapping shut: a burst where it caught someone, in its owner's colour
      const at = v3(e.at)
      const color = TEAM[teamOf(e.owner)]
      kit.flash(new THREE.Vector3(at.x, 0.5, at.z), color, 2)
      kit.sparkle({ at: { x: at.x, y: 0.3, z: at.z }, count: 30, kind: 'glow', life: 0.5, size: [0.16, 0.03], color, speed: 6, spread: e.radius * 0.6 })
      kit.puff({ at: { x: at.x, y: 0.2, z: at.z }, count: 10, kind: 'smoke', life: 1, size: [0.5, 1.4], color: new THREE.Color(0.6, 0.55, 0.5), speed: 2.5, drag: 2, up: 0.6, alpha: 0.4 })
    }
  }

  function release(o: THREE.Object3D) {
    o.removeFromParent()
    o.traverse((x) => {
      const m = x as THREE.Mesh
      if (m.geometry && m.geometry !== discGeo && m.geometry !== ringGeo && m.geometry !== shellGeo) m.geometry.dispose()
      const mat = m.material as THREE.Material | THREE.Material[] | undefined
      if (Array.isArray(mat)) mat.forEach((x) => x.dispose())
      else mat?.dispose()
    })
  }

  return {
    events(list: readonly MatchEvent[]) {
      for (const e of list) {
        if (e.type === 'wall') e.phase === 'up' ? raiseWall(e) : dropWall(e.index)
        else if (e.type === 'cover-broken') dropWall(e.index)
        else if (e.type === 'turret') {
          if (e.phase === 'start') placeTurret(e)
          else if (e.phase === 'shot') turretShot(e)
          else {
            const t = turrets.get(e.id)
            if (t && t.dying === undefined) t.dying = clock
          }
        } else if (e.type === 'field') {
          if (e.phase === 'start') openField(e)
          else if (e.phase === 'pulse') {
            const f = fields.get(e.id)
            if (f) f.pulse = 1
          } else closeField(e)
        }
      }
    },
    frame(dt: number) {
      clock += dt
      const me = viewer()
      const drawn = ctrl.positions()
      for (const [index, w] of walls) {
        const age = clock - w.born
        if (w.dying !== undefined) {
          const p = (clock - w.dying) / FADE
          w.root.scale.y = Math.max(0.02, 1 - p)
          if (p >= 1) {
            release(w.root)
            walls.delete(index)
          }
        } else w.root.scale.y = age < RISE ? 0.02 + 0.98 * (1 - (1 - age / RISE) ** 3) : 1
      }
      for (const [id, t] of turrets) {
        const age = clock - t.born
        t.recoil = Math.max(0, t.recoil - dt * 8)
        t.head.position.y = 1.35 - t.recoil * 0.05
        if (t.dying !== undefined) {
          const p = (clock - t.dying) / FADE
          t.root.scale.setScalar(Math.max(0.02, 1 - p))
          if (p >= 1) {
            release(t.root)
            turrets.delete(id)
          }
        } else t.root.scale.setScalar(age < RISE ? 0.02 + 0.98 * (age / RISE) : 1)
      }
      for (const [id, f] of fields) {
        const owner = arena.match.heroes[f.owner]
        // a field cast around its owner moves with it, as the engine's does
        const live = arena.match.fields?.find((x) => x.id === id)
        if (live?.follow && drawn[f.owner]) {
          f.disc.position.set(drawn[f.owner].x, 0.04, drawn[f.owner].z)
          f.ring.position.copy(f.disc.position)
        }
        // a trap is hidden from the player it is set for
        const hidden = f.trap && me !== undefined && owner.team !== me
        f.disc.visible = f.ring.visible = !hidden
        f.pulse = Math.max(0, f.pulse - dt * 3)
        const grow = Math.min(1, (clock - f.born) / 0.25)
        const fade = f.dying !== undefined ? Math.max(0, 1 - (clock - f.dying) / FADE) : 1
        ;(f.disc.material as THREE.MeshBasicMaterial).opacity = (f.trap ? 0.3 + 0.1 * Math.sin(clock * 3) : 0.55 + 0.35 * f.pulse) * grow * fade
        ;(f.ring.material as THREE.MeshBasicMaterial).opacity = (f.trap ? 0.45 : 0.7 + 0.3 * f.pulse) * grow * fade
        const r = live?.radius ?? f.disc.scale.x
        f.ring.scale.setScalar(r * (1 + 0.06 * f.pulse))
        if (f.dying !== undefined && fade <= 0) {
          f.disc.removeFromParent()
          f.ring.removeFromParent()
          ;(f.disc.material as THREE.Material).dispose()
          ;(f.ring.material as THREE.Material).dispose()
          fields.delete(id)
        }
      }
      for (let i = tracers.length - 1; i >= 0; i--) {
        const tr = tracers[i]
        tr.t += dt / 0.12
        ;(tr.line.material as THREE.LineBasicMaterial).opacity = Math.max(0, 1 - tr.t)
        if (tr.t >= 1) {
          release(tr.line)
          tracers.splice(i, 1)
        }
      }
      // stealth: the body goes, a faint shimmer stays for allies and spectators; the hunted player sees nothing
      // until it is close enough to give itself away
      const now = arena.match.tick
      arena.match.heroes.forEach((h, i) => {
        const view = ctrl.views[i]
        const hiddenNow = h.alive && (h.stealthUntil ?? 0) > now
        let s = shimmer.get(i)
        if (!hiddenNow) {
          if (s) {
            s.visible = false
            if (view) view.root.visible = true
          }
          return
        }
        if (view) view.root.visible = false
        if (!s) {
          s = new THREE.Mesh(shellGeo, new THREE.MeshBasicMaterial({ color: TEAM[h.team].clone().multiplyScalar(0.8), transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, wireframe: true }))
          group.add(s)
          shimmer.set(i, s)
        }
        const at = drawn[i]
        const enemy = me !== undefined && h.team !== me
        const near = enemy && arena.match.human !== undefined && drawn[arena.match.human] ? Math.hypot(at.x - drawn[arena.match.human].x, at.z - drawn[arena.match.human].z) <= ENGINE.revealRange + 1 : false
        s.visible = !enemy || near
        s.position.set(at.x, at.y + 0.9, at.z)
        s.scale.set(0.45, 0.95, 0.45)
        s.rotation.y += dt * 0.8
      })
    },
    dispose() {
      for (const w of walls.values()) release(w.root)
      for (const t of turrets.values()) release(t.root)
      for (const tr of tracers) release(tr.line)
      group.removeFromParent()
      discGeo.dispose()
      ringGeo.dispose()
      shellGeo.dispose()
      floorRing.dispose()
    },
  }
}
