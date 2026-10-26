import { BUILD_SLOTS } from '../charter/build.js'

/**
 * Encore ABJ, the Forge's worked example: the prompt a player typed, and the answer a reader gives when it can see the
 * Lunch Break cover, in the reading schema's own shape (every field present, '' for none). The reading tests hold the
 * Forge to it and the character charter shows what the Forge makes of it, so the two can't tell different stories.
 */

export const ENCORE_PROMPT = 'ENCORE ABJ from Seedhe Maut as he appears on lunch break cover. Skill 1 "encore kha ja" skill 2 "bhussi bar de" and ultimate is a transformation "kendrick se bhi upar"'

const none = { colors: [], finishes: [], print: '', knobs: [] }
const unseen = { element: '', form: '', palette: [], pose: '', charge: '', impact: '', trail: '', motif: '', callout: false }

export const ENCORE_COVER_ANSWER = {
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
    ...Object.fromEntries(BUILD_SLOTS.map((s) => [s, { name: '', does: '', template: '', look: unseen }])),
    ultimate: { name: 'Kendrick Se Bhi Upar', does: 'Transforms into a bigger, stronger self', template: 'fighter-super-form', look: { ...unseen, element: 'energy', palette: ['#FFFFFF', '#FFD23A', '#FF7400'], charge: 'gather', callout: true } },
  },
  form: { entry: 'burst', aura: 'flame', growth: 'swell', trail: '', avatar: '', hair: 'hair_spiky', hairColor: '#FFD23A', eyes: '#3AD2FF', marks: '', wear: [] },
  questions: [
    { about: 'active1', ask: 'What should Encore Kha Ja do?', options: ['A devouring combo', 'A sound blast'] },
    { about: 'active2', ask: 'What should Bhussi Bar De do?', options: ['A taunt', 'A stun'] },
    { about: 'form', ask: 'Does he grow, shrink, or keep his size?', options: ['Grows large', 'Keeps his size', 'Shrinks to tiny'] },
  ],
}
