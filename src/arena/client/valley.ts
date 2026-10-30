import * as THREE from 'three'
import { MeshStandardNodeMaterial } from 'three/webgpu'
import { abs, attribute, cameraPosition, color, float, length, max, mix, modelPosition, normalize, normalViewGeometry, positionLocal, positionWorld, pow, sin, smoothstep, texture, time, vec2, vec3 } from 'three/tsl'
import type { CoverPiece } from '../engine/cover.js'
import { buildRuins, crossedCard, paintedTexture, tuftMaterial } from './ruins.js'
import { place, placeModels, seeded, type Placement } from './scenery.js'
import { skyAt } from './sky.js'

/**
 * The valley round the courtyard (R25; Forge goal, phase 2 look pass, after the owner's reference sheet). Past the
 * barrier the paving breaks up into meadow, and ruined walls and gates hung with team banners stand at the
 * courtyard's edge. Under the low sun the hill falls away to a lake; every other way pine forest climbs to a ring of
 * snow-capped peaks that fade into the haze. One mesh carries the land, the lake and the mountains, shaded by height
 * and slope; the pines are instanced branch cards. Nothing here can be walked into: the barrier stops every hero first.
 */

/** The courtyard and its edge stay level out to here; past it the land rolls away. */
const FLAT = 74
/** The lake's surface, below the courtyard. */
const WATER = -38
/** Where the land ends, behind the far ridges and inside the sky dome. */
const EDGE = 1400

type Noise = (x: number, z: number) => number

/** Smooth gradient noise in about -1..1 from a seeded table, so the valley is the same on every load. */
function gradientNoise(seed: number): Noise {
  const rnd = seeded(seed)
  const p = Array.from({ length: 256 }, (_, i) => i)
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1))
    ;[p[i], p[j]] = [p[j], p[i]]
  }
  const perm = new Uint8Array(512)
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]
  const gx = [1, -1, 0, 0, 0.7071, -0.7071, 0.7071, -0.7071]
  const gz = [0, 0, 1, -1, 0.7071, 0.7071, -0.7071, -0.7071]
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
  return (x, z) => {
    const xi = Math.floor(x)
    const zi = Math.floor(z)
    const [xf, zf] = [x - xi, z - zi]
    const [X, Z] = [xi & 255, zi & 255]
    const grad = (h: number, dx: number, dz: number) => gx[h & 7] * dx + gz[h & 7] * dz
    const a = grad(perm[X + perm[Z]], xf, zf)
    const b = grad(perm[X + 1 + perm[Z]], xf - 1, zf)
    const c = grad(perm[X + perm[Z + 1]], xf, zf - 1)
    const d = grad(perm[X + 1 + perm[Z + 1]], xf - 1, zf - 1)
    const [u, v] = [fade(xf), fade(zf)]
    return (a + (b - a) * u + (c - a + (a - b - c + d) * u) * v) * 1.41
  }
}

const smooth = (from: number, to: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - from) / (to - from)))
  return t * t * (3 - 2 * t)
}

/** A few octaves of noise, about -1..1. */
function fbm(n: Noise, x: number, z: number, octaves: number) {
  let [sum, amp, f, norm] = [0, 0.5, 1, 0]
  for (let i = 0; i < octaves; i++) {
    sum += amp * n(x * f, z * f)
    norm += amp
    amp *= 0.5
    f *= 2.03
  }
  return sum / norm
}

/** Ridged noise, 0..1: sharp crests where the noise crosses zero, each octave weighted by the last, as eroded peaks are. */
function ridged(n: Noise, x: number, z: number, octaves: number) {
  let [sum, amp, f, weight, norm] = [0, 0.5, 1, 1, 0]
  for (let i = 0; i < octaves; i++) {
    let v = 1 - Math.abs(n(x * f, z * f))
    v *= v * weight
    weight = Math.min(1, Math.max(0, v * 1.8))
    sum += v * amp
    norm += amp
    amp *= 0.5
    f *= 2.1
  }
  return sum / norm
}

interface Land {
  height: (x: number, z: number) => number
  /** How thickly pines grow at (x, z), 0..1, given the height there and how steep it is (0 flat, 1 sheer). */
  forest: (x: number, z: number, h: number, slope: number) => number
}

function landOf(sun: THREE.Vector3): Land {
  const [roll, hills, peaks, woods] = [gradientNoise(7), gradientNoise(19), gradientNoise(31), gradientNoise(43)]
  const len = Math.hypot(sun.x, sun.z)
  const [sx, sz] = [sun.x / len, sun.z / len]
  // how nearly (x, z) lies toward the sun from the courtyard: 1 straight at it, -1 straight away
  const toward = (x: number, z: number, r: number) => (r > 1 ? (x * sx + z * sz) / r : 0)
  return {
    height: (x, z) => {
      const r = Math.hypot(x, z)
      const sunward = toward(x, z, r)
      const lakeward = smooth(0.2, 0.8, sunward)
      let h = fbm(roll, x / 110, z / 110, 4) * 6 * smooth(FLAT, FLAT + 60, r)
      // under the sun the hill falls away to the lake; every other way it climbs into wooded hills
      // the brow is close and the slope steepest just past it, so the water shows from the courtyard over the drop
      const down = Math.min(1, Math.max(0, (r - FLAT - 15) / 150))
      h -= 52 * (1 - (1 - down) * (1 - down)) * lakeward
      h += (36 + 26 * fbm(hills, x / 260, z / 260, 3)) * smooth(140, 460, r) * (1 - lakeward)
      // the mountain ring, lower under the sun so it stays in the sky above them
      // massifs and saddles: the peaks gather into ranges with lower passes between them
      const massif = 0.35 + 0.65 * smooth(-0.25, 0.45, fbm(hills, x / 1100 + 7.3, z / 1100 - 2.9, 2))
      h += smooth(430, 980, r) * (60 + 620 * ridged(peaks, x / 700 + 3.1, z / 700 - 1.7, 6) * massif) * (1 - 0.7 * smooth(0.5, 0.95, sunward))
      return h
    },
    forest: (x, z, h, slope) => {
      const r = Math.hypot(x, z)
      // the slope down to the lake stays open, so the water shows between the trees
      const open = smooth(0.15, 0.6, toward(x, z, r)) * (1 - smooth(300, 460, r))
      return smooth(-0.1, 0.3, fbm(woods, x / 85, z / 85, 3)) * smooth(FLAT - 6, FLAT + 26, r) * (1 - smooth(170, 250, h)) * smooth(WATER + 3, WATER + 9, h) * (1 - smooth(0.35, 0.55, slope)) * (1 - open)
    },
  }
}

/**
 * The land as one radial mesh, fine near the courtyard and coarse at the far ridges, with what covers each vertex
 * (pine canopy, bare rock, snow, water) and a slow tone that varies the grass. The lake is the land flattened to the
 * water's surface, so the shore never flickers.
 */
function terrain(land: Land, W: number, L: number): THREE.Mesh {
  const rings = [0]
  for (let r = 8; r < EDGE; r = r < 64 ? r + 8 : r * 1.034) rings.push(r)
  rings.push(EDGE)
  const SEG = 448
  const count = rings.length * (SEG + 1)
  const position = new Float32Array(count * 3)
  const ground = new Float32Array(count)
  for (let i = 0; i < rings.length; i++)
    for (let j = 0; j <= SEG; j++) {
      const a = (j / SEG) * Math.PI * 2
      const [x, z] = [Math.cos(a) * rings[i], Math.sin(a) * rings[i]]
      const k = i * (SEG + 1) + j
      // just under the paving, so the courtyard floor always wins
      ground[k] = land.height(x, z) - 0.05
      position.set([x, Math.max(ground[k], WATER), z], k * 3)
    }
  const index: number[] = []
  for (let i = 0; i < rings.length - 1; i++)
    for (let j = 0; j < SEG; j++) {
      const a = i * (SEG + 1) + j
      const c = a + SEG + 1
      index.push(a, a + 1, c, a + 1, c + 1, c)
    }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(position, 3))
  geo.setIndex(index)
  geo.computeVertexNormals()
  const normal = geo.getAttribute('normal')
  const surface = new Float32Array(count * 4)
  const tone = new Float32Array(count)
  const shade = gradientNoise(59)
  for (let k = 0; k < count; k++) {
    const [x, z, h] = [position[k * 3], position[k * 3 + 2], ground[k]]
    const slope = 1 - normal.getY(k)
    const water = smooth(WATER + 0.3, WATER - 1.5, h)
    const rock = Math.max(smooth(0.3, 0.55, slope), smooth(160, 260, h) * 0.8) * (1 - water)
    const snow = smooth(300, 380, h + fbm(shade, x / 90, z / 90, 3) * 60) * (1 - smooth(0.38, 0.62, slope))
    surface.set([land.forest(x, z, h, slope) * (1 - rock), rock, snow, water], k * 4)
    tone[k] = fbm(shade, x / 55, z / 55, 3)
  }
  geo.setAttribute('surface', new THREE.BufferAttribute(surface, 4))
  geo.setAttribute('tone', new THREE.BufferAttribute(tone, 1))

  const m = new MeshStandardNodeMaterial({ roughness: 1, metalness: 0 })
  const cover = attribute('surface', 'vec4')
  const t = attribute('tone', 'float')
  const p = positionWorld
  const meadow = paintedTexture('meadow', 'albedo')
  const near = texture(meadow, p.xz.div(5)).rgb
  const far = texture(meadow, p.xz.div(41)).rgb
  let grass = mix(near, far, 0.4).mul(mix(vec3(1.05, 1, 0.82), vec3(0.8, 0.95, 0.74), smoothstep(-0.35, 0.35, t)))
  // the courtyard's paving runs on past the barrier and breaks up into the grass; it lines up with the floor's slabs
  const paving = texture(paintedTexture('paving', 'albedo'), vec2(p.x.add(W), p.z.negate()).div(5)).rgb
  const out = length(max(abs(p.xz).sub(vec2(W, L)), vec2(0, 0)))
  grass = mix(grass, paving, float(1).sub(smoothstep(1, 6, out.add(far.g.mul(9)).sub(2))))
  // from afar the forest floor reads as dark canopy, under and between the trees
  grass = mix(grass, near.mul(vec3(0.34, 0.46, 0.3)).mul(mix(0.75, 1.1, smoothstep(-0.3, 0.3, t))), cover.x)
  const rock = texture(paintedTexture('cliff', 'albedo'), vec2(p.x.add(p.z).mul(0.7), p.y).div(16)).rgb
  grass = mix(grass, rock.mul(vec3(0.55, 0.57, 0.62)), cover.y)
  grass = mix(grass, vec3(0.9, 0.93, 0.97), cover.z)
  // still water mirrors the sky (gold toward the sun, cool away), more of it the flatter it's seen, over a dark green
  // depth; a slow ripple from the meadow's normal map breaks the mirror into a glitter path under the sun
  const ripple = texture(paintedTexture('meadow', 'normal'), p.xz.div(9).add(time.mul(0.02))).rg.sub(0.5).mul(0.12)
  const view = normalize(p.sub(cameraPosition))
  const mirrored = skyAt(normalize(vec3(view.x.add(ripple.x), abs(view.y), view.z.add(ripple.y))))
  const fresnel = float(0.04).add(float(0.96).mul(pow(float(1).sub(abs(view.y)), 5)))
  m.colorNode = mix(grass, vec3(0.02, 0.03, 0.03), cover.w)
  m.emissiveNode = mix(color('#1d3836'), mirrored, fresnel).mul(cover.w)
  const mesh = new THREE.Mesh(geo, m)
  mesh.name = 'valley'
  mesh.receiveShadow = true
  return mesh
}

/**
 * One pine's crown: branch cards in drooping whorls round the trunk, narrowing to the tip, with a leader on top.
 * Normals lean out from the trunk so the crown shades as one mass; `spacing` is the height between whorls (wider for
 * the far forest, where fewer, bigger cards read the same).
 */
function crownGeometry(rnd: () => number, h: number, spacing: number, bare: number): THREE.BufferGeometry {
  const pos: number[] = []
  const nrm: number[] = []
  const uvs: number[] = []
  const idx: number[] = []
  const card = (corners: THREE.Vector3[], normals: THREE.Vector3[]) => {
    const k = pos.length / 3
    corners.forEach((c, i) => {
      pos.push(c.x, c.y, c.z)
      nrm.push(normals[i].x, normals[i].y, normals[i].z)
    })
    uvs.push(0, 0, 1, 0, 1, 1, 0, 1)
    idx.push(k, k + 1, k + 2, k, k + 2, k + 3)
  }
  const base = h * bare
  const tiers = Math.max(3, Math.round((h - base) / spacing))
  const spread = h * 0.24
  for (let t = 0; t < tiers; t++) {
    const f = t / tiers
    const y = base + (h - base) * f
    const len = spread * Math.pow(1 - f, 0.85) + 0.35
    const n = Math.max(3, Math.round(3 + 4 * (1 - f)))
    const turn = rnd() * Math.PI * 2
    for (let k = 0; k < n; k++) {
      const a = turn + (k / n) * Math.PI * 2 + (rnd() - 0.5) * 0.6
      const droop = 0.3 + rnd() * 0.3 - f * 0.15
      const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a))
      const along = out.clone().multiplyScalar(Math.cos(droop)).setY(-Math.sin(droop))
      // each card rolls a little about its length, so the crown never shows a row of cards edge-on
      const flat = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a))
      const roll = (rnd() - 0.5) * 0.9
      const side = flat.clone().multiplyScalar(Math.cos(roll)).addScaledVector(new THREE.Vector3().crossVectors(along, flat), Math.sin(roll))
      const half = side.multiplyScalar((len * (0.7 + rnd() * 0.25)) / 2)
      const root = new THREE.Vector3(0, y, 0).addScaledVector(out, 0.15)
      const tip = root.clone().addScaledVector(along, len)
      const inner = out.clone().multiplyScalar(0.35).setY(0.6).normalize()
      const outer = out.clone().setY(0.4).normalize()
      card([root.clone().sub(half), root.clone().add(half), tip.clone().add(half), tip.clone().sub(half)], [inner, inner, outer, outer])
    }
  }
  const up = new THREE.Vector3(0, 1, 0)
  for (const a of [0, Math.PI / 2]) {
    const side = new THREE.Vector3(Math.cos(a), 0, Math.sin(a)).multiplyScalar(0.45)
    const [lo, hi] = [new THREE.Vector3(0, h - 1.4, 0), new THREE.Vector3(0, h + 0.3, 0)]
    card([lo.clone().sub(side), lo.clone().add(side), hi.clone().add(side), hi.clone().sub(side)], [up, up, up, up])
  }
  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3))
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3))
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2))
  geo.setIndex(idx)
  return geo
}

/** Branch cards lit from either face with the crown's own normals, a little of the needles' colour glowing through. */
function needleMaterial(): MeshStandardNodeMaterial {
  const map = new THREE.TextureLoader().load('/textures/pine_card.webp')
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = 8
  const m = new MeshStandardNodeMaterial({ map, alphaTest: 0.38, side: THREE.DoubleSide, roughness: 0.85, emissive: 0xffffff, emissiveMap: map, emissiveIntensity: 0.08 })
  m.normalNode = normalViewGeometry
  return m
}

/**
 * Pines in the meadow ring and the forest beyond, by the land's density: the near ones (`near`, for the cameras to
 * keep out of) full, the far ones in fewer cards.
 */
function pines(land: Land, at: (x: number, z: number) => number, rnd: () => number, W: number, L: number): { meshes: THREE.Object3D[]; near: Placement[] } {
  const HEIGHTS = [13, 17, 22]
  const near: Placement[] = []
  const far: Placement[] = []
  for (let i = 0; i < 26000; i++) {
    const r = Math.sqrt(rnd()) * 760
    const a = rnd() * Math.PI * 2
    const [x, z] = [Math.cos(a) * r, Math.sin(a) * r]
    // none in the courtyard's ruins ring, where the cameras roam
    if (Math.abs(x) < W + 10 && Math.abs(z) < L + 10) continue
    const y = at(x, z)
    const lean = Math.abs(at(x + 2, z) - at(x - 2, z)) + Math.abs(at(x, z + 2) - at(x, z - 2))
    const density = land.forest(x, z, y, Math.min(1, lean / 8))
    const keep = r < 180 ? 1 : 0.35
    if (rnd() > density * keep) continue
    const placement = { variant: Math.floor(rnd() * 3), matrix: place(x, y - 0.3, z, rnd() * Math.PI * 2, 0.8 + rnd() * 0.4) }
    ;(r < 180 ? near : far).push(placement)
  }
  const needles = needleMaterial()
  const bark = new THREE.MeshStandardMaterial({ map: paintedTexture('bark', 'albedo'), normalMap: paintedTexture('bark', 'normal'), roughness: 1 })
  const out: THREE.Object3D[] = []
  const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, placements: Placement[]) => {
    if (!placements.length) return
    const mesh = new THREE.InstancedMesh(geo, mat, placements.length)
    placements.forEach((p, i) => mesh.setMatrixAt(i, p.matrix))
    mesh.computeBoundingSphere()
    mesh.name = 'pines'
    out.push(mesh)
  }
  HEIGHTS.forEach((h, v) => {
    const mine = near.filter((p) => p.variant === v)
    instanced(crownGeometry(seeded(101 + v), h, 0.8, 0.18), needles, mine)
    instanced(new THREE.CylinderGeometry(h * 0.012, h * 0.024, h * 0.9, 7, 1, true).translate(0, h * 0.45, 0), bark, mine)
    instanced(crownGeometry(seeded(201 + v), h, 1.7, 0.08), needles, far.filter((p) => p.variant === v))
  })
  return { meshes: out, near }
}

/**
 * The ruins outside the barrier, built like the arena's own (ruins.ts) but out of reach: at the back of each half a
 * gate of two piers and an arch with broken walls running off either way and a few pillars standing proud, and along
 * each side a lower broken wall. Point-symmetric, so neither half looks better.
 */
function perimeter(W: number, L: number): CoverPiece[] {
  const pieces: CoverPiece[] = []
  const rnd = seeded(77)
  for (const s of [1, -1]) {
    const block = (x: number, z: number, hx: number, hz: number, top: number, look: CoverPiece['look'], base = 0) => pieces.push({ shape: { kind: 'block', x: x * s, z: z * s, hx, hz }, base, top, look })
    const z = L + 7.5
    block(-3.6, z, 1.2, 1.2, 9.4, 'pier')
    block(3.6, z, 1.2, 1.2, 9.4, 'pier')
    block(0, z, 4.8, 1.2, 10.6, 'arch', 7)
    for (let x = 6.5; x < W + 6; ) {
      const len = 2.5 + rnd() * 6
      if (rnd() < 0.78) for (const dir of [-1, 1]) block(dir * (x + len / 2), z + (rnd() - 0.5) * 0.8, len / 2, 0.45, (1.2 + rnd() * 3.4 * (1 - (x / (W + 10)) * 0.5)) * (0.7 + rnd() * 0.5), 'wall')
      x += len + 0.8 + rnd() * 3
    }
    for (const x of [-W + 4, -W * 0.55, W * 0.4, W - 6]) block(x, z + 3 + rnd() * 2, 0.65, 0.65, 3 + rnd() * 6, 'pillar')
    for (let zz = -L + 4; zz < L - 4; ) {
      const len = 3 + rnd() * 7
      if (rnd() < 0.6) block(W + 7 + (rnd() - 0.5), zz + len / 2, 0.45, len / 2, 0.9 + rnd() * 2.6, 'wall')
      zz += len + 1 + rnd() * 4
    }
  }
  return pieces
}

/** A cloth banner in a team's colours, its top edge at `top`, swaying from the bottom in a slow wind. */
function bannerMaterial(team: 0 | 1): MeshStandardNodeMaterial {
  const map = new THREE.TextureLoader().load(team === 0 ? '/textures/banner_blue.webp' : '/textures/banner_red.webp')
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = 8
  const m = new MeshStandardNodeMaterial({ map, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.9 })
  // the hanging edge is fixed; the cloth below it swings more the further down it hangs, out of step with its neighbours
  const drop = positionLocal.y.negate().div(BANNER.height)
  const phase = modelPosition.x.mul(0.37).add(modelPosition.z.mul(0.21))
  const swing = sin(time.mul(1.1).add(phase).add(positionLocal.y.mul(0.9))).mul(0.14).add(sin(time.mul(2.6).add(positionLocal.x.mul(2.2)).add(phase)).mul(0.03))
  m.positionNode = positionLocal.add(vec3(0, 0, swing.mul(pow(drop, 1.5))))
  return m
}

const BANNER = { width: 1.35, height: 3.6 }

export interface Valley {
  group: THREE.Group
  /** Boxes the cameras keep out of: the ruins and the trees near the courtyard. */
  proxies: THREE.Box3[]
}

/** Lay out the valley round an arena of half-width `W` and half-length `L`, the low sun along `sun`. */
export function valley(W: number, L: number, sun: THREE.Vector3): Valley {
  const group = new THREE.Group()
  group.name = 'valley'
  const proxies: THREE.Box3[] = []
  const land = landOf(sun)
  const at = (x: number, z: number) => Math.max(land.height(x, z) - 0.05, WATER)
  group.add(terrain(land, W, L))
  const trees = pines(land, at, seeded(5), W, L)
  group.add(...trees.meshes)
  // the cameras keep out of the trunks and lower crowns of the trees nearest the courtyard
  const p = new THREE.Vector3()
  for (const tree of trees.near) {
    p.setFromMatrixPosition(tree.matrix)
    if (Math.hypot(p.x, p.z) < 130) proxies.push(new THREE.Box3(new THREE.Vector3(p.x - 2, p.y, p.z - 2), new THREE.Vector3(p.x + 2, p.y + 12, p.z + 2)))
  }

  const ruins = buildRuins(perimeter(W, L))
  group.add(ruins.group)
  proxies.push(...ruins.proxies)

  // banners on the gates and the arches inside the courtyard, blue on team 0's half, red on team 1's
  const cloth = [bannerMaterial(0), bannerMaterial(1)]
  const banner = new THREE.PlaneGeometry(BANNER.width, BANNER.height, 4, 12).translate(0, -BANNER.height / 2, 0)
  const hang = (x: number, z: number, top: number, facing: number) => {
    const b = new THREE.Mesh(banner, cloth[z < 0 ? 0 : 1])
    b.position.set(x, top, z)
    b.rotation.y = facing
    b.name = 'banner'
    group.add(b)
  }
  for (const s of [1, -1]) {
    // the gate's piers face the courtyard; the arch inside each half (cover.ts, at 24 m) is hung on both faces
    for (const x of [-3.6, 3.6]) hang(x, s * (L + 7.5 - 1.2 - 0.03), 6.8, s > 0 ? Math.PI : 0)
    for (const x of [-3.4, 3.4]) {
      hang(x, s * (24 - 1.1 - 0.03), 6.2, s > 0 ? Math.PI : 0)
      hang(x, s * (24 + 1.1 + 0.03), 6.2, s > 0 ? 0 : Math.PI)
    }
  }

  // tufts of meadow grass: sparse in the courtyard's joints, thick in the meadow round it, never tall enough to hide anyone
  const rnd = seeded(13)
  const tufts: THREE.Matrix4[] = []
  const tuft = new THREE.Object3D()
  for (let i = 0; i < 2400; i++) {
    const inside = i < 300
    const [x, z] = inside ? [(rnd() * 2 - 1) * (W - 1), (rnd() * 2 - 1) * (L - 1)] : [(rnd() * 2 - 1) * (W + 40), (rnd() * 2 - 1) * (L + 40)]
    if (!inside && Math.abs(x) < W + 0.5 && Math.abs(z) < L + 0.5) continue
    const s = inside ? 0.45 + rnd() * 0.35 : 0.5 + rnd() * 0.5
    tuft.position.set(x, at(x, z), z)
    tuft.rotation.set(0, rnd() * Math.PI, 0)
    tuft.scale.set(s, s * (0.8 + rnd() * 0.5), s)
    tuft.updateMatrix()
    tufts.push(tuft.matrix.clone())
  }
  const clump = new THREE.InstancedMesh(crossedCard(1, 1), tuftMaterial(), tufts.length)
  tufts.forEach((m, i) => clump.setMatrixAt(i, m))
  clump.computeBoundingSphere()
  clump.name = 'tufts'
  group.add(clump)

  // boulders in the meadow and down the slope, half sunk
  const boulders: Placement[] = []
  for (let i = 0; i < 40; i++) {
    const r = W + 14 + rnd() * 120
    const a = rnd() * Math.PI * 2
    const [x, z] = [Math.cos(a) * r, Math.sin(a) * r]
    if (Math.abs(x) < W + 4 && Math.abs(z) < L + 4) continue
    const s = 0.9 + rnd() * 2.2
    boulders.push({ variant: Math.floor(rnd() * 3), matrix: place(x, at(x, z) - 0.25 * s, z, rnd() * 6.28, new THREE.Vector3(s * (1 + rnd() * 0.5), s * (0.6 + rnd() * 0.5), s * (1 + rnd() * 0.5))) })
  }
  placeModels(group, 'rocks', boulders, { cast: false, receive: true })
  return { group, proxies }
}
