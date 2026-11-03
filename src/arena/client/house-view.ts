import * as THREE from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { color, float, fract, max, mix, positionWorld, smoothstep, time, uniform, uv } from 'three/tsl'
import { ENGINE } from '../engine/calibration.js'
import { VAULT, edgeAt } from '../engine/house-rules.js'
import type { MatchState } from '../engine/state.js'
import { TEAM_COLORS } from './map.js'

/**
 * The house's rules drawn in the world (GAME.md §2): the edge as a wall of light, gold where it holds and red while it
 * closes, its bright top and bottom rims marking the band of heights still safe; and a ring on the vault's floor, gold
 * while the jackpot is up for grabs, in the colour of the squad holding it after.
 */

const GOLD = new THREE.Color(0xffc24a)
const RED = new THREE.Color(0xff4a3a)

/** How high the wall is drawn at most: the sky above the chandelier needs no wall. */
const TOP = 30

export interface HouseView {
  update(match: MatchState, alpha: number): void
  dispose(): void
}

export function createHouseView(scene: THREE.Scene): HouseView {
  const tint = uniform(new THREE.Color(GOLD))
  // rims at the band's floor and ceiling, faint light between, and bands of light rising up the wall
  const v = uv().y
  const rim = max(smoothstep(0.035, 0, v), smoothstep(0.965, 1, v))
  const rising = smoothstep(0.82, 1, fract(positionWorld.y.mul(0.35).sub(time.mul(0.5))))
  const wallMaterial = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide })
  wallMaterial.colorNode = mix(tint, color(0xffffff), rim.mul(0.5))
  wallMaterial.opacityNode = float(0.07).add(rising.mul(0.12)).add(rim.mul(0.75))
  const wall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 128, 1, true).translate(0, 0.5, 0), wallMaterial)
  wall.name = 'house-edge'
  wall.renderOrder = 3
  wall.frustumCulled = false
  scene.add(wall)

  const ringTint = uniform(new THREE.Color(GOLD))
  const ringMaterial = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false })
  const r = uv().x
  ringMaterial.colorNode = ringTint
  ringMaterial.opacityNode = smoothstep(0, 0.3, r).mul(smoothstep(1, 0.7, r)).mul(0.55)
  const ring = new THREE.Mesh(new THREE.RingGeometry(4.2, 5.2, 96, 1).rotateX(-Math.PI / 2), ringMaterial)
  // the fade runs out across the ring's width
  ring.geometry.setAttribute('uv', radialUv(ring.geometry))
  ring.position.set(VAULT.at.x, VAULT.at.y + 0.03, VAULT.at.z)
  ring.name = 'vault-ring'
  // both stay visible until the first update, so the match's compile before the fight builds their shaders
  scene.add(ring)

  return {
    update(match, alpha) {
      const house = match.house
      if (!house) {
        wall.visible = ring.visible = false
        return
      }
      const edge = edgeAt(house.spot, match.tick + alpha)
      const lo = Math.max(edge.lo, -1)
      const hi = Math.min(edge.hi, TOP)
      wall.position.set(edge.x, lo, edge.z)
      wall.scale.set(edge.r, Math.max(0.1, hi - lo), edge.r)
      tint.value.copy(edge.closing ? RED : GOLD)
      // until it first closes the whole house is inside it, and its ring far out over the hills only reads as stray lines
      wall.visible = match.winner === undefined && edge.phase > 0

      const vault = house.vault
      ring.visible = vault.open
      ringTint.value.set(vault.holder === undefined ? GOLD : TEAM_COLORS[vault.holder])
      ring.scale.setScalar(1 + (vault.by !== undefined ? 0.15 * Math.sin((match.tick / ENGINE.tickHz) * 8) : 0))
    },
    dispose() {
      for (const m of [wall, ring]) {
        m.removeFromParent()
        m.geometry.dispose()
        ;(m.material as THREE.Material).dispose()
      }
    },
  }
}

/** UVs for the vault's ring: u from 0 at its inner edge to 1 at its outer, for the fade across it. */
function radialUv(geometry: THREE.BufferGeometry): THREE.BufferAttribute {
  const p = geometry.getAttribute('position')
  const out = new Float32Array(p.count * 2)
  for (let i = 0; i < p.count; i++) {
    const d = Math.sqrt(p.getX(i) ** 2 + p.getZ(i) ** 2)
    out[i * 2] = (d - 4.2) / 1
    out[i * 2 + 1] = 0
  }
  return new THREE.BufferAttribute(out, 2)
}
