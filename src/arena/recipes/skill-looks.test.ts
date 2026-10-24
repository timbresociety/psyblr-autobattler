import { describe, expect, it } from 'vitest'
import { CHARGES, ELEMENTS, ELEMENT_FORM, FAMILY_OF, IMPACTS, MOTIFS, TRAILS, elementLook, formsFor, hydrateSkillLook, type SkillLook } from '../../charter/skill-look.js'
import { getTemplate } from '../../charter/templates/catalog.js'
import type { Delivery } from '../../charter/types.js'
import { baseSize, layerSize } from '../client/effects/sizing.js'
import { composeRecipe } from './defaults.js'
import { formLookOf, lookFor, lookFromWords, templateWords } from './looks.js'
import { validateRecipe } from './validate.js'

const KINDS: Delivery['kind'][] = ['melee', 'projectile', 'beam', 'cone', 'zone', 'self', 'aura', 'dash', 'blink', 'leap', 'grapple']

/** One damaging layer, first, at size 1 (none for a self-cast): what can hit is exactly what's drawn. */
function trueToSize(kind: Delivery['kind'], look: SkillLook, label: string) {
  const r = composeRecipe(kind, look)
  expect(validateRecipe(r), label).toEqual([])
  const hits = r.layers.filter((l) => l.damaging)
  if (FAMILY_OF[kind] === 'self') return expect(hits, label).toHaveLength(0)
  expect(hits, label).toHaveLength(1)
  expect(hits[0].size, label).toBe(1)
  expect(r.layers[0], label).toBe(hits[0])
}

describe('skill looks (R33)', () => {
  it('draws every form of every delivery, in every element, with one hit layer at its true size', () => {
    for (const kind of KINDS) for (const form of formsFor(kind)) for (const element of ELEMENTS) trueToSize(kind, { ...elementLook(element), form }, `${kind} ${form} ${element}`)
  })

  it('keeps the hit layer true whatever the charge, landing, trail or motif', () => {
    for (const kind of KINDS)
      for (const charge of CHARGES) for (const impact of IMPACTS) for (const trail of TRAILS) trueToSize(kind, { ...elementLook('energy'), charge, impact, trail }, `${kind} ${charge} ${impact} ${trail}`)
    for (const motif of MOTIFS) trueToSize('projectile', { ...elementLook('money'), trail: 'motif', motif }, motif)
  })

  it('gives three beams on one template the same hit and nothing else in common', () => {
    const template = getTemplate('mage-mega-beam')
    const looks = ['Kamehameha', 'Galick Gun', 'Special Beam Cannon'].map((name) => lookFromWords({ own: name, ...templateWords(template), kind: 'beam', slot: 'ultimate' })!)
    const recipes = looks.map((look) => composeRecipe('beam', look))
    const hits = recipes.map((r) => r.layers.find((l) => l.damaging)!)
    // the same mechanic, so the same width on screen
    const base = baseSize({ radius: 0, range: template.delivery.range, width: template.delivery.width })
    for (const h of hits) expect(layerSize(h, base)).toBeCloseTo(hits[0] && layerSize(hits[0], base))
    expect(hits.map((h) => h.style)).toEqual(['wave', 'crackle', 'drill'])
    expect(looks.map((l) => l.pose)).toEqual(['hip', 'palms', 'fingers'])
    expect(looks.map((l) => l.charge)).toEqual(['gather', 'crackle', 'point'])
    expect(looks.map((l) => l.impact)).toEqual(['dome', 'burst', 'pierce'])
    expect(new Set(recipes.map((r) => r.palette.join())).size).toBe(3)
    for (const look of looks) expect(look.callout).toBe(true)
  })

  it('recognises famous moves whole and reads the rest from their words', () => {
    const cases: [string, Delivery['kind'], Partial<SkillLook>][] = [
      ['Chidori', 'melee', { element: 'lightning', form: 'thrust', charge: 'crackle', impact: 'pierce' }],
      ['Rasengan', 'melee', { element: 'wind', form: 'punch', pose: 'palm' }],
      ['Getsuga Tensho', 'projectile', { element: 'shadow', form: 'crescent', pose: 'swing' }],
      ['Great Fireball Jutsu', 'cone', { element: 'fire', form: 'breath', pose: 'breath' }],
      ['Destructo Disc', 'projectile', { form: 'disc', pose: 'overhead', impact: 'pierce' }],
      ['Spirit Bomb', 'projectile', { form: 'orb', pose: 'overhead', charge: 'sky', intensity: 1.8 }],
      ['Instant Transmission', 'blink', { form: 'flash', pose: 'fingers' }],
      ['Shadow Clone', 'dash', { form: 'afterimage' }],
      ['Mjolnir', 'zone', { element: 'lightning', form: 'rain', charge: 'sky' }],
      // plain names: an element and a form from the words, and no call-out
      ['Energy wave', 'beam', { element: 'energy', form: 'wave' }],
      ['Frost shards', 'cone', { element: 'ice', form: 'shards' }],
      ['Gold coin toss', 'projectile', { element: 'money' }],
    ]
    for (const [name, kind, want] of cases) {
      const look = lookFor(name, kind)
      expect(look, name).toMatchObject(want)
      expect(!!look?.callout, name).toBe(!/wave|shards|coin/i.test(name))
    }
  })

  it('takes a famous move on a delivery its form does not fit, keeping the colours', () => {
    const look = lookFor('Kamehameha', 'zone')!
    expect(look.element).toBe('energy')
    expect(look.form).toBeUndefined()
    expect(look.palette).toEqual(lookFor('Kamehameha', 'beam')!.palette)
    trueToSize('zone', look, 'kamehameha zone')
  })

  it('gives no look to words that name no element, so the skill keeps its neutral one', () => {
    expect(lookFromWords({ own: 'Quick strike', kind: 'melee' })).toBeUndefined()
    expect(lookFromWords({ own: 'Quick strike', kind: 'melee', signature: 'money' })?.element).toBe('money')
  })

  it("leaves basic attacks and ultimates their own clips unless the words name a pose", () => {
    expect(lookFromWords({ own: 'Fire bolt', kind: 'projectile', slot: 'basic' })?.pose).toBeUndefined()
    expect(lookFromWords({ own: 'Fire bolt', kind: 'projectile', slot: 'active1' })?.pose).toBe('fingers')
    expect(lookFromWords({ own: 'Meteor storm', kind: 'zone', slot: 'ultimate' })?.pose).toBeUndefined()
    expect(lookFromWords({ own: 'Meteor storm, called down', kind: 'zone', slot: 'ultimate' })?.pose).toBe('summon')
  })

  it('stores a look field by field, dropping anything it does not know', () => {
    expect(hydrateSkillLook({ element: 'plasma' })).toBeUndefined()
    expect(hydrateSkillLook('fire')).toBeUndefined()
    const l = hydrateSkillLook({ element: 'fire', palette: ['red', '#00ff00', '#0000ff'], form: 'banana', pose: 'palms', charge: 'sky', intensity: 9, callout: 'yes', trail: 'motif', motif: 'coin' })!
    expect(l).toEqual({ element: 'fire', palette: elementLook('fire').palette, pose: 'palms', charge: 'sky', trail: 'motif', motif: 'coin' })
    const kame = lookFor('Kamehameha', 'beam')!
    expect(hydrateSkillLook(JSON.parse(JSON.stringify(kame)))).toEqual(kame)
  })
})

describe('transformation looks (R23)', () => {
  it('reads the famous transformations whole: how each arrives, what it wears and what it leaves behind', () => {
    expect(lookFor('Super Saiyan')!.transformation).toEqual({ entry: 'burst', aura: 'flame', body: { hair: 'hair_spiky', hairColor: '#ffd84a', eyes: '#2fd6c8' } })
    expect(lookFor('Nine-Tails Chakra Mode')!.transformation).toMatchObject({ entry: 'swirl', aura: 'chakra', avatar: 'tails', body: { eyes: '#e0301b', marks: 'whiskers' } })
    expect(lookFor('Ant-Man')!.transformation).toEqual({ entry: 'implode', growth: 'snap', trail: 'streak' })
    expect(lookFor('Titan')!.transformation).toEqual({ entry: 'strike', aura: 'steam', growth: 'swell' })
    expect(lookFor('Susanoo')!.transformation).toMatchObject({ avatar: 'spirit' })
    // Giant-Man grows: he is not Ant-Man
    expect(lookFor('Giant Man')?.transformation).toBeUndefined()
  })

  it('stores a transformation look field by field, dropping anything it does not know', () => {
    for (const name of ['Super Saiyan', 'Nine-Tails', 'Ant-Man', 'Titan', 'Susanoo']) {
      const look = lookFor(name)!
      expect(hydrateSkillLook(JSON.parse(JSON.stringify(look))), name).toEqual(look)
    }
    const wear = [{ id: 'kimono', colors: ['#112233', '#445566', '#778899', '#aabbcc', '#ddeeff'] }, { id: 'long_coat' }, { id: 'nope' }, { id: 'hair_spiky' }]
    const look = hydrateSkillLook({ element: 'fire', transformation: { entry: 'explode', aura: 'flame', growth: 'swell', avatar: 'dragon', body: { hair: 'beanie', hairColor: 'GOLD', eyes: '#FF0000', marks: 'tattoos', wear } } })!
    // five channels is one too many, a second full-body item gives way to the first, and hair is not wear
    expect(look.transformation).toEqual({ aura: 'flame', growth: 'swell', body: { eyes: '#ff0000', wear: [{ id: 'kimono' }] } })
    expect(hydrateSkillLook({ element: 'fire', transformation: { entry: 'explode' } })!.transformation).toBeUndefined()
  })

  it("transforms a look's own way when it has one, else its element's, swelling unless told to snap", () => {
    expect(formLookOf(undefined)).toEqual({ growth: 'swell', ...ELEMENT_FORM.energy })
    expect(formLookOf(lookFor('Frost shards', 'cone'))).toEqual({ growth: 'swell', entry: 'burst', aura: 'steam' })
    // Ant-Man sets his own, so he gets no aura from his element; a form with only an aura arrives its element's way
    expect(formLookOf(lookFor('Ant-Man'))).toEqual({ entry: 'implode', growth: 'snap', trail: 'streak' })
    expect(formLookOf({ ...elementLook('lightning'), transformation: { aura: 'flame' } })).toEqual({ entry: 'strike', aura: 'flame', growth: 'swell' })
    expect(formLookOf(lookFor('Super Saiyan'))).toMatchObject({ entry: 'burst', aura: 'flame', growth: 'swell' })
  })
})
