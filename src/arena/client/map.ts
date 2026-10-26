import * as THREE from 'three'
import { ENGINE } from '../engine/calibration'

/**
 * The arena (R1, R25): one map in two near-mirror halves with small differences, like Dire and Radiant, and no
 * lanes, creeps or base. A minimal style protects the frame rate. Simple boxes stand in for the scenery when
 * cameras check for walls.
 */

export interface ArenaMap {
  group: THREE.Group
  /** Axis-aligned boxes the cameras keep out of. */
  proxies: THREE.Box3[]
}

export const TEAM_COLORS = [0x4fa3ff, 0xff6a4a] as const

export function buildMap(): ArenaMap {
  const { halfWidth, halfLength } = ENGINE.arena
  const group = new THREE.Group()
  const proxies: THREE.Box3[] = []
  const half = (side: 0 | 1) => {
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(halfWidth * 2, halfLength), new THREE.MeshStandardMaterial({ color: side ? 0x3a2b2b : 0x26323f, roughness: 0.95 }))
    ground.rotation.x = -Math.PI / 2
    ground.position.z = (side ? 1 : -1) * (halfLength / 2)
    ground.receiveShadow = true
    group.add(ground)
  }
  half(0)
  half(1)
  const line = new THREE.Mesh(new THREE.PlaneGeometry(halfWidth * 2, 0.3), new THREE.MeshBasicMaterial({ color: 0xf2e6c9 }))
  line.rotation.x = -Math.PI / 2
  line.position.y = 0.01
  group.add(line)
  // pillars and rocks mirrored across the middle, nudged so the halves differ a little
  const rock = (x: number, z: number, w: number, h: number, color: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, w * 0.8), new THREE.MeshStandardMaterial({ color, roughness: 0.8, flatShading: true }))
    mesh.position.set(x, h / 2, z)
    mesh.rotation.y = (x * 0.37 + z * 0.11) % Math.PI
    mesh.castShadow = mesh.receiveShadow = true
    group.add(mesh)
    proxies.push(new THREE.Box3().setFromObject(mesh))
  }
  for (const [x, z, w, h] of [[-14, 12, 3, 5], [12, 16, 2.5, 7], [-4, 22, 4, 3], [22, 6, 3, 4]] as const) {
    rock(x, -z, w, h, 0x5b6b7c)
    rock(-x + 1.5, z - 1, w * 1.1, h * 0.9, 0x7c5b52)
  }
  // a low rim marks the edge of the arena
  const rim = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(halfWidth * 2, 0.6, halfLength * 2)), new THREE.LineBasicMaterial({ color: 0x8a96a8 }))
  rim.position.y = 0.3
  group.add(rim)
  return { group, proxies }
}

export function lights(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xcfe3ff, 0x2a2018, 1.2))
  const sun = new THREE.DirectionalLight(0xffffff, 2.2)
  sun.position.set(20, 40, 10)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  Object.assign(sun.shadow.camera, { left: -45, right: 45, top: 35, bottom: -35 })
  scene.add(sun)
  return sun
}
