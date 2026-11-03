import * as THREE from 'three'
import { MeshoptSimplifier } from 'meshoptimizer'

/**
 * Character levels of detail (GAME.md §10). A hero's tier comes from its distance to the camera: near heroes are
 * drawn whole and posed every frame, mid ones on simplified meshes posed every other frame, far ones on rough meshes
 * posed every fourth frame and casting no shadow, and beyond that a team-coloured card stands in. At most `nearCap`
 * heroes are near at once, the closest; the rest drop to mid.
 *
 * The simplified meshes keep the hero's own vertices, skin weights and face shapes and only drop triangles, so a tier
 * change swaps an index buffer and nothing else.
 */
export type Tier = 'near' | 'mid' | 'far' | 'impostor'

export const LOD = {
  /** Within this, a near hero is drawn with everything: inside its mouth, the shine on its eyes, its gear's shadow. */
  close: 6,
  /** Where each tier ends, in metres from the camera. */
  near: 15,
  mid: 40,
  far: 120,
  /** How far past a boundary a hero goes before it changes tier back, so one standing on the line doesn't flicker. */
  margin: 2,
  nearCap: 10,
  /** Triangles a whole hero is drawn with in each tier, its gear included. */
  triangles: { mid: 8000, far: 2000 },
} as const

/** Frames between poses: 60 Hz, 30 Hz, 15 Hz, none. */
export const POSE_EVERY: Record<Tier, number> = { near: 1, mid: 2, far: 4, impostor: 0 }

const ORDER: readonly Tier[] = ['near', 'mid', 'far', 'impostor']
const ENDS = [LOD.near, LOD.mid, LOD.far, Infinity]

/** The tier at `distance`, held at `previous` until the hero is `LOD.margin` past the line it would cross outward. */
export function tierAt(distance: number, previous?: Tier): Tier {
  let k = ENDS.findIndex((end) => distance <= end)
  if (previous && k > ORDER.indexOf(previous) && distance <= ENDS[k - 1] + LOD.margin) k -= 1
  return ORDER[k]
}

/** Every hero's tier from its distance to the camera; past `cap` near heroes, the farther ones are drawn mid. */
export function tiersFor(distances: readonly number[], previous: readonly (Tier | undefined)[] = [], cap: number = LOD.nearCap): Tier[] {
  const tiers = distances.map((d, i) => tierAt(d, previous[i]))
  const near = tiers.flatMap((t, i) => (t === 'near' ? [i] : [])).sort((a, b) => distances[a] - distances[b] || a - b)
  for (const i of near.slice(cap)) tiers[i] = 'mid'
  return tiers
}

/**
 * Parts too small to read at each tier: inside the mouth, the corneas and the brow and lash cards past arm's length,
 * the eyes when far.
 */
const HIDDEN: Record<Tier, RegExp> = {
  near: /^(teeth:|tongue|cornea|head:cards)/,
  mid: /^(teeth:|tongue|cornea|head:cards)/,
  far: /^(teeth:|tongue|cornea|sclera|head:cards)/,
  impostor: /./,
}
/** The eyeballs a near hero shows past arm's length: a few pixels across, a quarter of the triangles. */
const EYES = /^sclera/
const EYE_RATIO = 0.25

/** A mesh this small (gear, mostly) is drawn whole in every tier: simplifying it saves nothing and spoils its outline. */
const SMALL = 1000

const triangles = (geometry: THREE.BufferGeometry) => (geometry.index ? geometry.index.count : (geometry.attributes.position?.count ?? 0)) / 3

/**
 * `geometry` with about `ratio` of its triangles, sharing its vertex attributes and face shapes; each draw group is
 * simplified on its own so materials keep their parts. Needs `MeshoptSimplifier.ready`.
 */
export function simplified(geometry: THREE.BufferGeometry, ratio: number): THREE.BufferGeometry {
  const position = geometry.attributes.position as THREE.BufferAttribute | THREE.InterleavedBufferAttribute
  const positions =
    position instanceof THREE.BufferAttribute && position.array instanceof Float32Array && position.itemSize === 3
      ? position.array
      : Float32Array.from({ length: position.count * 3 }, (_v, k) => position.getComponent(Math.floor(k / 3), k % 3))
  const source = geometry.index ? geometry.index.array : Uint32Array.from({ length: position.count }, (_v, k) => k)
  const groups = geometry.groups.length ? geometry.groups : [{ start: 0, count: source.length, materialIndex: 0 }]
  const parts: Uint32Array[] = []
  const out = new THREE.BufferGeometry()
  let at = 0
  for (const g of groups) {
    const indices = Uint32Array.from(source.subarray(g.start, Math.min(source.length, g.start + g.count)))
    const target = Math.max(3, Math.floor((indices.length * ratio) / 3) * 3)
    // the triangle count is what's budgeted, so the error allowed is generous: the shape is what reads at range
    const [kept] = indices.length / 3 < 64 ? [indices] : MeshoptSimplifier.simplify(indices, positions, 3, target, 0.5, ['Sparse'])
    parts.push(kept)
    out.addGroup(at, kept.length, g.materialIndex)
    at += kept.length
  }
  const index = new Uint32Array(at)
  let k = 0
  for (const p of parts) index.set(p, (k += p.length) - p.length)
  for (const [name, attribute] of Object.entries(geometry.attributes)) out.setAttribute(name, attribute)
  out.morphAttributes = geometry.morphAttributes
  out.morphTargetsRelative = geometry.morphTargetsRelative
  out.setIndex(new THREE.BufferAttribute(index, 1))
  if (!geometry.boundingSphere) geometry.computeBoundingSphere()
  out.boundingSphere = geometry.boundingSphere!.clone()
  if (geometry.boundingBox) out.boundingBox = geometry.boundingBox.clone()
  out.name = `${geometry.name}:lod`
  return out
}

interface Part {
  mesh: THREE.Mesh
  geometry: THREE.BufferGeometry
  castShadow: boolean
  visible: boolean
}

/** The simplified meshes, per source geometry and tier: a geometry shared by several heroes is simplified once. */
const made = new WeakMap<THREE.BufferGeometry, Map<string, THREE.BufferGeometry>>()

/**
 * One hero's levels of detail, over every mesh under its root (its transformed form too). `apply` swaps each mesh to
 * its tier: the whole mesh near, simplified ones further out, its small parts hidden, its shadow off when far, and
 * every mesh hidden for an impostor. Meshes that turn up later (a form loaded after) are taken in on the next change.
 */
export class HeroLod {
  private readonly parts = new Map<THREE.Mesh, Part>()
  tier: Tier = 'near'
  close = true

  constructor(readonly root: THREE.Object3D) {}

  private take() {
    this.root.traverse((o) => {
      const mesh = o as THREE.Mesh
      if (mesh.isMesh && !this.parts.has(mesh)) this.parts.set(mesh, { mesh, geometry: mesh.geometry, castShadow: mesh.castShadow, visible: mesh.visible })
    })
  }

  /** How much of each simplifiable mesh a tier keeps, so the hero comes to about its tier's triangle budget. */
  private ratio(tier: 'mid' | 'far'): number {
    let small = 0
    let big = 0
    for (const p of this.parts.values()) {
      if (HIDDEN[tier].test(p.mesh.name)) continue
      const n = triangles(p.geometry)
      if (n < SMALL) small += n
      else big += n
    }
    return big ? Math.min(1, Math.max(0.02, (LOD.triangles[tier] - small) / big)) : 1
  }

  /**
   * Simplify every mesh for the mid and far tiers now, while loading, rather than in the frame a hero first walks off;
   * and let the hero be culled.
   */
  prepare() {
    this.take()
    cullable(this.root)
    for (const p of this.parts.values()) if (EYES.test(p.mesh.name)) this.lod(p.geometry, 'near', EYE_RATIO)
    for (const tier of ['mid', 'far'] as const) {
      const ratio = this.ratio(tier)
      for (const p of this.parts.values()) if (!HIDDEN[tier].test(p.mesh.name) && triangles(p.geometry) >= SMALL) this.lod(p.geometry, tier, ratio)
    }
  }

  private lod(geometry: THREE.BufferGeometry, tier: 'near' | 'mid' | 'far', ratio: number): THREE.BufferGeometry {
    let byTier = made.get(geometry)
    if (!byTier) made.set(geometry, (byTier = new Map()))
    let g = byTier.get(tier)
    if (!g) byTier.set(tier, (g = simplified(geometry, ratio)))
    return g
  }

  /** Draw the hero at `tier`; `close` (within `LOD.close`) draws a near hero with everything it has. */
  apply(tier: Tier, close = false) {
    close = close && tier === 'near'
    if (tier === this.tier && close === this.close) return
    this.tier = tier
    this.close = close
    this.take()
    const ratio = tier === 'mid' || tier === 'far' ? this.ratio(tier) : 1
    for (const p of this.parts.values()) {
      const m = p.mesh
      const small = triangles(p.geometry) < SMALL
      if (close) {
        m.geometry = p.geometry
        m.visible = p.visible
        m.castShadow = p.castShadow
        continue
      }
      m.visible = p.visible && !HIDDEN[tier].test(m.name)
      if (tier === 'impostor') continue
      if (tier === 'near') m.geometry = EYES.test(m.name) ? this.lod(p.geometry, 'near', EYE_RATIO) : p.geometry
      else m.geometry = small ? p.geometry : this.lod(p.geometry, tier, ratio)
      // a hat's or a staff's shadow is a few pixels past arm's length; the body's carries the silhouette
      m.castShadow = p.castShadow && tier !== 'far' && !small
    }
  }

  /** Triangles drawn now, for the budget check. */
  drawn(): number {
    this.take()
    let n = 0
    for (const p of this.parts.values()) if (p.mesh.visible) n += triangles(p.mesh.geometry)
    return n
  }
}

/** Loads the simplifier; every `HeroLod` needs it before `prepare` or `apply`. */
export const lodReady = (): Promise<void> => MeshoptSimplifier.ready

/** A card per team that stands in for a hero beyond the far tier: a dark silhouette rimmed in the team's colour. */
export function impostorMaterial(team: THREE.Color): THREE.SpriteMaterial {
  const material = new THREE.SpriteMaterial({ color: 0xffffff, transparent: true, depthWrite: false, fog: true })
  if (typeof document === 'undefined') return material
  const c = document.createElement('canvas')
  c.width = 32
  c.height = 64
  const g = c.getContext('2d')
  if (!g) return material
  const silhouette = () => {
    g.beginPath()
    g.arc(16, 10, 7, 0, Math.PI * 2)
    g.moveTo(5, 62)
    g.lineTo(7, 22)
    g.quadraticCurveTo(16, 17, 25, 22)
    g.lineTo(27, 62)
    g.closePath()
  }
  g.fillStyle = `#${team.getHexString()}`
  silhouette()
  g.fill()
  g.lineWidth = 3
  g.strokeStyle = 'rgba(10, 10, 16, 0.85)'
  silhouette()
  g.stroke()
  const map = new THREE.CanvasTexture(c)
  map.colorSpace = THREE.SRGBColorSpace
  material.map = map
  return material
}

/** How much bigger than its body at rest a hero's culling sphere is, for the reach of a swing, a flip or lying prone. */
export const CULL_REACH = 1.5

/**
 * Let a hero's skinned meshes be culled, in the main view and in each shadow cascade, instead of drawn wherever they
 * are. A skinned mesh's bounds move with its pose, so every one of them takes the body's sphere at rest, grown by
 * `CULL_REACH`: generous enough for anything the body does, and the head is never culled apart from the body.
 */
export function cullable(root: THREE.Object3D) {
  const skinned: THREE.SkinnedMesh[] = []
  root.traverse((o) => {
    if ((o as THREE.SkinnedMesh).isSkinnedMesh && !o.frustumCulled) skinned.push(o as THREE.SkinnedMesh)
  })
  // per body: a transformed form is a body of its own, under its own parent
  for (const parent of new Set(skinned.map((m) => m.parent))) {
    const meshes = skinned.filter((m) => m.parent === parent)
    const body = meshes.find((m) => m.name === 'hero') ?? meshes.reduce((a, b) => (triangles(b.geometry) > triangles(a.geometry) ? b : a))
    if (!body.geometry.boundingSphere) body.geometry.computeBoundingSphere()
    const sphere = body.geometry.boundingSphere!.clone()
    sphere.radius *= CULL_REACH
    for (const m of meshes) {
      m.boundingSphere = sphere.clone()
      m.frustumCulled = true
    }
  }
}
