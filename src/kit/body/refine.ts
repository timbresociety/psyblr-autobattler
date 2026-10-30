import * as THREE from 'three'

/**
 * A finer body for close looks (the creator's studio). The bodies share one coarse proxy (about 2,600 points), which
 * reads faceted at the jaw and cheeks up close, more so once a face is sculpted. Each pass splits every triangle in
 * four and pushes each new point on an edge out onto the curve its two ends' normals describe (Phong tessellation),
 * so the head reads round. The body's own points stay where they are, so a fitted face, the clothes over it and
 * anything bound to a point still sit right; and the two copies of a point on a UV seam share a position and a normal,
 * so a seam's new points land together and nothing cracks open.
 *
 * Every other attribute is carried along its edges: texture coordinates and colours halfway, skin weights merged
 * bone by bone (the four strongest kept). Draw groups stay in order, four times as long.
 */

/**
 * How far a new point leans from the flat midpoint onto the curve (Phong tessellation's alpha; 0 is flat). A half puts
 * an edge's midpoint back on the circle its ends lie on, so the body rounds out without swelling past its clothes.
 */
const BEND = 0.5

export function refineGeometry(source: THREE.BufferGeometry, passes = 1): THREE.BufferGeometry {
  let geo = source
  for (let p = 0; p < passes; p++) geo = splitOnce(geo)
  return geo
}

function splitOnce(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const index = geo.getIndex()
  const position = geo.getAttribute('position')
  const normal = geo.getAttribute('normal')
  if (!index || !position || !normal) throw new Error('refineGeometry needs an indexed geometry with normals')
  const n = position.count
  const tri = index.array
  // every edge once, the new point's number by its two ends
  const mids = new Map<number, number>()
  const ends: number[] = []
  const out = new Uint32Array(tri.length * 4)
  const mid = (a: number, b: number) => {
    const key = a < b ? a * n + b : b * n + a
    let m = mids.get(key)
    if (m === undefined) {
      m = n + ends.length / 2
      mids.set(key, m)
      ends.push(a, b)
    }
    return m
  }
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t]
    const b = tri[t + 1]
    const c = tri[t + 2]
    const ab = mid(a, b)
    const bc = mid(b, c)
    const ca = mid(c, a)
    out.set([a, ab, ca, ab, b, bc, ca, bc, c, ab, bc, ca], t * 4)
  }
  const added = ends.length / 2
  const total = n + added
  const next = new THREE.BufferGeometry()

  // positions: Phong tessellation on each edge; normals: the two ends' normals, averaged
  const pos = new Float32Array(total * 3)
  const nor = new Float32Array(total * 3)
  for (let i = 0; i < n; i++) {
    pos.set([position.getX(i), position.getY(i), position.getZ(i)], i * 3)
    nor.set([normal.getX(i), normal.getY(i), normal.getZ(i)], i * 3)
  }
  for (let e = 0; e < added; e++) {
    const a = ends[e * 2] * 3
    const b = ends[e * 2 + 1] * 3
    const at = (n + e) * 3
    const mx = (pos[a] + pos[b]) / 2
    const my = (pos[a + 1] + pos[b + 1]) / 2
    const mz = (pos[a + 2] + pos[b + 2]) / 2
    // the midpoint projected onto each end's tangent plane, and the two projections averaged
    const da = (mx - pos[a]) * nor[a] + (my - pos[a + 1]) * nor[a + 1] + (mz - pos[a + 2]) * nor[a + 2]
    const db = (mx - pos[b]) * nor[b] + (my - pos[b + 1]) * nor[b + 1] + (mz - pos[b + 2]) * nor[b + 2]
    pos[at] = mx - BEND * ((da * nor[a] + db * nor[b]) / 2)
    pos[at + 1] = my - BEND * ((da * nor[a + 1] + db * nor[b + 1]) / 2)
    pos[at + 2] = mz - BEND * ((da * nor[a + 2] + db * nor[b + 2]) / 2)
    const nx = nor[a] + nor[b]
    const ny = nor[a + 1] + nor[b + 1]
    const nz = nor[a + 2] + nor[b + 2]
    const len = Math.hypot(nx, ny, nz) || 1
    nor.set([nx / len, ny / len, nz / len], at)
  }
  next.setAttribute('position', new THREE.BufferAttribute(pos, 3))
  next.setAttribute('normal', new THREE.BufferAttribute(nor, 3))

  const skinIndex = geo.getAttribute('skinIndex')
  const skinWeight = geo.getAttribute('skinWeight')
  for (const [name, attr] of Object.entries(geo.attributes)) {
    if (name === 'position' || name === 'normal' || name === 'skinIndex' || name === 'skinWeight') continue
    next.setAttribute(name, halfway(attr, ends, total))
  }
  if (skinIndex && skinWeight) {
    const [joints, weights] = mergedSkin(skinIndex, skinWeight, ends, total)
    next.setAttribute('skinIndex', joints)
    next.setAttribute('skinWeight', weights)
  }
  next.setIndex(new THREE.BufferAttribute(out, 1))
  for (const g of geo.groups) next.addGroup(g.start * 4, g.count * 4, g.materialIndex)
  next.computeBoundingSphere()
  return next
}

/** An attribute with each new point halfway between its edge's two ends. */
function halfway(attr: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, ends: number[], total: number): THREE.BufferAttribute {
  const size = attr.itemSize
  const n = attr.count
  const values = new Float32Array(total * size)
  for (let i = 0; i < n; i++) for (let k = 0; k < size; k++) values[i * size + k] = attr.getComponent(i, k)
  for (let e = 0; e < ends.length / 2; e++) {
    const a = ends[e * 2] * size
    const b = ends[e * 2 + 1] * size
    for (let k = 0; k < size; k++) values[(n + e) * size + k] = (values[a + k] + values[b + k]) / 2
  }
  return new THREE.BufferAttribute(values, size, attr.normalized)
}

/** Skin weights for the new points: both ends' bones at half weight each, summed, the four strongest renormalised. */
function mergedSkin(skinIndex: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, skinWeight: THREE.BufferAttribute | THREE.InterleavedBufferAttribute, ends: number[], total: number): [THREE.BufferAttribute, THREE.BufferAttribute] {
  const n = skinIndex.count
  const joints = new Uint16Array(total * 4)
  const weights = new Float32Array(total * 4)
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 4; k++) {
      joints[i * 4 + k] = skinIndex.getComponent(i, k)
      weights[i * 4 + k] = skinWeight.getComponent(i, k)
    }
  const sum = new Map<number, number>()
  for (let e = 0; e < ends.length / 2; e++) {
    sum.clear()
    for (const end of [ends[e * 2], ends[e * 2 + 1]])
      for (let k = 0; k < 4; k++) {
        const w = weights[end * 4 + k]
        if (w > 0) sum.set(joints[end * 4 + k], (sum.get(joints[end * 4 + k]) ?? 0) + w / 2)
      }
    const strongest = [...sum].sort((x, y) => y[1] - x[1]).slice(0, 4)
    const kept = strongest.reduce((s, [, w]) => s + w, 0) || 1
    strongest.forEach(([joint, w], k) => {
      joints[(n + e) * 4 + k] = joint
      weights[(n + e) * 4 + k] = w / kept
    })
  }
  return [new THREE.BufferAttribute(joints, 4), new THREE.BufferAttribute(weights, 4)]
}
