import * as THREE from 'three'

/**
 * A dev-only probe that reads a scene with rays, so a script driving the game gets, as text, what the camera shows,
 * where each hero stands and what covers it. Callers load it under `import.meta.env.DEV`, so it never ships.
 */

/** A scene the probe can read: the arena's match, or a close-up stage. */
export interface ProbeTarget {
  scene: THREE.Object3D
  camera: THREE.Camera
  /** The canvas the camera draws into, for sizes in pixels. */
  readonly canvas?: HTMLCanvasElement
  /** The heroes on stage, so a hit on one reads as that hero. */
  heroes?: () => ProbeHero[]
}

export interface ProbeHero {
  root: THREE.Object3D
  name: string
  team?: number
  alive?: boolean
}

/** One thing a ray met. */
export interface ProbeHit {
  /** The hero it belongs to, by name and by its index in `heroes()`. */
  hero?: string
  heroIndex?: number
  /** The nearest named object up the tree (the body, `outfit`, `gear:crown`, `surroundings`), else the mesh's geometry. */
  part: string
  distance: number
  point: THREE.Vector3Tuple
}

/** What the camera sees on a grid of rays: the nearest solid hit per cell, row by row from the top left. */
export interface ProbeView {
  cols: number
  rows: number
  cells: (ProbeHit | undefined)[]
  /** Sheer things in front of those hits (glows, barriers, floor rings), by how many cells each one tints. */
  veils: Record<string, number>
}

export interface HeroFacts {
  name: string
  team?: number
  alive?: boolean
  /** Where it stands, in metres. */
  at: THREE.Vector3Tuple
  /** Metres above the scenery under it; undefined over nothing. */
  altitude?: number
  /** Its box on the picture, 0 to 1 from the top left; undefined when it is all behind the camera. */
  screen?: { left: number; top: number; right: number; bottom: number }
  /** How tall it stands on the canvas, in CSS pixels. */
  pixels?: number
  /** The share of rays aimed at it that reach it first; undefined when none found it. */
  visible?: number
  /** What covers it, most first. */
  coveredBy: string[]
  nearestEnemy?: { name: string; distance: number; inSight: boolean }
}

interface Scan {
  target: ProbeTarget
  /** What rays test: each drawn mesh, or a posed copy of it when bones or morphs move its vertices. */
  meshes: THREE.Mesh[]
  /** The drawn mesh behind each posed copy. */
  drawn: Map<THREE.Object3D, THREE.Mesh>
  heroes: ProbeHero[]
  /** The hero each drawn hero mesh belongs to. */
  owner: Map<THREE.Object3D, number>
}

const raycaster = new THREE.Raycaster()
const pointer = new THREE.Vector2()
const corner = new THREE.Vector3()
const DOWN = new THREE.Vector3(0, -1, 0)
const TEAM_LETTERS = ['ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz']
const MARKS = '#=+%&@$*:;!?0123456789'

/** Glows, barriers, floor rings and the sky add light or draw without depth, so whatever lies behind them still shows. */
const sheer = (m: THREE.Material | undefined) => !m || m.blending === THREE.AdditiveBlending || !m.depthWrite || (m.transparent && m.opacity < 0.95)
const materialsOf = (mesh: THREE.Mesh) => (Array.isArray(mesh.material) ? mesh.material : [mesh.material])
const sheerHit = (hit: THREE.Intersection) => {
  const mesh = hit.object as THREE.Mesh
  return sheer(Array.isArray(mesh.material) ? mesh.material[hit.face?.materialIndex ?? 0] : mesh.material)
}

const round = (n: number) => Math.round(n * 100) / 100
const clamp01 = (n: number) => Math.min(1, Math.max(0, n))
const pct = (n: number) => `${Math.round(n * 100)}%`
const xyz = (p: THREE.Vector3Tuple) => `(${p.map((n) => n.toFixed(1)).join(', ')})`

/**
 * A still copy of a mesh in its current pose, in world space. three.js re-poses a skinned, morphed vertex every time a
 * ray tests a triangle that uses it, which made one read of a 10v10 take longer than a minute; posing each once is quick.
 */
function posed(mesh: THREE.Mesh): THREE.Mesh {
  const source = mesh.geometry
  const count = source.getAttribute('position').count
  const positions = new Float32Array(count * 3)
  const v = new THREE.Vector3()
  for (let i = 0; i < count; i++) mesh.getVertexPosition(i, v).applyMatrix4(mesh.matrixWorld).toArray(positions, i * 3)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  if (source.index) geometry.setIndex(source.index)
  for (const g of source.groups) geometry.addGroup(g.start, g.count, g.materialIndex)
  geometry.setDrawRange(source.drawRange.start, source.drawRange.count)
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  const copy = new THREE.Mesh(geometry, mesh.material)
  copy.layers.mask = mesh.layers.mask
  return copy
}

/** Everything the camera would draw now, with moving meshes posed as they stand. */
function scan(target: ProbeTarget): Scan {
  target.scene.updateMatrixWorld()
  target.camera.updateMatrixWorld()
  const heroes = target.heroes?.() ?? []
  const roots = new Map(heroes.map((h, i) => [h.root, i]))
  const owner = new Map<THREE.Object3D, number>()
  const drawn = new Map<THREE.Object3D, THREE.Mesh>()
  const meshes: THREE.Mesh[] = []
  target.scene.traverseVisible((o) => {
    const mesh = o as THREE.Mesh
    if (!mesh.isMesh || !o.layers.test(target.camera.layers)) return
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    if (materials.every((m) => !m.visible || (m.transparent && m.opacity < 0.02))) return
    for (let p: THREE.Object3D | null = o; p; p = p.parent) {
      const i = roots.get(p)
      if (i === undefined) continue
      owner.set(o, i)
      break
    }
    if (!(o as THREE.SkinnedMesh).isSkinnedMesh && !mesh.morphTargetInfluences?.some((w) => w !== 0)) {
      meshes.push(mesh)
      return
    }
    const copy = posed(mesh)
    drawn.set(copy, mesh)
    meshes.push(copy)
  })
  return { target, meshes, drawn, heroes, owner }
}

/** The drawn mesh a ray-tested mesh stands for. */
const drawnOf = (s: Scan, mesh: THREE.Object3D) => s.drawn.get(mesh) ?? mesh

function label(s: Scan, hit: THREE.Intersection): ProbeHit {
  const heroIndex = s.owner.get(hit.object)
  const root = heroIndex === undefined ? undefined : s.heroes[heroIndex].root
  let part: string | undefined
  for (let o: THREE.Object3D | null = hit.object; o && o !== root && !part; o = o.parent) if (o.name) part = o.name
  const mesh = hit.object as THREE.Mesh
  part ??= `${mesh.type}(${mesh.geometry.type})`
  // the outfit is one mesh with a material per item, so the face says which item was hit
  const material = Array.isArray(mesh.material) && hit.face ? mesh.material[hit.face.materialIndex] : undefined
  if (material?.name) part += `:${material.name}`
  return {
    hero: heroIndex === undefined ? undefined : s.heroes[heroIndex].name,
    heroIndex,
    part,
    distance: round(hit.distance),
    point: hit.point.toArray().map(round) as THREE.Vector3Tuple,
  }
}

/** The ray's hits, nearest first, each pointing at the drawn mesh rather than its posed copy. */
function hitsOf(s: Scan, meshes: THREE.Mesh[]): THREE.Intersection[] {
  const hits = raycaster.intersectObjects(meshes, false)
  for (const hit of hits) hit.object = drawnOf(s, hit.object)
  return hits
}

/** Every hit under a point of the picture, nearest first; x and y run 0 to 1 from the top left. */
function cast(s: Scan, x: number, y: number): THREE.Intersection[] {
  const camera = s.target.camera
  const { near = 0, far = Infinity } = camera as Partial<THREE.PerspectiveCamera>
  pointer.set(x * 2 - 1, 1 - y * 2)
  raycaster.setFromCamera(pointer, camera)
  raycaster.layers.mask = camera.layers.mask
  raycaster.near = near
  raycaster.far = far
  return hitsOf(s, s.meshes)
}

/** The first scenery hit along a ray in the world, within `far` metres. */
function sceneryHit(s: Scan, scenery: THREE.Mesh[], from: THREE.Vector3, direction: THREE.Vector3, far = Infinity): THREE.Intersection | undefined {
  raycaster.set(from, direction)
  raycaster.near = 0
  raycaster.far = far
  return hitsOf(s, scenery)[0]
}

function lookIn(s: Scan, cols: number, rows: number): ProbeView {
  const cells: (ProbeHit | undefined)[] = []
  const veils: Record<string, number> = {}
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) {
      const hits = cast(s, (c + 0.5) / cols, (r + 0.5) / rows)
      const k = hits.findIndex((h) => !sheerHit(h))
      cells.push(k < 0 ? undefined : label(s, hits[k]))
      const seen = new Set<string>()
      for (const hit of k < 0 ? hits : hits.slice(0, k)) {
        const { hero, part } = label(s, hit)
        seen.add(hero ? `${hero} ${part}` : part)
      }
      for (const name of seen) veils[name] = (veils[name] ?? 0) + 1
    }
  return { cols, rows, cells, veils }
}

function boxOf(s: Scan, hero: number): THREE.Box3 {
  const box = new THREE.Box3()
  for (const mesh of s.meshes) {
    if (s.owner.get(drawnOf(s, mesh)) !== hero) continue
    // a posed copy is already in world space, so its matrix is the identity
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
    box.union(mesh.geometry.boundingBox!.clone().applyMatrix4(mesh.matrixWorld))
  }
  return box
}

/** A world box's rectangle on the picture, 0 to 1 from the top left; undefined when it is all behind the camera. */
function onPicture(box: THREE.Box3, camera: THREE.Camera): HeroFacts['screen'] {
  if (box.isEmpty()) return undefined
  let left = Infinity
  let top = Infinity
  let right = -Infinity
  let bottom = -Infinity
  for (let k = 0; k < 8; k++) {
    corner.set(k & 1 ? box.max.x : box.min.x, k & 2 ? box.max.y : box.min.y, k & 4 ? box.max.z : box.min.z)
    // a corner behind the camera projects through the eye and lands mirrored, so it is left out
    if (corner.clone().applyMatrix4(camera.matrixWorldInverse).z >= 0) continue
    corner.project(camera)
    left = Math.min(left, (corner.x + 1) / 2)
    right = Math.max(right, (corner.x + 1) / 2)
    top = Math.min(top, (1 - corner.y) / 2)
    bottom = Math.max(bottom, (1 - corner.y) / 2)
  }
  return left === Infinity ? undefined : { left, top, right, bottom }
}

function factsOf(s: Scan): HeroFacts[] {
  // the ground and cover, without heroes or effects, for altitude and line of sight
  const scenery = s.meshes.filter((m) => {
    const mesh = s.drawn.get(m) ?? m
    if (s.owner.has(mesh) || materialsOf(mesh).every(sheer)) return false
    for (let p: THREE.Object3D | null = mesh; p; p = p.parent) if (p.name === 'world-fx') return false
    return true
  })
  const boxes = s.heroes.map((_, i) => boxOf(s, i))
  const feet = s.heroes.map((h) => h.root.getWorldPosition(new THREE.Vector3()))
  const chest = (i: number) => {
    const box = boxes[i]
    return box.isEmpty() ? feet[i].clone().setY(feet[i].y + 1) : feet[i].clone().setY(box.min.y + 0.65 * (box.max.y - box.min.y))
  }
  const canvas = s.target.canvas
  const height = canvas ? canvas.clientHeight || canvas.height : 0
  return s.heroes.map((hero, i) => {
    const screen = onPicture(boxes[i], s.target.camera)
    // aim a 4 by 6 grid of rays at the hero's rectangle; each ray that meets the hero says whether it met it first
    let reached = 0
    let covered = 0
    const covers = new Map<string, number>()
    if (screen) {
      const [x0, x1, y0, y1] = [clamp01(screen.left), clamp01(screen.right), clamp01(screen.top), clamp01(screen.bottom)]
      if (x1 > x0 && y1 > y0)
        for (let r = 0; r < 6; r++)
          for (let c = 0; c < 4; c++) {
            const hits = cast(s, x0 + ((c + 0.5) / 4) * (x1 - x0), y0 + ((r + 0.5) / 6) * (y1 - y0)).filter((h) => !sheerHit(h))
            const k = hits.findIndex((h) => s.owner.get(h.object) === i)
            if (k < 0) continue
            if (k === 0) {
              reached++
              continue
            }
            covered++
            const first = label(s, hits[0])
            const name = first.hero ?? first.part
            covers.set(name, (covers.get(name) ?? 0) + 1)
          }
    }
    const ground = sceneryHit(s, scenery, feet[i].clone().setY(feet[i].y + 0.5), DOWN)
    let nearestEnemy: HeroFacts['nearestEnemy']
    if (hero.team !== undefined) {
      let best = -1
      s.heroes.forEach((other, j) => {
        if (other.team === undefined || other.team === hero.team || other.alive === false) return
        if (best < 0 || feet[j].distanceTo(feet[i]) < feet[best].distanceTo(feet[i])) best = j
      })
      if (best >= 0) {
        const from = chest(i)
        const to = chest(best).sub(from)
        const gap = to.length()
        nearestEnemy = { name: s.heroes[best].name, distance: round(feet[best].distanceTo(feet[i])), inSight: !sceneryHit(s, scenery, from, to.normalize(), gap) }
      }
    }
    return {
      name: hero.name,
      team: hero.team,
      alive: hero.alive,
      at: feet[i].toArray().map(round) as THREE.Vector3Tuple,
      altitude: ground ? round(feet[i].y - ground.point.y) : undefined,
      screen: screen && { left: round(screen.left), top: round(screen.top), right: round(screen.right), bottom: round(screen.bottom) },
      pixels: screen && height ? Math.round((clamp01(screen.bottom) - clamp01(screen.top)) * height) : undefined,
      visible: reached + covered ? round(reached / (reached + covered)) : undefined,
      coveredBy: [...covers].sort((a, b) => b[1] - a[1]).map(([name]) => name),
      nearestEnemy,
    }
  })
}

/** One letter per hero: capitals for the first team (or a stage's hero), small letters for the second. */
function heroLetters(heroes: ProbeHero[]): string[] {
  const used = [0, 0]
  return heroes.map((h) => {
    const team = h.team === 1 ? 1 : 0
    return TEAM_LETTERS[team][used[team]++] ?? '?'
  })
}

/** What the camera sees, as a grid of the nearest hit per cell. */
export function look(target: ProbeTarget, cols = 48, rows = 18): ProbeView {
  return lookIn(scan(target), cols, rows)
}

/** Every hit under a point of the picture, nearest first; x and y run 0 to 1 from the top left. */
export function at(target: ProbeTarget, x: number, y: number): ProbeHit[] {
  const s = scan(target)
  return cast(s, x, y).map((hit) => label(s, hit))
}

/** Where each hero stands, how it shows on the picture, what covers it and whether its nearest enemy is in sight. */
export function heroFacts(target: ProbeTarget): HeroFacts[] {
  return factsOf(scan(target))
}

/** The camera, the picture as letters and marks, and every hero's place, in one text a script can read. */
export function report(target: ProbeTarget, cols = 48, rows = 18): string {
  const started = performance.now()
  const s = scan(target)
  const view = lookIn(s, cols, rows)
  const heroes = factsOf(s)
  const letters = heroLetters(s.heroes)
  // heroes keep their letters; every other thing gets a mark, the commonest first
  const keyOf = (hit: ProbeHit | undefined) => (hit === undefined ? '' : hit.heroIndex !== undefined ? `\u0000${hit.heroIndex}` : hit.part)
  const counts = new Map<string, number>()
  for (const cell of view.cells) counts.set(keyOf(cell), (counts.get(keyOf(cell)) ?? 0) + 1)
  const ranked = [...counts].sort((a, b) => b[1] - a[1])
  const marks = new Map<string, string>([['', '.']])
  let next = 0
  for (const [key] of ranked) if (!marks.has(key)) marks.set(key, key.startsWith('\u0000') ? letters[Number(key.slice(1))] : (MARKS[next++] ?? '?'))
  const nameOf = (key: string) => (key === '' ? 'sky or nothing' : key.startsWith('\u0000') ? s.heroes[Number(key.slice(1))].name : key)

  const camera = target.camera
  const facing = camera.getWorldDirection(new THREE.Vector3())
  const { fov } = camera as Partial<THREE.PerspectiveCamera>
  const canvas = target.canvas
  const lines = [
    `camera at ${xyz(camera.getWorldPosition(new THREE.Vector3()).toArray())}, heading ${Math.round(THREE.MathUtils.radToDeg(Math.atan2(facing.x, facing.z)))}° (0° looks along +z), ` +
      `pitch ${Math.round(THREE.MathUtils.radToDeg(Math.asin(facing.y)))}°${fov ? `, fov ${fov}°` : ''}` +
      `${canvas ? `, canvas ${canvas.clientWidth}×${canvas.clientHeight} px` : ''} · ${s.meshes.length} meshes · read in ${Math.round(performance.now() - started)} ms`,
    `picture, ${cols}×${rows} rays, nearest thing per cell:`,
  ]
  for (let r = 0; r < rows; r++) lines.push(view.cells.slice(r * cols, (r + 1) * cols).map((c) => marks.get(keyOf(c))).join(''))
  lines.push(`key: ${ranked.map(([key, n]) => `${marks.get(key)} ${nameOf(key)} ${n}`).join(' · ')}`)
  const veils = Object.entries(view.veils).sort((a, b) => b[1] - a[1])
  if (veils.length) lines.push(`seen through: ${veils.slice(0, 6).map(([name, n]) => `${name} ${n}`).join(' · ')}`)
  heroes.forEach((h, i) => {
    const where =
      h.screen === undefined
        ? 'behind the camera'
        : h.screen.right < 0 || h.screen.left > 1 || h.screen.bottom < 0 || h.screen.top > 1
          ? 'off the picture'
          : `on the picture x ${pct(h.screen.left)}–${pct(h.screen.right)}, y ${pct(h.screen.top)}–${pct(h.screen.bottom)}${h.pixels ? `, ${h.pixels} px tall` : ''}`
    const seen = h.visible === undefined ? 'no ray reached it' : `${pct(h.visible)} visible${h.coveredBy.length ? `, covered by ${h.coveredBy.join(', ')}` : ''}`
    const enemy = h.nearestEnemy ? ` · nearest enemy ${h.nearestEnemy.name} ${h.nearestEnemy.distance} m, ${h.nearestEnemy.inSight ? 'in sight' : 'blocked'}` : ''
    const team = h.team === undefined ? '' : ` (team ${h.team}${h.alive === false ? ', dead' : ''})`
    lines.push(`${letters[i]} ${h.name}${team} · at ${xyz(h.at)}, ${h.altitude === undefined ? 'over nothing' : `${h.altitude} m up`} · ${where} · ${seen}${enemy}`)
  })
  return lines.join('\n')
}

/** The scene's tree to a depth, with how many visible meshes and triangles each branch holds. */
export function outline(target: ProbeTarget, depth = 2): string {
  const lines: string[] = []
  const walk = (o: THREE.Object3D, level: number) => {
    let meshes = 0
    let triangles = 0
    o.traverseVisible((c) => {
      const mesh = c as THREE.Mesh
      if (!mesh.isMesh) return
      meshes++
      triangles += (mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position')?.count ?? 0) / 3
    })
    lines.push(`${'  '.repeat(level)}${o.name || o.type}${o.visible ? '' : ' (hidden)'} · ${meshes} meshes, ${Math.round(triangles)} triangles`)
    if (level >= depth) return
    o.children.slice(0, 40).forEach((c) => walk(c, level + 1))
    if (o.children.length > 40) lines.push(`${'  '.repeat(level + 1)}… ${o.children.length - 40} more`)
  }
  walk(target.scene, 0)
  return lines.join('\n')
}

const targets = new Map<string, ProbeTarget>()

function pick(name?: string): ProbeTarget {
  const target = name === undefined ? (targets.get('arena') ?? [...targets.values()].pop()) : targets.get(name)
  if (!target) throw new Error(`no scene ${name ?? 'open'} to probe (open: ${[...targets.keys()].join(', ') || 'none'})`)
  return target
}

const probe = {
  /** The scenes open now: `arena`, and `stage:<label>` for each close-up stage. */
  targets: () => [...targets.keys()],
  report: (name?: string, cols?: number, rows?: number) => report(pick(name), cols, rows),
  look: (name?: string, cols?: number, rows?: number) => look(pick(name), cols, rows),
  at: (x: number, y: number, name?: string) => at(pick(name), x, y),
  heroes: (name?: string) => heroFacts(pick(name)),
  outline: (name?: string, depth?: number) => outline(pick(name), depth),
}

/** Let `window.__probe` read a scene until the returned call forgets it. */
export function watch(name: string, target: ProbeTarget): () => void {
  let key = name
  for (let n = 2; targets.has(key); n++) key = `${name} ${n}`
  targets.set(key, target)
  if (typeof window !== 'undefined') (window as unknown as { __probe?: typeof probe }).__probe = probe
  return () => {
    if (targets.get(key) === target) targets.delete(key)
  }
}
