import { describe, expect, it } from 'vitest'
import { BUILD_SLOTS, SLOT_KIND } from '../charter/build'
import { poolFor } from '../charter/templates/catalog'
import { answerQuestion, buildFromReading, hydrateReading, namedSkills, offlineReading, readingSchema, withRole } from './reading'

const ENCORE = 'ENCORE ABJ from Seedhe Maut as he appears on lunch break cover. Skill 1 "encore kha ja" skill 2 "bhussi bar de" and ultimate is a transformation "kendrick se bhi upar"'

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

  it('asks what each unexplained skill does, with engine mechanics as one-tap answers, and which transformation', () => {
    const reading = offlineReading({ prompt: ENCORE })
    expect(reading.questions.map((q) => q.about)).toEqual(['active1', 'active2', 'role'])
    expect(reading.questions[0].ask).toBe('What should Encore Kha Ja do?')
    const pool = poolFor(reading.roleId, 'active').map((t) => t.id)
    for (const option of reading.questions[0].options) expect(pool).toContain(option.template)
    // a face found on the image is worth a question too, ahead of the transformation
    expect(offlineReading({ prompt: ENCORE, faceFound: true }).questions.map((q) => q.about)).toEqual(['active1', 'active2', 'face'])
  })

  it('a quote with no slot word near it is a nickname, not a skill', () => {
    expect(namedSkills('Jeff "Prime" Bezos, a tank who never stops')).toEqual({})
    expect(namedSkills('Q "Moon Slash", E "Tide Turn", passive: "Undertow"')).toMatchObject({ active1: { name: 'Moon Slash' }, active2: { name: 'Tide Turn' }, passive: { name: 'Undertow' } })
  })

  it('an answer settles its question: the kit takes the mechanic picked, the face and the role theirs', () => {
    const reading = offlineReading({ prompt: ENCORE, faceFound: true })
    const pick = reading.questions[0].options[1]
    const answered = answerQuestion(reading, 0, pick)
    expect(answered.kit.active1.template).toBe(pick.template)
    expect(answered.kit.active1.does).not.toBe('')
    expect(answered.questions).toHaveLength(2)
    const faceless = answerQuestion(answered, answered.questions.findIndex((q) => q.about === 'face'), { label: 'No', value: 'no' })
    expect(faceless.look.wearFace).toBe(false)
    expect(withRole(reading, 'tank').kit.ultimate.template).toBe('tank-titan-form')
  })

  it('a correction changes what it names and keeps the rest', () => {
    const first = offlineReading({ prompt: 'a samurai with a katana and a straw hat, Q "Moon Slash"' })
    expect(first.gear.map((g) => g.phrase)).toEqual(expect.arrayContaining(['katana', 'straw hat']))
    const again = offlineReading({ prompt: first.summary, previous: first, note: 'no hat, give him a red jacket and long hair' })
    expect(again.gear.map((g) => g.phrase)).toEqual(['katana'])
    expect(again.look.colors.suit).toBe('#c8242c')
    expect(again.look.hair).toBe('long')
    expect(again.kit.active1.name).toBe('Moon Slash')
  })
})

describe('an AI reader’s answer', () => {
  it('keeps only what the vocabulary allows, and the player’s own names whatever the model said', () => {
    const raw = {
      heroName: 'Encore',
      summary: 'Encore ABJ as on the Lunch Break cover: a wandering swordsman in a wide straw hat and an open blue robe.',
      realPerson: true,
      roleId: 'fighter',
      look: { gender: 'm', size: 'colossal', hair: 'long', beard: 'goatee', armour: false, cape: false, colors: [{ region: 'suit', hex: '#4A6FB5' }, { region: 'skin', hex: 'brown' }], wearFace: true },
      gear: [{ phrase: 'Wide Straw Hat', kind: 'head' }, { phrase: 'katana', kind: 'hand' }, { phrase: 'laser eyes', kind: 'eyes' }],
      kit: Object.fromEntries(BUILD_SLOTS.map((s) => [s, { name: `Model Name 42 ${s}`, does: 'Something cool', template: 'not-a-template' }])),
      questions: [{ about: 'active1', ask: 'What should Encore Kha Ja do?', options: ['A devouring combo', 'A sound blast'] }, { about: 'face', ask: 'Wear the face?', options: ['Yes', 'No'] }, { about: 'nope', ask: 'x', options: ['a', 'b'] }],
    }
    const reading = hydrateReading(raw, { prompt: ENCORE, heroName: 'Encore ABJ', faceFound: false }, 'claude')
    expect(reading.heroName).toBe('Encore ABJ')
    // colossal is no size you can pick; it falls back to the offline reading's
    expect(reading.look.size).toBe('medium')
    expect(reading.look.colors).toEqual({ suit: '#4a6fb5' })
    // no face was found, so there is nothing to wear and nothing to ask
    expect(reading.look.wearFace).toBe(false)
    expect(reading.questions.map((q) => q.about)).toEqual(['active1'])
    expect(reading.gear).toEqual([{ phrase: 'wide straw hat', kind: 'head' }, { phrase: 'katana', kind: 'hand' }])
    expect(reading.kit.active1.name).toBe('Encore Kha Ja')
    expect(reading.kit.basic.name).toBe('Model Name basic')
    for (const slot of BUILD_SLOTS) expect(poolFor('fighter', SLOT_KIND[slot]).map((t) => t.id)).toContain(reading.kit[slot].template)
    expect(reading.kit.active1.template).not.toBe(reading.kit.active2.template)
  })

  it('the schema asks for every field, so a reader can’t leave one out', () => {
    const schema = readingSchema() as { required: string[]; properties: Record<string, { required?: string[] }> }
    expect(schema.required).toEqual(['heroName', 'summary', 'realPerson', 'roleId', 'look', 'gear', 'kit', 'questions'])
    expect(schema.properties.kit.required).toEqual([...BUILD_SLOTS])
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
