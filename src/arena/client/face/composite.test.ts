import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { whiskerStrokes } from './composite.js'
import type { FaceMeta } from './patch.js'

const meta = JSON.parse(readFileSync(new URL('../../../../public/heroes/m-medium.kit.json', import.meta.url), 'utf8')) as FaceMeta

describe("a form's whisker marks", () => {
  it('draws three strokes on each cheek, out from beside the nose toward the ear, the two sides alike', () => {
    const strokes = whiskerStrokes(meta.landmarks)
    expect(strokes).toHaveLength(6)
    const mid = meta.landmarks[1]![0]
    for (const s of strokes) expect(Math.abs(s.to[0] - mid)).toBeGreaterThan(Math.abs(s.from[0] - mid) + 50)
    expect(strokes.slice(0, 3).every((s) => s.from[0] < mid)).toBe(true)
    expect(strokes.slice(3).every((s) => s.from[0] > mid)).toBe(true)
    expect(Math.abs(strokes[1].from[1] - strokes[4].from[1])).toBeLessThan(10)
    // fanned: the strokes spread wider at the ear than by the nose
    const gap = (a: [number, number], b: [number, number]) => Math.abs(a[1] - b[1])
    expect(gap(strokes[0].to, strokes[2].to)).toBeGreaterThan(gap(strokes[0].from, strokes[2].from))
  })

  it('leaves out a cheek whose landmarks are missing', () => {
    const some = meta.landmarks.map((p, i) => (i === 352 ? undefined : p))
    expect(whiskerStrokes(some as FaceMeta['landmarks'])).toHaveLength(3)
  })
})
