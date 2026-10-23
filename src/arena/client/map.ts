import * as THREE from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { color, dot, float, max, mix, mx_fractal_noise_float, normalize, positionLocal, pow, smoothstep, time, uniform, vec3 } from 'three/tsl'
import { ENGINE } from '../engine/calibration'
import { paintedMaterial } from './ruins'

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
  zenith: '#1a2560',
  sky: '#4867b8',
  lavender: '#9d8bc9',
  peach: '#f4a37e',
  horizon: '#ffd49c',
  haze: 0xe2a986,
  cloudShade: '#6f6596',
  cloudLit: '#ffdcbc',
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

/** Where the low sun sits in the sky: the key light's bearing, nearer the horizon. */
const SUN = new THREE.Vector3(30, 11, -18).normalize()

/** The sky's light for image-based lighting, top to bottom: blue above, a warm horizon, warm ground bounce below. */
function skyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, 256)
  g.addColorStop(0, PALETTE.zenith)
  g.addColorStop(0.3, PALETTE.sky)
  g.addColorStop(0.44, PALETTE.lavender)
  g.addColorStop(0.5, PALETTE.horizon)
  g.addColorStop(0.56, '#d39a78')
  g.addColorStop(1, '#5a4334')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 4, 256)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/**
 * An Italian cypress crown, one unit tall: a flame that is full low down and tapers to a point, its surface pushed
 * out in lumps so it reads as foliage, dark at the base and lighter toward the sunlit top.
 */
function cypressCrown(phase: number): THREE.BufferGeometry {
  const profile: THREE.Vector2[] = []
  const rows = 16
  for (let i = 0; i <= rows; i++) {
    const t = i / rows
    const r = 0.17 * Math.pow(Math.sin(Math.PI * Math.min(1, 0.1 + t * 1.25)), 0.75) * (1 - 0.5 * t)
    profile.push(new THREE.Vector2(Math.max(0.004, r), t))
  }
  const g = new THREE.LatheGeometry(profile, 14)
  const pos = g.getAttribute('position')
  const colors = new Float32Array(pos.count * 3)
  const dark = new THREE.Color(0x1d3820)
  const light = new THREE.Color(0x6b9444)
  const c = new THREE.Color()
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const y = pos.getY(i)
    const z = pos.getZ(i)
    const a = Math.atan2(z, x)
    const lump = 1 + 0.16 * Math.sin(a * 5 + y * 23 + phase) + 0.1 * Math.sin(y * 51 + a * 3 + phase * 2)
    pos.setXYZ(i, x * lump, y, z * lump)
    c.copy(dark).lerp(light, Math.min(1, Math.max(0, y * 0.75 + (lump - 1) * 1.6)))
    colors.set([c.r, c.g, c.b], i * 3)
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  g.computeVertexNormals()
  return g
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
  // painted irregular flagstones (generated art, tools/textures/process.py), one tile every 6 m
  const half = (side: 0 | 1) => {
    const mat = paintedMaterial('floor', 1.1)
    mat.vertexColors = false
    for (const t of [mat.map, mat.normalMap, mat.roughnessMap]) t?.repeat.set((W * 2) / 6, L / 6)
    mat.color = new THREE.Color(0xffffff).lerp(new THREE.Color(TEAM_COLORS[side]), 0.06)
    const top = new THREE.Mesh(new THREE.PlaneGeometry(W * 2, L), mat)
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
  const leaves = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 })
  const bark = new THREE.MeshStandardMaterial({ color: 0x4a3a2a, roughness: 1 })
  const crowns = [0, 1, 2].map((k) => cypressCrown(k * 2.1))
  const cypress = (x: number, z: number, h: number) => {
    const tree = new THREE.Group()
    const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.25, 1.4, 6), bark)
    trunk.position.y = 0.7
    trunk.castShadow = true
    const crown = new THREE.Mesh(crowns[Math.floor(rnd() * crowns.length)], leaves)
    crown.position.y = 0.9
    const girth = h * (0.9 + rnd() * 0.3)
    crown.scale.set(girth, h, girth)
    crown.rotation.y = rnd() * Math.PI * 2
    crown.castShadow = true
    tree.add(trunk, crown)
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
    // drifting below the island's rim, so they read as broken-off ground rather than shapes in the sky
    rock.position.set(Math.cos(a) * r, -30 + rnd() * 24, Math.sin(a) * r)
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

/** A charged ultimate tints the whole sky for a moment; the effects drive these two values. */
export interface SkyFlash {
  tint: THREE.Color
  amount: { value: number }
}
export const skyFlashOf = (scene: THREE.Scene) => scene.userData.skyFlash as SkyFlash | undefined

/**
 * The dusk sky, drawn per pixel: deep blue overhead falling through lavender and peach to a golden band on the
 * horizon, a low sun with a wide warm glow, and a slow-drifting cloud layer lit gold on the sun's side and lilac away
 * from it. Below the horizon it melts into the haze the far props fade into.
 */
function skyMaterial(): { material: MeshBasicNodeMaterial; flash: SkyFlash } {
  const m = new MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false })
  const dir = normalize(positionLocal)
  const h = dir.y
  let sky = mix(color(PALETTE.horizon), color(PALETTE.peach), smoothstep(0, 0.07, h))
  sky = mix(sky, color(PALETTE.lavender), smoothstep(0.07, 0.2, h))
  sky = mix(sky, color(PALETTE.sky), smoothstep(0.2, 0.48, h))
  sky = mix(sky, color(PALETTE.zenith), smoothstep(0.48, 1, h))
  const toSun = max(dot(dir, vec3(SUN.x, SUN.y, SUN.z)), 0)
  sky = sky.add(color('#ff9d5c').mul(pow(toSun, 6).mul(0.5))).add(color('#ffe0b0').mul(pow(toSun, 60).mul(0.9)))
  // clouds: a noise layer seen in perspective overhead, thinning out toward the horizon so it never shimmers there
  const plane = dir.xz.div(h.add(0.18)).mul(1.1)
  const n = mx_fractal_noise_float(vec3(plane.x.add(time.mul(0.006)), plane.y, time.mul(0.004)), 4, 2, 0.5)
  const cover = smoothstep(0.08, 0.5, n).mul(smoothstep(0.02, 0.22, h))
  const lit = mix(color(PALETTE.cloudShade), color(PALETTE.cloudLit), pow(toSun, 1.5).mul(0.85).add(smoothstep(0.1, 0.45, n).mul(0.15)))
  sky = mix(sky, lit, cover.mul(0.9))
  // the sun's disc sits in front of the clouds' haze, hot enough to bloom
  sky = sky.add(color('#fff3d6').mul(smoothstep(0.9991, 0.9996, toSun).mul(6)))
  sky = mix(color(PALETTE.haze), sky, smoothstep(-0.06, 0.005, h))
  const tint = uniform(new THREE.Color())
  const amount = uniform(0)
  m.colorNode = mix(sky, tint.mul(float(0.7)), amount)
  return { material: m, flash: { tint: tint.value, amount } }
}

/** The dusk sky dome and the haze that blends the far props into it. */
export function atmosphere(scene: THREE.Scene) {
  const { material, flash } = skyMaterial()
  const dome = new THREE.Mesh(new THREE.SphereGeometry(380, 48, 24), material)
  dome.renderOrder = -1
  dome.frustumCulled = false
  scene.add(dome)
  scene.userData.skyFlash = flash
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
  sun.position.set(30, 28, -18)
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
