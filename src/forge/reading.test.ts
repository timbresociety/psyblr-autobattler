import { describe, expect, it } from 'vitest'
import { BUILD_SLOTS, SLOT_KIND } from '../charter/build'
import { poolFor } from '../charter/templates/catalog'
import type { BuildSlot } from '../charter/types'
import { ENCORE_COVER_ANSWER, ENCORE_PROMPT } from './examples'
import { answerQuestion, buildFromReading, hydrateReading, namedSkills, offlineReading, readingSchema, withForm, withRole } from './reading'
import { gearFromPrompt } from './gear-read'
import { sculptFromPrompt } from './sculpt-read'

const ENCORE = ENCORE_PROMPT

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
    const pool = poolFor(reading.roleId, SLOT_KIND[reading.questions[0].about as BuildSlot]).map((t) => t.id)
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

  it('reads what a skill does from the words after its name too, when they name a mechanic', () => {
    const samurai = offlineReading({ prompt: 'a samurai in a blue kimono. Ultimate "Moon Slash" goes super saiyan' })
    expect(samurai.kit.ultimate).toMatchObject({ name: 'Moon Slash', template: 'fighter-ascended-form' })
    expect(samurai.questions.map((q) => q.about)).not.toContain('ultimate')
    expect(namedSkills('Q "Moon Slash" stuns everyone. E "Zip"').active1?.does).toBe('Stuns an enemy')
    // words about the hero after a name leave the skill to ask about
    expect(namedSkills('Skill 1 "Fireball" and he wears a red cape').active1).toMatchObject({ name: 'Fireball', does: '' })
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
    const first = offlineReading({ prompt: 'a samurai with a katana and a round shield, Q "Moon Slash"' })
    expect(first.gear).toEqual({ hand_r: 'katana', hand_l: 'shield' })
    const again = offlineReading({ prompt: first.summary, previous: first, note: 'no shield, give him blue eyes' })
    expect(again.gear).toEqual({ hand_r: 'katana' })
    expect(again.look.colors.iris).toBe('#2a5bd7')
    expect(again.kit.active1.name).toBe('Moon Slash')
    // a reading never dresses a hero: what's worn isn't read at all
    expect(offlineReading({ prompt: 'a queen in gold armour with a red cape and a crown' }).gear).toEqual({})
  })
})

describe('a face from words', () => {
  it('sculpts the features a prompt describes, and stacks words that agree, held to each slider’s range', () => {
    expect(sculptFromPrompt('a knight with a square jaw, big eyes and high cheekbones')).toEqual({
      shape_square: 0.6,
      chin_width: 0.4,
      chin_prominence: 0.3,
      eye_size: 0.7,
      eye_opening: 0.4,
      cheekbones: 0.7,
      cheek_volume: -0.3,
    })
    // "big anime eyes" and "wide-set eyes" both move the eyes; "gaunt" and "hollow cheeks" both empty the cheeks
    expect(sculptFromPrompt('anime eyes, wide-set eyes, gaunt, hollow cheeks')).toMatchObject({ eye_size: 0.7, eye_spacing: 0.5, cheek_volume: -0.7, head_fullness: -0.4 })
    expect(sculptFromPrompt('a wizard in a blue robe')).toBeUndefined()
  })

  it('reads the face onto the offline reading, and a correction changes only what it names', () => {
    const first = offlineReading({ prompt: 'a samurai with a long face and thin lips' })
    expect(first.look.sculpt).toMatchObject({ shape_rectangular: 0.6, head_width: -0.3, mouth_fullness: -0.6 })
    const next = offlineReading({ prompt: 'a samurai with a long face and thin lips', previous: first, note: 'give him a strong chin' })
    expect(next.look.sculpt).toMatchObject({ shape_rectangular: 0.6, mouth_fullness: -0.6, chin_prominence: 0.6, chin_height: 0.3 })
  })

  it('takes an AI reader’s listed sliders, known ones only, and the offline face when it lists none', () => {
    const listed = hydrateReading({ look: { sculpt: [{ feature: 'eye_size', value: 0.8 }, { feature: 'not_a_slider', value: 1 }, { feature: 'nose_width', value: -4 }] } }, { prompt: 'a ninja' }, 'claude')
    expect(listed.look.sculpt).toEqual({ eye_size: 0.8, nose_width: -1 })
    const none = hydrateReading({ look: { sculpt: [] } }, { prompt: 'a ninja with a button nose' }, 'claude')
    expect(none.look.sculpt).toEqual({ nose_length: -0.5, nose_width: -0.3 })
  })
})

describe('the offline hands', () => {
  it('arms a kind of hero only where the words leave room', () => {
    // a samurai carries a katana, but the spear named stays a spear
    expect(gearFromPrompt('a samurai with a spear')).toEqual({ hand_r: 'spear' })
    expect(gearFromPrompt('a samurai')).toEqual({ hand_r: 'katana' })
  })

  it('a pair fills both hands, an off-hand piece the left, and a skill’s quoted name nothing', () => {
    expect(gearFromPrompt('an assassin with twin daggers')).toEqual({ hand_r: 'dagger', hand_l: 'dagger' })
    expect(gearFromPrompt('a knight with a sword and a round shield')).toEqual({ hand_r: 'sword', hand_l: 'shield' })
    expect(gearFromPrompt('a wizard, Q "Axe of Ages"')).toEqual({ hand_r: 'staff' })
  })
})

describe('an AI reader’s answer', () => {
  it('reads Encore ABJ off the cover: twin katanas, the body, and what it couldn’t tell', () => {
    const raw = structuredClone(ENCORE_COVER_ANSWER)
    const reading = hydrateReading(raw, { prompt: ENCORE, heroName: 'Encore ABJ', faceFound: true }, 'claude')
    expect(reading.gear).toEqual({ hand_r: 'katana', hand_l: 'katana' })
    expect(reading.look).toMatchObject({ physique: { weight: 0.45, muscle: 0.6, age: 0.1 }, colors: { brow: '#1a1a1a' }, wearFace: true })
    expect(reading.questions.map((q) => q.about)).toEqual(['active1', 'active2', 'form'])
    expect(reading.questions[2].options.map((o) => o.template)).toEqual(['fighter-super-form', 'fighter-ascended-form', 'assassin-shrink-form'])
    expect(reading.kit.ultimate.template).toBe('fighter-super-form')
    expect(reading.kit.ultimate.look).toMatchObject({ element: 'energy', palette: ['#ffffff', '#ffd23a', '#ff7400'], charge: 'gather', callout: true })
    expect(reading.form).toMatchObject({ entry: 'burst', aura: 'flame', growth: 'swell', body: { eyes: '#3ad2ff' } })
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
      // a shield can't go in the right hand, and a lightsaber isn't a built-in
      gear: { hand_r: 'shield', hand_l: 'lightsaber', head: 'katana' },
      kit: {
        ...Object.fromEntries(BUILD_SLOTS.map((s) => [s, { name: `Model Name 42 ${s}`, does: 'Something cool', template: 'not-a-template' }])),
        active1: { name: 'x', does: 'An uppercut', template: 'fighter-rising-uppercut', look: { element: 'sound', form: 'wave', palette: ['#ffffff', '#88ccff', '#2255aa'], pose: '', charge: '', impact: '', trail: '', motif: '', callout: false } },
        ultimate: { name: 'x', does: 'A combo from the sky', template: 'fighter-meteor-combo' },
      },
      form: { entry: 'burst', aura: '', growth: '', trail: '', avatar: '', eyes: '', marks: '' },
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
    expect(reading.gear).toEqual({})
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
    const schema = readingSchema() as { required: string[]; properties: Record<string, { required?: string[]; properties?: Record<string, { enum?: string[] }> }> }
    expect(schema.required).toEqual(['heroName', 'summary', 'realPerson', 'roleId', 'look', 'gear', 'kit', 'form', 'questions'])
    expect(schema.properties.kit.required).toEqual([...BUILD_SLOTS])
    const gear = schema.properties.gear
    expect(gear.required).toEqual(['hand_r', 'hand_l'])
    expect(gear.properties!.hand_r.enum).toEqual(expect.arrayContaining(['', 'katana', 'staff']))
    expect(gear.properties!.hand_r.enum).not.toContain('shield')
    expect(gear.properties!.hand_l.enum).toContain('shield')
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
