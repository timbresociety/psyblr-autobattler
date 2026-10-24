import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { FACE_POINTS, hydrateLook, pieceUrl, wearUrl } from '../../charter/look.js'
import { BUILT_IN_PIECES } from '../../kit/pieces.gen.js'
import { BUILT_IN_ITEMS } from '../../kit/wear/library.gen.js'
import { DEMO_IDS, demoLook } from './looks.js'
import { DEMO_HEROES } from './roster.js'

const served = (url: string) => existsSync(new URL(`../../../public${url}`, import.meta.url))

describe('the demo looks', () => {
  it('give every demo hero a look of its own, with its portrait as its face', () => {
    expect(DEMO_IDS).toEqual(DEMO_HEROES.map((h) => h.id))
    for (const id of DEMO_IDS) {
      const { face } = demoLook(id)
      expect(face!.url).toBe(`/kit/faces/${id}.webp`)
      expect(served(face!.url), id).toBe(true)
      expect(face!.points).toHaveLength(FACE_POINTS * 2)
      expect(face!.points.every((p) => p >= 0 && p <= Math.max(face!.width, face!.height)), id).toBe(true)
    }
  })

  it('are looks a player could save: each reads back unchanged', () => {
    for (const id of DEMO_IDS) expect(hydrateLook(demoLook(id)), id).toEqual(demoLook(id))
  })

  it('wear only the library, each item in its own slot, in colours its channels take and cuts it allows', () => {
    for (const id of DEMO_IDS) {
      const wear = demoLook(id).wear!
      expect(wear.full && (wear.upper || wear.lower), id).toBeFalsy()
      for (const [slot, w] of Object.entries(wear)) {
        const item = BUILT_IN_ITEMS.find((i) => i.id === w!.id)
        const piece = BUILT_IN_PIECES.find((p) => p.id === w!.id)
        if (item) {
          expect(item.slot, `${id} ${slot}`).toBe(slot)
          expect(w!.url).toBe(wearUrl(item.id))
          expect(w!.colors?.length ?? 0, `${id} ${slot}`).toBeLessThanOrEqual(item.channels.length)
          expect(w!.finishes?.length ?? 0, `${id} ${slot}`).toBeLessThanOrEqual(item.channels.length)
          for (const knob of Object.keys(w!.knobs ?? {})) expect(item.knobs, `${id} ${slot}`).toContain(knob)
        } else {
          expect(piece, `${id} wears ${w!.id}, which is in neither the wardrobe nor the pieces`).toBeDefined()
          expect(piece!.kind, `${id} ${slot}`).toBe(slot)
          expect(w!.url).toBe(pieceUrl(piece!.id))
          expect(w!.colors?.length ?? 0).toBeLessThanOrEqual(1)
        }
        expect(served(w!.url), w!.url).toBe(true)
      }
    }
  })

  it('come fresh each time, so editing one hero never reaches another', () => {
    const a = demoLook('lincoln')
    a.wear!.head!.colors![0] = '#ff0000'
    a.face!.points[0] = 0
    expect(demoLook('lincoln').wear!.head!.colors![0]).not.toBe('#ff0000')
    expect(demoLook('lincoln').face!.points[0]).not.toBe(0)
  })
})
