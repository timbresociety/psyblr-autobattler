import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { CoverPiece } from '../engine/cover.js'
import { rockGeometry, sceneryMaterial } from './scenery.js'
import { grassTexture, travertine } from './textures.js'

/**
 * The ruins on screen (R25), built from the engine's own cover pieces so every wall the audience sees is a wall the
 * engine blocks with, no more and no less. Detail stays inside each piece's shape: fluting, courses of ashlar,
 * capitals and shields are carved into the silhouette, never past it, except a capital's lip high above the heroes.
 * Breakable barricades show their wear and burst when the engine breaks them.
 */

export interface RuinsView {
  group: THREE.Group
  /** Boxes the cameras keep out of. */
  proxies: THREE.Box3[]
  /** A shot or blast struck piece `index`; `health` is what is left (-1 for unbreakable stone). */
  hit: (index: number, health: number) => void
  /** The engine broke piece `index`: hide it; returns where its pieces should fly from. */
  broken: (index: number) => THREE.Vector3 | undefined
  /** Ease hit flashes and shakes back to rest. */
  update: (dt: number) => void
}

function seeded(seed: number) {
  let s = seed % 2147483647 || 1
  return () => ((s = (s * 16807) % 2147483647) / 2147483647)
}

/** Darken vertex colours toward the ground and multiply in a tint: cheap baked ambient occlusion. */
function paint(geo: THREE.BufferGeometry, tint: THREE.Color, groundY = 0, aoHeight = 1.4): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo
  const pos = g.getAttribute('position')
  const colors = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const h = Math.max(0, Math.min(1, (pos.getY(i) - groundY) / aoHeight))
    const ao = 0.5 + 0.5 * h * h * (3 - 2 * h)
    colors[i * 3] = tint.r * ao
    colors[i * 3 + 1] = tint.g * ao
    colors[i * 3 + 2] = tint.b * ao
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return g
}

/** Planar box UVs in metres, so textures keep one scale across pieces of any size. */
function worldUV(geo: THREE.BufferGeometry, scale = 0.5): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo
  // smooth normals come from the indexed source; only fill them in when a geometry has none
  if (!g.getAttribute('normal')) g.computeVertexNormals()
  const pos = g.getAttribute('position')
  const nrm = g.getAttribute('normal')
  const uv = new Float32Array(pos.count * 2)
  for (let i = 0; i < pos.count; i++) {
    const nx = Math.abs(nrm.getX(i))
    const ny = Math.abs(nrm.getY(i))
    const [u, v] = ny > nx && ny > Math.abs(nrm.getZ(i)) ? [pos.getX(i), pos.getZ(i)] : nx > Math.abs(nrm.getZ(i)) ? [pos.getZ(i), pos.getY(i)] : [pos.getX(i), pos.getY(i)]
    uv[i * 2] = u * scale
    uv[i * 2 + 1] = v * scale
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return g
}

/** A fluted column shaft; `broken` jags its top. */
function shaft(r: number, h: number, rnd: () => number, broken: boolean): THREE.BufferGeometry {
  const geo = new THREE.CylinderGeometry(r * 0.94, r, h, 40, 8, false)
  const pos = geo.getAttribute('position')
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i)
    const z = pos.getZ(i)
    const y = pos.getY(i)
    const len = Math.sqrt(x * x + z * z)
    if (len < 1e-4) continue
    const a = Math.atan2(z, x)
    // twenty concave flutes, the Doric count
    const flute = 1 - 0.045 * (0.5 + 0.5 * Math.cos(a * 20))
    pos.setX(i, (x / len) * len * flute)
    pos.setZ(i, (z / len) * len * flute)
    if (broken && y > h / 2 - 1e-3) pos.setY(i, y - rnd() * Math.min(0.7, h * 0.15))
  }
  geo.computeVertexNormals()
  geo.translate(0, h / 2, 0)
  return geo
}

const textureLoader = new THREE.TextureLoader()

/** A material from a painted texture set in public/textures: albedo, normal and roughness, tiling in world metres. */
export function paintedMaterial(name: string, normalScale = 1): THREE.MeshStandardMaterial {
  const load = (kind: string, color: boolean) => {
    const t = textureLoader.load(`/textures/${name}_${kind}.webp`)
    t.wrapS = t.wrapT = THREE.RepeatWrapping
    t.anisotropy = 8
    if (color) t.colorSpace = THREE.SRGBColorSpace
    return t
  }
  return new THREE.MeshStandardMaterial({
    map: load('albedo', true),
    normalMap: load('normal', false),
    roughnessMap: load('rough', false),
    normalScale: new THREE.Vector2(normalScale, normalScale),
    vertexColors: true,
    roughness: 1,
  })
}

export function buildRuins(pieces: readonly CoverPiece[]): RuinsView {
  const group = new THREE.Group()
  const proxies: THREE.Box3[] = []
  const rnd = seeded(23)
  const stone = travertine(31)
  const stoneMat = new THREE.MeshStandardMaterial({ ...stone, vertexColors: true, roughness: 1, normalScale: new THREE.Vector2(0.9, 0.9) })
  // painted masonry (generated art, processed by tools/textures/process.py) for walls, lintels and plinths
  const masonry = paintedMaterial('wall')
  const masonry2 = paintedMaterial('wall2')
  // weathered cream marble with gold veins for the columns and the fallen drums (generated art, same pipeline)
  const marbleMat = paintedMaterial('marble', 0.5)
  marbleMat.roughness = 0.8
  // dark oak planks with iron nails (generated art) for the barricades
  const woodMat = paintedMaterial('timber', 0.8)
  const bronze = new THREE.MeshStandardMaterial({ color: 0xb98a4a, metalness: 0.85, roughness: 0.35 })
  // a legionary scutum painted front-on (generated art), wrapped once around each curved shield
  const shieldMap = textureLoader.load('/textures/scutum_albedo.webp')
  shieldMap.colorSpace = THREE.SRGBColorSpace
  shieldMap.anisotropy = 8
  const shieldFace = new THREE.MeshStandardMaterial({ map: shieldMap, roughness: 0.55, metalness: 0.1, side: THREE.DoubleSide })
  const views: (THREE.Object3D | undefined)[] = []
  const shake: { obj: THREE.Object3D; t: number; base: THREE.Vector3 }[] = []
  const rubble: THREE.Matrix4[] = []
  const tufts: THREE.Matrix4[] = []
  const place = new THREE.Object3D()
  const scatter = (x: number, z: number, spreadX: number, spreadZ: number, count: number) => {
    for (let k = 0; k < count; k++) {
      // rubble and grass hug the base of a piece, low enough never to hide a hero or block a shot
      const side = rnd() < 0.5 ? -1 : 1
      const along = (rnd() - 0.5) * 2
      const px = rnd() < 0.5 ? x + side * (spreadX + 0.2 + rnd() * 0.8) : x + along * spreadX
      const pz = rnd() < 0.5 ? z + along * spreadZ : z + side * (spreadZ + 0.2 + rnd() * 0.8)
      place.position.set(px, 0, pz)
      place.rotation.set(rnd() * 0.4, rnd() * Math.PI * 2, rnd() * 0.4)
      const s = 0.08 + rnd() * 0.16
      place.scale.set(s * (1 + rnd()), s, s * (1 + rnd()))
      place.updateMatrix()
      rubble.push(place.matrix.clone())
      place.rotation.set(0, rnd() * Math.PI, 0)
      place.position.set(px + (rnd() - 0.5) * 0.6, 0, pz + (rnd() - 0.5) * 0.6)
      const g = 0.5 + rnd() * 0.5
      place.scale.set(g, g * (0.6 + rnd() * 0.6), g)
      place.updateMatrix()
      tufts.push(place.matrix.clone())
    }
  }

  pieces.forEach((piece, index) => {
    const s = piece.shape
    const node = new THREE.Group()
    const h = piece.top - piece.base
    if (s.kind === 'column') {
      const broken = piece.top < 6
      const capital = broken ? 0 : 0.7
      const base = 0.35
      const parts = [
        worldUV(paint(shaft(s.r, h - capital - base, rnd, broken).translate(0, base, 0), new THREE.Color(1, 1, 1), 0, 2.2), 0.6),
        worldUV(paint(new THREE.CylinderGeometry(s.r * 1.12, s.r * 1.2, base, 40), new THREE.Color(0.92, 0.9, 0.86)).translate(0, base / 2, 0)),
      ]
      if (!broken) {
        parts.push(worldUV(paint(new THREE.CylinderGeometry(s.r * 1.28, s.r * 0.95, capital * 0.5, 40), new THREE.Color(1, 1, 1)).translate(0, h - capital * 0.75, 0)))
        parts.push(worldUV(paint(new THREE.BoxGeometry(s.r * 2.7, capital * 0.5, s.r * 2.7), new THREE.Color(0.96, 0.95, 0.92)).translate(0, h - capital * 0.25, 0)))
      }
      const mesh = new THREE.Mesh(mergeGeometries(parts), marbleMat)
      mesh.castShadow = mesh.receiveShadow = true
      node.add(mesh)
      node.position.set(s.x, piece.base, s.z)
      scatter(s.x, s.z, s.r, s.r, broken ? 10 : 5)
    } else {
      const w = s.hx * 2
      const d = s.hz * 2
      const long = w >= d
      if (piece.look === 'fallen') {
        // a toppled column lying in drums along its length
        const r = Math.min(s.hz, h / 2)
        const drums = 3
        const len = (long ? w : d) / drums
        const parts: THREE.BufferGeometry[] = []
        for (let k = 0; k < drums; k++) {
          // each drum lies along x, rolled a little differently, with a small gap to the next
          const drum = shaft(r, len - 0.08, rnd, k === drums - 1).translate(0, -(len - 0.08) / 2, 0).rotateZ(Math.PI / 2).rotateX(rnd() * Math.PI)
          drum.translate(-(long ? w : d) / 2 + len * (k + 0.5), r, (rnd() - 0.5) * 0.06)
          parts.push(worldUV(paint(drum, new THREE.Color(1, 1, 1), 0, 0.8), 0.6))
        }
        const mesh = new THREE.Mesh(mergeGeometries(parts), marbleMat)
        if (!long) mesh.rotation.y = Math.PI / 2
        mesh.castShadow = mesh.receiveShadow = true
        node.add(mesh)
        scatter(s.x, s.z, s.hx, s.hz, 12)
      } else if (piece.look === 'barricade') {
        // timber planks bound in bronze, faced with a row of red shields
        const parts = [worldUV(paint(new THREE.BoxGeometry(w, h, d * 0.55), new THREE.Color(1, 1, 1), 0, 0.9).translate(0, h / 2, 0), 0.7)]
        const planks = new THREE.Mesh(mergeGeometries(parts), woodMat)
        const bands = new THREE.Group()
        for (const y of [0.35, h - 0.35]) {
          const band = new THREE.Mesh(new THREE.BoxGeometry(long ? w + 0.02 : d * 0.6, 0.12, long ? d * 0.6 : w + 0.02), bronze)
          band.position.y = y
          bands.add(band)
        }
        const shields = new THREE.Group()
        const count = Math.max(2, Math.round((long ? w : d) / 0.9))
        for (const face of [-1, 1]) {
          for (let k = 0; k < count; k++) {
            const scutum = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.4, h * 0.62, 12, 1, true, -0.28, 0.56), shieldFace)
            const boss = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), bronze)
            const along = -((long ? w : d) / 2) + ((long ? w : d) / count) * (k + 0.5)
            const g = new THREE.Group()
            scutum.position.z = -1.4 + 0.02
            boss.position.z = 0.05
            g.add(scutum, boss)
            g.position.set(long ? along : face * (w / 2 - 0.05), h * 0.45, long ? face * (d / 2 - 0.05) : along)
            g.rotation.y = long ? (face > 0 ? 0 : Math.PI) : face > 0 ? Math.PI / 2 : -Math.PI / 2
            shields.add(g)
          }
        }
        planks.castShadow = planks.receiveShadow = true
        node.add(planks, bands, shields)
        scatter(s.x, s.z, s.hx, s.hz, 6)
      } else {
        // walls, plinths and lintels: one weathered mass wrapped in the painted masonry at real scale (a course of the
        // painting is about 0.55 m), its faces gently bowed and its edges worn so it never reads as a crisp box
        const parts: THREE.BufferGeometry[] = []
        if (piece.look === 'plinth') {
          for (let c = 0; c < 3; c++) {
            const inset = c * 0.3
            const g = new THREE.BoxGeometry(w - inset * 2, h / 3, d - inset * 2, 6, 2, 6).translate(0, h / 6 + (c * h) / 3, 0)
            parts.push(weather(g, rnd, 0.05))
          }
        } else {
          const g = new THREE.BoxGeometry(w, h, d, Math.max(4, Math.round(w * 3)), Math.max(3, Math.round(h * 3)), Math.max(3, Math.round(d * 3))).translate(0, h / 2, 0)
          parts.push(weather(g, rnd, 0.06))
        }
        const mesh = new THREE.Mesh(mergeGeometries(parts.map((g) => worldUV(paint(g, new THREE.Color(1, 1, 1), 0, 1.0), 0.48))), piece.look === 'plinth' ? masonry2 : masonry)
        mesh.castShadow = mesh.receiveShadow = true
        node.add(mesh)
        if (piece.base <= 0) scatter(s.x, s.z, s.hx, s.hz, Math.round((s.hx + s.hz) * 2.5))
      }
      node.position.set(s.x, piece.base, s.z)
    }
    group.add(node)
    views[index] = node
    const box = new THREE.Box3()
    if (s.kind === 'block') box.set(new THREE.Vector3(s.x - s.hx, piece.base, s.z - s.hz), new THREE.Vector3(s.x + s.hx, piece.top, s.z + s.hz))
    else box.set(new THREE.Vector3(s.x - s.r, piece.base, s.z - s.r), new THREE.Vector3(s.x + s.r, piece.top, s.z + s.r))
    proxies.push(box)
  })

  // rubble and grass at the feet of the ruins, instanced so hundreds cost two draw calls
  const rubbleMesh = new THREE.InstancedMesh<THREE.BufferGeometry, THREE.Material>(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ ...stone, color: 0xc9bca6, roughness: 1 }), rubble.length)
  rubble.forEach((m, i) => rubbleMesh.setMatrixAt(i, m))
  rubbleMesh.receiveShadow = true
  // the stand-in chips give way to a sculpted, painted rock (tools/blender/scenery.py) once it loads
  void rockGeometry(0)
    .then((geo) => {
      if (!geo) return
      const old = rubbleMesh.geometry
      rubbleMesh.geometry = geo
      rubbleMesh.material = sceneryMaterial('rock')
      rubbleMesh.computeBoundingSphere()
      old.dispose()
    })
    .catch(() => undefined)
  const blade = new THREE.PlaneGeometry(0.7, 0.55).translate(0, 0.27, 0)
  const tuft = mergeGeometries([blade, blade.clone().rotateY(Math.PI / 2)])
  const grassMat = new THREE.MeshStandardMaterial({ map: grassTexture(), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1 })
  const grass = new THREE.InstancedMesh(tuft, grassMat, tufts.length)
  tufts.forEach((m, i) => grass.setMatrixAt(i, m))
  group.add(rubbleMesh, grass)

  const flash = new THREE.Color(1.6, 1.4, 1.2)
  return {
    group,
    proxies,
    hit: (index, health) => {
      const node = views[index]
      if (!node) return
      if (!shake.some((s) => s.obj === node)) shake.push({ obj: node, t: 0.25, base: node.position.clone() })
      // breakable pieces darken and split as they wear down
      const piece = pieces[index]
      if (piece.health && health >= 0) {
        const wear = 1 - health / piece.health
        node.traverse((o) => {
          const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
          if (!m || !('color' in m)) return
          if (!o.userData.baseColor) o.userData.baseColor = m.color.clone()
          // each mesh gets its own material the first time it wears, so neighbours stay pristine
          if (!o.userData.own) {
            ;(o as THREE.Mesh).material = m.clone()
            o.userData.own = true
          }
          const own = (o as THREE.Mesh).material as THREE.MeshStandardMaterial
          own.color.copy(o.userData.baseColor as THREE.Color).multiplyScalar(1 - wear * 0.45)
          own.emissive?.copy(flash).multiplyScalar(0.12)
        })
        node.rotation.z = (rnd() - 0.5) * wear * 0.06
      }
    },
    broken: (index) => {
      const node = views[index]
      if (!node) return undefined
      node.visible = false
      proxies[index].makeEmpty()
      return node.position.clone().add(new THREE.Vector3(0, (pieces[index].top - pieces[index].base) / 2, 0))
    },
    update: (dt) => {
      for (let i = shake.length - 1; i >= 0; i--) {
        const s = shake[i]
        s.t -= dt
        const k = Math.max(0, s.t) * 0.25
        s.obj.position.set(s.base.x + (rnd() - 0.5) * k, s.base.y, s.base.z + (rnd() - 0.5) * k)
        if (s.t <= 0) {
          s.obj.position.copy(s.base)
          s.obj.traverse((o) => {
            const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined
            if (o.userData.own && m?.emissive) m.emissive.setScalar(0)
          })
          shake.splice(i, 1)
        }
      }
    },
  }
}

/** Wear a box: bow its faces in a little and round its edges, staying inside the original bounds (honest cover). */
function weather(geo: THREE.BufferGeometry, rnd: () => number, amount: number): THREE.BufferGeometry {
  geo.computeBoundingBox()
  const box = geo.boundingBox!
  const c = box.getCenter(new THREE.Vector3())
  const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5)
  const pos = geo.getAttribute('position')
  const seed = rnd() * 100
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i) - c.x
    const y = pos.getY(i) - c.y
    const z = pos.getZ(i) - c.z
    // how close to an edge or corner: shrink there most, so edges look chipped and worn
    const ex = Math.abs(x) / half.x
    const ey = Math.abs(y) / half.y
    const ez = Math.abs(z) / half.z
    const edge = Math.max(0, Math.min(ex, ey) - 0.85) + Math.max(0, Math.min(ex, ez) - 0.85) + Math.max(0, Math.min(ey, ez) - 0.85)
    const n = 0.5 + 0.5 * Math.sin(x * 5.3 + seed) * Math.cos(z * 4.1 + y * 3.7 + seed)
    const k = 1 - (edge * 2.2 + n * 0.25) * amount
    pos.setXYZ(i, c.x + x * k, c.y + y * (y > 0 ? 1 - edge * amount * 1.5 : 1), c.z + z * k)
  }
  geo.computeVertexNormals()
  return geo
}

/** One ashlar block in a course: slightly smaller than its slot, a touch rotated, its own shade of stone. */
function blockGeo(len: number, ch: number, long: boolean, depth: number, width: number, at: number, y: number, rnd: () => number): THREE.BufferGeometry {
  const gap = 0.025
  const geo = long ? new THREE.BoxGeometry(len - gap, ch - gap, depth - rnd() * 0.04) : new THREE.BoxGeometry(width - rnd() * 0.04, ch - gap, len - gap)
  geo.rotateY((rnd() - 0.5) * 0.015)
  if (long) geo.translate(at, y + ch / 2, (rnd() - 0.5) * 0.03)
  else geo.translate((rnd() - 0.5) * 0.03, y + ch / 2, at)
  const shade = 0.82 + rnd() * 0.22
  return worldUV(paint(geo, new THREE.Color(shade, shade * 0.98, shade * 0.95)))
}
