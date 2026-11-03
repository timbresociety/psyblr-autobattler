import { readFileSync } from 'node:fs'
import { Quaternion, Vector3 } from 'three'
import { beforeAll, describe, expect, it } from 'vitest'
import { parseFaceBasis, type FaceBasis } from '../body/face-basis.js'
import { readBody, type BodyFile } from '../body/node.js'
import { weldedNormals, weldValues } from '../body/surface.js'
import { evaluate, type Binding } from './bind.js'
import { EYE_LIMIT } from '../rig/limits.js'
import {
  ARKIT_SHAPES,
  blendCollar,
  blinkState,
  boundDeltas,
  clampTurn,
  collarRing,
  eyeIds,
  headShare,
  headTriangles,
  jawFit,
  LITE_SHAPES,
  sphereOf,
  stepBlink,
  type CardPart,
  type HeadMeta,
} from './head.js'

const json = <T>(path: string) => JSON.parse(readFileSync(path, 'utf8')) as T

let body: BodyFile
let pos: Float32Array
let normals: Float32Array
let meta: HeadMeta
let shapes: FaceBasis
let scale: number
const shape = (name: string) => shapes.groups[meta.shapes.indexOf(name as never)]
const binding = (p: CardPart): Binding => ({ tri: Uint16Array.from(p.tri), st: Float32Array.from(p.st), lift: Float32Array.from(p.lift) })
const surface = (positions: ArrayLike<number>) => ({ positions, normals, triangles: body.surface.triangles })

/** The body's welded positions with a shape on, at full weight. */
function posed(name: string, w = 1): Float32Array {
  const out = Float32Array.from(pos)
  const g = shape(name)
  for (let i = 0; i < g.ids.length; i++) for (let k = 0; k < 3; k++) out[g.ids[i] * 3 + k] += g.deltas[i * 3 + k] * scale * w
  return out
}

/** Distance along the ray to the nearest skin triangle (eyes left out), or Infinity. */
function hit(positions: Float32Array, skin: Uint8Array, o: number[], d: number[]): number {
  const T = body.surface.triangles
  let best = Infinity
  const at = (i: number) => [positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]]
  for (let t = 0; t < T.length; t += 3) {
    if (!skin[T[t]]) continue
    const a = at(T[t])
    const b = at(T[t + 1])
    const c = at(T[t + 2])
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
    const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
    const p = [d[1] * e2[2] - d[2] * e2[1], d[2] * e2[0] - d[0] * e2[2], d[0] * e2[1] - d[1] * e2[0]]
    const det = e1[0] * p[0] + e1[1] * p[1] + e1[2] * p[2]
    if (Math.abs(det) < 1e-14) continue
    const s = [o[0] - a[0], o[1] - a[1], o[2] - a[2]]
    const u = (s[0] * p[0] + s[1] * p[1] + s[2] * p[2]) / det
    if (u < 0 || u > 1) continue
    const q = [s[1] * e1[2] - s[2] * e1[1], s[2] * e1[0] - s[0] * e1[2], s[0] * e1[1] - s[1] * e1[0]]
    const v = (d[0] * q[0] + d[1] * q[1] + d[2] * q[2]) / det
    if (v < 0 || u + v > 1) continue
    const tt = (e2[0] * q[0] + e2[1] * q[1] + e2[2] * q[2]) / det
    if (tt > 0 && tt < best) best = tt
  }
  return best
}

beforeAll(async () => {
  body = await readBody('public/heroes/v2/m-medium.glb')
  pos = weldValues(body.surface, body.positions, 3)
  normals = weldedNormals(body.surface, pos)
  meta = json<HeadMeta>('public/kit/v2/head-m.json')
  const buf = readFileSync('public/kit/v2/head-m.bin')
  shapes = parseFaceBasis(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  scale = json<{ faceScale: number }>('public/heroes/v2/m-medium.kit.json').faceScale / meta.faceScale
})

describe('the head file (GAME.md §9.1)', () => {
  it('carries the 52 ARKit shapes, in order, for both genders', () => {
    expect(new Set(ARKIT_SHAPES).size).toBe(52)
    for (const g of ['m', 'f']) expect(json<HeadMeta>(`public/kit/v2/head-${g}.json`).shapes).toEqual([...ARKIT_SHAPES])
    expect(shapes.groups).toHaveLength(52)
    expect(LITE_SHAPES.every((s) => ARKIT_SHAPES.includes(s))).toBe(true)
  })

  it('moves the face, each side on its own side', () => {
    const side = (name: string) => {
      const g = shape(name)
      let left = 0
      let right = 0
      for (let i = 0; i < g.ids.length; i++) {
        const m = Math.hypot(g.deltas[i * 3], g.deltas[i * 3 + 1], g.deltas[i * 3 + 2])
        if (pos[g.ids[i] * 3] > 0) left += m
        else right += m
      }
      return left / (left + right)
    }
    for (const [l, r] of [['eyeBlinkLeft', 'eyeBlinkRight'], ['mouthSmileLeft', 'mouthSmileRight'], ['browDownLeft', 'browDownRight'], ['noseSneerLeft', 'noseSneerRight']]) {
      expect(side(l), l).toBeGreaterThan(0.85)
      expect(side(r), r).toBeLessThan(0.15)
    }
    // the shapes with no skin of their own are empty; every other one moves something
    for (const name of ARKIT_SHAPES) {
      const empty = /^eyeLook(In|Out)|^tongueOut$/.test(name)
      expect(shape(name).ids.length === 0, name).toBe(empty)
    }
  })

  it('opens the lids over real eyes, and the blink closes them over the eyeball', () => {
    const skin = new Uint8Array(body.surface.count)
    const eyes = eyeIds(body.surface.triangles, pos, body.surface.count)
    skin.fill(1)
    for (const v of [...eyes.left, ...eyes.right]) skin[v] = 0
    for (const [ids, blink] of [[eyes.left, 'eyeBlinkLeft'], [eyes.right, 'eyeBlinkRight']] as const) {
      const { centre, radius } = sphereOf(pos, ids)
      expect(radius).toBeGreaterThan(0.01)
      // open: straight ahead from the eye's middle nothing covers it
      expect(hit(pos, skin, centre, [0, 0, 1])).toBe(Infinity)
      // shut: the lid crosses in front of the eyeball, at most a few millimetres past its surface
      const shut = posed(blink)
      const d = hit(shut, skin, centre, [0, 0, 1])
      expect(d).toBeGreaterThan(radius * 0.7)
      expect(d).toBeLessThan(radius + 0.006)
    }
  })

  it('opens the mouth by turning the jaw a believable amount, the lower teeth kept between the lips', () => {
    const part = json<{ position: number[]; anchor: { at: number[] } }>('public/kit/v2/head-m-parts/teeth_lower.json')
    const teeth = part.anchor.at
    const fit = jawFit(shape('jawOpen'), pos, body.rest.Jaw, { centre: teeth, radius: 0.025, below: meta.mouth[1], width: 0.012 })
    expect(fit.deg).toBeGreaterThan(4)
    expect(fit.deg).toBeLessThan(30)
    // the lower teeth's front edge, turned and shifted with the jaw
    let front = 0
    for (let i = 0; i < part.position.length / 3; i++) if (part.position[i * 3 + 2] > part.position[front * 3 + 2]) front = i
    const pivot = body.rest.Jaw
    const y = part.position[front * 3 + 1] - pivot[1]
    const z = part.position[front * 3 + 2] - pivot[2]
    const a = Math.atan2(y, z) - (fit.deg * Math.PI) / 180
    const drop = Math.hypot(y, z) * Math.sin(a) - y + fit.shift[1]
    // the lip's middle in front of them: how far its inside and its outside drop
    const g = shape('jawOpen')
    const drops: number[] = []
    for (let i = 0; i < g.ids.length; i++) {
      const v = g.ids[i]
      const p = [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]]
      if (Math.hypot(p[0] - teeth[0], p[1] - teeth[1], p[2] - teeth[2]) > 0.025 || p[1] >= meta.mouth[1] || Math.abs(p[0]) > 0.012) continue
      if (Math.hypot(g.deltas[i * 3], g.deltas[i * 3 + 1], g.deltas[i * 3 + 2]) > 0.004) drops.push(g.deltas[i * 3 + 1])
    }
    expect(drops.length).toBeGreaterThan(4)
    // down is negative: at least as far as the inner lip, never past the outer
    expect(drop).toBeLessThanOrEqual(Math.max(...drops) + 0.001)
    expect(drop).toBeGreaterThanOrEqual(Math.min(...drops) - 0.001)
    expect(jawFit(shape('jawOpen'), pos, body.rest.Jaw).deg).toBeGreaterThan(4)
  })
})

describe('the head on the body', () => {
  it('takes the whole face and nothing below the neck, meeting the body at one collar', () => {
    const share = headShare(weldValues(body.surface, body.joints, 4), weldValues(body.surface, body.weights, 4), body.bones)
    const inHead = headTriangles(body.surface.triangles, share)
    const T = body.surface.triangles
    const eye = body.rest.LeftEye
    for (let t = 0; t < inHead.length; t++) {
      const ys = [0, 1, 2].map((k) => pos[T[t * 3 + k] * 3 + 1])
      const near = [0, 1, 2].some((k) => Math.hypot(pos[T[t * 3 + k] * 3] - eye[0], pos[T[t * 3 + k] * 3 + 1] - eye[1], pos[T[t * 3 + k] * 3 + 2] - eye[2]) < 0.04)
      if (near) expect(inHead[t]).toBe(1)
      if (Math.max(...ys) < body.rest.Neck[1] - 0.02) expect(inHead[t]).toBe(0)
    }
    const ring = collarRing(T, inHead)
    expect(ring.length).toBeGreaterThan(20)
    for (const v of ring) {
      expect(pos[v * 3 + 1]).toBeGreaterThan(body.rest.Neck[1] - 0.05)
      expect(pos[v * 3 + 1]).toBeLessThan(body.rest.Head[1] + 0.1)
    }
  })

  it('blends a foreign collar onto the body, and leaves a shared one alone', () => {
    const head = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0.05, 0, 0, 0.5, 0])
    const own = Float32Array.from(head)
    expect(blendCollar(own, [0, 1], head.slice(0, 6), 0.1)).toBe(0)
    expect(Array.from(own)).toEqual(Array.from(head))
    const moved = Float32Array.from(head)
    const bodyRing = new Float32Array([0, -0.01, 0, 1, -0.01, 0])
    blendCollar(moved, [0, 1], bodyRing, 0.1)
    expect(moved[1]).toBeCloseTo(-0.01, 6)
    expect(moved[4]).toBeCloseTo(-0.01, 6)
    // halfway up the band the move has faded to a quarter; past it, nothing
    expect(moved[7]).toBeCloseTo(0.05 - 0.01 * 0.25, 6)
    expect(moved[10]).toBeCloseTo(0.5, 6)
  })

  it('keeps the brows and lashes on the face as it moves', () => {
    for (const part of ['brows', 'lashes']) {
      const p = json<CardPart>(`public/kit/v2/head-m-parts/${part}.json`)
      const b = binding(p)
      // bound on the reference body, evaluated on the shipped one, they sit within millimetres of where they were made
      const here = evaluate(b, surface(pos))
      let worst = 0
      for (let i = 0; i < here.length; i++) worst = Math.max(worst, Math.abs(here[i] - p.position[i]))
      expect(worst, part).toBeLessThan(0.006)
      // the blink carries the upper lashes down with the lid, as the surface under them goes
      const shut = posed('eyeBlinkLeft')
      const exact = evaluate(b, surface(shut))
      const d = boundDeltas(b, shape('eyeBlinkLeft'), scale)
      let err = 0
      let down = 0
      for (let i = 0; i < d.length / 3; i++) {
        for (let k = 0; k < 3; k++) err = Math.max(err, Math.abs(here[i * 3 + k] + d[i * 3 + k] - exact[i * 3 + k]))
        down = Math.min(down, d[i * 3 + 1])
      }
      expect(err, part).toBeLessThan(1e-5)
      if (part === 'lashes') expect(down).toBeLessThan(-0.004)
    }
  })
})

describe('eyes and blinks', () => {
  it('turns an eye at most EYE_LIMIT from ahead, keeping the way it looks', () => {
    const q = new Quaternion().setFromAxisAngle(new Vector3(1, 0.2, 0).normalize(), (100 * Math.PI) / 180)
    const axis = new Vector3(q.x, q.y, q.z).normalize()
    expect(clampTurn(q, EYE_LIMIT)).toBe(true)
    expect((2 * Math.acos(q.w) * 180) / Math.PI).toBeCloseTo(EYE_LIMIT, 4)
    expect(new Vector3(q.x, q.y, q.z).normalize().dot(axis)).toBeCloseTo(1, 6)
    const small = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.1)
    const before = small.clone()
    expect(clampTurn(small, EYE_LIMIT)).toBe(false)
    expect(small.equals(before)).toBe(true)
  })

  it('blinks every few seconds, fully shut, whatever the frame rate', () => {
    for (const fps of [30, 60, 144]) {
      const b = blinkState(7)
      let blinks = 0
      let shut = 0
      let was = 0
      for (let i = 0; i < 60 * fps; i++) {
        const c = stepBlink(b, 1 / fps)
        if (c > 0 && was === 0) blinks++
        shut = Math.max(shut, c)
        was = c
      }
      expect(blinks, `${fps} fps`).toBeGreaterThanOrEqual(10)
      expect(blinks, `${fps} fps`).toBeLessThanOrEqual(32)
      expect(shut).toBe(1)
    }
  })
})
