import { describe, expect, it } from 'vitest'
import { coloursFromPrompt, genderFromPrompt, nameFromPrompt, partsFromPrompt, sizeFromPrompt, skillsFromPrompt } from './prompt.js'

describe('reading a Forge prompt', () => {
  it('takes the name from capitalised words, the culture table, or the words that describe the hero', () => {
    expect(nameFromPrompt('Jensen Huang in a Raiden-like avatar as a GPU god')).toBe('Jensen Huang')
    expect(nameFromPrompt('A samurai with a katana and a straw hat')).toBe('Samurai')
    expect(nameFromPrompt('a time-bending samurai who rewinds fights')).toBe('Time-Bending Samurai')
    expect(nameFromPrompt('make goku but as a chef')).toBe('Goku')
    expect(nameFromPrompt('   ')).toBe('Unnamed Hero')
    // capitalised skill names belong to the skills, not the hero
    expect(nameFromPrompt('a giant samurai with skills around Moon Slash and Tide Turn')).toBe('Giant Samurai')
  })

  it('reads a size only when the prompt asks for one', () => {
    expect(sizeFromPrompt('a giant who shields the whole team')).toBe('huge')
    expect(sizeFromPrompt('a tiny gremlin with a wrench')).toBe('tiny')
    expect(sizeFromPrompt('a GPU god')).toBeUndefined()
  })

  it('names skills from the themes the prompt lists, with a dash theme in the movement slot', () => {
    const skills = skillsFromPrompt('Jensen as a GPU god with skills around CUDA, Stonks and a lightning dash')
    expect(skills.active1?.name).toBe('CUDA')
    expect(skills.active2?.name).toBe('Stonks')
    expect(skills.movement?.name).toBe('A Lightning Dash')
    // the culture table fills what the prompt left: Jensen's barrage takes the ultimate, his law the passive
    expect(skills.ultimate?.name).toBe('CUDA Core Barrage')
    expect(skills.passive?.name).toBe("Huang's Law Overclock")
  })

  it('counts a theme once, and names a basic attack or passive only with a theme that fits it', () => {
    const skills = skillsFromPrompt('Jensen Huang as a GPU god, skills around CUDA and tensor beams')
    expect(skills.active1?.name).toBe('CUDA')
    expect(skills.active2?.name).toBe('Tensor Beams')
    expect(skills.ultimate?.name).toBe('CUDA Core Barrage')
    expect(skills.passive?.name).toBe("Huang's Law Overclock")
    expect(skills.basic).toBeUndefined()
    expect(Object.values(skills).filter((s) => /tensor beam/i.test(s?.name ?? ''))).toHaveLength(1)
  })

  it('leaves the kit to the engine when the prompt names no skills', () => {
    expect(skillsFromPrompt('a quiet librarian')).toEqual({})
  })
})

describe('the look a prompt asks for', () => {
  it('reads colours by noun, brand colours included', () => {
    expect(coloursFromPrompt('a knight in gold armour with a red cape')).toEqual({ metal: '#d4a531', cape: '#c8242c' })
    expect(coloursFromPrompt('Jensen in a black leather jacket')).toEqual({ suit: '#1a1a1e' })
    expect(coloursFromPrompt('a GPU god glowing NVIDIA green')).toEqual({ suit: '#76b900' })
    expect(coloursFromPrompt('a red-haired witch with long hair')).toEqual({})
  })

  it('reads a stated gender, and leaves it alone when the prompt does not say', () => {
    expect(genderFromPrompt('a queen who freezes the battlefield')).toBe('f')
    expect(genderFromPrompt('a GPU god of compute')).toBe('m')
    expect(genderFromPrompt('a robot made of tensors')).toBeUndefined()
  })

  it('reads hair, armour and a cape', () => {
    expect(partsFromPrompt('a bald monk with a cape')).toEqual({ hair: 'none', cape: true })
    expect(partsFromPrompt('an armoured knight')).toEqual({ hair: 'helmet', armour: true })
    expect(partsFromPrompt('a samurai with long hair')).toEqual({ hair: 'long' })
  })
})
