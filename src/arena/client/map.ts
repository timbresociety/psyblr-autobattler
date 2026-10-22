import * as THREE from 'three'
import { ENGINE } from '../engine/calibration'

/**
 * The arena (R1, R25): a floating stone stage in a dusk sky, split into two near-mirror halves like Dire and Radiant,
 * with no lanes, creeps or base. The fighting floor is bare on purpose: the engine has no cover, so every prop stands
 * outside the barrier, where no hero can walk through it. Cameras keep out of the props' boxes.
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

/** Stone tiles with a little variation per tile; repeated across the floor. */
function tileTexture(): THREE.CanvasTexture {
  const size = 512
  const tiles = 4
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = size
  const ctx = canvas.getContext('2d')!
  const rnd = seeded(7)
  ctx.fillStyle = PALETTE.grout
  ctx.fillRect(0, 0, size, size)
  const cell = size / tiles
  for (let y = 0; y < tiles; y++)
    for (let x = 0; x < tiles; x++) {
      const light = 62 + rnd() * 10
      ctx.fillStyle = `hsl(34 18% ${light}%)`
      ctx.fillRect(x * cell + 3, y * cell + 3, cell - 6, cell - 6)
      // a few soft speckles keep large areas from reading as flat colour
      for (let k = 0; k < 40; k++) {
        ctx.fillStyle = `hsla(30 20% ${light - 8 + rnd() * 16}% / 0.35)`
        ctx.beginPath()
        ctx.arc(x * cell + 6 + rnd() * (cell - 12), y * cell + 6 + rnd() * (cell - 12), 1 + rnd() * 3, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping
  texture.anisotropy = 4
  return texture
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

  // the stage: a thick stone slab with a tiled top, each half tinted toward its team
  const tiles = tileTexture()
  const half = (side: 0 | 1) => {
    const map = tiles.clone()
    map.needsUpdate = true
    map.repeat.set(W / 4, L / 8)
    const tint = new THREE.Color(0xffffff).lerp(new THREE.Color(TEAM_COLORS[side]), 0.12)
    const top = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, L), new THREE.MeshStandardMaterial({ map, color: tint, roughness: 0.92 }))
    top.rotation.x = -Math.PI / 2
    top.position.z = (side ? 1 : -1) * (L / 2)
    top.receiveShadow = true
    group.add(top)
  }
  half(0)
  half(1)
  const slab = new THREE.Mesh(new THREE.BoxGeometry(W * 2 + 2, 4, L * 2 + 2), new THREE.MeshStandardMaterial({ color: PALETTE.slab, roughness: 1 }))
  slab.position.y = -2.02
  slab.receiveShadow = true
  group.add(slab)

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
      new THREE.MeshBasicMaterial({ color, map: fade, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false }),
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

  // pillars stand just outside the barrier, mirrored with small differences between the halves
  const rnd = seeded(11)
  const pillarMat = new THREE.MeshStandardMaterial({ color: PALETTE.pillar, roughness: 0.75 })
  const pillar = (x: number, z: number, h: number) => {
    const p = new THREE.Group()
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.3, h, 12), pillarMat)
    shaft.position.y = h / 2 - 2
    const cap = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.8, 3.2), pillarMat)
    cap.position.y = h - 2
    const foot = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.2, 3.4), pillarMat)
    foot.position.y = -1.4
    for (const m of [shaft, cap, foot]) {
      m.castShadow = m.receiveShadow = true
      p.add(m)
    }
    p.position.set(x, 0, z)
    group.add(p)
    proxies.push(new THREE.Box3().setFromObject(p))
  }
  for (const side of [0, 1] as const) {
    const s = side ? 1 : -1
    for (const t of [0.15, 0.55, 0.95]) {
      pillar(-W - 4, s * L * t + s * (side ? 1 : 0), 10 + rnd() * 8)
      pillar(W + 4, s * L * t - s * (side ? 1.5 : 0), 10 + rnd() * 8)
    }
    pillar(-W * 0.5, s * (L + 4), 12 + rnd() * 6)
    pillar(W * 0.5 + (side ? 2 : 0), s * (L + 4), 12 + rnd() * 6)
  }

  // floating rocks and a cloud sea below the stage give the sky its depth
  const rockMat = new THREE.MeshStandardMaterial({ color: 0x8f8170, roughness: 0.95, flatShading: true })
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * Math.PI * 2 + rnd() * 0.3
    const r = 70 + rnd() * 50
    const rock = new THREE.Mesh(new THREE.IcosahedronGeometry(2 + rnd() * 5, 0), rockMat)
    rock.position.set(Math.cos(a) * r, -6 + rnd() * 30, Math.sin(a) * r)
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
  scene.fog = new THREE.Fog(PALETTE.haze, 90, 330)
}

/** A warm key light from the low sun, a cool sky fill and a rim from behind the far half. */
export function lights(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x6a4a3a, 1.1))
  const sun = new THREE.DirectionalLight(0xffd2a6, 2.6)
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
