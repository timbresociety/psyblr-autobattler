import { describe, expect, it } from 'vitest'
import { BUILD_SLOTS, SLOT_KIND } from '../charter/build'
import { poolFor } from '../charter/templates/catalog'
import { answerQuestion, buildFromReading, hydrateReading, namedSkills, offlineReading, readingSchema, withForm, withRole } from './reading'
import { atRung, canReach, physiqueFromPrompt, wearFromPrompt } from './wardrobe-read'

const ENCORE = 'ENCORE ABJ from Seedhe Maut as he appears on lunch break cover. Skill 1 "encore kha ja" skill 2 "bhussi bar de" and ultimate is a transformation "kendrick se bhi upar"'
const none = { colors: [], finishes: [], print: '', knobs: [] }

describe('the offline reader', () => {
  it('recovers all three of Encore ABJ’s skill names, by slot, and reads the ultimate as a transformation', () => {
    const named = namedSkills(ENCORE)
    expect(named.active1?.name).toBe('Encore Kha Ja')
    expect(named.active2?.name).toBe('Bhussi Bar De')
    expect(named.ultimate?.name).toBe('Kendrick Se Bhi Upar')
    expect(named.ultimate?.does).toMatch(/^Transforms/)
    expect(named.active1?.does).toBe('')
  })

  it('makes the transformation a real one: a fighter or tank on its transformation ultimate', () => {
    const reading = offlineReading({ prompt: ENCORE })
    expect(reading.heroName).toBe('ENCORE ABJ')
    expect(['fighter', 'tank']).toContain(reading.roleId)
    expect(reading.kit.ultimate.template).toBe(reading.roleId === 'tank' ? 'tank-titan-form' : 'fighter-super-form')
    expect(reading.look.gender).toBe('m')
    expect(reading.source).toBe('offline')
    expect(reading.summary).toContain('Kendrick Se Bhi Upar')
  })

  it('asks what each unexplained skill does, with engine mechanics as one-tap answers, and which way the form changes size', () => {
    const reading = offlineReading({ prompt: ENCORE })
    expect(reading.questions.map((q) => q.about)).toEqual(['active1', 'active2', 'form'])
    expect(reading.questions[0].ask).toBe('What should Encore Kha Ja do?')
    const pool = poolFor(reading.roleId, 'active').map((t) => t.id)
    for (const option of reading.questions[0].options) expect(pool).toContain(option.template)
    const form = reading.questions[2]
    expect(form.ask).toBe('Does Kendrick Se Bhi Upar grow, shrink, or keep his size?')
    expect(form.options.map((o) => o.template)).toEqual(['fighter-super-form', 'fighter-ascended-form', 'assassin-shrink-form', 'tank-titan-form'])
    expect(form.options[3].label).toBe('Titan Form: grows colossal (tank)')
    // the size of the form outranks a face found on the image: the face is worn unless the player says otherwise
    const withFace = offlineReading({ prompt: ENCORE, faceFound: true })
    expect(withFace.questions.map((q) => q.about)).toEqual(['active1', 'active2', 'form'])
    expect(withFace.look.wearFace).toBe(true)
  })

  it('reads the size of a form from the words for it, and asks nothing about it', () => {
    const ant = offlineReading({ prompt: 'Scott Lang. Ultimate shrinks him like Ant-Man: "Pym Particles"' })
    expect(ant.kit.ultimate.template).toBe('assassin-shrink-form')
    expect(ant.roleId).toBe('assassin')
    expect(ant.questions.map((q) => q.about)).not.toContain('form')
    expect(offlineReading({ prompt: 'Naruto. Ultimate turns him into the nine-tails: "Kurama Mode"' }).kit.ultimate.template).toBe('fighter-avatar-form')
    expect(offlineReading({ prompt: 'Goku. Ultimate goes super saiyan: "Kaioken"' }).kit.ultimate.template).toBe('fighter-ascended-form')
  })

  it('an answer settles its question: the kit takes the mechanic picked, the form its size and role, the face theirs', () => {
    const reading = offlineReading({ prompt: ENCORE, faceFound: true })
    const pick = reading.questions[0].options[1]
    const answered = answerQuestion(reading, 0, pick)
    expect(answered.kit.active1.template).toBe(pick.template)
    expect(answered.kit.active1.does).not.toBe('')
    expect(answered.questions).toHaveLength(2)
    const titan = answerQuestion(answered, answered.questions.findIndex((q) => q.about === 'form'), answered.questions[1].options[3])
    expect(titan.roleId).toBe('tank')
    expect(titan.kit.ultimate.template).toBe('tank-titan-form')
    // the names stay the player's across the move to another role
    expect(titan.kit.ultimate.name).toBe('Kendrick Se Bhi Upar')
    expect(titan.kit.active1.name).toBe('Encore Kha Ja')
    expect(withForm(reading, 'fighter-ascended-form').kit.ultimate.template).toBe('fighter-ascended-form')
    expect(withRole(reading, 'tank').kit.ultimate.template).toBe('tank-titan-form')
  })

  it('a correction about the ultimate sizes its form and leaves the hero’s own size alone', () => {
    const first = offlineReading({ prompt: ENCORE })
    const again = offlineReading({ prompt: ENCORE, previous: first, note: 'make the ultimate shrink him down to tiny' })
    expect(again.kit.ultimate.template).toBe('assassin-shrink-form')
    expect(again.roleId).toBe('assassin')
    expect(again.look.size).toBe(first.look.size)
    expect(offlineReading({ prompt: ENCORE, previous: first, note: 'make him huge' }).look.size).toBe('huge')
  })

  it('a correction changes what it names and keeps the rest', () => {
    const first = offlineReading({ prompt: 'a samurai with a katana and a straw hat, Q "Moon Slash"' })
    expect(first.wear.map((w) => w.item)).toEqual(['kasa', 'samurai_armour', 'katana'])
    const again = offlineReading({ prompt: first.summary, previous: first, note: 'no hat, give him a red jacket and long hair' })
    expect(again.wear.find((w) => w.slot === 'head')).toMatchObject({ bare: true })
    expect(again.wear.find((w) => w.slot === 'upper')).toMatchObject({ item: 'bomber', colors: ['#c8242c'], rung: 'recolour' })
    // the jacket is a top, so the samurai armour over the whole body comes off
    expect(again.wear.some((w) => w.slot === 'full')).toBe(false)
    expect(again.wear.find((w) => w.slot === 'hair')?.item).toBe('hair_long')
    expect(again.wear.find((w) => w.slot === 'hand_r')?.item).toBe('katana')
    expect(again.kit.active1.name).toBe('Moon Slash')
  })
})

describe('the offline wardrobe', () => {
  it('reads each thing worn into a library item, its colours onto the item’s channels', () => {
    expect(wearFromPrompt('a queen in gold armour with a red cape and a crown')).toEqual([
      { slot: 'head', phrase: 'crown', item: 'crown', rung: 'wear' },
      { slot: 'full', phrase: 'gold armour', item: 'knight_armour', colors: ['#d4a531'], rung: 'recolour' },
      { slot: 'back', phrase: 'red cape', item: 'cape', colors: ['#c8242c'], rung: 'recolour' },
    ])
  })

  it('dresses a kind of hero only where the words leave room', () => {
    // a samurai carries a katana, but the hoodie named stays a hoodie
    expect(wearFromPrompt('a samurai in a red hoodie').map((w) => [w.slot, w.item])).toEqual([
      ['upper', 'hoodie'],
      ['hand_r', 'katana'],
    ])
  })

  it('a pair fills both hands, and what’s left empty on purpose stays empty', () => {
    expect(wearFromPrompt('an assassin with twin daggers').map((w) => [w.slot, w.item])).toEqual([
      ['hand_r', 'dagger'],
      ['hand_l', 'dagger'],
    ])
    const wizard = wearFromPrompt('a bald old wizard in a blue robe, barefoot')
    expect(wizard.filter((w) => w.bare).map((w) => [w.slot, w.phrase])).toEqual([
      ['hair', 'bald'],
      ['feet', 'barefoot'],
    ])
    expect(wizard.find((w) => w.slot === 'full')).toMatchObject({ item: 'wizard_robe', colors: ['#2a5bd7'] })
  })

  it('a garment the library lacks is a wish to generate, still in its colours', () => {
    const poncho = wearFromPrompt('a cowboy in a brown poncho').find((w) => w.slot === 'upper')
    expect(poncho).toEqual({ slot: 'upper', phrase: 'brown poncho', colors: ['#6a4228'], rung: 'generate' })
    expect(canReach(poncho!, 'wear')).toBe(false)
  })

  it('a wish moves down its rungs to the item as made, and up to generating', () => {
    const [, armour] = wearFromPrompt('a queen in gold armour')
    expect(atRung(armour, 'wear')).toEqual({ slot: 'full', phrase: 'gold armour', item: 'knight_armour', rung: 'wear' })
    expect(atRung(armour, 'generate')).toMatchObject({ item: 'knight_armour', colors: ['#d4a531'], rung: 'generate' })
    // restyling needs a print or a cut to show
    expect(canReach(armour, 'restyle')).toBe(false)
  })

  it('reads a build off the words', () => {
    expect(physiqueFromPrompt('a muscular old man')).toEqual({ weight: 0.5, muscle: 0.9, age: 0.7 })
    expect(physiqueFromPrompt('a hero')).toBeUndefined()
  })
})

describe('an AI reader’s answer', () => {
  it('reads Encore ABJ off the cover: the kasa as made, the kimono recoloured, twin swords, a full beard, and what it couldn’t tell', () => {
    const raw = {
      heroName: 'Encore',
      summary: 'Encore ABJ as on the Lunch Break cover: a wandering swordsman in a wide straw hat and a blue kimono.',
      realPerson: true,
      roleId: 'fighter',
      look: { gender: 'm', size: 'medium', physique: { weight: 0.45, muscle: 0.6, age: 0.1 }, colors: [{ region: 'hair', hex: '#1A1A1A' }], wearFace: true },
      wear: [
        { slot: 'head', phrase: 'Wide straw hat', item: 'kasa', rung: 'wear', ...none },
        { slot: 'full', phrase: 'blue kimono, gold obi', item: 'kimono', rung: 'recolour', ...none, colors: ['#2A4B8D', '#D4A531', ''], finishes: ['silk', '', ''] },
        { slot: 'back', phrase: 'twin swords', item: 'twin_swords', rung: 'wear', ...none },
        { slot: 'beard', phrase: 'full beard', item: 'beard_full', rung: 'wear', ...none },
      ],
      kit: {
        ...Object.fromEntries(BUILD_SLOTS.map((s) => [s, { name: '', does: '', template: '', look: { element: '', form: '', palette: [], pose: '', charge: '', impact: '', trail: '', motif: '', callout: false } }])),
        ultimate: { name: 'Kendrick Se Bhi Upar', does: 'Transforms into a bigger, stronger self', template: 'fighter-super-form', look: { element: 'energy', form: '', palette: ['#FFFFFF', '#FFD23A', '#FF7400'], pose: '', charge: 'gather', impact: '', trail: '', motif: '', callout: true } },
      },
      form: { entry: 'burst', aura: 'flame', growth: 'swell', trail: '', avatar: '', hair: 'hair_spiky', hairColor: '#FFD23A', eyes: '#3AD2FF', marks: '', wear: [] },
      questions: [
        { about: 'active1', ask: 'What should Encore Kha Ja do?', options: ['A devouring combo', 'A sound blast'] },
        { about: 'active2', ask: 'What should Bhussi Bar De do?', options: ['A taunt', 'A stun'] },
        { about: 'form', ask: 'Does he grow, shrink, or keep his size?', options: ['Grows large', 'Keeps his size', 'Shrinks to tiny'] },
      ],
    }
    const reading = hydrateReading(raw, { prompt: ENCORE, heroName: 'Encore ABJ', faceFound: true }, 'claude')
    expect(reading.wear).toEqual([
      { slot: 'head', phrase: 'wide straw hat', item: 'kasa', rung: 'wear' },
      { slot: 'full', phrase: 'blue kimono, gold obi', item: 'kimono', colors: ['#2a4b8d', '#d4a531'], finishes: ['silk'], rung: 'recolour' },
      { slot: 'back', phrase: 'twin swords', item: 'twin_swords', rung: 'wear' },
      { slot: 'beard', phrase: 'full beard', item: 'beard_full', rung: 'wear' },
    ])
    expect(reading.look).toMatchObject({ physique: { weight: 0.45, muscle: 0.6, age: 0.1 }, colors: { hair: '#1a1a1a' }, wearFace: true })
    expect(reading.questions.map((q) => q.about)).toEqual(['active1', 'active2', 'form'])
    expect(reading.questions[2].options.map((o) => o.template)).toEqual(['fighter-super-form', 'fighter-ascended-form', 'assassin-shrink-form'])
    expect(reading.kit.ultimate.template).toBe('fighter-super-form')
    expect(reading.kit.ultimate.look).toMatchObject({ element: 'energy', palette: ['#ffffff', '#ffd23a', '#ff7400'], charge: 'gather', callout: true })
    expect(reading.form).toMatchObject({ entry: 'burst', aura: 'flame', growth: 'swell', body: { hair: 'hair_spiky', hairColor: '#ffd23a', eyes: '#3ad2ff' } })
    // the player's own names stand
    expect(reading.kit.active1.name).toBe('Encore Kha Ja')
  })

  it('keeps only what the vocabulary allows, and the player’s own names whatever the model said', () => {
    const raw = {
      heroName: 'Encore',
      summary: 'A swordsman.',
      realPerson: true,
      roleId: 'fighter',
      look: { gender: 'm', size: 'colossal', physique: { weight: 2, muscle: 0.5, age: 0.5 }, colors: [{ region: 'suit', hex: '#4A6FB5' }, { region: 'skin', hex: 'brown' }, { region: 'iris', hex: '#2E5E3A' }], wearFace: true },
      wear: [
        { slot: 'upper', phrase: 'tee', item: 'tee', rung: 'wear', ...none },
        // a full-body item can't go over a top the reader already gave
        { slot: 'full', phrase: 'kimono', item: 'kimono', rung: 'wear', ...none },
        { slot: 'eyes', phrase: 'laser eyes', item: '', rung: 'generate', ...none },
        // an item named in the wrong slot goes where it's worn
        { slot: 'head', phrase: 'katana', item: 'katana', rung: 'wear', ...none },
        { slot: 'hand_r', phrase: 'laser sword', item: '', rung: 'generate', ...none, colors: ['#FF0000', 'red'], knobs: [{ knob: 'sleeve', value: 0.5 }] },
        { slot: 'hair', phrase: '', item: 'none', rung: 'wear', ...none },
      ],
      kit: {
        ...Object.fromEntries(BUILD_SLOTS.map((s) => [s, { name: `Model Name 42 ${s}`, does: 'Something cool', template: 'not-a-template' }])),
        active1: { name: 'x', does: 'An uppercut', template: 'fighter-rising-uppercut', look: { element: 'sound', form: 'wave', palette: ['#ffffff', '#88ccff', '#2255aa'], pose: '', charge: '', impact: '', trail: '', motif: '', callout: false } },
        ultimate: { name: 'x', does: 'A combo from the sky', template: 'fighter-meteor-combo' },
      },
      form: { entry: 'burst', aura: '', growth: '', trail: '', avatar: '', hair: '', hairColor: '', eyes: '', marks: '', wear: [] },
      questions: [{ about: 'active1', ask: 'What should Encore Kha Ja do?', options: ['A devouring combo', 'A sound blast'] }, { about: 'face', ask: 'Wear the face?', options: ['Yes', 'No'] }, { about: 'nope', ask: 'x', options: ['a', 'b'] }],
    }
    const reading = hydrateReading(raw, { prompt: ENCORE, heroName: 'Encore ABJ', faceFound: false }, 'claude')
    expect(reading.heroName).toBe('Encore ABJ')
    // colossal is no size you can pick; it falls back to the offline reading's
    expect(reading.look.size).toBe('medium')
    expect(reading.look.physique).toEqual({ weight: 1, muscle: 0.5, age: 0.5 })
    expect(reading.look.colors).toEqual({ iris: '#2e5e3a' })
    // no face was found, so there is nothing to wear and nothing to ask
    expect(reading.look.wearFace).toBe(false)
    expect(reading.questions.map((q) => q.about)).toEqual(['active1'])
    expect(reading.wear).toEqual([
      { slot: 'upper', phrase: 'tee', item: 'tee', rung: 'wear' },
      { slot: 'hand_r', phrase: 'katana', item: 'katana', rung: 'wear' },
      { slot: 'hand_l', phrase: 'laser sword', colors: ['#ff0000'], knobs: { sleeve: 0.5 }, rung: 'generate' },
      { slot: 'hair', phrase: 'bald', bare: true, rung: 'wear' },
    ])
    expect(reading.kit.active1.name).toBe('Encore Kha Ja')
    expect(reading.kit.basic.name).toBe('Model Name basic')
    // an uppercut is no beam: the look keeps its element and palette and loses the beam's form
    expect(reading.kit.active1.look).toEqual({ element: 'sound', palette: ['#ffffff', '#88ccff', '#2255aa'] })
    // the ultimate the words chose doesn't transform, so there's no form to keep
    expect(reading.form).toBeUndefined()
    for (const slot of BUILD_SLOTS) expect(poolFor('fighter', SLOT_KIND[slot]).map((t) => t.id)).toContain(reading.kit[slot].template)
    expect(reading.kit.active1.template).not.toBe(reading.kit.active2.template)
  })

  it('the schema asks for every field, so a reader can’t leave one out, and uses nothing structured outputs reject', () => {
    const schema = readingSchema() as { required: string[]; properties: Record<string, { required?: string[]; items?: { required?: string[]; properties: Record<string, { enum?: string[] }> } }> }
    expect(schema.required).toEqual(['heroName', 'summary', 'realPerson', 'roleId', 'look', 'wear', 'kit', 'form', 'questions'])
    expect(schema.properties.kit.required).toEqual([...BUILD_SLOTS])
    const wish = schema.properties.wear.items!
    expect(wish.required).toEqual(['slot', 'phrase', 'item', 'rung', 'colors', 'finishes', 'print', 'knobs'])
    expect(wish.properties.item.enum).toEqual(expect.arrayContaining(['', 'none', 'kasa', 'kimono', 'twin_swords']))
    const walk = (node: unknown): void => {
      if (!node || typeof node !== 'object') return
      const n = node as Record<string, unknown>
      for (const banned of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'pattern']) expect(n).not.toHaveProperty(banned)
      if (n.type === 'object') {
        expect(n.additionalProperties).toBe(false)
        expect(n.required).toEqual(Object.keys(n.properties as object))
      }
      Object.values(n).forEach(walk)
    }
    walk(schema)
  })
})

describe('building from a reading', () => {
  it('gives the hero its role, the names it was read with, the templates it chose and its size', () => {
    const reading = { ...offlineReading({ prompt: ENCORE }), look: { ...offlineReading({ prompt: ENCORE }).look, size: 'large' as const } }
    const build = buildFromReading(reading)
    expect(build.heroName).toBe('ENCORE ABJ')
    expect(build.roleId).toBe(reading.roleId)
    expect(build.sizeClass).toBe('large')
    expect(build.slots.active1.name).toBe('Encore Kha Ja')
    expect(build.slots.ultimate.name).toBe('Kendrick Se Bhi Upar')
    for (const slot of BUILD_SLOTS) expect(build.slots[slot].templateId).toBe(reading.kit[slot].template)
  })
})
