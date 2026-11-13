import * as THREE from 'three'

/**
 * A whip's thong on a chain of bones. In the hand it swings after the hand (Verlet at a fixed rate, as tails.ts's
 * tails do): stiff near the handle, loose to the tip, pulled down and kept off the floor, so a lash's follow-through
 * cracks out behind the arm. Put away it lies coiled under its handle on the carry slot. The chain is fitted to the
 * piece's own mesh when it is hung (arms.ts), so any thong modelled hanging from its grip takes it.
 */

/** The pieces with a thong. */
export const ROPES: ReadonlySet<string> = new Set(['whip'])

/** Joints down the thong, its root (the handle's end) and its tip included. */
const JOINTS = 12
/** How far below the grip the handle ends, in the piece's metres. */
const HANDLE = 0.1
/** Steps a second; velocity kept per step; passes over the links each step. */
const RATE = 60
const KEEP = 0.985
const PASSES = 4
const GRAVITY = -9.8
/** How hard each joint is pulled back toward the thong's modelled shape per step, root to tip. */
const STIFF: [number, number] = [0.2, 0]
/** The most a link turns from the one before it. */
const BEND = (25 * Math.PI) / 180
/** Loops in a coil, and how far each loop sits out from the last. */
const LOOPS = 2
const STACK = 0.015

export interface Rope {
  /** Advance the thong by `dt` seconds after the hand; `floor` is the ground's height where the hero stands. */
  step: (dt: number, floor?: number) => void
  /** Coiled under the handle (put away), or hanging free again (in hand). */
  coil: (on: boolean) => void
}

/**
 * Re-skins `piece`'s mesh (a thong modelled hanging down -y from its grip at the origin) onto a chain of bones and
 * turns it to come out of the hand on +y, as a blade does (gear.ts); undefined for a piece without a mesh.
 */
export function makeRope(piece: THREE.Object3D): Rope | undefined {
  let mesh: THREE.Mesh | undefined
  piece.traverse((o) => {
    if (!mesh && (o as THREE.Mesh).isMesh) mesh = o as THREE.Mesh
  })
  if (!mesh?.parent) return undefined
  // the thong out of the thumb's side, as a blade: turned half round about z, its curl kept on the same side
  const geometry = mesh.geometry.clone().rotateZ(Math.PI)
  const position = geometry.getAttribute('position')
  geometry.computeBoundingBox()
  const tipY = geometry.boundingBox!.max.y
  const reach = tipY - HANDLE
  if (reach <= 0) return undefined
  const n = JOINTS - 1
  const step = reach / n
  // the thong's middle at each joint's height: the mean of the skin around it
  const rest = Array.from({ length: JOINTS }, (_, k) => {
    const y = HANDLE + step * k
    let [x, z, count] = [0, 0, 0]
    for (let i = 0; i < position.count; i++) {
      const v = position.getY(i)
      if (Math.abs(v - y) > step / 2) continue
      x += position.getX(i)
      z += position.getZ(i)
      count++
    }
    return new THREE.Vector3(count ? x / count : 0, y, count ? z / count : 0)
  })
  // bone 0 is the handle; bone 1 + k sits at joint k and turns the link from it to the next
  const handle = new THREE.Bone()
  const bones = [handle, ...rest.map(() => new THREE.Bone())]
  rest.forEach((p, k) => {
    bones[k + 1].position.copy(k ? p.clone().sub(rest[k - 1]) : p)
    bones[k].add(bones[k + 1])
  })
  const joints = new Uint16Array(position.count * 4)
  const weights = new Float32Array(position.count * 4)
  for (let i = 0; i < position.count; i++) {
    const t = (position.getY(i) - HANDLE) / step
    if (t <= 0) {
      weights[i * 4] = 1
      continue
    }
    const k = Math.min(Math.floor(t), n - 1)
    const f = Math.min(t - k, 1)
    joints[i * 4] = k + 1
    joints[i * 4 + 1] = k + 2
    weights[i * 4] = 1 - f
    weights[i * 4 + 1] = f
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(joints, 4))
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4))
  const skin = new THREE.SkinnedMesh(geometry, mesh.material)
  skin.name = mesh.name
  skin.position.copy(mesh.position)
  skin.quaternion.copy(mesh.quaternion)
  skin.scale.copy(mesh.scale)
  skin.castShadow = mesh.castShadow
  skin.frustumCulled = false
  skin.add(handle)
  mesh.parent.add(skin)
  mesh.removeFromParent()
  skin.updateMatrixWorld(true)
  skin.bind(new THREE.Skeleton(bones))

  // each link's way and length at rest, in the handle's space
  const ways = rest.slice(1).map((p, k) => p.clone().sub(rest[k]))
  const lengths = ways.map((w) => w.length())
  ways.forEach((w) => w.normalize())

  /** Lays the chain through `points` (the handle's space), each link turned from its modelled way to the new one. */
  const lay = (points: readonly THREE.Vector3[]) => {
    const parent = new THREE.Quaternion()
    const turn = new THREE.Quaternion()
    const way = new THREE.Vector3()
    for (let k = 0; k < n; k++) {
      way.subVectors(points[k + 1], points[k])
      if (way.lengthSq() < 1e-12) continue
      turn.setFromUnitVectors(ways[k], way.normalize())
      bones[k + 1].quaternion.copy(parent).invert().multiply(turn)
      parent.copy(turn)
    }
  }

  const coiled = (() => {
    const r = reach / (2 * Math.PI * LOOPS)
    const centre = rest[0].clone().add(new THREE.Vector3(0, r, 0))
    let along = 0
    return rest.map((_, k) => {
      if (k) along += lengths[k - 1]
      const a = along / r
      return centre.clone().add(new THREE.Vector3((STACK * a) / (2 * Math.PI), -r * Math.cos(a), r * Math.sin(a)))
    })
  })()

  const pos = rest.map((p) => p.clone())
  const prev = rest.map((p) => p.clone())
  const home = rest.map((p) => p.clone())
  const local = rest.map((p) => p.clone())
  const into = new THREE.Matrix4()
  const scaled = new THREE.Vector3()
  let away = true
  let fresh = true
  let carry = 0

  const coil = (on: boolean) => {
    away = on
    fresh = true
    if (on) lay(coiled)
  }
  coil(true)

  return {
    coil,
    step: (dt, floor) => {
      if (away) return
      handle.updateWorldMatrix(true, false)
      const frame = handle.matrixWorld
      const scale = scaled.setFromMatrixScale(frame).x
      rest.forEach((p, k) => home[k].copy(p).applyMatrix4(frame))
      // put out (or flung across the arena), it starts hanging as modelled
      if (fresh || pos[0].distanceToSquared(home[0]) > 4) {
        home.forEach((p, k) => (pos[k].copy(p), prev[k].copy(p)))
        fresh = false
        carry = 0
      }
      const h = 1 / RATE
      carry = Math.min(carry + dt, h * 4)
      while (carry >= h) {
        carry -= h
        pos[0].copy(home[0])
        prev[0].copy(home[0])
        for (let k = 1; k < JOINTS; k++) {
          const p = pos[k]
          const v = p.clone().sub(prev[k]).multiplyScalar(KEEP)
          prev[k].copy(p)
          p.add(v)
          p.y += GRAVITY * h * h
          const stiff = STIFF[1] + (STIFF[0] - STIFF[1]) * (1 - k / n) ** 6
          p.lerp(home[k], stiff)
        }
        for (let pass = 0; pass < PASSES; pass++)
          for (let k = 1; k < JOINTS; k++) {
            // leather bends, it doesn't kink: a joint is kept as far from the one two back as a BEND turn would leave it
            if (k > 1) {
              const d = pos[k].clone().sub(pos[k - 2])
              const least = (lengths[k - 2] + lengths[k - 1]) * scale * Math.cos(BEND / 2)
              const l = d.length()
              if (l < least) pos[k].copy(pos[k - 2]).addScaledVector(d, least / (l || 1e-6))
            }
            const d = pos[k].clone().sub(pos[k - 1])
            const l = d.length() || 1e-6
            pos[k].copy(pos[k - 1]).addScaledVector(d, (lengths[k - 1] * scale) / l)
            if (floor !== undefined && pos[k].y < floor + 0.01) pos[k].y = floor + 0.01
          }
      }
      into.copy(frame).invert()
      pos.forEach((p, k) => local[k].copy(p).applyMatrix4(into))
      lay(local)
    },
  }
}
