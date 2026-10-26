import { describe, expect, it } from 'vitest'
import { defaultLook, hydrateLook, type HeroLook, type LookSlot } from '../../charter/look.js'
import { libraryItem } from '../../kit/wear/library.js'
import { asMade, editWorn, isRigid, itemsFor, rungOf, setChannel, wardrobeCatalog, wardrobeOf, wearIn } from './wardrobe.js'

const old: HeroLook = { ...defaultLook('fighter', 'Ada', 0.6), gear: { hand_r: { id: 'katana', url: '/kit/pieces/katana.glb' } } }
const kimono = libraryItem('kimono')!

describe('the wardrobe in the Forge', () => {
  it('writes down a look from before the wardrobe the first time it changes, gear and all', () => {
    const dressed = wearIn(old, 'head', libraryItem('kasa'))
    expect(dressed.gear).toBeUndefined()
    expect(dressed.wear?.hand_r).toEqual({ id: 'katana', url: '/kit/pieces/katana.glb' })
    expect(dressed.wear?.head).toEqual({ id: 'kasa', url: '/kit/wear/kasa.glb' })
    // the rest of the old look comes along as items, in its colours
    expect(dressed.wear?.upper?.id).toBe('breastplate')
  })

  it('a full-body item takes the upper and lower ones off, and either of those takes it off', () => {
    const robed = wearIn(old, 'full', kimono)
    expect(robed.wear).not.toHaveProperty('upper')
    expect(robed.wear).not.toHaveProperty('lower')
    const split = wearIn(robed, 'upper', libraryItem('tee'))
    expect(split.wear).not.toHaveProperty('full')
    expect(wearIn(split, 'upper', undefined).wear).not.toHaveProperty('upper')
  })

  it('climbs the rungs: colours and finishes recolour, a print or a cut restyles, and as made goes back to wearing', () => {
    let look = wearIn(old, 'full', kimono)
    expect(rungOf(look.wear!.full!)).toBe('wear')
    look = editWorn(look, 'full', (w) => setChannel(w, 1, { color: '#112233', finish: 'metal' }))
    expect(look.wear!.full).toMatchObject({ colors: [null, '#112233'], finishes: [null, 'metal'] })
    expect(rungOf(look.wear!.full!)).toBe('recolour')
    look = editWorn(look, 'full', (w) => ({ ...w, print: { id: 'seigaiha' } }))
    expect(rungOf(look.wear!.full!)).toBe('restyle')
    // putting a channel's own colour back drops the list once nothing is the player's
    const plain = setChannel(setChannel(look.wear!.full!, 1, { color: null }), 1, { finish: null })
    expect(plain).not.toHaveProperty('colors')
    expect(plain).not.toHaveProperty('finishes')
    expect(asMade(look.wear!.full!)).toEqual({ id: 'kimono', url: '/kit/wear/kimono.glb' })
    expect(editWorn(look, 'face', (w) => ({ ...w, colors: ['#ffffff'] }))).toBe(look)
  })

  it('lists what a slot takes, searched by name or tag, with the community after the library', () => {
    expect(itemsFor('full', wardrobeCatalog([]), 'yukata').map((e) => e.id)).toEqual(['kimono'])
    const hands = itemsFor('hand_l', wardrobeCatalog([]))
    expect(hands.some((e) => e.id === 'shield')).toBe(true)
    expect(itemsFor('hand_r', wardrobeCatalog([])).some((e) => e.id === 'shield')).toBe(false)
    const straw = { ...kimono, id: '0f0e1d2c-3b4a-4596-8778-695a4b3c2d1e', name: 'Straw cloak', slot: 'back' as const, source: 'community' as const, url: '/dev-store/wear/0f0e1d2c-3b4a-4596-8778-695a4b3c2d1e.glb' }
    const catalog = wardrobeCatalog([straw, straw])
    expect(catalog.filter((e) => e.id === straw.id)).toHaveLength(1)
    expect(itemsFor('back', catalog).at(-1)).toBe(straw)
    expect(isRigid(libraryItem('katana')!)).toBe(true)
    expect(isRigid(kimono)).toBe(false)
  })

  it('keeps a wardrobe with nothing in it through storage, rather than dressing the hero again', () => {
    let stripped = old
    for (const slot of Object.keys(wardrobeOf(old)) as LookSlot[]) stripped = wearIn(stripped, slot, undefined)
    expect(stripped.wear).toEqual({})
    expect(hydrateLook(JSON.parse(JSON.stringify(stripped)))?.wear).toEqual({})
  })
})
