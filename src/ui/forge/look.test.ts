import { describe, expect, it } from 'vitest'
import { outfitOf, type HeroLook } from '../../charter/look'
import { offlineReading, withRole, type Reading } from '../../forge/reading'
import { LIBRARY } from '../../kit/wear/library'
import { bodyAfter, gapsOf, readingLook, wishesAfter, withOutfit } from './look'
import { editWorn, setChannel, wearIn } from './wardrobe'

const dress = (reading: Reading, outfit = {}) => readingLook(reading, { catalog: LIBRARY, hue: 0.6, outfit })
const read = (prompt: string, roleId?: Reading['roleId']) => {
  const r = offlineReading({ prompt })
  return roleId ? withRole(r, roleId) : r
}
const item = (id: string) => LIBRARY.find((e) => e.id === id)!

describe('the look a reading dresses', () => {
  it('puts each wish on in its colours, a full-body item over the top and trousers, and no cape the words didn’t ask for', () => {
    const wear = outfitOf(dress(read('a queen in gold armour with a red cape and a crown', 'mage')))
    expect(wear.full).toMatchObject({ id: 'knight_armour', colors: ['#d4a531'] })
    expect(wear.upper).toBeUndefined()
    expect(wear.lower).toBeUndefined()
    expect(wear.back).toMatchObject({ id: 'cape', colors: ['#c8242c'] })
    expect(wear.head?.id).toBe('crown')
  })

  it('a role dresses a hero the words don’t, and a hat the words name takes the place of the role’s helmet', () => {
    const plain = outfitOf(dress(read('a stubborn wall of a man', 'tank')))
    expect(plain.head?.id).toBe('legion_helm')
    expect(plain.upper?.id).toBe('breastplate')
    expect(plain.back?.id).toBe('cape')
    const hatted = outfitOf(dress(read('a stubborn man in a cowboy hat', 'tank')))
    expect(hatted.head?.id).toBe('cowboy_hat')
    expect(hatted.hair?.id).toBe('hair_crop')
  })

  it('what the library lacks wears the outfit’s own item meanwhile, in the colours asked for, and waits to be generated', () => {
    const reading = read('a drifter in a brown poncho', 'fighter')
    const look = dress(reading)
    expect(outfitOf(look).upper?.id).toBe('longsleeve')
    expect(outfitOf(look).upper?.colors?.[0]).toBe('#6a4228')
    expect(gapsOf(reading, look, LIBRARY)).toEqual([{ phrase: 'brown poncho', slot: 'upper', under: 'longsleeve' }])
  })

  it('leaves a slot empty on purpose, and puts the hair colour on the hair and the beard', () => {
    const bald = outfitOf(dress(read('a bald monk')))
    expect(bald.hair).toBeUndefined()
    const reading = read('a man with long hair and a full beard')
    const wear = outfitOf(dress({ ...reading, look: { ...reading.look, colors: { hair: '#aa3311' } } }))
    expect(wear.hair).toMatchObject({ id: 'hair_long', colors: ['#aa3311'] })
    expect(wear.beard).toMatchObject({ id: 'beard_full', colors: ['#aa3311'] })
  })

  it('offline, the image’s outfit colours go on the garments the words left uncoloured, and the card shows them as a recolour', () => {
    const reading = read('a swordsman in a kimono')
    const outfit = { top: '#22335f', accent: '#d4a531' }
    expect(outfitOf(dress(reading, outfit)).full).toMatchObject({ id: 'kimono', colors: ['#22335f', '#d4a531'] })
    const shown = withOutfit(reading, outfit, LIBRARY)
    expect(shown.wear.find((w) => w.slot === 'full')).toMatchObject({ item: 'kimono', colors: ['#22335f', '#d4a531'], rung: 'recolour' })
    // an AI reading reads the image itself
    expect(withOutfit({ ...reading, source: 'claude' }, outfit, LIBRARY)).toEqual({ ...reading, source: 'claude' })
  })

  it('carries the ultimate’s transformation on its look', () => {
    const reading = read('Goku. Ultimate goes super saiyan: "Kaioken"')
    const look = dress({ ...reading, form: { entry: 'burst', aura: 'flame', body: { hair: 'hair_spiky', hairColor: '#ffd23a' } } })
    expect(look.skills?.ultimate?.transformation).toEqual({ entry: 'burst', aura: 'flame', body: { hair: 'hair_spiky', hairColor: '#ffd23a' } })
  })
})

describe('the card’s wardrobe, written back into the reading', () => {
  const queen = read('a queen in gold armour with a red cape, barefoot', 'mage')
  const before = dress(queen)
  const after = (change: (l: HeroLook) => HeroLook) => wishesAfter(queen, before, change(before), LIBRARY)

  it('the same item restyled keeps its words; a slot emptied is a wish for nothing', () => {
    const recoloured = after((l) => editWorn(l, 'back', (w) => setChannel(w, 0, { color: '#123456' })))
    expect(recoloured.find((w) => w.slot === 'back')).toEqual({ slot: 'back', phrase: 'red cape', item: 'cape', colors: ['#123456'], rung: 'recolour' })
    const capeless = after((l) => wearIn(l, 'back', undefined))
    expect(capeless.find((w) => w.slot === 'back')).toEqual({ slot: 'back', phrase: 'nothing', bare: true, rung: 'wear' })
    // everything else stays as read
    expect(capeless.filter((w) => w.slot !== 'back')).toEqual(queen.wear.filter((w) => w.slot !== 'back'))
  })

  it('a new item is a wish in its own name, and the top and trousers a full-body item took off ask for nothing', () => {
    const tee = after((l) => wearIn(l, 'upper', item('tee')))
    expect(tee.find((w) => w.slot === 'upper')).toEqual({ slot: 'upper', phrase: 'tee', item: 'tee', rung: 'wear' })
    // the tee took the armour off: that isn't a wish to go without armour
    expect(tee.some((w) => w.slot === 'full')).toBe(false)
    const robe = wishesAfter(read('a man in a red hoodie'), dress(read('a man in a red hoodie')), wearIn(dress(read('a man in a red hoodie')), 'full', item('wizard_robe')), LIBRARY)
    expect(robe.map((w) => w.slot)).toEqual(['full'])
  })

  it('a gap’s stand-in recoloured is still the gap, in its new colour', () => {
    const drifter = read('a drifter in a brown poncho', 'fighter')
    const look = dress(drifter)
    const wear = wishesAfter(drifter, look, editWorn(look, 'upper', (w) => setChannel(w, 0, { color: '#000000' })), LIBRARY)
    const poncho = wear.find((w) => w.slot === 'upper')
    expect(poncho).toMatchObject({ slot: 'upper', phrase: 'brown poncho', rung: 'generate' })
    expect(poncho?.item).toBeUndefined()
    expect(poncho?.colors?.[0]).toBe('#000000')
  })

  it('the body panel writes back its build and the colours it changed, nothing it only showed', () => {
    const drawn = { ...before, colors: { ...before.colors, skin: '#c08a6a', iris: '#334455' } }
    const next = bodyAfter(queen, drawn, { ...drawn, physique: { weight: 0.3, muscle: 0.8, age: 0.2 }, colors: { ...drawn.colors, iris: '#00ff00' } })
    expect(next.look.physique).toEqual({ weight: 0.3, muscle: 0.8, age: 0.2 })
    expect(next.look.colors).toEqual({ ...queen.look.colors, iris: '#00ff00' })
  })
})
