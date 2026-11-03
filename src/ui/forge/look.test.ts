import { describe, expect, it } from 'vitest'
import { offlineReading, withRole, type Reading } from '../../forge/reading'
import { bodyAfter, gearAfter, readingLook } from './look'

const dress = (reading: Reading) => readingLook(reading)
const read = (prompt: string, roleId?: Reading['roleId']) => {
  const r = offlineReading({ prompt })
  return roleId ? withRole(r, roleId) : r
}

describe('the look a reading draws', () => {
  it('draws the body bare, whatever the words dress it in, and puts the named pieces in its hands', () => {
    const look = dress(read('a queen in gold armour with a red cape and a crown, holding a sword and a round shield', 'mage'))
    expect(look).not.toHaveProperty('wear')
    expect(look).not.toHaveProperty('hair')
    expect(look.gear).toEqual({ hand_r: { id: 'sword', url: '/kit/pieces/sword.glb' }, hand_l: { id: 'shield', url: '/kit/pieces/shield.glb' } })
    expect(dress(read('a stubborn wall of a man', 'tank'))).not.toHaveProperty('gear')
  })

  it('carries the ultimate’s transformation on its look', () => {
    const reading = read('Goku. Ultimate goes super saiyan: "Kaioken"')
    const look = dress({ ...reading, form: { entry: 'burst', aura: 'flame', body: { eyes: '#3ad2ff' } } })
    expect(look.skills?.ultimate?.transformation).toEqual({ entry: 'burst', aura: 'flame', body: { eyes: '#3ad2ff' } })
  })
})

describe('the card, written back into the reading', () => {
  const queen = read('a queen with a sword', 'mage')
  const before = dress(queen)

  it('the hands keep the built-in pieces the player put in them', () => {
    expect(gearAfter(queen, { ...before, gear: { hand_l: { id: 'shield', url: '/kit/pieces/shield.glb' } } }).gear).toEqual({ hand_l: 'shield' })
    expect(gearAfter(queen, { ...before, gear: undefined }).gear).toEqual({})
  })

  it('the body panel writes back its build and the colours it changed, nothing it only showed', () => {
    const drawn = { ...before, colors: { ...before.colors, skin: '#c08a6a', iris: '#334455' } }
    const next = bodyAfter(queen, drawn, { ...drawn, physique: { weight: 0.3, muscle: 0.8, age: 0.2 }, colors: { ...drawn.colors, iris: '#00ff00' } })
    expect(next.look.physique).toEqual({ weight: 0.3, muscle: 0.8, age: 0.2 })
    expect(next.look.colors).toEqual({ ...queen.look.colors, iris: '#00ff00' })
  })
})
