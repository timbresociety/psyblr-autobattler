import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import type { AnimIndex } from '../../arena/client/anim-index.js'
import { MOTIONS, STYLES } from '../../charter/motions.js'
import { COVERAGE, coverageOf, missing, pickable, type Coverage } from './coverage.js'

const index = JSON.parse(readFileSync('public/anim/standard/index.json', 'utf8')) as AnimIndex
const GENDERS = ['m', 'f'] as const
const clipsOf = (g: (typeof GENDERS)[number]) => new Set(Object.values(index.genders[g].sets).flatMap((s) => Object.keys(s)))

describe('animation coverage (GAME.md §12)', () => {
  it('holds every clip of every style, family and move the game offers, on both bodies', () => {
    for (const g of GENDERS) {
      const has = clipsOf(g)
      const short = COVERAGE.filter((c) => c.offered !== false).flatMap((c) => missing(c, (x) => has.has(x)).map((m) => `${g} ${c.id}.${m.role}: has ${m.have.length} of ${m.need}`))
      expect(short).toEqual([])
    }
  })

  it('only lets a style be picked when its every role has its clips', () => {
    const style: Coverage = { id: 'test', kind: 'melee', label: 'Test', roles: { light: { clips: ['a', 'b', 'c', 'd'], min: 3 }, heavy: { clips: ['e'] } } }
    expect(pickable(style, (x) => ['a', 'b', 'c', 'e'].includes(x))).toBe(true)
    expect(pickable(style, (x) => ['a', 'b', 'e'].includes(x))).toBe(false)
    expect(pickable({ ...style, offered: false }, () => true)).toBe(false)
  })

  it('lets the Forge store only a fighting style the library animates in full', () => {
    for (const g of GENDERS) {
      const has = clipsOf(g)
      const styles = STYLES.filter((s) => s !== 'any')
      expect(styles.filter((s) => !coverageOf(s)), 'a style with no coverage entry').toEqual([])
      expect(styles.filter((s) => !pickable(coverageOf(s)!, (x) => has.has(x))).map((s) => `${g} ${s}`)).toEqual([])
    }
  })

  it('points every charter motion at a clip the library has', () => {
    for (const g of GENDERS) {
      const has = clipsOf(g)
      expect(MOTIONS.filter((m) => !has.has(m.id)).map((m) => `${g} ${m.id}`)).toEqual([])
    }
  })

  it('has 600 clips or more for each body', () => {
    for (const g of GENDERS) expect(clipsOf(g).size).toBeGreaterThanOrEqual(600)
  })

  it("records every clip's source and licence, and none from a source the owner excluded", () => {
    for (const g of GENDERS)
      for (const clip of clipsOf(g)) {
        const source = index.sources?.[clip]
        expect(source, clip).toBeDefined()
        expect(index.licences?.[source!]?.licence, clip).toBeTruthy()
      }
    expect(Object.keys(index.licences ?? {}).filter((s) => /bandai|amass/i.test(s))).toEqual([])
  })

  it('tags every clip with where its feet plant and when it lands a blow', () => {
    for (const g of GENDERS) {
      const tags = index.genders[g].tags ?? {}
      expect([...clipsOf(g)].filter((c) => !tags[c])).toEqual([])
    }
  })
})
