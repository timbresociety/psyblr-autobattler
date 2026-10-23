import * as THREE from 'three'
import { MeshBasicNodeMaterial } from 'three/webgpu'
import { color, float, length, mix, mx_fractal_noise_float, positionWorld, smoothstep, time, vec3 } from 'three/tsl'

/**
 * The arena's surroundings (R25), modelled in Blender (tools/blender/scenery.py) and painted from generated art:
 * Italian cypresses and gnarled olives with alpha leaf cards, sculpted rocks and grassy islets drifting below the
 * rim, a fluted Doric colonnade like the ruins', the island's craggy underside, distant rock spires and a slow cloud sea.
 * Everything is instanced (one draw call per mesh, however many trees), loads after the stage so Start never waits
 * on it, and stays outside the barrier, where nothing can be walked into.
 */

type Placement = { variant: number; matrix: THREE.Matrix4 }
type Gltf = { scene: THREE.Group }

let loader: Promise<(url: string) => Promise<Gltf>> | undefined

function gltf(): Promise<(url: string) => Promise<Gltf>> {
  loader ??= (async () => {
    const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([import('three/addons/loaders/GLTFLoader.js'), import('three/addons/libs/meshopt_decoder.module.js')])
    const l = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder)
    return (url: string) => l.loadAsync(url) as unknown as Promise<Gltf>
  })().catch((e: unknown) => {
    loader = undefined
    throw e
  })
  return loader
}

const files = new Map<string, Promise<Gltf>>()
function file(name: string): Promise<Gltf> {
  let f = files.get(name)
  if (!f) {
    f = gltf().then((load) => load(`/scenery/${name}.glb`))
    f.catch(() => files.delete(name))
    files.set(name, f)
  }
  return f
}

const textures = new THREE.TextureLoader()
const cache = new Map<string, THREE.Material>()

function tex(path: string, srgb: boolean, repeat = true): THREE.Texture {
  const t = textures.load(path)
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping
  t.anisotropy = 8
  if (srgb) t.colorSpace = THREE.SRGBColorSpace
  return t
}

/** The scenery's materials by the names the Blender meshes carry; painted sets tile in metres, as on the ruins. */
export function sceneryMaterial(name: string): THREE.Material {
  const hit = cache.get(name)
  if (hit) return hit
  let m: THREE.Material
  const painted = (set: string, normalScale = 1, tint = 0xffffff) =>
    new THREE.MeshStandardMaterial({
      map: tex(`/textures/${set}_albedo.webp`, true),
      normalMap: tex(`/textures/${set}_normal.webp`, false),
      roughnessMap: tex(`/textures/${set}_rough.webp`, false),
      normalScale: new THREE.Vector2(normalScale, normalScale),
      color: tint,
      roughness: 1,
    })
  switch (name) {
    case 'bark':
      m = painted('bark', 1.2)
      break
    case 'rock':
      m = painted('rock', 1.4)
      break
    case 'grass':
      m = painted('grass', 0.6)
      break
    case 'cliff':
      m = painted('cliff', 1.3)
      break
    case 'marble':
      m = painted('marble', 0.5)
      ;(m as THREE.MeshStandardMaterial).roughness = 0.8
      break
    case 'cypress':
    case 'olive': {
      // leaf cards light from both faces; a little of the leaves' own colour glows through, as sunlit leaves do, so
      // the cards turned from the sun never read as black
      const map = tex(`/textures/${name}_card.webp`, true, false)
      m = new THREE.MeshStandardMaterial({ map, alphaTest: 0.42, side: THREE.DoubleSide, roughness: 0.9, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.22 })
      break
    }
    case 'cypress_core':
      // the crown inside the cards: dense, deep green foliage (the meadow painting, darkened), so gaps between the
      // cards read as depth rather than sky
      m = painted('grass', 0.8, 0x2f4a2a)
      break
    default:
      m = new THREE.MeshStandardMaterial({ color: 0x8f8170, roughness: 1 })
  }
  cache.set(name, m)
  return m
}

/** Meshes of a scenery file grouped by variant: the number after the last underscore of each object's name. */
function variants(scene: THREE.Object3D): Map<number, THREE.Mesh[]> {
  const out = new Map<number, THREE.Mesh[]>()
  scene.updateMatrixWorld(true)
  for (const node of scene.children) {
    const m = /_(\d+)$/.exec(node.name)
    const v = m ? Number(m[1]) : 0
    node.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return
      if (!out.has(v)) out.set(v, [])
      out.get(v)!.push(o as THREE.Mesh)
    })
  }
  return out
}

/** Instance a file's variants at the placements: one InstancedMesh per mesh (and per material group). */
function instance(group: THREE.Group, meshes: Map<number, THREE.Mesh[]>, placements: Placement[], shadows: { cast: boolean; receive: boolean }) {
  for (const [variant, list] of meshes) {
    const mine = placements.filter((p) => p.variant === variant)
    if (!mine.length) continue
    for (const mesh of list) {
      const mats = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((m) => sceneryMaterial(m.name))
      const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)
      const inst = new THREE.InstancedMesh(geo, mats.length === 1 ? mats[0] : mats, mine.length)
      mine.forEach((p, i) => inst.setMatrixAt(i, p.matrix))
      inst.instanceMatrix.needsUpdate = true
      inst.castShadow = shadows.cast
      inst.receiveShadow = shadows.receive
      inst.computeBoundingSphere()
      group.add(inst)
    }
  }
}

const place = (x: number, y: number, z: number, rotY: number, s: number | THREE.Vector3, tilt = new THREE.Euler()) => {
  const scale = typeof s === 'number' ? new THREE.Vector3(s, s, s) : s
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt.x, rotY, tilt.z))
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, scale)
}

function seeded(seed: number) {
  let s = seed
  return () => ((s = (s * 16807) % 2147483647) / 2147483647)
}

export interface Surroundings {
  group: THREE.Group
  /** Boxes the cameras keep out of (trees and columns), known before the models load. */
  proxies: THREE.Box3[]
}

/**
 * Lay out the scenery round an arena of half-width `W` and half-length `L` (the lawn rim reaches `rim` beyond the
 * stage) and start loading it; the meshes appear in `group` as their files arrive.
 */
export function surroundings(W: number, L: number, rim: number): Surroundings {
  const group = new THREE.Group()
  group.name = 'surroundings'
  const proxies: THREE.Box3[] = []
  const rnd = seeded(11)

  // trees on the lawn rim, outside the barrier: mostly cypresses, with olives at the corners and between
  const cypresses: Placement[] = []
  const olives: Placement[] = []
  const tree = (x: number, z: number) => {
    const olive = rnd() < 0.28
    const yaw = rnd() * Math.PI * 2
    if (olive) {
      const s = 0.95 + rnd() * 0.5
      olives.push({ variant: Math.floor(rnd() * 2), matrix: place(x, 0, z, yaw, s) })
      proxies.push(new THREE.Box3(new THREE.Vector3(x - 2.6 * s, 0, z - 2.6 * s), new THREE.Vector3(x + 2.6 * s, 4.6 * s, z + 2.6 * s)))
    } else {
      const variant = Math.floor(rnd() * 3)
      const s = 0.9 + rnd() * 0.3
      const h = [9, 11.5, 13.5][variant] * s
      cypresses.push({ variant, matrix: place(x, 0, z, yaw, s) })
      proxies.push(new THREE.Box3(new THREE.Vector3(x - 1.3, 0, z - 1.3), new THREE.Vector3(x + 1.3, h, z + 1.3)))
    }
  }
  for (const side of [-1, 1]) {
    for (let k = 0; k < 7; k++) tree(side * (W + 4 + rnd() * 6), -L + (k / 6) * L * 2 + (rnd() - 0.5) * 4)
    for (let k = 0; k < 6; k++) tree(-W + (k / 5) * W * 2 + (rnd() - 0.5) * 5, side * (L + 4 + rnd() * 6))
  }

  // the outer colonnade at both ends, standing and broken, with drums fallen at their feet
  const columns: Placement[] = []
  for (const side of [-1, 1])
    for (let k = 0; k < 5; k++) {
      const x = -W * 0.8 + k * (W * 0.4) + (rnd() - 0.5) * 1.5
      const z = side * (L + 10)
      const v = rnd() < 0.45 ? 0 : rnd() < 0.6 ? 1 : 2
      columns.push({ variant: v, matrix: place(x, 0, z, Math.floor(rnd() * 4) * (Math.PI / 2), 1.05) })
      proxies.push(new THREE.Box3(new THREE.Vector3(x - 1.4, 0, z - 1.4), new THREE.Vector3(x + 1.4, v === 0 ? 10.5 : v === 1 ? 7.4 : 4.6, z + 1.4)))
      if (v !== 0 && rnd() < 0.8) columns.push({ variant: 3, matrix: place(x + (rnd() - 0.5) * 4, 0, z + side * (1.6 + rnd() * 1.5), rnd() * Math.PI, 1.05) })
    }

  // rocks: boulders along the lawn's edge, and islets drifting below the rim so the sky has depth
  const rocks: Placement[] = []
  for (let i = 0; i < 18; i++) {
    // on the meadow between the barrier and the island's edge, never on the stage (a rock there would read as cover)
    const out = 3 + rnd() * (rim - 5)
    const along = rnd() * 2 - 1
    const [ex, ez] = i % 2 ? [Math.sign(along || 1) * (W + out), along * (L + rim - 3)] : [along * (W + rim - 3), Math.sign(rnd() - 0.5 || 1) * (L + out)]
    rocks.push({ variant: Math.floor(rnd() * 3), matrix: place(ex, -0.2, ez, rnd() * 6.28, new THREE.Vector3(1.2 + rnd() * 1.4, 0.8 + rnd() * 0.9, 1.2 + rnd() * 1.4)) })
  }
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + rnd() * 0.3
    const r = 95 + rnd() * 90
    const islet = rnd() < 0.55
    const s = islet ? 5 + rnd() * 9 : 2.5 + rnd() * 5
    rocks.push({ variant: islet ? 3 + Math.floor(rnd() * 2) : Math.floor(rnd() * 3), matrix: place(Math.cos(a) * r, -26 + rnd() * 22, Math.sin(a) * r, rnd() * 6.28, s) })
  }

  const shade = { cast: true, receive: true }
  void file('cypress').then((g) => instance(group, variants(g.scene), cypresses, shade))
  void file('olive').then((g) => instance(group, variants(g.scene), olives, shade))
  void file('columns').then((g) => instance(group, variants(g.scene), columns, shade))
  void file('rocks').then((g) => instance(group, variants(g.scene), rocks, { cast: false, receive: true }))
  void file('underside').then((g) => instance(group, variants(g.scene), [{ variant: 0, matrix: new THREE.Matrix4().makeTranslation(0, -0.04, 0) }], { cast: false, receive: false }))
  void file('spires').then((g) => instance(group, variants(g.scene), [{ variant: 0, matrix: new THREE.Matrix4() }], { cast: false, receive: false }))

  group.add(cloudSea(-24, 0.011, 0.9), cloudSea(-36, 0.007, 0.7))
  return { group, proxies }
}

/**
 * A layer of the cloud sea below the island: drifting fractal noise, lit warm on top and lilac in its hollows,
 * thinning into the haze far out so it never shows an edge.
 */
function cloudSea(y: number, scale: number, opacity: number): THREE.Mesh {
  const m = new MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false })
  const p = positionWorld.xz.mul(scale)
  const n = mx_fractal_noise_float(vec3(p.x.add(time.mul(0.01)), p.y.add(time.mul(0.004)), time.mul(0.002).add(y)), 5, 2, 0.5)
  const density = smoothstep(-0.12, 0.38, n)
  const d = length(positionWorld.xz)
  const fade = smoothstep(370, 240, d).mul(smoothstep(30, 70, d))
  m.colorNode = mix(color('#8f7fae'), color('#ffe2c6'), smoothstep(-0.1, 0.45, n).mul(0.8).add(0.1))
  m.opacityNode = density.mul(fade).mul(float(opacity))
  const mesh = new THREE.Mesh(new THREE.CircleGeometry(380, 64).rotateX(-Math.PI / 2), m)
  mesh.position.y = y
  mesh.renderOrder = -0.5
  mesh.frustumCulled = false
  return mesh
}

/**
 * One of the sculpted rocks as plain geometry (in its own space, about a metre across), for scatter that is laid out
 * elsewhere, such as the rubble at the foot of the ruins.
 */
export async function rockGeometry(variant = 0): Promise<THREE.BufferGeometry | undefined> {
  const g = await file('rocks')
  let found: THREE.BufferGeometry | undefined
  g.scene.updateMatrixWorld(true)
  for (const node of g.scene.children) {
    if (node.name !== `rock_${variant}`) continue
    node.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh && !found) found = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld)
    })
  }
  return found
}
