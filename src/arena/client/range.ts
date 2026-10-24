import * as THREE from 'three'
import { geometryOf } from '../../charter/geometry.js'
import { SIZES } from '../../charter/sizes.js'
import { ENGINE } from '../engine/calibration.js'
import { chest, isRanged } from '../engine/deliveries.js'
import { enemiesOf } from '../engine/effects.js'
import type { Vec3 } from '../engine/maths.js'
import { capsule, type HeroSetup, type HeroState, type MatchState } from '../engine/state.js'

/**
 * How far the controlled hero's basic attack reaches, on the floor around it: an arc in front for a swing (it turns
 * with the aim), a thin ring for a shot. Both light up gold while an enemy stands where the next attack would land.
 * The same test drives the crosshair's in-range colour, so the floor and the reticle always agree.
 */

const GOLD = new THREE.Color(1, 0.78, 0.3)
const WHITE = new THREE.Color(1, 1, 1)

/** How far a basic attack reaches, from the attacker's body: what the engine's own reach check uses. */
export function basicReach(hero: HeroState, setup: HeroSetup): number {
  const d = setup.kit.basic.delivery
  return isRanged(setup) ? d.range : d.range + ENGINE.meleeSlack + SIZES[hero.size].reachBonus + capsule(hero).radius
}

/** The width of the basic attack's arc in degrees; 360 for a shot, which goes wherever it is aimed. */
export function basicArc(setup: HeroSetup): number {
  const d = setup.kit.basic.delivery
  return isRanged(setup) ? 360 : d.kind === 'melee' || d.kind === 'cone' ? geometryOf(d).arcDegrees : 360
}

/**
 * The enemy the next basic attack would land on, if any: inside its reach and inside its arc for a swing, or within a
 * few degrees of the aim for a shot. `yaw` and `pitch` are the aim.
 */
export function inReach(match: MatchState, setups: readonly HeroSetup[], hero: HeroState, yaw: number, pitch: number): HeroState | undefined {
  const setup = setups[hero.id]
  const reach = basicReach(hero, setup)
  const arc = basicArc(setup)
  const from = chest(hero)
  const aim = new THREE.Vector3(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
  const ranged = isRanged(setup)
  for (const e of enemiesOf(match, hero)) {
    const to = chest(e)
    const dir = new THREE.Vector3(to.x - from.x, to.y - from.y, to.z - from.z)
    const dist = dir.length()
    if (ranged) {
      if (dist > reach + capsule(e).radius) continue
      // a shot lands if the aim passes within the target's body
      const off = Math.asin(Math.min(1, (capsule(e).radius + 0.3) / Math.max(dist, 0.1)))
      if (dir.normalize().angleTo(aim) <= off) return e
    } else {
      const flat = Math.hypot(dir.x, dir.z) - capsule(e).radius
      if (flat > reach || Math.abs(dir.y) > 2.5) continue
      const facing = Math.abs(Math.atan2(dir.x, dir.z) - yaw)
      const wrapped = Math.min(facing, Math.PI * 2 - facing)
      if (wrapped <= ((arc / 2) * Math.PI) / 180) return e
    }
  }
  return undefined
}

export function createRangeIndicator(scene: THREE.Scene) {
  const group = new THREE.Group()
  group.name = 'basic-range'
  group.visible = false
  const edge = new THREE.MeshBasicMaterial({ color: WHITE, transparent: true, opacity: 0.4, depthWrite: false, toneMapped: false, side: THREE.DoubleSide })
  const fill = new THREE.MeshBasicMaterial({ color: WHITE, transparent: true, opacity: 0.06, depthWrite: false, toneMapped: false, side: THREE.DoubleSide })
  const outline = new THREE.Mesh(new THREE.BufferGeometry(), edge)
  const area = new THREE.Mesh(new THREE.BufferGeometry(), fill)
  outline.renderOrder = area.renderOrder = 3
  group.add(area, outline)
  scene.add(group)
  let shape = ''

  return {
    /** Each frame: follow the controlled hero, turn with the aim, and light up when an attack would land. */
    update(match: MatchState, setups: readonly HeroSetup[], drawn: readonly Vec3[], yaw: number, pitch: number) {
      const i = match.human
      const hero = i !== undefined ? match.heroes[i] : undefined
      if (!hero?.alive || !drawn[hero.id]) {
        group.visible = false
        return
      }
      const setup = setups[hero.id]
      const reach = basicReach(hero, setup)
      const arc = basicArc(setup)
      const key = `${reach.toFixed(2)}|${arc}`
      if (key !== shape) {
        shape = key
        outline.geometry.dispose()
        area.geometry.dispose()
        // built around +z, the way a hero with yaw 0 faces, then turned with the aim
        const span = (Math.min(arc, 360) * Math.PI) / 180
        const start = -Math.PI / 2 - span / 2
        outline.geometry = new THREE.RingGeometry(Math.max(0.1, reach - 0.07), reach, 96, 1, start, span).rotateX(-Math.PI / 2)
        area.geometry = arc >= 360 ? new THREE.BufferGeometry() : new THREE.CircleGeometry(reach, 48, start, span).rotateX(-Math.PI / 2)
      }
      const at = drawn[hero.id]
      group.visible = true
      // on the floor under a grounded hero; level with the feet of one in the air
      group.position.set(at.x, Math.max(0.05, at.y + 0.05), at.z)
      group.rotation.y = arc >= 360 ? 0 : yaw
      const target = inReach(match, setups, hero, yaw, pitch)
      edge.color.copy(target ? GOLD : WHITE)
      fill.color.copy(target ? GOLD : WHITE)
      edge.opacity = target ? 0.85 : 0.4
      fill.opacity = target ? 0.14 : 0.06
    },
    dispose() {
      group.removeFromParent()
      outline.geometry.dispose()
      area.geometry.dispose()
      edge.dispose()
      fill.dispose()
    },
  }
}
