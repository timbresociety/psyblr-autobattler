import * as THREE from 'three'
import { ENGINE } from '../engine/calibration'
import { paving } from './textures'

/**
 * The arena (R1, R25): a floating island in a dusk sky, paved and split into two near-mirror halves like Dire and
 * Radiant, with no lanes, creeps or base. The ruins heroes fight around come from the engine's cover (ruins.ts); this
 * module draws the stage, the sky and the scenery outside the barrier, where nothing can be walked into.
 */

export interface ArenaMap {
  group: THREE.Group
  /** Axis-aligned boxes the cameras keep out of. */
  proxies: THREE.Box3[]
}

export const TEAM_COLORS = [0x4fa3ff, 0xff6a4a] as const

/** The look in one place, so a later art pass tunes numbers instead of hunting through code. */
export const PALETTE = {
  zenith: '#1b2350',
  horizon: '#f29a6b',
  haze: 0xc98a78,
  stone: '#b7aa98',
  grout: '#7d7264',
  slab: 0x6f6458,
  pillar: 0xd8cbb6,
  cloud: 0xfff1e6,
  line: 0xfff3d6,
} as const

/** Seeded so every visit draws the same floor. */
function seeded(seed: number) {
  let s = seed
  return () => ((s = (s * 16807) % 2147483647) / 2147483647)
}

/** A vertical gradient for the sky dome. */
function skyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, 256)
  g.addColorStop(0, PALETTE.zenith)
  g.addColorStop(0.55, '#6b4e7c')
  g.addColorStop(0.8, PALETTE.horizon)
  g.addColorStop(1, '#ffd7a8')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 4, 256)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** A barrier panel that fades upward, tinted to its half. */
function barrierTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = 128
  const ctx = canvas.getContext('2d')!
  const g = ctx.createLinearGradient(0, 128, 0, 0)
  g.addColorStop(0, 'rgba(255,255,255,0.55)')
  g.addColorStop(0.15, 'rgba(255,255,255,0.18)')
  g.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 4, 128)
  return new THREE.CanvasTexture(canvas)
}

export function buildMap(): ArenaMap {
  const { halfWidth: W, halfLength: L, ceiling } = ENGINE.arena
  const group = new THREE.Group()
  const proxies: THREE.Box3[] = []

  // the stage: large paving slabs with mossy joints, each half tinted a little toward its team
  const stones = paving(41)
  const half = (side: 0 | 1) => {
    const set = { map: stones.map.clone(), normalMap: stones.normalMap.clone(), roughnessMap: stones.roughnessMap.clone() }
    for (const t of Object.values(set)) {
      t.needsUpdate = true
      t.repeat.set(W / 6, L / 12)
    }
    const tint = new THREE.Color(0xffffff).lerp(new THREE.Color(TEAM_COLORS[side]), 0.08)
    const top = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, L), new THREE.MeshStandardMaterial({ ...set, color: tint, roughness: 1, normalScale: new THREE.Vector2(1.2, 1.2) }))
    top.rotation.x = -Math.PI / 2
    top.position.z = (side ? 1 : -1) * (L / 2)
    top.receiveShadow = true
    group.add(top)
  }
  half(0)
  half(1)
  // the island: a grassy rim around the stage and a rocky underside
  const rim = 14
  const lawn = new THREE.Mesh(new THREE.PlaneGeometry(W * 2 + rim * 2, L * 2 + rim * 2), new THREE.MeshStandardMaterial({ color: 0x5f8a3a, roughness: 1 }))
  lawn.rotation.x = -Math.PI / 2
  lawn.position.y = -0.02
  lawn.receiveShadow = true
  group.add(lawn)
  const under = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(W, L) + rim + 4, 18, 26, 9, 3), new THREE.MeshStandardMaterial({ color: PALETTE.slab, roughness: 1, flatShading: true }))
  under.scale.set(1.15, 1, 0.9)
  under.position.y = -13.1
  group.add(under)

  // the centre line and the edge trim glow a little so bloom picks them up
  const glow = (w: number, d: number, x: number, z: number, color: number) => {
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(w, d), new THREE.MeshBasicMaterial({ color, toneMapped: false }))
    strip.rotation.x = -Math.PI / 2
    strip.position.set(x, 0.015, z)
    group.add(strip)
  }
  glow(W * 2, 0.35, 0, 0, PALETTE.line)
  for (const side of [0, 1] as const) {
    const z = (side ? 1 : -1) * (L - 0.2)
    glow(W * 2, 0.4, 0, z, TEAM_COLORS[side])
    glow(0.4, L, -W + 0.2, (side ? 1 : -1) * (L / 2), TEAM_COLORS[side])
    glow(0.4, L, W - 0.2, (side ? 1 : -1) * (L / 2), TEAM_COLORS[side])
  }

  // a faint barrier up to the flight ceiling: where the engine stops a hero, the audience can see why
  const fade = barrierTexture()
  const wall = (w: number, x: number, z: number, rotY: number, color: number) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, ceiling),
      new THREE.MeshBasicMaterial({ color, map: fade, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false }),
    )
    m.position.set(x, ceiling / 2, z)
    m.rotation.y = rotY
    group.add(m)
  }
  for (const side of [0, 1] as const) {
    const s = side ? 1 : -1
    wall(W * 2, 0, s * L, 0, TEAM_COLORS[side])
    wall(L, -W, s * (L / 2), Math.PI / 2, TEAM_COLORS[side])
    wall(L, W, s * (L / 2), Math.PI / 2, TEAM_COLORS[side])
  }

  // cypress trees and a broken outer colonnade on the island's rim, outside the barrier
  const rnd = seeded(11)
  const leaves = new THREE.MeshStandardMaterial({ color: 0x3f6b34, roughness: 0.85 })
  const bark = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 })
  const cypress = (x: number, z: number, h: number) => {
    const tree = new THREE.Group()
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, 1.4, 6), bark)
    trunk.position.y = 0.7
    // a cypress is a stack of soft, tapering puffs
    tree.add(trunk)
    trunk.castShadow = true
    const puffs = 4
    for (let k = 0; k < puffs; k++) {
      const t = k / (puffs - 1)
      const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(1, 2), leaves)
      const r = 1.25 * (1 - t * 0.6)
      crown.scale.set(r, h / puffs * 0.85, r)
      crown.position.y = 1.2 + (h / puffs) * (k + 0.5)
      crown.castShadow = true
      tree.add(crown)
    }
    tree.position.set(x, 0, z)
    group.add(tree)
    proxies.push(new THREE.Box3().setFromObject(tree))
  }
  for (const side of [-1, 1]) {
    for (let k = 0; k < 7; k++) cypress(side * (W + 4 + rnd() * 6), -L + (k / 6) * L * 2 + (rnd() - 0.5) * 4, 6 + rnd() * 5)
    for (let k = 0; k < 6; k++) cypress(-W + (k / 5) * W * 2 + (rnd() - 0.5) * 5, side * (L + 4 + rnd() * 6), 6 + rnd() * 5)
  }
  const pillarMat = new THREE.MeshStandardMaterial({ color: PALETTE.pillar, roughness: 0.8 })
  for (const side of [-1, 1])
    for (let k = 0; k < 5; k++) {
      const h = 4 + rnd() * 9
      const col = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.05, h, 20), pillarMat)
      col.position.set(-W * 0.8 + k * (W * 0.4), h / 2, side * (L + 10))
      col.castShadow = true
      group.add(col)
    }

  // floating rocks and a cloud sea below the stage give the sky its depth
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8f8170, roughness: 0.95, flatShading: true })
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rnd() * 0.3
    const r = 110 + rnd() * 70
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(2 + rnd() * 4, 1), rockMat)
    rock.position.set(Math.cos(a) * r, -10 + rnd() * 26, Math.sin(a) * r)
    rock.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3)
    rock.scale.y = 0.6
    group.add(rock)
  }
  const puff = new THREE.SphereGeometry(1, 12, 8)
  const clouds = new THREE.InstancedMesh(puff, new THREE.MeshStandardMaterial({ color: PALETTE.cloud, roughness: 1, emissive: 0x5a3a3a, emissiveIntensity: 0.25 }), 90)
  const place = new THREE.Object3D()
  for (let i = 0; i < 90; i++) {
    const a = rnd() * Math.PI * 2
    const r = 30 + rnd() * 150
    place.position.set(Math.cos(a) * r, -18 - rnd() * 10, Math.sin(a) * r)
    const s = 8 + rnd() * 14
    place.scale.set(s * 1.6, s * 0.5, s)
    place.updateMatrix()
    clouds.setMatrixAt(i, place.matrix)
  }
  group.add(clouds)

  return { group, proxies }
}

/** The dusk sky dome and the haze that blends the far props into it. */
export function atmosphere(scene: THREE.Scene) {
  const dome = new THREE.Mesh(new THREE.SphereGeometry(380, 32, 16), new THREE.MeshBasicMaterial({ map: skyTexture(), side: THREE.BackSide, fog: false, depthWrite: false }))
  scene.add(dome)
  scene.background = new THREE.Color(PALETTE.horizon)
  // the sky lights every material too, so stone picks up warm horizon light and a cool fill from above
  const env = skyTexture()
  env.mapping = THREE.EquirectangularReflectionMapping
  scene.environment = env
  scene.environmentIntensity = 0.55
  scene.fog = new THREE.Fog(PALETTE.haze, 90, 330)
}

/** A warm key light from the low sun, a cool sky fill and a rim from behind the far half. */
export function lights(scene: THREE.Scene) {
  // a strong low sun and a softer sky make the stone read in relief, the way stylised AAA arenas are lit
  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x6a4a3a, 0.7))
  const sun = new THREE.DirectionalLight(0xffd2a6, 3.6)
  sun.position.set(30, 38, -18)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.02
  Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 38, bottom: -38, near: 1, far: 140 })
  scene.add(sun)
  const rim = new THREE.DirectionalLight(0x9db8ff, 0.9)
  rim.position.set(-20, 18, 40)
  scene.add(rim)
  return sun
}
