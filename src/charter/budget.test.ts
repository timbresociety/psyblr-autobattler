import { describe, expect, it } from 'vitest'
import { BUDGET_TOLERANCE, SLOT_BUDGETS, normalizeTemplate, scaleMagnitudes, scoreTemplate, validateTemplate } from './budget'
import type { Template } from './types'

const nova: Template = {
  id: 'test-nova',
  name: 'Test Nova',
  slot: 'active',
  roles: ['mage'],
  tags: ['burst', 'zone'],
  delivery: { kind: 'zone', range: 10, radius: 4 },
  effects: [{ kind: 'damage', amount: 100, ratio: 1, scaling: 'spiritPower', type: 'spirit' }],
  cooldown: 9,
  ai: { use: 'poke', priority: 5, minTargets: 1 },
}

const stunBolt: Template = {
  ...nova,
  id: 'test-stun-bolt',
  name: 'Test Stun Bolt',
  tags: ['stun', 'projectile'],
  delivery: { kind: 'projectile', range: 18 },
  effects: [
    { kind: 'damage', amount: 100, ratio: 1, scaling: 'spiritPower', type: 'spirit' },
    { kind: 'stun', duration: 1.2 },
  ],
}

describe('power budget', () => {
  it('normalized templates in the same slot score within the tolerance', () => {
    const a = scoreTemplate(normalizeTemplate(nova))
    const b = scoreTemplate(normalizeTemplate(stunBolt))
    expect(Math.abs(a - SLOT_BUDGETS.active) / SLOT_BUDGETS.active).toBeLessThanOrEqual(BUDGET_TOLERANCE)
    expect(Math.abs(b - SLOT_BUDGETS.active) / SLOT_BUDGETS.active).toBeLessThanOrEqual(BUDGET_TOLERANCE)
  })

  it('control costs budget, so a stun skill deals less damage after normalizing', () => {
    const plain = normalizeTemplate(nova).effects[0]
    const withStun = normalizeTemplate(stunBolt).effects[0]
    expect(plain.kind === 'damage' && withStun.kind === 'damage').toBe(true)
    if (plain.kind === 'damage' && withStun.kind === 'damage') expect(withStun.amount).toBeLessThan(plain.amount)
  })

  it('an override records its reason and the score targets the override budget', () => {
    const tuned: Template = { ...nova, id: 'test-override', override: { budget: SLOT_BUDGETS.active * 0.9, reason: 'zone is easy to land in team fights' } }
    const score = scoreTemplate(normalizeTemplate(tuned))
    expect(Math.abs(score - SLOT_BUDGETS.active * 0.9) / (SLOT_BUDGETS.active * 0.9)).toBeLessThanOrEqual(BUDGET_TOLERANCE)
    expect(validateTemplate(tuned).ok).toBe(true)
  })

  it('an override without a reason fails validation', () => {
    const bad: Template = { ...nova, override: { budget: 10, reason: '' } }
    expect(validateTemplate(bad).ok).toBe(false)
  })

  it('a template missing AI usage hints fails validation', () => {
    const bad = { ...nova, ai: undefined } as unknown as Template
    expect(validateTemplate(bad).ok).toBe(false)
  })

  it('a template whose control alone exceeds the budget cannot be normalized', () => {
    const lockdown: Template = { ...nova, id: 'test-lockdown', effects: [{ kind: 'stun', duration: 30 }] }
    expect(() => normalizeTemplate(lockdown)).toThrow(/over budget/)
  })

  it('scaling magnitudes by a factor scales damage, heal and shield but not durations', () => {
    const scaled = scaleMagnitudes(stunBolt, 0.5)
    const [damage, stun] = scaled.effects
    expect(damage.kind === 'damage' && damage.amount).toBe(50)
    expect(stun.kind === 'stun' && stun.duration).toBe(1.2)
  })

  it('passives and basics need no cooldown; actives do', () => {
    expect(validateTemplate({ ...nova, cooldown: 0 }).ok).toBe(false)
    expect(validateTemplate({ ...nova, slot: 'basic', cooldown: 0 }).ok).toBe(true)
  })
})
