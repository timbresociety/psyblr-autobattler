import { describe, expect, it } from 'vitest'
import { summarizeFrames } from './frames'

describe('frame-time summary (U1)', () => {
  it('reports the median and the 1% low of a fixed list', () => {
    const frames = [...Array(99).fill(16), 40]
    const s = summarizeFrames(frames)
    expect(s.medianMs).toBe(16)
    expect(s.onePercentLowMs).toBe(16)
    expect(s.fps).toBeCloseTo(62.5)
    const spiky = [...Array(98).fill(16), 40, 50]
    expect(summarizeFrames(spiky).onePercentLowMs).toBe(40)
  })

  it('averages the middle pair for an even count, and is empty-safe', () => {
    expect(summarizeFrames([10, 20]).medianMs).toBe(15)
    expect(summarizeFrames([])).toEqual({ medianMs: 0, onePercentLowMs: 0, fps: 0 })
  })
})
