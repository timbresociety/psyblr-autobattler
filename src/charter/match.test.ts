import { describe, expect, it } from 'vitest'
import { matchTemplate, nearestAlternatives, tokenize } from './match.js'
import { defaultTemplate, getTemplate } from './templates/catalog.js'

describe('description matcher', () => {
  it('"rewind the last 5 seconds" on a Mage active finds a return-to-past template (AE1)', () => {
    const result = matchTemplate('mage', 'active', 'rewind the last 5 seconds of the fight')
    expect(result.template.tags).toContain('return-to-past')
    expect(result.fallback).toBe(false)
  })

  it('maps fantasy wording through synonyms', () => {
    expect(matchTemplate('mage', 'ultimate', 'a giant kamehameha wave').template.id).toBe('mage-mega-beam')
    expect(matchTemplate('tank', 'active', 'throws a chain and drags them in').template.id).toBe('tank-chain-hook')
    expect(matchTemplate('assassin', 'active', 'turns invisible and slips away').template.id).toBe('assassin-vanish')
    expect(matchTemplate('fighter', 'ultimate', 'goes super saiyan').template.id).toBe('fighter-super-form')
  })

  it('an empty description returns the role default for that slot, flagged as a fallback', () => {
    const result = matchTemplate('support', 'ultimate', '')
    expect(result.template.id).toBe(defaultTemplate('support', 'ultimate').id)
    expect(result.fallback).toBe(true)
  })

  it('unknown words do not throw and fall back to the role default', () => {
    const result = matchTemplate('marksman', 'active', 'zxqv blorp')
    expect(result.template.id).toBe(defaultTemplate('marksman', 'active').id)
    expect(result.fallback).toBe(true)
  })

  it('is deterministic', () => {
    const a = matchTemplate('fighter', 'active', 'fast punches and fire')
    const b = matchTemplate('fighter', 'active', 'fast punches and fire')
    expect(a.template.id).toBe(b.template.id)
  })

  it('can exclude a template, so the second active differs from the first', () => {
    const first = matchTemplate('mage', 'active', 'fireball')
    const second = matchTemplate('mage', 'active', 'fireball', [first.template.id])
    expect(second.template.id).not.toBe(first.template.id)
  })

  it('only returns templates from the role pool for that slot', () => {
    const result = matchTemplate('tank', 'active', 'snipe from far away with a rifle')
    expect(result.template.roles).toContain('tank')
    expect(result.template.slot).toBe('active')
  })
})

describe('nearest alternatives', () => {
  it('gives 2 to 3 options from the same slot and role, never the chosen one', () => {
    const chosen = getTemplate('mage-chrono-rewind')
    const alternatives = nearestAlternatives('mage', 'active', chosen.id, 'rewind the last 5 seconds')
    expect(alternatives.length).toBeGreaterThanOrEqual(2)
    expect(alternatives.length).toBeLessThanOrEqual(3)
    for (const alt of alternatives) {
      expect(alt.id).not.toBe(chosen.id)
      expect(alt.slot).toBe('active')
      expect(alt.roles).toContain('mage')
    }
  })

  it('is deterministic', () => {
    const a = nearestAlternatives('tank', 'ultimate', 'tank-earthquake', 'shake the ground')
    const b = nearestAlternatives('tank', 'ultimate', 'tank-earthquake', 'shake the ground')
    expect(a.map((t) => t.id)).toEqual(b.map((t) => t.id))
  })
})

describe('tokenize', () => {
  it('lowercases, drops stop words and joins two-word phrases', () => {
    const tokens = tokenize('Opens a Black Hole')
    expect(tokens).toContain('black-hole')
    expect(tokens).not.toContain('a')
  })
})
