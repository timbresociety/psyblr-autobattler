import { readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { BODIES } from '../../arena/client/character-look.js'
import { applyFace, landmarkAt, parseFaceBasis, type FaceBasisMeta } from './face-basis.js'
import { readBody, type BodyFile } from './node.js'
import { triangleKeys, weldValues } from './surface.js'

const pub = (path: string) => new URL(`../../../public${path}`, import.meta.url)
const MORPHS = ['weight-', 'weight+', 'muscle-', 'muscle+', 'age']
const CAST_POSES = ['cast_palms', 'cast_palm', 'cast_fingers', 'cast_overhead', 'cast_cross', 'cast_clap', 'cast_slam', 'cast_summon', 'cast_breath', 'cast_spin']

interface KitV2 {
  version: number
  morphs: string[]
  faceScale: number
  fit: number[]
  sockets: Record<string, unknown>
}

const files = new Map<string, BodyFile>()
const kits = new Map<string, KitV2>()
const meta = JSON.parse(readFileSync(pub('/kit/face-basis.json'), 'utf8')) as FaceBasisMeta
const basis = parseFaceBasis(readFileSync(pub('/kit/face-basis.bin')).buffer as ArrayBuffer)

beforeAll(async () => {
  for (const body of BODIES) {
    files.set(body, await readBody(pub(`/heroes/${body}.glb`)))
    kits.set(body, JSON.parse(readFileSync(pub(`/heroes/${body}.kit.json`), 'utf8')) as KitV2)
  }
})

describe('the bodies', () => {
  it('share one surface: the same welded vertices joined into the same triangles', () => {
    const ref = files.get('m-medium')!
    const keys = new Set(triangleKeys(ref.surface))
    expect(keys.size).toBe(ref.surface.triangles.length / 3)
    for (const body of BODIES) {
      const f = files.get(body)!
      expect(f.surface.count, body).toBe(ref.surface.count)
      const own = triangleKeys(f.surface)
      expect(own.length, body).toBe(keys.size)
      expect(own.filter((k) => !keys.has(k)), body).toEqual([])
    }
  })

  it('carry the physique morphs their kit names, every clip, and kit version 2', () => {
    for (const body of BODIES) {
      const f = files.get(body)!
      const kit = kits.get(body)!
      expect(kit.version, body).toBe(2)
      expect(kit.morphs, body).toEqual(MORPHS)
      expect(f.morphs, body).toHaveLength(MORPHS.length)
      expect(kit.fit, body).toHaveLength(meta.groups.length)
      expect(kit.faceScale, body).toBeGreaterThan(0)
      for (const clip of ['idle', 'run', 'cast', 'ultimate', ...CAST_POSES]) expect(f.clips, `${body} ${clip}`).toContain(clip)
    }
  })

  it('move with the physique: more weight widens the waist, less narrows it', () => {
    const f = files.get('m-medium')!
    const width = (morph?: Float32Array, w = 1) => {
      const pos = weldValues(f.surface, f.positions.map((p, i) => p + (morph ? morph[i] * w : 0)), 3)
      // the width across the waist (y up, metres), leaving out the hands that hang beside it
      let lo = Infinity
      let hi = -Infinity
      for (let v = 0; v < pos.length; v += 3) {
        if (Math.abs(pos[v + 1] - 1.05) < 0.03 && Math.abs(pos[v]) < 0.3) {
          lo = Math.min(lo, pos[v])
          hi = Math.max(hi, pos[v])
        }
      }
      return hi - lo
    }
    const plain = width()
    expect(width(f.morphs[MORPHS.indexOf('weight+')])).toBeGreaterThan(plain + 0.01)
    expect(width(f.morphs[MORPHS.indexOf('weight-')])).toBeLessThan(plain - 0.01)
  })
})

describe('the face basis', () => {
  it('fits the shared surface and binds the landmarks to it', () => {
    const count = files.get('m-medium')!.surface.count
    expect(basis.vertices).toBe(count)
    expect(meta.vertices).toBe(count)
    expect(basis.groups).toHaveLength(meta.groups.length)
    for (const g of basis.groups) for (const id of g.ids) expect(id).toBeLessThan(count)
    const bound = meta.landmarks.filter((l) => l !== null)
    expect(bound.length).toBeGreaterThan(450)
    for (const [a, b, c, u, v, w] of bound) {
      expect(Math.max(a, b, c)).toBeLessThan(count)
      expect(u + v + w).toBeCloseTo(1, 3)
    }
  })

  it('widens the mouth when the mouth-width group is set', () => {
    const f = files.get('m-medium')!
    const pos = weldValues(f.surface, f.positions, 3)
    // MediaPipe's mouth corners
    const width = (p: Float32Array) => Math.abs(landmarkAt(meta.landmarks[61], p)![0] - landmarkAt(meta.landmarks[291], p)![0])
    const weights = meta.groups.map((g) => (g === 'mouth-scale-horiz-incr' ? 1 : 0))
    const wider = applyFace(basis, weights, 1, Float32Array.from(pos))
    expect(width(wider)).toBeGreaterThan(width(pos) + 0.004)
  })
})
