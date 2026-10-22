import { describe, expect, it } from 'vitest'
import { renderTooltip } from './tooltip'
import type { SecondarySheet, Template } from './types'

const rewind: Template = {
  id: 'test-recall',
  name: 'Recall Step',
  slot: 'active',
  roles: ['mage'],
  tags: ['return-to-past', 'blink', 'heal'],
  delivery: { kind: 'blink', range: 8 },
  effects: [
    { kind: 'mobility', distance: 8 },
    { kind: 'heal', amount: 60, ratio: 0.5, target: 'self' },
  ],
  cooldown: 14,
  ai: { use: 'escape', priority: 8, selfHealthBelow: 0.35 },
}

const sheet = (spiritPower: number): SecondarySheet => ({
  maxHealth: 600, armor: 10, magicResist: 10, moveSpeed: 6, attackSpeed: 1, weaponDamage: 40, fireRate: 1, ammo: 10,
  spiritPower, regen: 2, lifesteal: 0, cooldownReduction: 0,
})

describe('tooltips', () => {
  it("shows the player's skill name on top of the template's real numbers (AE1)", () => {
    const tip = renderTooltip(rewind, { name: 'Rewind', flavour: 'rewind the last 5 seconds' }, sheet(40))
    expect(tip.title).toBe('Rewind')
    expect(tip.mechanic).toBe('Recall Step')
    expect(tip.text).toContain('Rewind')
    expect(tip.lines.join(' ')).toMatch(/Heal 80/)
    expect(tip.lines.join(' ')).toMatch(/Range 8 m/)
    expect(tip.lines.join(' ')).toMatch(/Cooldown 14 s/)
    expect(tip.lines.join(' ')).toMatch(/0\.5× spirit/)
  })

  it('numbers follow the hero sheet', () => {
    const low = renderTooltip(rewind, { name: 'Rewind', flavour: '' }, sheet(0))
    const high = renderTooltip(rewind, { name: 'Rewind', flavour: '' }, sheet(100))
    expect(low.lines.join(' ')).toMatch(/Heal 60/)
    expect(high.lines.join(' ')).toMatch(/Heal 110/)
  })

  it('cooldown reduction shortens the shown cooldown', () => {
    const tip = renderTooltip(rewind, { name: 'Rewind', flavour: '' }, { ...sheet(40), cooldownReduction: 50 })
    expect(tip.lines.join(' ')).toMatch(/Cooldown 7 s/)
  })

  it('retune steps lower the shown numbers', () => {
    const tip = renderTooltip(rewind, { name: 'Rewind', flavour: '' }, sheet(40), 2)
    expect(tip.lines.join(' ')).not.toMatch(/Heal 80\b/)
    expect(tip.retuned).toBe(true)
  })

  it('renders every effect kind without throwing', () => {
    const all: Template = {
      ...rewind,
      effects: [
        { kind: 'damage', amount: 10, ratio: 1, scaling: 'weaponDamage', type: 'physical', overTime: 3 },
        { kind: 'shield', amount: 10, ratio: 0, target: 'allies', duration: 3 },
        { kind: 'stun', duration: 1 },
        { kind: 'slow', pct: 30, duration: 2 },
        { kind: 'displace', distance: 4 },
        { kind: 'buff', stat: 'damage', pct: 20, duration: 4, target: 'self' },
        { kind: 'execute', thresholdPct: 20, bonusPct: 50 },
      ],
    }
    expect(renderTooltip(all, { name: 'Everything', flavour: '' }, sheet(40)).lines.length).toBeGreaterThan(6)
  })
})
