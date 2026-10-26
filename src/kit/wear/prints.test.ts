import { describe, expect, it } from 'vitest'
import { PRINTS, PRINT_LABEL, PRINT_WORDS, drawPrint, inkFor, isPrintId, type PrintContext } from './prints.js'

/** A canvas context that draws nothing and writes down every call, with the colour and alpha it was made in. */
function recorder() {
  const log: string[] = []
  const state = { fillStyle: '', strokeStyle: '', lineWidth: 1, lineCap: 'butt', lineJoin: 'miter', globalAlpha: 1 }
  const stack: (typeof state)[] = []
  const n = (v: number) => Math.round(v * 100) / 100
  const call = (name: string) => (...args: number[]) => {
    const ink = name === 'fill' || name === 'fillRect' ? state.fillStyle : name === 'stroke' ? state.strokeStyle : ''
    log.push(`${name}(${args.map(n).join(',')})${ink && ` ${ink}@${n(state.globalAlpha)}`}`)
  }
  const ctx = {
    ...Object.fromEntries(['fillRect', 'beginPath', 'closePath', 'moveTo', 'lineTo', 'arc', 'ellipse', 'quadraticCurveTo', 'fill', 'stroke', 'translate', 'rotate'].map((m) => [m, call(m)])),
    save: () => void stack.push({ ...state }),
    restore: () => void Object.assign(state, stack.pop()),
  } as unknown as PrintContext
  for (const key of Object.keys(state) as (keyof typeof state)[])
    Object.defineProperty(ctx, key, { get: () => state[key], set: (v) => ((state as Record<string, unknown>)[key] = v), enumerable: true })
  return { ctx, log, depth: () => stack.length }
}

const draw = (id: (typeof PRINTS)[number], size = 256) => {
  const r = recorder()
  drawPrint(r.ctx, id, size, '#112233', '#ddeeff')
  return r
}

describe('prints', () => {
  it('lays the ground first, then inks over it, and leaves the context as it found it', () => {
    for (const id of PRINTS) {
      const { log, depth } = draw(id)
      expect(log[0], id).toBe('fillRect(0,0,256,256) #112233@1')
      expect(log.filter((l) => l.includes('#ddeeff')).length, id).toBeGreaterThan(0)
      expect(depth(), id).toBe(0)
    }
  })

  it('draws the same tile every time, and no two prints alike', () => {
    const signatures = PRINTS.map((id) => draw(id).log.join('\n'))
    expect(PRINTS.map((id) => draw(id).log.join('\n'))).toEqual(signatures)
    expect(new Set(signatures).size).toBe(PRINTS.length)
  })

  it('scales with the tile: the same calls at twice the size, every number doubled', () => {
    for (const id of ['polka', 'asanoha', 'houndstooth', 'clouds'] as const) {
      const small = draw(id, 128).log
      const big = draw(id, 256).log
      expect(big.length).toBe(small.length)
      const numbers = (l: string) => (l.match(/\(([^)]*)\)/)?.[1] ?? '').split(',').filter(Boolean).map(Number)
      for (let i = 0; i < small.length; i++) {
        const [a, b] = [numbers(small[i]), numbers(big[i])]
        // angles in arc and ellipse don't scale; everything else does
        const kept = small[i].startsWith('arc') ? 3 : small[i].startsWith('ellipse') ? 4 : a.length
        for (let k = 0; k < kept; k++) expect(b[k]).toBeCloseTo(a[k] * 2, 0)
      }
    }
  })

  it('names every print, and gives the reader words that point at one print only', () => {
    const owner = new Map<string, string>()
    for (const id of PRINTS) {
      expect(PRINT_LABEL[id]).toBeTruthy()
      expect(PRINT_WORDS[id].length).toBeGreaterThan(0)
      for (const word of PRINT_WORDS[id]) {
        expect(owner.get(word), word).toBeUndefined()
        owner.set(word, id)
      }
    }
    expect(isPrintId('seigaiha')).toBe(true)
    expect(isPrintId('paisley')).toBe(false)
  })

  it('inks a print in a deeper shade of its ground, or a lighter one on a dark ground', () => {
    expect(inkFor('#ffffff')).toBe('#737373')
    expect(inkFor('#c81e1e')).toBe('#5a0e0e')
    expect(inkFor('#101828')).toBe('#93979e')
  })
})
