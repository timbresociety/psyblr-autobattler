import { describe, expect, it } from 'vitest'
import { ROLES, ROLE_IDS, getRole } from './roles'
import { ATTRIBUTES, POOL_SIZE, SECONDARY_STATS, deriveSheet, spentPoints, validateSpread } from './stats'
import type { Spread } from './types'

const full: Spread = { strength: 10, agility: 10, intellect: 10 }

describe('stat model', () => {
  it('a spread that spends the full pool keeps every secondary stat inside its role cap', () => {
    expect(spentPoints(full)).toBe(POOL_SIZE)
    for (const id of ROLE_IDS) {
      const role = getRole(id)
      const { sheet } = deriveSheet(role, full)
      for (const stat of SECONDARY_STATS) {
        expect(sheet[stat]).toBeLessThanOrEqual(role.caps[stat])
        expect(sheet[stat]).toBeGreaterThanOrEqual(0)
      }
    }
  })

  it('the same spread gives different sheets on Tank and Assassin', () => {
    const tank = deriveSheet(getRole('tank'), full).sheet
    const assassin = deriveSheet(getRole('assassin'), full).sheet
    expect(tank.maxHealth).toBeGreaterThan(assassin.maxHealth)
    expect(assassin.weaponDamage).toBeGreaterThan(tank.weaponDamage)
  })

  it('more Strength means more health and armor for the same role', () => {
    const role = getRole('fighter')
    const low = deriveSheet(role, { strength: 2, agility: 14, intellect: 14 }).sheet
    const high = deriveSheet(role, { strength: 18, agility: 6, intellect: 6 }).sheet
    expect(high.maxHealth).toBeGreaterThan(low.maxHealth)
    expect(high.armor).toBeGreaterThan(low.armor)
  })

  it('rejects a spread over the pool total', () => {
    const result = validateSpread(getRole('mage'), { strength: 20, agility: 10, intellect: 10 })
    expect(result.ok).toBe(false)
    expect(result.ok ? [] : result.errors.map((e) => e.reason)).toContain('pool-exceeded')
  })

  it('rejects negative and fractional point values', () => {
    const neg = validateSpread(getRole('mage'), { strength: -1, agility: 10, intellect: 10 })
    const frac = validateSpread(getRole('mage'), { strength: 1.5, agility: 10, intellect: 10 })
    expect(neg.ok ? [] : neg.errors.map((e) => e.reason)).toContain('negative')
    expect(frac.ok ? [] : frac.errors.map((e) => e.reason)).toContain('not-integer')
  })

  it('rejects an attribute above its role cap', () => {
    const role = getRole('tank')
    const result = validateSpread(role, { strength: role.attributeCaps.strength + 1, agility: 0, intellect: 0 })
    expect(result.ok ? [] : result.errors.map((e) => e.reason)).toContain('attribute-cap')
  })

  it('accepts every role default spread', () => {
    for (const role of ROLES) {
      expect(validateSpread(role, role.defaultSpread)).toEqual({ ok: true })
      expect(spentPoints(role.defaultSpread)).toBe(POOL_SIZE)
    }
  })

  it('every role defines every secondary stat for base, caps and weights', () => {
    for (const role of ROLES) {
      for (const stat of SECONDARY_STATS) {
        expect(Number.isFinite(role.base[stat])).toBe(true)
        expect(Number.isFinite(role.caps[stat])).toBe(true)
      }
      for (const attr of ATTRIBUTES) {
        expect(role.weights[attr]).toBeDefined()
      }
    }
  })

  it('reports which stats hit their cap', () => {
    const role = getRole('tank')
    const { capped } = deriveSheet(role, { strength: role.attributeCaps.strength, agility: 0, intellect: POOL_SIZE - role.attributeCaps.strength })
    expect(Array.isArray(capped)).toBe(true)
  })

  it('derivation is deterministic', () => {
    const role = getRole('support')
    expect(deriveSheet(role, full)).toEqual(deriveSheet(role, full))
  })
})
