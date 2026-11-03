import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { ceilingOver, coverHit, floorUnder, initialCoverHealth, surfaceAt, type CoverHealth, type CoverPiece, type MapLine } from '../engine/cover.js'
import type { RuinsView } from './ruins.js'

/**
 * The House of Instinct in grey boxes on screen (GAME.md §8, first deliverable: "tested ... before any art"), built
 * from the engine's own pieces and lines so what is drawn is what blocks. Each band has its own grey, tops are lighter
 * than sides with a metre grid to judge jumps by, and arcade yellow marks traversal (§1, §7 rule 4): the rims of chips
 * and candlesticks, the edges of decks and walkways, the sides of ramps, and the ziplines and rails. Everything that
 * cannot break is merged into a few meshes; breakable barricades, glass and card bridges stay separate so they can
 * wear and burst.
 */

const YELLOW = new THREE.Color(0xffc820)
/** Greys by height of a piece's top: the lower routes darkest, the aerial routes lightest. */
function grey(top: number): THREE.Color {
  const k = top < 3 ? 0.34 : top < 8 ? 0.5 : top < 14 ? 0.62 : 0.72
  return new THREE.Color(k, k, k * 1.04)
}

/** Colour every face: tops lighter than sides. */
function shade(geo: THREE.BufferGeometry, base: THREE.Color): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo
  g.computeVertexNormals()
  const n = g.getAttribute('normal')
  const colors = new Float32Array(n.count * 3)
  const top = base.clone().multiplyScalar(1.25)
  const side = base.clone().multiplyScalar(0.85)
  for (let i = 0; i < n.count; i++) {
    const c = n.getY(i) > 0.5 ? top : n.getY(i) < -0.5 ? base.clone().multiplyScalar(0.6) : side
    colors.set([c.r, c.g, c.b], i * 3)
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return worldUV(g)
}

/** UVs in metres, projected along each face's main axis, so the grid keeps one scale everywhere. */
function worldUV(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const p = g.getAttribute('position')
  const n = g.getAttribute('normal')
  const uv = new Float32Array(p.count * 2)
  for (let i = 0; i < p.count; i++) {
    const [ax, ay, az] = [Math.abs(n.getX(i)), Math.abs(n.getY(i)), Math.abs(n.getZ(i))]
    const [u, v] = ay >= ax && ay >= az ? [p.getX(i), p.getZ(i)] : ax >= az ? [p.getZ(i), p.getY(i)] : [p.getX(i), p.getY(i)]
    uv.set([u, v], i * 2)
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return g
}

/** Metres between the vertices the baked light is stored at (`bake`). */
const LIGHT_STEP = 2
const steps = (size: number) => Math.min(40, Math.max(1, Math.ceil(size / LIGHT_STEP)))

/**
 * A block, a ramp (its top sloped as the engine slopes it) or an upright cylinder, in world space, cut into faces
 * about `LIGHT_STEP` across so the light baked into its vertices has somewhere to change.
 */
function solid(piece: CoverPiece): THREE.BufferGeometry {
  const s = piece.shape
  const h = Math.max(0.01, piece.top - piece.base)
  if (s.kind === 'column') return new THREE.CylinderGeometry(s.r, s.r, h, 40, steps(h)).translate(s.x, piece.base + h / 2, s.z)
  // a ramp keeps its sides one row high: its top is lifted onto the slope vertex by vertex
  const geo = new THREE.BoxGeometry(s.hx * 2, h, s.hz * 2, steps(s.hx * 2), piece.slope ? 1 : steps(h), steps(s.hz * 2)).translate(s.x, piece.base + h / 2, s.z)
  if (piece.slope) {
    const pos = geo.getAttribute('position')
    for (let i = 0; i < pos.count; i++) if (pos.getY(i) > piece.base + h / 2) pos.setY(i, surfaceAt(piece, pos.getX(i), pos.getZ(i)))
  }
  return geo
}

/** The yellow trim on a traversal piece: a rim round a chip's top, the long edges of a deck, the sides of a ramp. */
function trim(piece: CoverPiece): THREE.BufferGeometry[] {
  const s = piece.shape
  const t = 0.09
  if (s.kind === 'column') return [new THREE.CylinderGeometry(s.r + 0.03, s.r + 0.03, 0.16, 40, 1, true).translate(s.x, piece.top - 0.08, s.z)]
  if (piece.slope) {
    const alongX = piece.slope.rise[0] === 'x'
    const len = (alongX ? s.hx : s.hz) * 2
    const rise = piece.top - piece.slope.low
    const angle = Math.atan2(rise, len) * (piece.slope.rise[1] === '+' ? 1 : -1)
    const mid = (piece.top + piece.slope.low) / 2
    const out: THREE.BufferGeometry[] = []
    for (const side of [-1, 1]) {
      const strip = new THREE.BoxGeometry(alongX ? Math.sqrt(len * len + rise * rise) : t, t, alongX ? t : Math.sqrt(len * len + rise * rise))
      if (alongX) strip.rotateZ(angle).translate(s.x, mid + t / 2, s.z + side * (s.hz - t / 2))
      else strip.rotateX(-angle).translate(s.x + side * (s.hx - t / 2), mid + t / 2, s.z)
      out.push(strip)
    }
    return out
  }
  return [
    new THREE.BoxGeometry(s.hx * 2, t, t).translate(s.x, piece.top + t / 2 - 0.02, s.z - s.hz + t / 2),
    new THREE.BoxGeometry(s.hx * 2, t, t).translate(s.x, piece.top + t / 2 - 0.02, s.z + s.hz - t / 2),
    new THREE.BoxGeometry(t, t, s.hz * 2).translate(s.x - s.hx + t / 2, piece.top + t / 2 - 0.02, s.z),
    new THREE.BoxGeometry(t, t, s.hz * 2).translate(s.x + s.hx - t / 2, piece.top + t / 2 - 0.02, s.z),
  ]
}

/** Traversal pieces carry yellow: chips, ramps, and decks hung above a floor; not the main floor's own slabs. */
const traversal = (p: CoverPiece) => p.look === 'chip' || p.look === 'ramp' || (p.look === 'grey' && p.base > 0 && p.top - p.base <= 1)

let gridTexture: THREE.Texture | undefined
/**
 * Bake the house's light into its vertex colours (GAME.md §10: one shadowed sun, everything else baked), from the
 * engine's own pieces: sky light falls off under a deck or balcony, more the lower it is, and floors darken where
 * they meet a wall, walls where they meet the floor. The sun's own shadow stays live; this is the light it doesn't
 * cast, worked out once at load.
 */
export function bake(geo: THREE.BufferGeometry, pieces: readonly CoverPiece[], health: readonly CoverHealth[] = initialCoverHealth(pieces)) {
  const pos = geo.getAttribute('position')
  const nor = geo.getAttribute('normal')
  const col = geo.getAttribute('color')
  const q = { x: 0, y: 0, z: 0 }
  const b = { x: 0, y: 0, z: 0 }
  const AROUND = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const
  // vertices are shared by up to six triangles once unindexed: each spot is worked out once
  const seen = new Map<string, number>()
  for (let i = 0; i < pos.count; i++) {
    const ny = nor.getY(i)
    q.x = pos.getX(i) + nor.getX(i) * 0.15
    q.y = pos.getY(i) + ny * 0.15
    q.z = pos.getZ(i) + nor.getZ(i) * 0.15
    const key = `${q.x.toFixed(2)},${q.y.toFixed(2)},${q.z.toFixed(2)}`
    let light = seen.get(key)
    if (light === undefined) {
      light = 1
      // under a roof: open at the sides, so never black; a low roof shades more than a high one
      const roof = ny > -0.5 ? ceilingOver(pieces, health, q, 0, q.y + 0.05, q.y + 30) : undefined
      if (roof !== undefined) light *= 0.5 + 0.3 * Math.min(1, (roof - q.y) / 12)
      if (ny > 0.5) {
        // a floor beside a wall: how much of the way round is walled within a metre
        let shut = 0
        for (const [dx, dz] of AROUND) {
          b.x = q.x + dx * 1.2
          b.y = q.y + 0.3
          b.z = q.z + dz * 1.2
          const hit = coverHit(pieces, health, { x: q.x, y: q.y + 0.3, z: q.z }, b)
          if (hit) shut += 1 - hit.t
        }
        light *= 1 - 0.18 * shut
      } else if (Math.abs(ny) < 0.5) {
        // a wall's foot, where it meets the floor in front of it
        const floor = floorUnder(pieces, health, q, 0.5)
        light *= 1 - 0.22 * Math.max(0, 1 - (q.y - floor) / 1.5)
      }
      seen.set(key, light)
    }
    col.setXYZ(i, col.getX(i) * light, col.getY(i) * light, col.getZ(i) * light)
  }
  col.needsUpdate = true
}

/** A one-metre grid, faint, to judge a gap or a step by eye. */
function grid(): THREE.Texture | undefined {
  if (gridTexture || typeof document === 'undefined') return gridTexture
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 128
  const g = canvas.getContext('2d')
  if (!g) return undefined
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, 128, 128)
  g.strokeStyle = 'rgba(0, 0, 0, 0.22)'
  g.lineWidth = 3
  g.strokeRect(0, 0, 128, 128)
  g.strokeStyle = 'rgba(0, 0, 0, 0.08)'
  g.lineWidth = 2
  g.beginPath()
  g.moveTo(64, 0)
  g.lineTo(64, 128)
  g.moveTo(0, 64)
  g.lineTo(128, 64)
  g.stroke()
  gridTexture = new THREE.CanvasTexture(canvas)
  gridTexture.wrapS = gridTexture.wrapT = THREE.RepeatWrapping
  gridTexture.colorSpace = THREE.SRGBColorSpace
  gridTexture.anisotropy = 8
  return gridTexture
}

export function buildGreybox(pieces: readonly CoverPiece[], lines: readonly MapLine[] = []): RuinsView {
  const group = new THREE.Group()
  group.name = 'greybox'
  const proxies: THREE.Box3[] = []
  const views: (THREE.Object3D | undefined)[] = []
  const map = grid()
  const greyMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82, metalness: 0.02, ...(map ? { map } : {}) })
  const yellowMat = new THREE.MeshStandardMaterial({ color: YELLOW, emissive: YELLOW, emissiveIntensity: 0.55, roughness: 0.5 })
  // what breaks (§6b) reads apart from what never does: red barricades, pale glass, and card bridges printed like cards
  const BREAKABLE: Partial<Record<CoverPiece['look'], { color: number; opacity?: number }>> = { glass: { color: 0x9fd8ff, opacity: 0.38 }, card: { color: 0xf3ead6 } }
  const tone = (piece: CoverPiece) => BREAKABLE[piece.look] ?? { color: 0xc0462e }
  const breakableMat = (piece: CoverPiece) => {
    const { color, opacity } = tone(piece)
    return new THREE.MeshStandardMaterial({ color, roughness: piece.look === 'glass' ? 0.1 : 0.7, ...(opacity ? { transparent: true, opacity, depthWrite: false } : {}) })
  }
  const solids: THREE.BufferGeometry[] = []
  const trims: THREE.BufferGeometry[] = []
  pieces.forEach((piece, index) => {
    const s = piece.shape
    const box = new THREE.Box3()
    if (s.kind === 'block') box.set(new THREE.Vector3(s.x - s.hx, piece.base, s.z - s.hz), new THREE.Vector3(s.x + s.hx, piece.top, s.z + s.hz))
    else box.set(new THREE.Vector3(s.x - s.r, piece.base, s.z - s.r), new THREE.Vector3(s.x + s.r, piece.top, s.z + s.r))
    proxies.push(box)
    if (piece.health) {
      // a barricade, a glass partition or a card bridge: its own node, so it can shake, wear and break
      const node = new THREE.Group()
      node.name = `cover:${piece.look}`
      const mesh = new THREE.Mesh(solid(piece), breakableMat(piece))
      mesh.castShadow = piece.look !== 'glass'
      mesh.receiveShadow = true
      node.add(mesh)
      // a card bridge is a deck to cross: yellow edges, like every other
      if (piece.look === 'card') trims.push(...trim(piece))
      group.add(node)
      views[index] = node
      return
    }
    solids.push(shade(solid(piece), piece.look === 'pillar' ? grey(piece.top).multiplyScalar(0.8) : grey(piece.top)))
    if (traversal(piece)) trims.push(...trim(piece))
  })
  const merged = mergeGeometries(solids)!
  bake(merged, pieces)
  const body = new THREE.Mesh(merged, greyMat)
  body.name = 'greybox:solids'
  body.castShadow = body.receiveShadow = true
  group.add(body)
  if (trims.length) {
    const edges = new THREE.Mesh(mergeGeometries(trims.map((g) => (g.index ? g.toNonIndexed() : g)).map((g) => (g.deleteAttribute('uv'), g.deleteAttribute('normal'), g.computeVertexNormals(), g))), yellowMat)
    edges.name = 'greybox:traversal'
    group.add(edges)
  }
  // ziplines hang as yellow cables from posts; rails are thicker steel with a yellow stripe
  const cables: THREE.BufferGeometry[] = []
  for (const l of lines) {
    const a = new THREE.Vector3(l.a.x, l.a.y, l.a.z)
    const b = new THREE.Vector3(l.b.x, l.b.y, l.b.z)
    const len = a.distanceTo(b)
    const cable = new THREE.CylinderGeometry(l.kind === 'zip' ? 0.05 : 0.09, l.kind === 'zip' ? 0.05 : 0.09, len, 8, 1, true)
    cable.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize()))
    cable.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2)
    cables.push(cable.index ? cable.toNonIndexed() : cable)
  }
  if (cables.length) {
    const mesh = new THREE.Mesh(mergeGeometries(cables.map((g) => (g.deleteAttribute('uv'), g))), yellowMat)
    mesh.name = 'greybox:lines'
    group.add(mesh)
  }

  const flash = new THREE.Color(1.6, 1.4, 1.2)
  const shake: { obj: THREE.Object3D; t: number }[] = []
  return {
    group,
    proxies,
    hit: (index, health) => {
      const node = views[index]
      const piece = pieces[index]
      if (!node || !piece.health) return
      if (!shake.some((s) => s.obj === node)) shake.push({ obj: node, t: 0.25 })
      const wear = health >= 0 ? 1 - health / piece.health : 0
      const mesh = node.children[0] as THREE.Mesh
      const m = mesh.material as THREE.MeshStandardMaterial
      m.color.set(tone(piece).color).multiplyScalar(1 - wear * 0.45)
      m.emissive.copy(flash).multiplyScalar(0.12)
    },
    broken: (index) => {
      const node = views[index]
      if (!node) return undefined
      node.visible = false
      proxies[index].makeEmpty()
      const p = pieces[index]
      return new THREE.Vector3(p.shape.x, (p.base + p.top) / 2, p.shape.z)
    },
    update: (dt) => {
      for (let i = shake.length - 1; i >= 0; i--) {
        const s = shake[i]
        s.t -= dt
        const k = Math.max(0, s.t) * 0.25
        s.obj.position.set((Math.random() - 0.5) * k, 0, (Math.random() - 0.5) * k)
        if (s.t <= 0) {
          s.obj.position.set(0, 0, 0)
          const m = (s.obj.children[0] as THREE.Mesh).material as THREE.MeshStandardMaterial
          m.emissive.setScalar(0)
          shake.splice(i, 1)
        }
      }
    },
  }
}
