import * as THREE from 'three'

/**
 * The House of Instinct dressed and lit in Blender (tools/blender/house.py, docs/ENGINE.md): bevelled pieces in the
 * arcade's materials, with the hall's fill light and every bounce baked into a lightmap. The key light stays live — it
 * is the only light these materials take from the scene, so its shadows and highlights move with the heroes, and the
 * fill isn't counted twice. The engine's pieces still do the colliding; this only draws them.
 */
export const BAKED_HOUSE = {
  glb: '/maps/house/house.glb',
  lightmap: '/maps/house/lightmap.ktx2',
  /** house.py stores irradiance over this, sRGB-encoded; three's lightmaps are irradiance times pi. */
  max: 1,
} as const

/** `?bake=0` (on any page; the tab remembers it, `?bake=1` undoes it) draws the painted grey boxes instead, to compare. */
export function bakedWanted(): boolean {
  if (typeof window === 'undefined') return true
  const asked = new URLSearchParams(window.location.search).get('bake')
  try {
    if (asked !== null) sessionStorage.setItem('bake', asked)
    return (asked ?? sessionStorage.getItem('bake')) !== '0'
  } catch {
    return asked !== '0'
  }
}

/** Meshopt geometry and a KTX2 lightmap (tools/blender/house-pack.ts); `renderer` picks the GPU's texture format. */
export async function loadBakedHouse(key: THREE.DirectionalLight, renderer: unknown): Promise<THREE.Object3D | undefined> {
  if (!bakedWanted()) return undefined
  try {
    const [{ GLTFLoader }, { KTX2Loader }, { MeshoptDecoder }, { MeshStandardNodeMaterial }, { lights }] = await Promise.all([
      import('three/addons/loaders/GLTFLoader.js'),
      import('three/addons/loaders/KTX2Loader.js'),
      import('three/addons/libs/meshopt_decoder.module.js'),
      import('three/webgpu'),
      import('three/tsl'),
    ])
    const ktx2 = new KTX2Loader().setTranscoderPath('/decoders/basis/')
    ;(ktx2 as unknown as { detectSupport: (r: unknown) => void }).detectSupport(renderer)
    const [gltf, lightmap] = await Promise.all([new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(BAKED_HOUSE.glb), ktx2.loadAsync(BAKED_HOUSE.lightmap)])
    ktx2.dispose()
    lightmap.colorSpace = THREE.SRGBColorSpace
    lightmap.channel = 0
    const only = lights([key])
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (!mesh.isMesh) return
      mesh.castShadow = mesh.receiveShadow = true
      const from = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]) as THREE.MeshStandardMaterial[]
      const made = from.map((m) => {
        const n = new MeshStandardNodeMaterial({ color: m.color, roughness: m.roughness, metalness: m.metalness, emissive: m.emissive, emissiveIntensity: m.emissiveIntensity })
        n.name = m.name
        n.lightMap = lightmap
        n.lightMapIntensity = Math.PI * BAKED_HOUSE.max
        n.lightsNode = only
        m.dispose()
        return n
      })
      mesh.material = Array.isArray(mesh.material) ? made : made[0]
    })
    gltf.scene.name = 'baked house'
    return gltf.scene
  } catch {
    // not built yet, or failed to load: the painted grey boxes stand in
    return undefined
  }
}
