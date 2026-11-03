import * as THREE from 'three'
import { MeshBasicNodeMaterial, type Node } from 'three/webgpu'
import { cameraPosition, color, dot, exp, float, fog, max, mix, mx_fractal_noise_float, normalize, positionLocal, positionView, positionWorld, pow, reference, smoothstep, time, uniform, vec3 } from 'three/tsl'
import { CSMShadowNode } from 'three/addons/csm/CSMShadowNode.js'
import { ENGINE } from '../engine/calibration.js'
import { OCCLUDED_LAYER } from './occlusion.js'

/**
 * The light over the arena (R25; Forge goal, phase 2 look pass): golden hour after the owner's reference sheet. A low
 * sun ahead of the opening camera throws long shadows across the courtyard, the sky pales to gold under it and stays
 * cool opposite, and a haze the colour of the sky behind it fades the far ridges.
 */

/** The look in one place, so a later art pass tunes numbers instead of hunting through code. */
export const PALETTE = {
  zenith: '#2f548f',
  sky: '#6b95cc',
  /** The horizon turned from the sun is pale and cool, toward it gold. */
  horizonCool: '#adbfd4',
  horizonWarm: '#f0c07f',
  lowCool: '#91afd3',
  lowWarm: '#e5b07a',
  /** The haze below the horizon, where the far ground fades out. */
  haze: 0xc9b89c,
  cloudShade: '#8a87a3',
  cloudLit: '#ffdcae',
  line: 0xfff3d6,
} as const

/** Where the low sun sits: ahead and to the right of the opening camera, about 16 degrees up, so shadows run long toward the viewer. */
export const SUN = new THREE.Vector3(-0.47, 0.276, 0.84).normalize()

/** How far the sky dome reaches, and how far the cameras must see to draw it and the mountains in front of it. */
export const SKY_RADIUS = 1500
export const VIEW_FAR = 2000

/** The sky's light for image-based lighting, top to bottom: blue above, a warm horizon, warm ground bounce below. */
function skyTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas')
  canvas.width = 4
  canvas.height = 256
  const ctx = canvas.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, 256)
  g.addColorStop(0, PALETTE.zenith)
  g.addColorStop(0.3, PALETTE.sky)
  g.addColorStop(0.45, PALETTE.lowCool)
  g.addColorStop(0.5, PALETTE.horizonWarm)
  g.addColorStop(0.56, '#b79d7c')
  g.addColorStop(1, '#5f4a36')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, 4, 256)
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  return texture
}

/** A charged ultimate tints the whole sky for a moment; the effects drive these two values. */
export interface SkyFlash {
  tint: THREE.Color
  amount: { value: number }
}
export const skyFlashOf = (scene: THREE.Scene) => scene.userData.skyFlash as SkyFlash | undefined

/** The sky just above the horizon along `dir`: gold toward the sun, pale and cool away from it. */
function horizonAt(dir: Node<'vec3'>) {
  const toSun = dot(dir, vec3(SUN.x, SUN.y, SUN.z))
  const warm = smoothstep(-0.25, 0.95, toSun)
  return mix(color(PALETTE.horizonCool), color(PALETTE.horizonWarm), warm).add(color('#ffb36b').mul(pow(max(toSun, 0), 10).mul(0.25)))
}

/** The clear sky along `dir` (a unit vector at or above the horizon), with the sun's glow but no clouds: what still water mirrors. */
export function skyAt(dir: Node<'vec3'>) {
  const h = dir.y
  const toSun = max(dot(dir, vec3(SUN.x, SUN.y, SUN.z)), 0)
  const warm = smoothstep(-0.25, 0.95, dot(dir, vec3(SUN.x, SUN.y, SUN.z)))
  let sky = mix(horizonAt(dir), mix(color(PALETTE.lowCool), color(PALETTE.lowWarm), warm), smoothstep(0, 0.12, h))
  sky = mix(sky, color(PALETTE.sky), smoothstep(0.1, 0.42, h))
  sky = mix(sky, color(PALETTE.zenith), smoothstep(0.42, 1, h))
  return sky.add(color('#ff9a50').mul(pow(toSun, 8).mul(0.28))).add(color('#fff0c8').mul(pow(toSun, 90).mul(0.85)))
}

/**
 * The golden-hour sky, drawn per pixel: blue overhead, paling toward a horizon that turns gold under the low sun and
 * stays cool opposite it, a wide warm glow round the sun, and a slow-drifting cloud layer lit gold on the sun's side.
 * Below the horizon it melts into the haze the far land fades into.
 */
function skyMaterial(tint: Node<'color'>, amount: Node<'float'>): MeshBasicNodeMaterial {
  const m = new MeshBasicNodeMaterial({ side: THREE.BackSide, depthWrite: false, fog: false })
  const dir = normalize(positionLocal)
  const h = dir.y
  const toSun = max(dot(dir, vec3(SUN.x, SUN.y, SUN.z)), 0)
  let sky = skyAt(dir)
  // clouds: a noise layer seen in perspective overhead, thinning out toward the horizon so it never shimmers there
  const plane = dir.xz.div(h.add(0.16)).mul(1.1)
  const n = mx_fractal_noise_float(vec3(plane.x.add(time.mul(0.006)), plane.y, time.mul(0.004)), 4, 2, 0.5)
  const cover = smoothstep(0.12, 0.55, n).mul(smoothstep(0.015, 0.2, h))
  const lit = mix(color(PALETTE.cloudShade), color(PALETTE.cloudLit), pow(toSun, 1.5).mul(0.8).add(smoothstep(0.1, 0.45, n).mul(0.2)))
  sky = mix(sky, lit.add(color('#ffcf8a').mul(pow(toSun, 12).mul(0.8))), cover.mul(0.85))
  // the sun's disc sits in front of the clouds, hot enough to bloom
  sky = sky.add(color('#fff3d6').mul(smoothstep(0.9993, 0.9997, toSun).mul(7)))
  sky = mix(color(PALETTE.haze), sky, smoothstep(-0.05, 0.004, h))
  m.colorNode = mix(sky, tint.mul(float(0.7)), amount)
  return m
}

/** The sky dome, the light it gives every material, and the haze that blends the far land into it. */
/**
 * Inside the Game Centre hall (hall.ts) there is no sky: the ceiling's neutral fluorescent panels light everything
 * (GAME.md §1: 4500–5000 K overhead, neutral contrast), porcelain above and carpet below fill the shadows, and a light
 * neutral haze softens the far end of a 150 m room.
 */
export const INDOOR = {
  key: 0xfff1e2,
  keyIntensity: 3.4,
  /** The panels are overhead, a little toward one corner so shapes still model. */
  from: new THREE.Vector3(-0.28, 0.92, 0.27).normalize(),
  above: 0xf2ece2,
  below: 0x8a6b62,
  fill: 1.15,
  haze: 0xd8d1c4,
  ceiling: 0x30383f,
} as const

export function atmosphere(scene: THREE.Scene, indoor = false) {
  if (indoor) {
    scene.background = new THREE.Color(INDOOR.ceiling)
    const canvas = document.createElement('canvas')
    canvas.width = 4
    canvas.height = 64
    const ctx = canvas.getContext('2d')!
    const g = ctx.createLinearGradient(0, 0, 0, 64)
    g.addColorStop(0, '#f6f2ea')
    g.addColorStop(0.5, '#d9d2c4')
    g.addColorStop(1, '#6e4d4f')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, 4, 64)
    const env = new THREE.CanvasTexture(canvas)
    env.colorSpace = THREE.SRGBColorSpace
    env.mapping = THREE.EquirectangularReflectionMapping
    scene.environment = env
    scene.environmentIntensity = 0.45
    scene.fog = new THREE.Fog(INDOOR.haze, 140, 900)
    return
  }
  const tint = uniform(new THREE.Color())
  const amount = uniform(0)
  const dome = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 48, 24), skyMaterial(tint, amount))
  dome.name = 'sky'
  dome.renderOrder = -1
  dome.frustumCulled = false
  scene.add(dome)
  scene.userData.skyFlash = { tint: tint.value, amount } satisfies SkyFlash
  scene.background = new THREE.Color(PALETTE.horizonWarm)
  // the sky lights every material too, so stone picks up warm horizon light and a cool fill from above
  const env = skyTexture()
  env.mapping = THREE.EquirectangularReflectionMapping
  scene.environment = env
  scene.environmentIntensity = 0.5
  // aerial perspective: nothing in the courtyard hazes, the far ridges fade toward the colour of the sky behind them.
  // `near` is where the haze starts and `far - near` how quickly it thickens; the Fog holds them, so a caller can push
  // them out for a wider camera
  const haze = new THREE.Fog(PALETTE.haze, 260, 2600)
  scene.fog = haze
  const near = reference('near', 'float', haze)
  const far = reference('far', 'float', haze)
  const dir = normalize(positionWorld.sub(cameraPosition))
  const amountAt = float(1).sub(exp(max(positionView.length().sub(near), 0).div(far.sub(near)).negate())).mul(0.85)
  scene.fogNode = fog(mix(horizonAt(dir), tint.mul(float(0.7)), amount), amountAt)
}

/** The sky's fill: blue from above, warm bounce from the ground, and a soft warm bounce from the camera's side. */
export const FILL = {
  sky: 0xa9c2e6,
  ground: 0x8a6a48,
  hemisphere: 0.85,
  bounce: 0xffdcb8,
  bounceIntensity: 0.7,
  /** Toward the bounce: behind the sun, from about 35 degrees up. */
  bounceFrom: new THREE.Vector3(-SUN.x * 100, 70, -SUN.z * 100).normalize(),
} as const

/** Lambert's cosine, band by band, for turning irradiance into the radiance a probe holds. */
const BAND = [Math.PI, (2 * Math.PI) / 3, (2 * Math.PI) / 3, (2 * Math.PI) / 3, Math.PI / 4, Math.PI / 4, Math.PI / 4, Math.PI / 4, Math.PI / 4]

/**
 * The sky's fill baked into one light probe (GAME.md §10: one shadowed key light, everything else baked): the light a
 * surface facing `n` gets from the sky dome and the ground below it, plus the unshadowed bounce, projected onto nine
 * spherical harmonics. It lights the same as a hemisphere light and a second directional did, for none of their cost.
 */
export function skyProbe(): THREE.LightProbe {
  const sky = new THREE.Color(FILL.sky).multiplyScalar(FILL.hemisphere)
  const ground = new THREE.Color(FILL.ground).multiplyScalar(FILL.hemisphere)
  const bounce = new THREE.Color(FILL.bounce).multiplyScalar(FILL.bounceIntensity)
  const sh = new THREE.SphericalHarmonics3()
  const basis: number[] = []
  const n = new THREE.Vector3()
  const at = new THREE.Color()
  const e = new THREE.Vector3()
  // directions spread evenly over the sphere (a Fibonacci spiral), each standing for an equal share of it
  const N = 4096
  for (let i = 0; i < N; i++) {
    const y = 1 - (2 * (i + 0.5)) / N
    const r = Math.sqrt(1 - y * y)
    const a = i * Math.PI * (3 - Math.sqrt(5))
    n.set(Math.cos(a) * r, y, Math.sin(a) * r)
    at.copy(ground).lerp(sky, 0.5 * y + 0.5)
    e.set(at.r, at.g, at.b).addScaledVector(new THREE.Vector3(bounce.r, bounce.g, bounce.b), Math.max(0, n.dot(FILL.bounceFrom)))
    THREE.SphericalHarmonics3.getBasisAt(n, basis)
    for (let k = 0; k < 9; k++) sh.coefficients[k].addScaledVector(e, (basis[k] * 4 * Math.PI) / N / BAND[k])
  }
  return new THREE.LightProbe(sh, 1)
}

/** A warm key light from the low sun, and the sky's fill in a probe. */
export function lights(scene: THREE.Scene, indoor?: { halfWidth: number; halfLength: number }) {
  if (indoor) {
    const { halfWidth: W, halfLength: L } = indoor
    scene.add(new THREE.HemisphereLight(INDOOR.above, INDOOR.below, INDOOR.fill))
    const key = new THREE.DirectionalLight(INDOOR.key, INDOOR.keyIntensity)
    key.position.copy(INDOOR.from).multiplyScalar(200)
    key.castShadow = true
    key.shadow.mapSize.set(2048, 2048)
    key.shadow.bias = -0.0005
    key.shadow.normalBias = 0.05
    fitShadow(key, new THREE.Box3(new THREE.Vector3(-W - 4, 0, -L - 4), new THREE.Vector3(W + 4, 22, L + 4)))
    scene.add(key)
    return key
  }
  const { halfWidth: W, halfLength: L } = ENGINE.arena
  scene.add(skyProbe())
  const sun = new THREE.DirectionalLight(0xffc68e, 4.4)
  sun.position.copy(SUN).multiplyScalar(200)
  sun.castShadow = true
  sun.shadow.mapSize.set(2048, 2048)
  // a sun this low grazes the paving: a firmer push along the normal keeps acne off it
  sun.shadow.bias = -0.0005
  sun.shadow.normalBias = 0.05
  fitShadow(sun, new THREE.Box3(new THREE.Vector3(-W - 14, 0, -L - 14), new THREE.Vector3(W + 14, 14, L + 14)))
  scene.add(sun)
  return sun
}

/**
 * The sun's shadow in cascades (GAME.md §10: one shadowed key light, in cascades): fine texels at the camera's feet,
 * coarser out to the valley, so a hero's shadow stays crisp up close and the ruins still throw theirs far off. A
 * cascade node is bound to the renderer it first draws with, so a new renderer needs a new one.
 */
// two cascades: a hero near the camera is drawn into each one its shadow might reach, so a third cost every near hero
// another shadow draw for shadows a few pixels across. The margin reaches back toward the sun far enough for the
// house's tallest piece (about 10 m) to throw its long low-sun shadow into the near cascade.
export const CASCADES = { count: 2, maxFar: 160, lightMargin: 40 } as const

export function cascade(sun: THREE.DirectionalLight): void {
  // a hero hidden from the camera still casts its shadow (occlusion.ts); the cascades copy this camera's layers
  sun.shadow.camera.layers.enable(OCCLUDED_LAYER)
  const node = new CSMShadowNode(sun, { cascades: CASCADES.count, maxFar: CASCADES.maxFar, mode: 'practical', lightMargin: CASCADES.lightMargin })
  node.fade = true
  ;(sun.shadow as THREE.LightShadow & { shadowNode?: unknown }).shadowNode = node
}

/** Every shadow map the sun draws: its cascades' once they're built, else its own. */
export function sunShadows(sun: THREE.DirectionalLight): THREE.LightShadow[] {
  const node = (sun.shadow as THREE.LightShadow & { shadowNode?: { lights?: { shadow: THREE.LightShadow }[] } }).shadowNode
  return node?.lights?.length ? node.lights.map((l) => l.shadow) : [sun.shadow]
}

/**
 * Fit the sun's shadow camera to `box` as the sun sees it, so the long golden-hour shadows of everything in the
 * courtyard land in the map at the finest texels it can give them.
 */
function fitShadow(sun: THREE.DirectionalLight, box: THREE.Box3) {
  const view = new THREE.OrthographicCamera()
  view.position.copy(sun.position)
  view.lookAt(sun.target.position)
  view.updateMatrixWorld()
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity)
  const hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
  const corner = new THREE.Vector3()
  for (let i = 0; i < 8; i++) {
    corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(view.matrixWorldInverse)
    lo.min(corner)
    hi.max(corner)
  }
  // anything between the sun and the box still casts into it, so the near plane reaches back toward the sun
  Object.assign(sun.shadow.camera, { left: lo.x, right: hi.x, bottom: lo.y, top: hi.y, near: Math.max(1, -hi.z - 60), far: -lo.z + 1 })
  sun.shadow.camera.updateProjectionMatrix()
}
