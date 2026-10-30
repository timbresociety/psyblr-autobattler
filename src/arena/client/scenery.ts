import * as THREE from 'three'

/**
 * Scenery models (R25), made in Blender (tools/blender/scenery.py) and painted from generated art: sculpted rocks and
 * their materials, instanced so a field of boulders costs one draw call per mesh, loading after the stage so Start
 * never waits on them. The valley round the arena (valley.ts) places them.
 */

export type Placement = { variant: number; matrix: THREE.Matrix4 }
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

export const place = (x: number, y: number, z: number, rotY: number, s: number | THREE.Vector3, tilt = new THREE.Euler()) => {
  const scale = typeof s === 'number' ? new THREE.Vector3(s, s, s) : s
  const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt.x, rotY, tilt.z))
  return new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, scale)
}

export function seeded(seed: number) {
  let s = seed
  return () => ((s = (s * 16807) % 2147483647) / 2147483647)
}

/**
 * Instance a scenery file's variants at `placements` into `group`, once the file loads: one draw call per mesh,
 * however many copies.
 */
export function placeModels(group: THREE.Group, name: string, placements: Placement[], shadows: { cast: boolean; receive: boolean }) {
  if (placements.length) void file(name).then((g) => instance(group, variants(g.scene), placements, shadows))
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
