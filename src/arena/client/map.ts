import * as THREE from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { color, dot, float, max, mix, mx_fractal_noise_float, normalize, positionLocal, pow, smoothstep, time, uniform, vec3 } from 'three/tsl'
import { ENGINE } from '../engine/calibration.js'
import { paintedMaterial } from './ruins.js'
import { sceneryMaterial, surroundings } from './scenery.js'

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
  // the island: a meadow rim around the stage (painted grass, generated art); its craggy underside, the trees, the
  // colonnade, the rocks and the cloud sea come from the scenery models (scenery.ts)
  const rim = 14
  const lawnGeo = new THREE.PlaneGeometry(W * 2 + rim * 2, L * 2 + rim * 2)
  const lawnUv = lawnGeo.getAttribute('uv')
  // one tile of the painting every 5 m
  for (let i = 0; i < lawnUv.count; i++) lawnUv.setXY(i, (lawnUv.getX(i) * (W * 2 + rim * 2)) / 5, (lawnUv.getY(i) * (L * 2 + rim * 2)) / 5)
  const lawn = new THREE.Mesh(lawnGeo, sceneryMaterial('grass'))
  lawn.rotation.x = -Math.PI / 2
  lawn.position.y = -0.02
  lawn.receiveShadow = true
  group.add(lawn)

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

  // cypresses and olives on the rim, the outer colonnade, rocks, the underside, distant peaks and the cloud sea
  const around = surroundings(W, L, rim)
  group.add(around.group)
  proxies.push(...around.proxies)

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
